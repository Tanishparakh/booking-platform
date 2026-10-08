import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../db/pool';
import { adminOnly, requireAuth, staffOnly } from '../middleware/auth';
import { conflict, notFound, parse } from '../utils/errors';
import { applyDisputeResolution } from '../services/bookings';
import { audit, bookingEvent, notify } from '../services/notify';

/** Shared by SUPPORT and ADMIN. Support can review and add notes, but cannot refund or release money. */
export const staffRouter = Router();
staffRouter.use(requireAuth, staffOnly);

const DISPUTE_SQL = `SELECT d.*, b.status AS booking_status, b.total_amount, b.client_id, b.professional_id, b.event_type, b.start_date, b.end_date,
    cu.full_name AS client_name, pu.full_name AS professional_name, ru.full_name AS raised_by_name, pay.status AS payment_status
  FROM disputes d JOIN bookings b ON b.id=d.booking_id JOIN users cu ON cu.id=b.client_id JOIN users pu ON pu.id=b.professional_id
  JOIN users ru ON ru.id=d.raised_by LEFT JOIN payments pay ON pay.booking_id=b.id`;

staffRouter.get('/disputes', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  res.json(await query(`${DISPUTE_SQL} WHERE ($1::text IS NULL OR d.status = $1) ORDER BY d.id DESC LIMIT 200`, [status]));
});

staffRouter.get('/disputes/:id', async (req, res) => {
  const d = await one(`${DISPUTE_SQL} WHERE d.id=$1`, [Number(req.params.id)]);
  if (!d) throw notFound('Dispute not found');
  const [messages, events, deliverables] = await Promise.all([
    query('SELECT m.id, m.sender_id, u.full_name AS sender_name, m.content, m.sent_at FROM messages m JOIN users u ON u.id=m.sender_id WHERE booking_id=$1 ORDER BY m.id', [d.booking_id]),
    query('SELECT e.type, e.note, e.created_at, u.full_name AS actor FROM booking_events e LEFT JOIN users u ON u.id=e.actor_id WHERE booking_id=$1 ORDER BY e.id', [d.booking_id]),
    query('SELECT id, file_name, content_type, file_size, round, status FROM deliverables WHERE booking_id=$1 ORDER BY id', [d.booking_id]),
  ]);
  res.json({ ...d, messages, events, deliverables });
});

staffRouter.post('/disputes/:id/notes', async (req, res) => {
  const { note } = parse(z.object({ note: z.string().trim().min(3).max(1000) }), req.body);
  const d = await one('SELECT * FROM disputes WHERE id=$1', [Number(req.params.id)]);
  if (!d) throw notFound('Dispute not found');
  if (d.status === 'RESOLVED') throw conflict('This dispute is already resolved');
  await query("UPDATE disputes SET status='UNDER_REVIEW', handled_by=$1 WHERE id=$2", [req.user!.id, d.id]);
  await bookingEvent(d.booking_id, req.user!.id, 'DISPUTE_NOTE', note);
  res.json({ message: 'Note added; dispute is under review' });
});

async function resolve(dispute: any, actorId: number, type: 'REFUND_CLIENT' | 'RELEASE_PAYOUT' | 'NO_ACTION', note: string) {
  if (dispute.status === 'RESOLVED') throw conflict('This dispute is already resolved');
  const b = await applyDisputeResolution(actorId, dispute.booking_id, type);
  await query("UPDATE disputes SET status='RESOLVED', resolution_type=$1, resolution_note=$2, handled_by=$3, resolved_at=now() WHERE id=$4", [type, note, actorId, dispute.id]);
  await audit(actorId, 'DISPUTE_' + type, 'dispute', dispute.id, note);
  const text = { REFUND_CLIENT: 'The client was refunded in full.', RELEASE_PAYOUT: 'Payment was released to the professional.', NO_ACTION: 'No financial change was made and the booking continues.' }[type];
  await notify(b.client_id, 'DISPUTE_RESOLVED', `Dispute on booking #${b.id} resolved. ${text} ${note}`, b.id);
  await notify(b.professional_id, 'DISPUTE_RESOLVED', `Dispute on booking #${b.id} resolved. ${text} ${note}`, b.id);
}

/** Support may close a dispute with no financial action. */
staffRouter.post('/disputes/:id/close', async (req, res) => {
  const { note } = parse(z.object({ note: z.string().trim().min(3).max(1000) }), req.body);
  const d = await one('SELECT * FROM disputes WHERE id=$1', [Number(req.params.id)]);
  if (!d) throw notFound('Dispute not found');
  await resolve(d, req.user!.id, 'NO_ACTION', note);
  res.json({ message: 'Dispute closed with no action' });
});

/** Only administrators can move money. */
staffRouter.post('/disputes/:id/resolve', adminOnly, async (req, res) => {
  const b = parse(z.object({ type: z.enum(['REFUND_CLIENT', 'RELEASE_PAYOUT', 'NO_ACTION']), note: z.string().trim().min(3).max(1000) }), req.body);
  const d = await one('SELECT * FROM disputes WHERE id=$1', [Number(req.params.id)]);
  if (!d) throw notFound('Dispute not found');
  await resolve(d, req.user!.id, b.type, b.note);
  res.json({ message: 'Dispute resolved' });
});

// ---------- Reported content ----------
staffRouter.get('/reports', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const rows = await query(
    `SELECT r.*, u.full_name AS reporter_name FROM content_reports r JOIN users u ON u.id=r.reporter_id
      WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.id DESC LIMIT 200`, [status]);
  for (const r of rows as any[]) {
    if (r.target_type === 'PORTFOLIO_ITEM') r.target = await one('SELECT id, title, description, hidden, professional_id FROM portfolio_items WHERE id=$1', [r.target_id]);
    else if (r.target_type === 'REVIEW') r.target = await one('SELECT id, rating, comment, hidden, professional_id FROM reviews WHERE id=$1', [r.target_id]);
    else r.target = await one('SELECT u.id, u.full_name, u.status, pr.headline, pr.bio FROM users u JOIN profiles pr ON pr.professional_id=u.id WHERE u.id=$1', [r.target_id]);
  }
  res.json(rows);
});

staffRouter.post('/reports/:id/resolve', async (req, res) => {
  const b = parse(z.object({ action: z.enum(['HIDE', 'DISMISS']), note: z.string().trim().min(3).max(500) }), req.body);
  const r = await one('SELECT * FROM content_reports WHERE id=$1', [Number(req.params.id)]);
  if (!r) throw notFound('Report not found');
  if (r.status !== 'OPEN') throw conflict('This report was already handled');
  await tx(async (db) => {
    if (b.action === 'HIDE') {
      if (r.target_type === 'PORTFOLIO_ITEM') await db.query('UPDATE portfolio_items SET hidden=TRUE WHERE id=$1', [r.target_id]);
      else if (r.target_type === 'REVIEW') await db.query('UPDATE reviews SET hidden=TRUE WHERE id=$1', [r.target_id]);
      else await db.query("UPDATE professionals SET verification_status='REJECTED' WHERE user_id=$1", [r.target_id]); // profile pulled from search until re-verified
    }
    await db.query('UPDATE content_reports SET status=$1, resolution_note=$2, handled_by=$3, resolved_at=now() WHERE id=$4', [b.action === 'HIDE' ? 'ACTION_TAKEN' : 'DISMISSED', b.note, req.user!.id, r.id]);
    await audit(req.user!.id, 'REPORT_' + b.action, 'content_report', r.id, b.note, db);
  });
  res.json({ message: b.action === 'HIDE' ? 'Content hidden' : 'Report dismissed' });
});
