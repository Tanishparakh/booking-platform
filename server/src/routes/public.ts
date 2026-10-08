import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db/pool';
import { notFound, parse } from '../utils/errors';
import { dateString, todayString, addDays } from '../utils/dates';
import { storage } from '../services/storage';

export const publicRouter = Router();

const VISIBLE = `p.verification_status = 'APPROVED' AND u.status = 'ACTIVE'`;

const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(['PHOTOGRAPHER', 'VIDEOGRAPHER']).optional(),
  city: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  date: dateString.optional(),
  sort: z.enum(['rating', 'price_asc', 'price_desc', 'newest']).default('rating'),
  page: z.coerce.number().int().min(1).default(1),
});

publicRouter.get('/professionals', async (req, res) => {
  const f = parse(searchSchema, req.query);
  const pageSize = 12;
  const params: any[] = [];
  const add = (v: any) => (params.push(v), `$${params.length}`);
  const where: string[] = [VISIBLE];
  if (f.q) { const p = add(`%${f.q}%`); where.push(`(u.full_name ILIKE ${p} OR pr.headline ILIKE ${p} OR p.specialization ILIKE ${p} OR pr.bio ILIKE ${p})`); }
  if (f.type) where.push(`p.professional_type = ${add(f.type)}`);
  if (f.city) where.push(`(p.operating_city ILIKE ${add(`%${f.city}%`)})`);
  if (f.date) where.push(`EXISTS (SELECT 1 FROM availability a WHERE a.professional_id = u.id AND a.slot_date = ${add(f.date)} AND a.status = 'AVAILABLE')`);
  const base = `FROM users u JOIN professionals p ON p.user_id = u.id JOIN profiles pr ON pr.professional_id = u.id
    LEFT JOIN (SELECT professional_id, MIN(price) AS min_price FROM packages WHERE active GROUP BY professional_id) pk ON pk.professional_id = u.id
    LEFT JOIN (SELECT professional_id, AVG(rating)::float AS avg_rating, COUNT(*)::int AS review_count FROM reviews WHERE NOT hidden GROUP BY professional_id) rv ON rv.professional_id = u.id`;
  const having: string[] = [];
  if (f.minPrice !== undefined) having.push(`pk.min_price >= ${add(f.minPrice)}`);
  if (f.maxPrice !== undefined) having.push(`pk.min_price <= ${add(f.maxPrice)}`);
  if (f.minRating !== undefined) having.push(`COALESCE(rv.avg_rating,0) >= ${add(f.minRating)}`);
  const all = [...where, ...having].join(' AND ');
  const order = { rating: 'COALESCE(rv.avg_rating,0) DESC, rv.review_count DESC NULLS LAST, u.id', price_asc: 'pk.min_price ASC NULLS LAST', price_desc: 'pk.min_price DESC NULLS LAST', newest: 'u.id DESC' }[f.sort];
  const total = (await one(`SELECT count(*)::int AS n ${base} WHERE ${all}`, params)).n;
  const rows = await query(
    `SELECT u.id, u.full_name, p.professional_type, p.operating_city, p.experience_years, p.specialization, pr.headline, pr.hourly_rate,
            (pr.profile_image_key IS NOT NULL) AS has_image, pk.min_price, rv.avg_rating, COALESCE(rv.review_count,0) AS review_count
       ${base} WHERE ${all} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(f.page - 1) * pageSize}`, params);
  res.json({ total, page: f.page, pageSize, results: rows });
});

publicRouter.get('/professionals/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound();
  const pro = await one(
    `SELECT u.id, u.full_name, p.professional_type, p.operating_city, p.experience_years, p.equipment, p.specialization,
            pr.headline, pr.bio, pr.location, pr.hourly_rate, (pr.profile_image_key IS NOT NULL) AS has_image
       FROM users u JOIN professionals p ON p.user_id = u.id JOIN profiles pr ON pr.professional_id = u.id WHERE u.id = $1 AND ${VISIBLE}`, [id]);
  if (!pro) throw notFound('Professional not found');
  const [portfolio, packages, reviews, stats] = await Promise.all([
    query('SELECT id, title, description, media_type FROM portfolio_items WHERE professional_id=$1 AND NOT hidden ORDER BY id DESC', [id]),
    query('SELECT id, name, description, price, duration_hours FROM packages WHERE professional_id=$1 AND active ORDER BY price', [id]),
    query(`SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS client_name FROM reviews r JOIN users u ON u.id = r.client_id
            WHERE r.professional_id=$1 AND NOT r.hidden ORDER BY r.id DESC LIMIT 50`, [id]),
    one('SELECT AVG(rating)::float AS avg, COUNT(*)::int AS n FROM reviews WHERE professional_id=$1 AND NOT hidden', [id]),
  ]);
  res.json({ ...pro, portfolio, packages, reviews, avg_rating: stats.avg, review_count: stats.n });
});

/** Available days in a month window (default: next 90 days). */
publicRouter.get('/professionals/:id/availability', async (req, res) => {
  const id = Number(req.params.id);
  const from = req.query.from ? parse(dateString, req.query.from) : todayString();
  const to = req.query.to ? parse(dateString, req.query.to) : addDays(from, 90);
  const ok = await one(`SELECT 1 FROM users u JOIN professionals p ON p.user_id=u.id WHERE u.id=$1 AND ${VISIBLE}`, [id]);
  if (!ok) throw notFound('Professional not found');
  res.json(await query(
    `SELECT slot_date, start_time, end_time, status FROM availability WHERE professional_id=$1 AND slot_date BETWEEN $2 AND $3 AND slot_date >= CURRENT_DATE ORDER BY slot_date`, [id, from, to]));
});

async function send(res: any, key: string, contentType: string) {
  const data = await storage.read(key);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(data);
}

publicRouter.get('/professionals/:id/image', async (req, res) => {
  const r = await one(`SELECT pr.profile_image_key FROM profiles pr JOIN professionals p ON p.user_id=pr.professional_id JOIN users u ON u.id=p.user_id WHERE pr.professional_id=$1 AND ${VISIBLE}`, [Number(req.params.id)]);
  if (!r?.profile_image_key) throw notFound();
  await send(res, r.profile_image_key, 'image/jpeg');
});

publicRouter.get('/portfolio/:id/media', async (req, res) => {
  const r = await one(
    `SELECT pi.media_key, pi.content_type FROM portfolio_items pi JOIN professionals p ON p.user_id=pi.professional_id JOIN users u ON u.id=p.user_id
      WHERE pi.id=$1 AND NOT pi.hidden AND ${VISIBLE}`, [Number(req.params.id)]);
  if (!r) throw notFound();
  await send(res, r.media_key, r.content_type);
});
