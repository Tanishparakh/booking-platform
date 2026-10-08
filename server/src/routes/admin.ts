import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../db/pool';
import { adminOnly, requireAuth } from '../middleware/auth';
import { badRequest, conflict, notFound, parse } from '../utils/errors';
import { hashPassword, PASSWORD_RULE } from '../utils/security';
import { SETTING_RULES, allSettings } from '../services/settings';
import { storage } from '../services/storage';
import { audit, notify } from '../services/notify';
import { processPendingPayouts } from '../services/payments';

export const adminRouter = Router();
adminRouter.use(requireAuth, adminOnly);

// ---------- Professional verification ----------
adminRouter.get('/verifications', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'PENDING';
  res.json(await query(
    `SELECT v.id, v.professional_id, v.document_type, v.status, v.remarks, v.submitted_at, v.reviewed_at, u.full_name, u.email, p.professional_type, p.operating_city, p.experience_years
       FROM verifications v JOIN users u ON u.id=v.professional_id JOIN professionals p ON p.user_id=u.id
      WHERE v.status = $1 ORDER BY v.submitted_at`, [status]));
});

adminRouter.get('/verifications/:id/document', async (req, res) => {
  const v = await one('SELECT * FROM verifications WHERE id=$1', [Number(req.params.id)]);
  if (!v) throw notFound('Verification not found');
  await audit(req.user!.id, 'VIEW_DOCUMENT', 'verification', v.id);
  res.setHeader('Content-Type', v.content_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(await storage.read(v.document_key));
});

async function review(req: any, approve: boolean) {
  const { remarks } = parse(z.object({ remarks: approve ? z.string().trim().max(500).optional() : z.string().trim().min(3).max(500) }), req.body ?? {});
  const v = await one('SELECT * FROM verifications WHERE id=$1', [Number(req.params.id)]);
  if (!v) throw notFound('Verification not found');
  if (v.status !== 'PENDING') throw conflict('This submission was already reviewed');
  const status = approve ? 'APPROVED' : 'REJECTED';
  await tx(async (db) => {
    await db.query('UPDATE verifications SET status=$1, remarks=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$4', [status, remarks ?? null, req.user.id, v.id]);
    await db.query('UPDATE professionals SET verification_status=$1 WHERE user_id=$2', [status, v.professional_id]);
    await audit(req.user.id, 'VERIFICATION_' + status, 'verification', v.id, remarks, db);
  });
  await notify(v.professional_id, approve ? 'VERIFICATION_APPROVED' : 'VERIFICATION_REJECTED',
    approve ? 'Your profile has been approved. You are now visible to clients and can receive bookings.' : `Your verification was rejected: ${remarks}. You can submit new documents.`);
}
adminRouter.post('/verifications/:id/approve', async (req, res) => { await review(req, true); res.json({ message: 'Approved' }); });
adminRouter.post('/verifications/:id/reject', async (req, res) => { await review(req, false); res.json({ message: 'Rejected' }); });

// ---------- Users ----------
adminRouter.get('/users', async (req, res) => {
  const role = typeof req.query.role === 'string' ? req.query.role : null;
  const q = typeof req.query.q === 'string' && req.query.q ? `%${req.query.q}%` : null;
  res.json(await query(
    `SELECT u.id, u.email, u.full_name, u.role, u.status, u.email_verified, u.created_at, p.verification_status
       FROM users u LEFT JOIN professionals p ON p.user_id=u.id
      WHERE ($1::text IS NULL OR u.role=$1) AND ($2::text IS NULL OR u.full_name ILIKE $2 OR u.email ILIKE $2) ORDER BY u.id DESC LIMIT 300`, [role, q]));
});

async function setStatus(req: any, status: 'ACTIVE' | 'SUSPENDED') {
  const id = Number(req.params.id);
  const u = await one('SELECT id, role, status FROM users WHERE id=$1', [id]);
  if (!u) throw notFound('User not found');
  if (u.id === req.user.id) throw badRequest('You cannot change your own account status');
  if (u.role === 'ADMIN') throw badRequest('Administrator accounts cannot be suspended here');
  await query('UPDATE users SET status=$1 WHERE id=$2', [status, id]);
  await audit(req.user.id, status === 'SUSPENDED' ? 'SUSPEND_USER' : 'REINSTATE_USER', 'user', id, req.body?.reason);
}
adminRouter.post('/users/:id/suspend', async (req, res) => { await setStatus(req, 'SUSPENDED'); res.json({ message: 'User suspended' }); });
adminRouter.post('/users/:id/reinstate', async (req, res) => { await setStatus(req, 'ACTIVE'); res.json({ message: 'User reinstated' }); });

adminRouter.post('/staff', async (req, res) => {
  const b = parse(z.object({
    email: z.string().trim().email(), fullName: z.string().trim().min(2).max(100),
    password: z.string().regex(PASSWORD_RULE, 'Password must be at least 8 characters and contain a letter and a digit'),
    role: z.enum(['SUPPORT', 'ADMIN']).default('SUPPORT'),
  }), req.body);
  if (await one('SELECT 1 FROM users WHERE lower(email)=$1', [b.email.toLowerCase()])) throw conflict('An account with this email already exists');
  const u = await one('INSERT INTO users (email, password_hash, full_name, role, email_verified) VALUES ($1,$2,$3,$4,TRUE) RETURNING id, email, full_name, role',
    [b.email.toLowerCase(), await hashPassword(b.password), b.fullName, b.role]);
  await audit(req.user!.id, 'CREATE_STAFF', 'user', u.id, b.role);
  res.status(201).json(u);
});

// ---------- Settings (commission etc.) ----------
adminRouter.get('/settings', async (_req, res) => res.json(await allSettings()));
adminRouter.put('/settings', async (req, res) => {
  const body = parse(z.record(z.union([z.number(), z.string()])), req.body);
  const entries = Object.entries(body);
  if (!entries.length) throw badRequest('Nothing to update');
  for (const [k, v] of entries) {
    const rule = SETTING_RULES[k];
    if (!rule) throw badRequest(`Unknown setting ${k}`);
    const n = Number(v);
    if (!Number.isFinite(n) || n < rule.min || n > rule.max) throw badRequest(`${k} must be between ${rule.min} and ${rule.max}`);
  }
  await tx(async (db) => {
    for (const [k, v] of entries) {
      await db.query('UPDATE settings SET value=$1, updated_by=$2, updated_at=now() WHERE key=$3', [String(Number(v)), req.user!.id, k]);
      await audit(req.user!.id, 'UPDATE_SETTING', 'setting', null, `${k}=${v}`, db);
    }
  });
  res.json(await allSettings());
});

// ---------- Payments & reports ----------
adminRouter.get('/payments', async (_req, res) => {
  res.json(await query(
    `SELECT pay.id, pay.booking_id, pay.amount, pay.status, pay.refunded_amount, pay.card_brand, pay.card_last4, pay.authorized_at, pay.released_at,
            b.status AS booking_status, b.commission_amount, po.status AS payout_status, po.net_amount, po.failure_reason
       FROM payments pay JOIN bookings b ON b.id=pay.booking_id LEFT JOIN payouts po ON po.booking_id=b.id ORDER BY pay.id DESC LIMIT 300`));
});

adminRouter.post('/payouts/retry', async (_req, res) => { await processPendingPayouts(); res.json({ message: 'Pending payouts processed' }); });

adminRouter.get('/reports/summary', async (_req, res) => {
  const [users, bookings, money, queues] = await Promise.all([
    query('SELECT role, count(*)::int AS n FROM users GROUP BY role'),
    query('SELECT status, count(*)::int AS n FROM bookings GROUP BY status'),
    one(`SELECT COALESCE(sum(amount) FILTER (WHERE status IN ('HELD','RELEASED')),0)::float AS gross,
                COALESCE(sum(amount) FILTER (WHERE status='HELD'),0)::float AS held,
                COALESCE(sum(refunded_amount),0)::float AS refunded FROM payments`),
    one(`SELECT (SELECT count(*) FROM verifications WHERE status='PENDING')::int AS pending_verifications,
                (SELECT count(*) FROM disputes WHERE status<>'RESOLVED')::int AS open_disputes,
                (SELECT count(*) FROM content_reports WHERE status='OPEN')::int AS open_reports,
                (SELECT count(*) FROM payouts WHERE status IN ('PENDING','FAILED'))::int AS pending_payouts`),
  ]);
  const commission = await one("SELECT COALESCE(sum(commission_amount),0)::float AS total FROM bookings WHERE status='COMPLETED'");
  res.json({ users, bookings, money: { ...money, commission: commission.total }, queues });
});

adminRouter.get('/audit', async (_req, res) => {
  res.json(await query('SELECT a.*, u.full_name AS actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200'));
});
