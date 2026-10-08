import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { badRequest, conflict, forbidden, notFound, parse } from '../utils/errors';
import { dateString, timeString } from '../utils/dates';
import { DELIVERABLE_TYPES, uploader } from '../utils/upload';
import { storage } from '../services/storage';
import { getNumber } from '../services/settings';
import { signToken } from '../utils/security';
import { bookingEvent, notify } from '../services/notify';
import * as svc from '../services/bookings';

export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

const id = (req: any) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw notFound('Booking not found');
  return n;
};
const uid = (req: any) => req.user.id as number;

const createSchema = z.object({
  packageId: z.number().int(),
  eventType: z.string().trim().min(2).max(100),
  startDate: dateString,
  endDate: dateString,
  startTime: timeString,
  endTime: timeString,
  venue: z.string().trim().min(2).max(300),
  notes: z.string().trim().max(1000).optional(),
  card: z.object({ number: z.string().max(25), expiry: z.string().max(7), cvv: z.string().max(4) }),
});

bookingsRouter.post('/', requireRole('CLIENT'), async (req, res) => {
  const b = await svc.createBooking(uid(req), parse(createSchema, req.body));
  res.status(201).json(await loadBooking(b.id));
});

const LIST_SQL = `SELECT b.id, b.status, b.event_type, b.start_date, b.end_date, b.start_time, b.end_time, b.venue, b.total_amount, b.created_at, b.expires_at,
    b.client_id, b.professional_id, cu.full_name AS client_name, pu.full_name AS professional_name, pk.name AS package_name,
    pay.status AS payment_status, po.status AS payout_status
  FROM bookings b JOIN users cu ON cu.id=b.client_id JOIN users pu ON pu.id=b.professional_id JOIN packages pk ON pk.id=b.package_id
  LEFT JOIN payments pay ON pay.booking_id=b.id LEFT JOIN payouts po ON po.booking_id=b.id`;

bookingsRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const role = req.user!.role;
  let where = 'TRUE';
  const params: any[] = [];
  if (role === 'CLIENT') { params.push(uid(req)); where = 'b.client_id = $1'; }
  else if (role === 'PROFESSIONAL') { params.push(uid(req)); where = 'b.professional_id = $1'; }
  if (status) { params.push(status); where += ` AND b.status = $${params.length}`; }
  res.json(await query(`${LIST_SQL} WHERE ${where} ORDER BY b.id DESC LIMIT 200`, params));
});

async function loadBooking(bid: number) {
  const b = await one(`${LIST_SQL.replace('SELECT b.id,', 'SELECT b.*,')} WHERE b.id = $1`, [bid]);
  if (!b) throw notFound('Booking not found');
  return b;
}

async function authorizeView(req: any, bid: number) {
  const b = await loadBooking(bid);
  const role = req.user.role;
  const ok = role === 'ADMIN' || role === 'SUPPORT' || b.client_id === uid(req) || b.professional_id === uid(req);
  if (!ok) throw notFound('Booking not found'); // do not reveal existence
  return b;
}

bookingsRouter.get('/:id', async (req, res) => {
  const b = await authorizeView(req, id(req));
  const role = req.user!.role;
  const [events, deliverables, dispute, review, payment, payout] = await Promise.all([
    query('SELECT e.type, e.note, e.created_at, u.full_name AS actor FROM booking_events e LEFT JOIN users u ON u.id=e.actor_id WHERE booking_id=$1 ORDER BY e.id', [b.id]),
    query('SELECT id, file_name, content_type, file_size, round, status, uploaded_at FROM deliverables WHERE booking_id=$1 ORDER BY id', [b.id]),
    one('SELECT * FROM disputes WHERE booking_id=$1 ORDER BY id DESC LIMIT 1', [b.id]),
    one('SELECT id, rating, comment, created_at FROM reviews WHERE booking_id=$1', [b.id]),
    one('SELECT status, amount, card_brand, card_last4, refunded_amount, authorized_at, captured_at, released_at, refunded_at FROM payments WHERE booking_id=$1', [b.id]),
    role === 'CLIENT' ? Promise.resolve(null) : one('SELECT status, gross_amount, commission_amount, net_amount, paid_at, failure_reason FROM payouts WHERE booking_id=$1', [b.id]),
  ]);
  // clients never see the platform commission split
  if (role === 'CLIENT') { delete b.commission_percent; delete b.commission_amount; delete b.payout_amount; }
  // professionals should not see client card details
  if (role === 'PROFESSIONAL' && payment) { delete (payment as any).card_brand; delete (payment as any).card_last4; }
  res.json({ ...b, events, deliverables, dispute, review, payment, payout });
});

bookingsRouter.post('/:id/accept', requireRole('PROFESSIONAL'), async (req, res) => {
  await svc.acceptBooking(uid(req), id(req));
  res.json(await loadBooking(id(req)));
});

bookingsRouter.post('/:id/decline', requireRole('PROFESSIONAL'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body ?? {});
  await svc.declineBooking(uid(req), id(req), reason);
  res.json(await loadBooking(id(req)));
});

bookingsRouter.post('/:id/cancel', requireRole('CLIENT', 'PROFESSIONAL'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional() }), req.body ?? {});
  const out = await svc.cancelBooking(req.user!, id(req), reason);
  res.json({ ...out, booking: await loadBooking(id(req)) });
});

// ---------- Deliverables ----------
bookingsRouter.post('/:id/deliverables', requireRole('PROFESSIONAL'), uploader(DELIVERABLE_TYPES, 200).array('files', 20), async (req, res) => {
  const bid = id(req);
  const b = await one('SELECT * FROM bookings WHERE id=$1', [bid]);
  if (!b || b.professional_id !== uid(req)) throw notFound('Booking not found');
  if (!['CONFIRMED', 'REVISION_REQUESTED'].includes(b.status)) throw conflict('Files can only be uploaded for confirmed bookings or open revision requests');
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) throw badRequest('Choose at least one file');
  for (const f of files) {
    const key = await storage.save(`deliverables/${bid}`, f.originalname, f.buffer);
    await query('INSERT INTO deliverables (booking_id, file_name, content_type, file_size, storage_key, round) VALUES ($1,$2,$3,$4,$5,$6)', [bid, f.originalname, f.mimetype, f.size, key, b.revision_round]);
  }
  res.status(201).json({ uploaded: files.length });
});

bookingsRouter.post('/:id/deliver', requireRole('PROFESSIONAL'), async (req, res) => {
  await svc.markDelivered(uid(req), id(req));
  res.json(await loadBooking(id(req)));
});

bookingsRouter.post('/:id/deliverables/:did/link', async (req, res) => {
  const b = await authorizeView(req, id(req));
  const role = req.user!.role;
  const d = await one('SELECT * FROM deliverables WHERE id=$1 AND booking_id=$2', [Number(req.params.did), b.id]);
  if (!d) throw notFound('File not found');
  if (d.status !== 'AVAILABLE') throw conflict('This file has expired and is no longer available');
  if (role === 'CLIENT' && !['DELIVERED', 'REVISION_REQUESTED', 'COMPLETED', 'DISPUTED'].includes(b.status)) throw forbidden('Files are available once the professional marks the work as delivered');
  const mins = await getNumber('download_link_minutes');
  const token = signToken({ purpose: 'dl', did: d.id, sub: uid(req) }, mins * 60);
  res.json({ url: `/api/download?token=${token}`, expiresInMinutes: mins });
});

// ---------- Revisions / approval ----------
bookingsRouter.post('/:id/revision', requireRole('CLIENT'), async (req, res) => {
  const { note } = parse(z.object({ note: z.string().trim().min(5).max(1000) }), req.body);
  await svc.requestRevision(uid(req), id(req), note);
  res.json(await loadBooking(id(req)));
});

bookingsRouter.post('/:id/approve', requireRole('CLIENT'), async (req, res) => {
  await svc.approveBooking(uid(req), id(req));
  res.json(await loadBooking(id(req)));
});

// ---------- Reviews ----------
bookingsRouter.post('/:id/review', requireRole('CLIENT'), async (req, res) => {
  const b = await authorizeView(req, id(req));
  const input = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }), req.body);
  if (b.client_id !== uid(req)) throw forbidden();
  if (b.status !== 'COMPLETED') throw conflict('You can review a booking only after it is completed');
  if (await one('SELECT 1 FROM reviews WHERE booking_id=$1', [b.id])) throw conflict('You have already reviewed this booking');
  const r = await one('INSERT INTO reviews (booking_id, client_id, professional_id, rating, comment) VALUES ($1,$2,$3,$4,$5) RETURNING id, rating, comment, created_at', [b.id, uid(req), b.professional_id, input.rating, input.comment ?? null]);
  await notify(b.professional_id, 'NEW_REVIEW', `You received a ${input.rating}-star review for booking #${b.id}.`, b.id);
  res.status(201).json(r);
});

// ---------- Disputes ----------
bookingsRouter.post('/:id/dispute', requireRole('CLIENT', 'PROFESSIONAL'), async (req, res) => {
  const input = parse(z.object({ reason: z.string().trim().min(3).max(100), description: z.string().trim().min(10).max(2000) }), req.body);
  const bid = id(req);
  const { b, d } = await tx(async (db) => {
    const b = await one('SELECT * FROM bookings WHERE id=$1 FOR UPDATE', [bid], db);
    if (!b || (b.client_id !== uid(req) && b.professional_id !== uid(req))) throw notFound('Booking not found');
    if (!['CONFIRMED', 'DELIVERED', 'REVISION_REQUESTED'].includes(b.status)) throw conflict('A dispute can only be raised while the booking is confirmed or delivered, before it is completed');
    const d = (await db.query('INSERT INTO disputes (booking_id, raised_by, reason, description) VALUES ($1,$2,$3,$4) RETURNING *', [bid, uid(req), input.reason, input.description])).rows[0];
    await db.query("UPDATE bookings SET status='DISPUTED', prior_status=$1, updated_at=now() WHERE id=$2", [b.status, bid]);
    await bookingEvent(bid, uid(req), 'DISPUTE_RAISED', input.reason, db);
    return { b, d };
  });
  const other = b.client_id === uid(req) ? b.professional_id : b.client_id;
  await notify(other, 'DISPUTE_RAISED', `A dispute was raised on booking #${bid}. Our team will review it.`, bid);
  res.status(201).json(d);
});

// ---------- Messages (scoped to a booking) ----------
bookingsRouter.get('/:id/messages', async (req, res) => {
  const b = await authorizeView(req, id(req));
  const rows = await query('SELECT m.id, m.sender_id, u.full_name AS sender_name, m.content, m.sent_at, m.read_at FROM messages m JOIN users u ON u.id=m.sender_id WHERE booking_id=$1 ORDER BY m.id', [b.id]);
  if (req.user!.role === 'CLIENT' || req.user!.role === 'PROFESSIONAL') {
    await query('UPDATE messages SET read_at=now() WHERE booking_id=$1 AND receiver_id=$2 AND read_at IS NULL', [b.id, uid(req)]);
  }
  res.json(rows);
});

bookingsRouter.post('/:id/messages', requireRole('CLIENT', 'PROFESSIONAL'), async (req, res) => {
  const b = await authorizeView(req, id(req));
  const { content } = parse(z.object({ content: z.string().trim().min(1).max(2000) }), req.body);
  if (['DECLINED', 'EXPIRED', 'CANCELLED'].includes(b.status)) throw conflict('Messaging is closed for this booking');
  const receiver = b.client_id === uid(req) ? b.professional_id : b.client_id;
  const m = await one('INSERT INTO messages (booking_id, sender_id, receiver_id, content) VALUES ($1,$2,$3,$4) RETURNING id, sender_id, content, sent_at', [b.id, uid(req), receiver, content]);
  await query('INSERT INTO notifications (user_id, type, message, booking_id) VALUES ($1,$2,$3,$4)', [receiver, 'NEW_MESSAGE', `New message on booking #${b.id}`, b.id]);
  res.status(201).json(m);
});
