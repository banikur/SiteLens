import type { Request, Response, NextFunction } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';
import { hashSessionToken } from './crypto.ts';
import type { User, UserRole } from '../../types/index.ts';

export const SESSION_COOKIE_NAME = 'sitelens_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface AuthUser extends User {
  username: string;
  hasPin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser | null;
      sessionId?: string | null;
    }
  }
}

export async function attachSessionUser(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  req.authUser = null;
  req.sessionId = null;

  const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (!rawToken || typeof rawToken !== 'string') {
    next();
    return;
  }

  const db = getDb();
  if (!db) {
    next();
    return;
  }

  try {
    const tokenHash = hashSessionToken(rawToken);
    const now = new Date();
    const rows = await db
      .select({
        sessionId: sessions.id,
        user: users,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, tokenHash), gt(sessions.expiresAt, now)))
      .limit(1);

    if (rows.length > 0 && rows[0].user.isActive) {
      const u = rows[0].user;
      req.sessionId = rows[0].sessionId;
      req.authUser = {
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        role: u.role,
        title: u.title,
        avatar: u.avatar,
        assignedProjects: u.assignedProjects,
        certifications: u.certifications,
        hasPin: Boolean(u.pinHash),
      };
    }
  } catch (err) {
    console.error('Session lookup error:', err);
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Insufficient role permissions.' });
      return;
    }
    next();
  };
}

