import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { one, query, tx } from '../db/pool';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { badRequest, conflict, parse, unauthorized, forbidden } from '../utils/errors';
import { checkPassword, hashPassword, PASSWORD_RULE, randomToken, sha256, signToken, sixDigitCode, verifyToken } from '../utils/security';
import { sendEmail } from '../services/mailer';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, limit: config.isTest ? 10_000 : 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, try again in a minute', code: 'RATE_LIMITED' } });

const registerSchema = z.object({
  role: z.enum(['CLIENT', 'PROFESSIONAL']),
  email: z.string().trim().email().max(200),
  password: z.string().regex(PASSWORD_RULE, 'Password must be at least 8 characters and contain a letter and a digit'),
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional(),
  professionalType: z.enum(['PHOTOGRAPHER', 'VIDEOGRAPHER']).optional(),
  city: z.string().trim().min(2).max(80).optional(),
});

async function sendVerificationEmail(userId: number, email: string, name: string) {
  const token = randomToken();
  await query("UPDATE users SET verify_token_hash = $1, verify_token_expires = now() + interval '24 hours' WHERE id = $2", [sha256(token), userId]);
  const link = `${config.clientUrl}/verify-email?token=${token}`;
  await sendEmail(email, 'Verify your email address', `Hello ${name},\n\nPlease verify your email address by opening this link (valid for 24 hours):\n${link}\n\n– Booking Platform`);
}

authRouter.post('/register', limiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  if (input.role === 'PROFESSIONAL' && (!input.professionalType || !input.city)) {
    throw badRequest('Professionals must choose a type (photographer or videographer) and an operating city');
  }
  const email = input.email.toLowerCase();
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [email])) throw conflict('An account with this email already exists');
  const passwordHash = await hashPassword(input.password);
  const user = await tx(async (db) => {
    const u = (await db.query('INSERT INTO users (email, password_hash, full_name, phone, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, email, full_name, role', [email, passwordHash, input.fullName, input.phone ?? null, input.role])).rows[0];
    if (input.role === 'CLIENT') {
      await db.query('INSERT INTO clients (user_id) VALUES ($1)', [u.id]);
    } else {
      await db.query('INSERT INTO professionals (user_id, professional_type, operating_city) VALUES ($1,$2,$3)', [u.id, input.professionalType, input.city]);
      await db.query('INSERT INTO profiles (professional_id, location) VALUES ($1,$2)', [u.id, input.city]);
    }
    return u;
  });
  await sendVerificationEmail(user.id, user.email, user.full_name);
  res.status(201).json({ id: user.id, message: 'Account created. Check your email for the verification link.' });
});

authRouter.get('/verify-email', async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) throw badRequest('Verification token is missing');
  const user = await one('SELECT id FROM users WHERE verify_token_hash = $1 AND verify_token_expires > now()', [sha256(token)]);
  if (!user) throw badRequest('This verification link is invalid or has expired. Request a new one.');
  await query('UPDATE users SET email_verified = TRUE, verify_token_hash = NULL, verify_token_expires = NULL WHERE id = $1', [user.id]);
  res.json({ message: 'Email verified. You can now continue.' });
});

authRouter.post('/resend-verification', limiter, async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().email() }), req.body);
  const user = await one('SELECT id, email, full_name, email_verified FROM users WHERE lower(email) = $1', [email.toLowerCase()]);
  if (user && !user.email_verified) await sendVerificationEmail(user.id, user.email, user.full_name);
  res.json({ message: 'If that account exists and is not verified, a new link has been sent.' });
});

function accessToken(userId: number, role: string) {
  return signToken({ sub: userId, role, purpose: 'access' }, '8h');
}

authRouter.post('/login', limiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().trim().email(), password: z.string().min(1) }), req.body);
  const user = await one('SELECT * FROM users WHERE lower(email) = $1', [email.toLowerCase()]);
  if (!user || !(await checkPassword(password, user.password_hash))) throw unauthorized('Incorrect email or password');
  if (user.status !== 'ACTIVE') throw forbidden('This account is suspended. Contact support.');

  if (user.role === 'ADMIN') {
    const code = sixDigitCode();
    await query("UPDATE users SET mfa_code_hash = $1, mfa_expires = now() + interval '10 minutes', mfa_attempts = 0 WHERE id = $2", [sha256(code), user.id]);
    await sendEmail(user.email, 'Your administrator login code', `Your one-time login code is ${code}. It is valid for 10 minutes.`);
    return res.json({ mfaRequired: true, mfaToken: signToken({ sub: user.id, purpose: 'mfa' }, '10m') });
  }
  res.json({ token: accessToken(user.id, user.role), user: publicUser(user) });
});

authRouter.post('/mfa/verify', limiter, async (req, res) => {
  const { mfaToken, code } = parse(z.object({ mfaToken: z.string(), code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') }), req.body);
  let payload: any;
  try {
    payload = verifyToken(mfaToken);
  } catch {
    throw unauthorized('Login step expired. Sign in again.');
  }
  if (payload.purpose !== 'mfa') throw unauthorized();
  const user = await one('SELECT * FROM users WHERE id = $1', [payload.sub]);
  if (!user || user.role !== 'ADMIN' || !user.mfa_code_hash) throw unauthorized();
  if (user.mfa_attempts >= 5 || new Date(user.mfa_expires) < new Date()) throw unauthorized('Code expired or too many attempts. Sign in again.');
  if (sha256(code) !== user.mfa_code_hash) {
    await query('UPDATE users SET mfa_attempts = mfa_attempts + 1 WHERE id = $1', [user.id]);
    throw unauthorized('Incorrect code');
  }
  await query('UPDATE users SET mfa_code_hash = NULL, mfa_expires = NULL, mfa_attempts = 0 WHERE id = $1', [user.id]);
  res.json({ token: accessToken(user.id, user.role), user: publicUser(user) });
});

authRouter.post('/logout', requireAuth, (_req, res) => {
  // Tokens are stateless; the client discards its token. Endpoint exists for a clean logout flow.
  res.json({ message: 'Logged out' });
});

function publicUser(u: any) {
  return { id: u.id, email: u.email, fullName: u.full_name, role: u.role, emailVerified: u.email_verified };
}

authRouter.get('/me', requireAuth, async (req, res) => {
  const u = await one('SELECT id, email, full_name, phone, role, email_verified, created_at FROM users WHERE id = $1', [req.user!.id]);
  const extra: any = {};
  if (u.role === 'PROFESSIONAL') {
    const p = await one('SELECT professional_type, operating_city, verification_status FROM professionals WHERE user_id = $1', [u.id]);
    extra.professionalType = p.professional_type;
    extra.operatingCity = p.operating_city;
    extra.verificationStatus = p.verification_status;
  }
  res.json({ ...publicUser(u), phone: u.phone, createdAt: u.created_at, ...extra });
});
