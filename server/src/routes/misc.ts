import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { badRequest, conflict, forbidden, notFound, parse, unauthorized } from '../utils/errors';
import { verifyToken } from '../utils/security';
import { storage } from '../services/storage';

/** Public: signed deliverable download (token is the credential; short-lived). */
export const downloadRouter = Router();
downloadRouter.get('/', async (req, res) => {
  let p: any;
  try { p = verifyToken(String(req.query.token || '')); } catch { throw unauthorized('This download link is invalid or has expired'); }
  if (p.purpose !== 'dl') throw unauthorized();
  const d = await one('SELECT * FROM deliverables WHERE id=$1', [p.did]);
  if (!d || d.status !== 'AVAILABLE') throw notFound('File not available');
  const data = await storage.read(d.storage_key);
  res.setHeader('Content-Type', d.content_type);
  res.setHeader('Content-Disposition', `attachment; filename="${d.file_name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
});

export const accountRouter = Router();
accountRouter.use(requireAuth);

accountRouter.get('/notifications', async (req, res) => {
  const rows = await query('SELECT id, type, message, booking_id, is_read, created_at FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 100', [req.user!.id]);
  const unread = (await one('SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND NOT is_read', [req.user!.id])).n;
  res.json({ unread, items: rows });
});
accountRouter.post('/notifications/read', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.number().int()).optional() }), req.body ?? {});
  await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND ($2::int[] IS NULL OR id = ANY($2::int[]))', [req.user!.id, ids ?? null]);
  res.json({ message: 'Marked as read' });
});

accountRouter.post('/reports', async (req, res) => {
  if (!['CLIENT', 'PROFESSIONAL'].includes(req.user!.role)) throw forbidden();
  const b = parse(z.object({ targetType: z.enum(['PROFILE', 'PORTFOLIO_ITEM', 'REVIEW']), targetId: z.number().int(), reason: z.string().trim().min(5).max(500) }), req.body);
  const table = { PROFILE: 'professionals WHERE user_id', PORTFOLIO_ITEM: 'portfolio_items WHERE id', REVIEW: 'reviews WHERE id' }[b.targetType];
  if (!(await one(`SELECT 1 FROM ${table} = $1`, [b.targetId]))) throw notFound('The reported item does not exist');
  const r = await one('INSERT INTO content_reports (reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4) RETURNING id', [req.user!.id, b.targetType, b.targetId, b.reason]);
  res.status(201).json({ id: r.id, message: 'Thank you. Our team will review this report.' });
});
void badRequest; void conflict;
