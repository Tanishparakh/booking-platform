import { Request, Response, NextFunction } from 'express';
import { one } from '../db/pool';
import { forbidden, unauthorized } from '../utils/errors';
import { verifyToken } from '../utils/security';

export type Role = 'CLIENT' | 'PROFESSIONAL' | 'ADMIN' | 'SUPPORT';

export interface AuthUser {
  id: number;
  role: Role;
  email: string;
  fullName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Reads the bearer token and loads the user. Suspended users are rejected immediately. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw unauthorized();
  let payload: any;
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized('Session expired or invalid');
  }
  if (payload.purpose !== 'access') throw unauthorized('Invalid token');
  const user = await one('SELECT id, role, email, full_name, status FROM users WHERE id = $1', [payload.sub]);
  if (!user) throw unauthorized();
  if (user.status !== 'ACTIVE') throw forbidden('This account is suspended');
  req.user = { id: user.id, role: user.role, email: user.email, fullName: user.full_name };
  next();
}

/** Role-based access control: allow only the listed roles. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

export const staffOnly = requireRole('ADMIN', 'SUPPORT');
export const adminOnly = requireRole('ADMIN');
