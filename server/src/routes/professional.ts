import { Router } from 'express';
import { z } from 'zod';
import { one, query, tx } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { badRequest, conflict, notFound, parse } from '../utils/errors';
import { DOCUMENT_TYPES, IMAGE_TYPES, VIDEO_TYPES, uploader } from '../utils/upload';
import { dateString, eachDay, timeString, todayString, daysBetween } from '../utils/dates';
import { storage } from '../services/storage';
import { processPendingPayouts } from '../services/payments';
import { audit } from '../services/notify';

export const professionalRouter = Router();
professionalRouter.use(requireAuth, requireRole('PROFESSIONAL'));

const me = (req: any) => req.user.id as number;

// ---------- Profile ----------
async function loadProfile(id: number) {
  return one(
    `SELECT u.id, u.full_name, u.email, u.phone, u.email_verified, p.professional_type, p.operating_city, p.experience_years,
            p.equipment, p.specialization, p.verification_status, pr.headline, pr.bio, pr.location, pr.hourly_rate,
            (pr.profile_image_key IS NOT NULL) AS has_image
       FROM users u JOIN professionals p ON p.user_id = u.id JOIN profiles pr ON pr.professional_id = u.id
      WHERE u.id = $1`,
    [id],
  );
}

professionalRouter.get('/profile', async (req, res) => res.json(await loadProfile(me(req))));

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  headline: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(120).optional(),
  hourlyRate: z.number().min(0).max(1_000_000).optional(),
  operatingCity: z.string().trim().min(2).max(80).optional(),
  experienceYears: z.number().int().min(0).max(70).optional(),
  equipment: z.string().trim().max(300).optional(),
  specialization: z.string().trim().max(200).optional(),
});

professionalRouter.put('/profile', async (req, res) => {
  const b = parse(profileSchema, req.body);
  const id = me(req);
  await tx(async (db) => {
    await db.query('UPDATE users SET full_name = COALESCE($1, full_name), phone = COALESCE($2, phone) WHERE id = $3', [b.fullName ?? null, b.phone ?? null, id]);
    await db.query(
      `UPDATE professionals SET operating_city = COALESCE($1, operating_city), experience_years = COALESCE($2, experience_years),
              equipment = COALESCE($3, equipment), specialization = COALESCE($4, specialization) WHERE user_id = $5`,
      [b.operatingCity ?? null, b.experienceYears ?? null, b.equipment ?? null, b.specialization ?? null, id],
    );
    await db.query(
      `UPDATE profiles SET headline = COALESCE($1, headline), bio = COALESCE($2, bio), location = COALESCE($3, location),
              hourly_rate = COALESCE($4, hourly_rate), updated_at = now() WHERE professional_id = $5`,
      [b.headline ?? null, b.bio ?? null, b.location ?? null, b.hourlyRate ?? null, id],
    );
  });
  res.json(await loadProfile(id));
});

professionalRouter.post('/profile-image', uploader(IMAGE_TYPES, 5).single('image'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an image to upload');
  const key = await storage.save(`profile/${me(req)}`, req.file.originalname, req.file.buffer);
  const old = await one('SELECT profile_image_key FROM profiles WHERE professional_id = $1', [me(req)]);
  await query('UPDATE profiles SET profile_image_key = $1, updated_at = now() WHERE professional_id = $2', [key, me(req)]);
  if (old?.profile_image_key) await storage.remove(old.profile_image_key).catch(() => undefined);
  res.json({ message: 'Profile image updated' });
});

// ---------- Identity verification ----------
professionalRouter.get('/verification', async (req, res) => {
  const p = await one('SELECT verification_status FROM professionals WHERE user_id = $1', [me(req)]);
  const latest = await one('SELECT id, document_type, status, remarks, submitted_at, reviewed_at FROM verifications WHERE professional_id = $1 ORDER BY id DESC LIMIT 1', [me(req)]);
  res.json({ status: p.verification_status, latest: latest ?? null });
});

professionalRouter.post('/verification', uploader(DOCUMENT_TYPES, 10).single('document'), async (req, res) => {
  const { documentType } = parse(z.object({ documentType: z.string().trim().min(2).max(60) }), req.body);
  if (!req.file) throw badRequest('Attach an identity document (PDF, JPG or PNG)');
  const id = me(req);
  const user = await one('SELECT email_verified FROM users WHERE id = $1', [id]);
  if (!user.email_verified) throw badRequest('Verify your email address before submitting identity documents');
  const p = await one('SELECT verification_status FROM professionals WHERE user_id = $1', [id]);
  if (p.verification_status === 'PENDING') throw conflict('Your verification is already waiting for review');
  if (p.verification_status === 'APPROVED') throw conflict('You are already verified');
  const key = await storage.save(`verification/${id}`, req.file.originalname, req.file.buffer);
  await tx(async (db) => {
    await db.query('INSERT INTO verifications (professional_id, document_type, document_key, content_type) VALUES ($1,$2,$3,$4)', [id, documentType, key, req.file!.mimetype]);
    await db.query("UPDATE professionals SET verification_status = 'PENDING' WHERE user_id = $1", [id]);
  });
  await audit(id, 'VERIFICATION_SUBMITTED', 'professional', id);
  res.status(201).json({ message: 'Verification submitted. An administrator will review it.' });
});

// ---------- Portfolio ----------
professionalRouter.get('/portfolio', async (req, res) => {
  res.json(await query('SELECT id, title, description, media_type, hidden, created_at FROM portfolio_items WHERE professional_id = $1 ORDER BY id DESC', [me(req)]));
});

professionalRouter.post('/portfolio', uploader([...IMAGE_TYPES, ...VIDEO_TYPES], 100).single('media'), async (req, res) => {
  const b = parse(z.object({ title: z.string().trim().min(1).max(120), description: z.string().trim().max(500).optional() }), req.body);
  if (!req.file) throw badRequest('Choose an image or video to upload');
  const key = await storage.save(`portfolio/${me(req)}`, req.file.originalname, req.file.buffer);
  const type = req.file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE';
  const item = await one(
    'INSERT INTO portfolio_items (professional_id, title, description, media_key, media_type, content_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, description, media_type, hidden, created_at',
    [me(req), b.title, b.description ?? null, key, type, req.file.mimetype],
  );
  res.status(201).json(item);
});

professionalRouter.delete('/portfolio/:id', async (req, res) => {
  const item = await one('SELECT media_key FROM portfolio_items WHERE id = $1 AND professional_id = $2', [req.params.id, me(req)]);
  if (!item) throw notFound('Portfolio item not found');
  await query('DELETE FROM portfolio_items WHERE id = $1', [req.params.id]);
  await storage.remove(item.media_key).catch(() => undefined);
  res.json({ message: 'Removed' });
});

// ---------- Packages ----------
const packageSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
  price: z.number().positive().max(10_000_000),
  durationHours: z.number().int().min(1).max(24),
});

professionalRouter.get('/packages', async (req, res) => {
  res.json(await query('SELECT id, name, description, price, duration_hours, active FROM packages WHERE professional_id = $1 ORDER BY id', [me(req)]));
});

professionalRouter.post('/packages', async (req, res) => {
  const b = parse(packageSchema, req.body);
  const row = await one('INSERT INTO packages (professional_id, name, description, price, duration_hours) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, description, price, duration_hours, active', [me(req), b.name, b.description ?? null, b.price, b.durationHours]);
  res.status(201).json(row);
});

professionalRouter.put('/packages/:id', async (req, res) => {
  const b = parse(packageSchema.extend({ active: z.boolean().optional() }), req.body);
  const row = await one(
    'UPDATE packages SET name=$1, description=$2, price=$3, duration_hours=$4, active=COALESCE($5, active) WHERE id=$6 AND professional_id=$7 RETURNING id, name, description, price, duration_hours, active',
    [b.name, b.description ?? null, b.price, b.durationHours, b.active ?? null, req.params.id, me(req)],
  );
  if (!row) throw notFound('Package not found');
  res.json(row);
});

professionalRouter.delete('/packages/:id', async (req, res) => {
  // Existing bookings keep their package, so a package is deactivated rather than deleted.
  const row = await one('UPDATE packages SET active = FALSE WHERE id = $1 AND professional_id = $2 RETURNING id', [req.params.id, me(req)]);
  if (!row) throw notFound('Package not found');
  res.json({ message: 'Package removed from your profile' });
});

// ---------- Availability ----------
professionalRouter.get('/availability', async (req, res) => {
  const { from, to } = parse(z.object({ from: dateString.optional(), to: dateString.optional() }), req.query);
  res.json(await query(
    `SELECT id, slot_date, start_time, end_time, status, booking_id FROM availability
      WHERE professional_id = $1 AND slot_date >= $2 AND slot_date <= $3 ORDER BY slot_date`,
    [me(req), from ?? todayString(), to ?? '9999-12-31'],
  ));
});

const availabilitySchema = z.object({
  dateFrom: dateString,
  dateTo: dateString,
  startTime: timeString,
  endTime: timeString,
  status: z.enum(['AVAILABLE', 'BLOCKED']).default('AVAILABLE'),
});

professionalRouter.post('/availability', async (req, res) => {
  const b = parse(availabilitySchema, req.body);
  if (b.dateTo < b.dateFrom) throw badRequest('End date must not be before start date');
  if (b.dateFrom < todayString()) throw badRequest('Availability cannot be set in the past');
  if (daysBetween(b.dateFrom, b.dateTo) > 90) throw badRequest('Set availability for at most 90 days at a time');
  if (b.endTime <= b.startTime) throw badRequest('End time must be after start time');
  const days = eachDay(b.dateFrom, b.dateTo);
  await tx(async (db) => {
    for (const d of days) {
      // HELD/BOOKED days belong to a booking and are never overwritten here.
      await db.query(
        `INSERT INTO availability (professional_id, slot_date, start_time, end_time, status) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (professional_id, slot_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, status = EXCLUDED.status
         WHERE availability.status IN ('AVAILABLE','BLOCKED')`,
        [me(req), d, b.startTime, b.endTime, b.status],
      );
    }
  });
  res.status(201).json({ message: `${days.length} day(s) updated` });
});

professionalRouter.delete('/availability/:id', async (req, res) => {
  const slot = await one('SELECT status FROM availability WHERE id = $1 AND professional_id = $2', [req.params.id, me(req)]);
  if (!slot) throw notFound('Availability not found');
  if (slot.status === 'HELD' || slot.status === 'BOOKED') throw conflict('This day is linked to a booking and cannot be removed');
  await query('DELETE FROM availability WHERE id = $1', [req.params.id]);
  res.json({ message: 'Removed' });
});

// ---------- Payout account and payouts ----------
professionalRouter.get('/payout-account', async (req, res) => {
  res.json((await one('SELECT account_holder, bank_name, account_last4, updated_at FROM payout_accounts WHERE professional_id = $1', [me(req)])) ?? null);
});

professionalRouter.put('/payout-account', async (req, res) => {
  const b = parse(z.object({ accountHolder: z.string().trim().min(2).max(100), bankName: z.string().trim().min(2).max(100), accountNumber: z.string().regex(/^\d{8,18}$/, 'Account number must be 8 to 18 digits') }), req.body);
  // Only the last 4 digits are kept; the full number is never stored.
  await query(
    `INSERT INTO payout_accounts (professional_id, account_holder, bank_name, account_last4) VALUES ($1,$2,$3,$4)
     ON CONFLICT (professional_id) DO UPDATE SET account_holder = EXCLUDED.account_holder, bank_name = EXCLUDED.bank_name, account_last4 = EXCLUDED.account_last4, updated_at = now()`,
    [me(req), b.accountHolder, b.bankName, b.accountNumber.slice(-4)],
  );
  await processPendingPayouts(me(req));
  res.json({ message: 'Payout account saved' });
});

professionalRouter.get('/payouts', async (req, res) => {
  const rows = await query(
    `SELECT po.id, po.booking_id, po.gross_amount, po.commission_amount, po.net_amount, po.status, po.failure_reason, po.created_at, po.paid_at
       FROM payouts po WHERE po.professional_id = $1 ORDER BY po.id DESC`,
    [me(req)],
  );
  const totals = await one(
    `SELECT COALESCE(SUM(net_amount) FILTER (WHERE status = 'PAID'), 0) AS paid,
            COALESCE(SUM(net_amount) FILTER (WHERE status IN ('PENDING','PROCESSING')), 0) AS pending,
            COALESCE((SELECT SUM(total_amount) FROM bookings WHERE professional_id = $1 AND status IN ('CONFIRMED','DELIVERED','REVISION_REQUESTED','DISPUTED')), 0) AS held
       FROM payouts WHERE professional_id = $1`,
    [me(req)],
  );
  res.json({ payouts: rows, totals });
});
