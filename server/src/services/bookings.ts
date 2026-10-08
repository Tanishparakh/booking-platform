import { PoolClient } from 'pg';
import { one, pool, query, tx } from '../db/pool';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { daysBetween, eachDay, hhmm, todayString } from '../utils/dates';
import { getNumber } from './settings';
import { audit, bookingEvent, notify } from './notify';
import { CardInput } from './gateway';
import { authorizePayment, captureAndHold, processPendingPayouts, refundHeld, releaseToProfessional, voidAuthorization } from './payments';

const money = (n: number) => Math.round(n * 100) / 100;
const MAX_DAYS = 30;

export interface BookingInput {
  packageId: number;
  eventType: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  venue: string;
  notes?: string;
  card: CardInput;
}

async function lockBooking(db: PoolClient, id: number) {
  const b = await one('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id], db);
  if (!b) throw notFound('Booking not found');
  return b;
}

async function setStatus(db: PoolClient, id: number, status: string, reason?: string | null, extra = '') {
  await query(`UPDATE bookings SET status=$1, status_reason=$2, updated_at=now() ${extra} WHERE id=$3`, [status, reason ?? null, id], db);
}

async function freeDays(db: PoolClient, b: any) {
  await query("UPDATE availability SET status='AVAILABLE', booking_id=NULL WHERE booking_id=$1 AND status IN ('HELD','BOOKED')", [b.id], db);
}

// ---------- Create ----------
export async function createBooking(clientId: number, input: BookingInput) {
  const today = todayString();
  if (input.startDate < today) throw badRequest('The start date cannot be in the past');
  if (input.endDate < input.startDate) throw badRequest('The end date cannot be before the start date');
  if (input.endTime <= input.startTime) throw badRequest('The end time must be after the start time');
  const days = eachDay(input.startDate, input.endDate);
  if (days.length > MAX_DAYS) throw badRequest(`A booking can span at most ${MAX_DAYS} days`);

  const pkg = await one(
    `SELECT pk.*, p.verification_status, u.status AS user_status FROM packages pk
       JOIN professionals p ON p.user_id = pk.professional_id JOIN users u ON u.id = pk.professional_id
      WHERE pk.id = $1`, [input.packageId]);
  if (!pkg || !pkg.active) throw notFound('Package not found');
  if (pkg.verification_status !== 'APPROVED' || pkg.user_status !== 'ACTIVE') throw badRequest('This professional is not available for booking');
  const expiryHours = await getNumber('request_expiry_hours');
  const total = money(Number(pkg.price) * days.length);

  const booking = await tx(async (db) => {
    const slots = await query('SELECT * FROM availability WHERE professional_id=$1 AND slot_date = ANY($2::date[]) FOR UPDATE', [pkg.professional_id, days], db);
    const byDate = new Map(slots.map((s: any) => [s.slot_date, s]));
    for (const d of days) {
      const s: any = byDate.get(d);
      if (!s || s.status !== 'AVAILABLE') throw conflict(`The professional is not available on ${d}`);
      if (hhmm(s.start_time) > input.startTime || hhmm(s.end_time) < input.endTime) {
        throw conflict(`On ${d} the professional is only available ${hhmm(s.start_time)}–${hhmm(s.end_time)}`);
      }
    }
    const b = (await db.query(
      `INSERT INTO bookings (client_id, professional_id, package_id, event_type, start_date, end_date, start_time, end_time, venue, notes, total_amount, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + ($12 || ' hours')::interval) RETURNING *`,
      [clientId, pkg.professional_id, pkg.id, input.eventType, input.startDate, input.endDate, input.startTime, input.endTime, input.venue, input.notes ?? null, total, String(expiryHours)])).rows[0];
    await query("UPDATE availability SET status='HELD', booking_id=$1 WHERE professional_id=$2 AND slot_date = ANY($3::date[])", [b.id, pkg.professional_id, days], db);
    await bookingEvent(b.id, clientId, 'REQUESTED', undefined, db);
    return b;
  });

  const auth = await authorizePayment(pool, booking.id, total, input.card);
  if (!auth.ok) {
    await tx(async (db) => {
      const b = await lockBooking(db, booking.id);
      await freeDays(db, b);
      await setStatus(db, b.id, 'CANCELLED', 'Payment failed: ' + auth.reason);
      await bookingEvent(b.id, clientId, 'PAYMENT_FAILED', auth.reason, db);
    });
    throw new ApiError(402, auth.reason, 'PAYMENT_FAILED');
  }
  const client = await one('SELECT full_name FROM users WHERE id=$1', [clientId]);
  await notify(pkg.professional_id, 'BOOKING_REQUEST', `${client.full_name} requested a booking (#${booking.id}) for ${input.startDate}${input.endDate !== input.startDate ? ' to ' + input.endDate : ''}. Please accept or decline.`, booking.id);
  return one('SELECT * FROM bookings WHERE id=$1', [booking.id]);
}

// ---------- Professional responses ----------
export async function acceptBooking(proId: number, id: number) {
  const b = await tx(async (db) => {
    const b = await lockBooking(db, id);
    if (b.professional_id !== proId) throw forbidden();
    if (b.status !== 'PENDING') throw conflict(`Booking is ${b.status.toLowerCase()} and cannot be accepted`);
    if (new Date(b.expires_at) < new Date()) throw conflict('This request has expired');
    await captureAndHold(db, b);
    await query("UPDATE availability SET status='BOOKED' WHERE booking_id=$1", [id], db);
    await setStatus(db, id, 'CONFIRMED', null, ', expires_at = NULL');
    await bookingEvent(id, proId, 'ACCEPTED', undefined, db);
    return b;
  });
  await notify(b.client_id, 'BOOKING_CONFIRMED', `Your booking #${id} was accepted. Payment is held securely until you approve the delivered work.`, id);
}

export async function declineBooking(proId: number, id: number, reason?: string) {
  const b = await tx(async (db) => {
    const b = await lockBooking(db, id);
    if (b.professional_id !== proId) throw forbidden();
    if (b.status !== 'PENDING') throw conflict(`Booking is ${b.status.toLowerCase()} and cannot be declined`);
    await voidAuthorization(db, id);
    await freeDays(db, b);
    await setStatus(db, id, 'DECLINED', reason);
    await bookingEvent(id, proId, 'DECLINED', reason, db);
    return b;
  });
  await notify(b.client_id, 'BOOKING_DECLINED', `Your booking #${id} was declined. Your card has not been charged.${reason ? ' Reason: ' + reason : ''}`, id);
}

// ---------- Cancellation ----------
export async function cancelBooking(user: { id: number; role: string }, id: number, reason?: string) {
  const result = await tx(async (db) => {
    const b = await lockBooking(db, id);
    const isClient = b.client_id === user.id;
    const isPro = b.professional_id === user.id;
    if (!isClient && !isPro) throw notFound("Booking not found");
    if (b.status === 'PENDING') {
      await voidAuthorization(db, id);
      await freeDays(db, b);
      await setStatus(db, id, 'CANCELLED', reason ?? 'Cancelled before acceptance');
      await bookingEvent(id, user.id, 'CANCELLED', reason, db);
      return { b, refund: 0, note: 'Your card has not been charged.' };
    }
    if (b.status !== 'CONFIRMED') throw conflict('Only pending or confirmed bookings can be cancelled');
    if (todayString() > b.start_date) throw conflict('The booking has already started and can no longer be cancelled');
    const pay = await one('SELECT * FROM payments WHERE booking_id=$1 FOR UPDATE', [id], db);
    let refundPct = 100;
    if (isClient) {
      const fullDays = await getNumber('full_refund_days', db);
      if (daysBetween(todayString(), b.start_date) < fullDays) refundPct = await getNumber('late_cancel_refund_percent', db);
    }
    const refundAmount = money((Number(pay.amount) * refundPct) / 100);
    await refundHeld(db, id, refundAmount);
    await freeDays(db, b);
    await setStatus(db, id, 'CANCELLED', reason ?? (isPro ? 'Cancelled by professional' : 'Cancelled by client'));
    await bookingEvent(id, user.id, 'CANCELLED', `${reason ?? ''} (refund ${refundPct}%)`.trim(), db);
    let payoutPro: number | null = null;
    if (refundPct < 100) {
      await releaseToProfessional(db, id);
      await setStatus(db, id, 'CANCELLED', reason ?? 'Late cancellation by client');
      payoutPro = b.professional_id;
    }
    return { b, refund: refundAmount, note: `Refund of ${refundAmount.toFixed(2)} (${refundPct}%) is on its way.`, payoutPro };
  });
  const other = result.b.client_id === user.id ? result.b.professional_id : result.b.client_id;
  await notify(other, 'BOOKING_CANCELLED', `Booking #${id} was cancelled. ${reason ?? ''}`.trim(), id);
  if (result.refund > 0 && result.b.client_id !== user.id) await notify(result.b.client_id, 'REFUND', `You were refunded ${result.refund.toFixed(2)} for booking #${id}.`, id);
  if ((result as any).payoutPro) await processPendingPayouts((result as any).payoutPro);
  return { refund: result.refund, message: result.note };
}

// ---------- Delivery / review cycle ----------
export async function markDelivered(proId: number, id: number) {
  const b = await tx(async (db) => {
    const b = await lockBooking(db, id);
    if (b.professional_id !== proId) throw forbidden();
    if (!['CONFIRMED', 'REVISION_REQUESTED'].includes(b.status)) throw conflict('Files can only be delivered for confirmed bookings or revision requests');
    const n = await one('SELECT count(*)::int AS n FROM deliverables WHERE booking_id=$1 AND round=$2 AND status=\'AVAILABLE\'', [id, b.revision_round], db);
    if (!n || n.n === 0) throw badRequest('Upload at least one file before marking the work as delivered');
    await setStatus(db, id, 'DELIVERED', null, ', delivered_at = now()');
    await bookingEvent(id, proId, 'DELIVERED', b.revision_round ? `Revision ${b.revision_round}` : undefined, db);
    return b;
  });
  await notify(b.client_id, 'DELIVERED', `Your files for booking #${id} are ready. Please review and approve, or request a revision.`, id);
}

export async function requestRevision(clientId: number, id: number, note: string) {
  const b = await tx(async (db) => {
    const b = await lockBooking(db, id);
    if (b.client_id !== clientId) throw forbidden();
    if (b.status !== 'DELIVERED') throw conflict('Revisions can only be requested on delivered work');
    const max = await getNumber('max_revisions', db);
    if (b.revision_round >= max) throw conflict(`The maximum of ${max} revision requests has been reached. You can approve or raise a dispute.`);
    await setStatus(db, id, 'REVISION_REQUESTED', note, ', revision_round = revision_round + 1');
    await bookingEvent(id, clientId, 'REVISION_REQUESTED', note, db);
    return b;
  });
  await notify(b.professional_id, 'REVISION_REQUESTED', `The client requested a revision on booking #${id}: ${note}`, id);
}

async function completeBooking(db: PoolClient, id: number, actorId: number | null, note?: string) {
  await releaseToProfessional(db, id);
  await setStatus(db, id, 'COMPLETED', null, ', completed_at = now()');
  await bookingEvent(id, actorId, 'COMPLETED', note, db);
}

export async function approveBooking(clientId: number, id: number) {
  const b = await tx(async (db) => {
    const b = await lockBooking(db, id);
    if (b.client_id !== clientId) throw forbidden();
    if (b.status !== 'DELIVERED') throw conflict('Only delivered work can be approved');
    await completeBooking(db, id, clientId);
    return b;
  });
  await notify(b.professional_id, 'COMPLETED', `Booking #${id} was approved. Your payout is being processed.`, id);
  await processPendingPayouts(b.professional_id);
}

// ---------- Dispute resolution (admin) ----------
export async function applyDisputeResolution(adminId: number, bookingId: number, type: 'REFUND_CLIENT' | 'RELEASE_PAYOUT' | 'NO_ACTION') {
  const b = await tx(async (db) => {
    const b = await lockBooking(db, bookingId);
    if (b.status !== 'DISPUTED') throw conflict('Booking is not in dispute');
    if (type === 'REFUND_CLIENT') {
      const pay = await one('SELECT amount FROM payments WHERE booking_id=$1', [bookingId], db);
      await refundHeld(db, bookingId, Number(pay.amount));
      await freeDays(db, b);
      await setStatus(db, bookingId, 'CANCELLED', 'Refunded after dispute');
      await bookingEvent(bookingId, adminId, 'DISPUTE_REFUND', undefined, db);
    } else if (type === 'RELEASE_PAYOUT') {
      await completeBooking(db, bookingId, adminId, 'Released after dispute');
    } else {
      await setStatus(db, bookingId, b.prior_status || 'CONFIRMED', null);
      await bookingEvent(bookingId, adminId, 'DISPUTE_CLOSED', undefined, db);
    }
    return b;
  });
  if (type === 'RELEASE_PAYOUT') await processPendingPayouts(b.professional_id);
  return b;
}

// ---------- Background jobs ----------
export async function expirePendingBookings() {
  const due = await query("SELECT id FROM bookings WHERE status='PENDING' AND expires_at < now()");
  for (const { id } of due) {
    try {
      const b = await tx(async (db) => {
        const b = await lockBooking(db, id);
        if (b.status !== 'PENDING') return null;
        await voidAuthorization(db, id);
        await freeDays(db, b);
        await setStatus(db, id, 'EXPIRED', 'The professional did not respond in time');
        await bookingEvent(id, null, 'EXPIRED', undefined, db);
        return b;
      });
      if (b) await notify(b.client_id, 'BOOKING_EXPIRED', `Booking #${id} expired because the professional did not respond. Your card has not been charged.`, id);
    } catch (e) { console.warn('expire failed', id, e); }
  }
  return due.length;
}

export async function autoApproveDelivered() {
  const days = await getNumber('auto_approve_days');
  if (days <= 0) return 0;
  const due = await query("SELECT id FROM bookings WHERE status='DELIVERED' AND delivered_at < now() - ($1 || ' days')::interval", [String(days)]);
  for (const { id } of due) {
    try {
      const b = await tx(async (db) => {
        const b = await lockBooking(db, id);
        if (b.status !== 'DELIVERED') return null;
        await completeBooking(db, id, null, 'Auto-approved after client inactivity');
        return b;
      });
      if (b) {
        await notify(b.client_id, 'AUTO_APPROVED', `Booking #${id} was automatically approved after ${days} days.`, id);
        await notify(b.professional_id, 'COMPLETED', `Booking #${id} was automatically approved. Your payout is being processed.`, id);
        await processPendingPayouts(b.professional_id);
      }
    } catch (e) { console.warn('auto-approve failed', id, e); }
  }
  return due.length;
}

import { storage } from './storage';
export async function retentionCleanup() {
  const fileDays = await getNumber('deliverable_retention_days');
  const old = await query(
    `SELECT d.id, d.storage_key FROM deliverables d JOIN bookings b ON b.id=d.booking_id
      WHERE d.status='AVAILABLE' AND b.status='COMPLETED' AND b.completed_at < now() - ($1 || ' days')::interval`, [String(fileDays)]);
  for (const d of old) {
    try { await storage.remove(d.storage_key); } catch {}
    await query("UPDATE deliverables SET status='EXPIRED' WHERE id=$1", [d.id]);
  }
  const msgDays = await getNumber('message_retention_days');
  await query(
    `DELETE FROM messages m USING bookings b WHERE b.id = m.booking_id AND b.status IN ('COMPLETED','CANCELLED','DECLINED','EXPIRED')
       AND b.updated_at < now() - ($1 || ' days')::interval
       AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id=b.id AND d.status <> 'RESOLVED')`, [String(msgDays)]);
}

export async function runJobs() {
  await expirePendingBookings();
  await autoApproveDelivered();
  await retentionCleanup();
  await processPendingPayouts();
}
void audit;
