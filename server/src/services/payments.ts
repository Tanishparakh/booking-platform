import { Db, one, pool, query } from '../db/pool';
import { gateway, CardInput } from './gateway';
import { getNumber } from './settings';
import { notify } from './notify';

const money = (n: number) => Math.round(n * 100) / 100;

/** Authorize the card for a booking. Creates/updates the single payment row. */
export async function authorizePayment(db: Db, bookingId: number, amount: number, card: CardInput) {
  const res = await gateway.authorize(amount, card);
  if (!res.ok) {
    await query(
      `INSERT INTO payments (booking_id, amount, card_brand, card_last4, status, failure_reason) VALUES ($1,$2,$3,$4,'FAILED',$5)
       ON CONFLICT (booking_id) DO UPDATE SET status='FAILED', failure_reason=$5`,
      [bookingId, amount, res.brand ?? null, res.last4 ?? null, res.reason ?? 'Declined'], db);
    return { ok: false as const, reason: res.reason ?? 'Payment declined' };
  }
  await query(
    `INSERT INTO payments (booking_id, amount, card_brand, card_last4, status, gateway_txn_id, authorized_at) VALUES ($1,$2,$3,$4,'AUTHORIZED',$5,now())
     ON CONFLICT (booking_id) DO UPDATE SET status='AUTHORIZED', gateway_txn_id=$5, authorized_at=now()`,
    [bookingId, amount, res.brand, res.last4, res.txnId], db);
  return { ok: true as const };
}

/** Professional accepted: capture the authorization, hold funds, snapshot commission. */
export async function captureAndHold(db: Db, booking: any) {
  const pay = await one('SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE', [booking.id], db);
  if (!pay || pay.status !== 'AUTHORIZED') throw new Error('No authorized payment to capture');
  const cap = await gateway.capture(pay.gateway_txn_id);
  if (!cap.ok) throw new Error(cap.reason || 'Capture failed');
  const pct = await getNumber('commission_percent', db);
  const commission = money((Number(booking.total_amount) * pct) / 100);
  await query("UPDATE payments SET status='HELD', captured_at=now(), held_at=now() WHERE id=$1", [pay.id], db);
  await query('UPDATE bookings SET commission_percent=$1, commission_amount=$2, payout_amount=$3 WHERE id=$4',
    [pct, commission, money(Number(booking.total_amount) - commission), booking.id], db);
}

/** Release an authorization that was never captured. */
export async function voidAuthorization(db: Db, bookingId: number) {
  const pay = await one('SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE', [bookingId], db);
  if (!pay || pay.status !== 'AUTHORIZED') return;
  await gateway.void(pay.gateway_txn_id);
  await query("UPDATE payments SET status='CANCELLED' WHERE id=$1", [pay.id], db);
}

/** Refund part or all of the held funds back to the client. */
export async function refundHeld(db: Db, bookingId: number, amount: number) {
  const pay = await one('SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE', [bookingId], db);
  if (!pay || pay.status !== 'HELD') throw new Error('No held payment to refund');
  const refund = money(Math.min(amount, Number(pay.amount)));
  await gateway.refund(pay.gateway_txn_id, refund);
  const full = refund >= Number(pay.amount);
  await query('UPDATE payments SET refunded_amount=$1, refunded_at=now(), status=$2 WHERE id=$3', [refund, full ? 'REFUNDED' : 'HELD', pay.id], db);
  return { refunded: refund, remaining: money(Number(pay.amount) - refund) };
}

/**
 * Release held funds (minus any refund already given) to the professional.
 * Creates the payout record; the transfer itself is attempted by processPendingPayouts.
 */
export async function releaseToProfessional(db: Db, bookingId: number) {
  const booking = await one('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [bookingId], db);
  const pay = await one('SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE', [bookingId], db);
  if (!pay || pay.status !== 'HELD') throw new Error('No held payment to release');
  const gross = money(Number(pay.amount) - Number(pay.refunded_amount));
  const pct = Number(booking.commission_percent ?? (await getNumber('commission_percent', db)));
  const commission = money((gross * pct) / 100);
  const net = money(gross - commission);
  await query("UPDATE payments SET status='RELEASED', released_at=now() WHERE id=$1", [pay.id], db);
  await query('UPDATE bookings SET commission_percent=$1, commission_amount=$2, payout_amount=$3 WHERE id=$4', [pct, commission, net, bookingId], db);
  await query(
    `INSERT INTO payouts (booking_id, professional_id, gross_amount, commission_amount, net_amount) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (booking_id) DO NOTHING`, [bookingId, booking.professional_id, gross, commission, net], db);
  return { professionalId: booking.professional_id as number };
}

/** Attempt every PENDING/FAILED payout (optionally for one professional) that has a payout account. */
export async function processPendingPayouts(professionalId?: number) {
  const rows = await query(
    `SELECT po.*, pa.account_last4 FROM payouts po JOIN payout_accounts pa ON pa.professional_id = po.professional_id
     WHERE po.status IN ('PENDING','FAILED') AND ($1::int IS NULL OR po.professional_id = $1)`, [professionalId ?? null]);
  for (const p of rows) {
    const claimed = await query("UPDATE payouts SET status='PROCESSING' WHERE id=$1 AND status IN ('PENDING','FAILED') RETURNING id", [p.id]);
    if (!claimed.length) continue;
    const res = await gateway.payout(p.account_last4, Number(p.net_amount));
    if (res.ok) {
      await query("UPDATE payouts SET status='PAID', gateway_ref=$1, paid_at=now(), failure_reason=NULL WHERE id=$2", [res.ref, p.id]);
      await notify(p.professional_id, 'PAYOUT_PAID', `Payout of ${Number(p.net_amount).toFixed(2)} for booking #${p.booking_id} has been paid.`, p.booking_id);
    } else {
      await query("UPDATE payouts SET status='FAILED', failure_reason=$1 WHERE id=$2", [res.reason, p.id]);
      await notify(p.professional_id, 'PAYOUT_FAILED', `Payout for booking #${p.booking_id} failed: ${res.reason}. Check your payout account.`, p.booking_id);
    }
  }
}
export { pool };
