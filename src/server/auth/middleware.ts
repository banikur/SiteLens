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

  const sessionCookie = (req.cookies as Record<string, unknown> | undefined)?.[SESSION_COOKIE_NAME];
  if (!sessionCookie || typeof sessionCookie !== 'string') {
    next();
    return;
  }

  const db = getDb();
  if (!db) {
    next();
    return;
  }

  try {
    const tokenHash = hashSessionToken(sessionCookie);
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

const ROLE_EQUIVALENTS: Record<string, string[]> = {
  'Project Director & Tenant Admin': ['Project Director & Tenant Admin', 'HSE / Quality Manager & Tenant Admin'],
  'HSE / Quality Manager & Tenant Admin': ['Project Director & Tenant Admin', 'HSE / Quality Manager & Tenant Admin'],
  'QA/QC Lead / Owner Inspector': ['QA/QC Lead / Owner Inspector', 'Authorized Inspector (API 510/570) & Verifikator K3'],
  'Authorized Inspector (API 510/570) & Verifikator K3': ['QA/QC Lead / Owner Inspector', 'Authorized Inspector (API 510/570) & Verifikator K3'],
  'Project / Site Engineer': ['Project / Site Engineer', 'Office / Integrity Engineer'],
  'Office / Integrity Engineer': ['Project / Site Engineer', 'Office / Integrity Engineer'],
  'Action Owner / Subcontractor': ['Action Owner / Subcontractor', 'Action Owner / Pelaksana Perbaikan'],
  'Action Owner / Pelaksana Perbaikan': ['Action Owner / Subcontractor', 'Action Owner / Pelaksana Perbaikan'],
  'Field / QC Inspector': ['Field / QC Inspector', 'Field Inspector / Petugas K3'],
  'Field Inspector / Petugas K3': ['Field / QC Inspector', 'Field Inspector / Petugas K3'],
};

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const userRole = req.authUser.role;
    const allowed = allowedRoles.some((role) => {
      const equivalents = ROLE_EQUIVALENTS[role] || [role];
      return equivalents.includes(userRole);
    });
    if (!allowed) {
      res.status(403).json({ error: 'Insufficient role permissions.' });
      return;
    }
    next();
  };
}

