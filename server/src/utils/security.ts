import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const sixDigitCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

export function signToken(payload: object, expiresIn: string | number): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: expiresIn as any });
}

export function verifyToken<T = any>(token: string): T {
  return jwt.verify(token, config.jwtSecret) as T;
}

/** Password rule: at least 8 characters with a letter and a digit. */
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
