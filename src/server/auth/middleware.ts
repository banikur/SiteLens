import type { Request, Response, NextFunction } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import {
  sessions,
  users,
  projectMembers,
  workStages,
  workWorkflows,
  workNodes,
  inspections,
  correctiveActions,
} from '../db/schema.ts';
import { hashSessionToken } from './crypto.ts';
import type { User, UserRole } from '../../types/index.ts';
import { resolveUserPermissions } from './rbac.ts';

export const SESSION_COOKIE_NAME = 'sitelens_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface AuthUser extends User {
  username: string;
  hasPin: boolean;
  hasBreakGlass?: boolean;
  hasOrgScope?: boolean;
  assignedProjectIds?: string[];
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
      const perms = await resolveUserPermissions(u.id);

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
        hasBreakGlass: perms.hasBreakGlass,
        hasOrgScope: perms.hasOrgScope,
        assignedProjectIds: Array.from(perms.assignedProjectIds),
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
  'Client / Vendor Viewer': ['Client / Vendor Viewer'],
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

export function checkProjectAccess(
  user: AuthUser | null | undefined,
  projectId: string,
  isMutation = false
): { allowed: boolean; status: number; error?: string } {
  if (!user) {
    return { allowed: false, status: 401, error: 'Authentication required.' };
  }

  // 1. Break-glass emergency authorization (F.1.E)
  if (user.hasBreakGlass) {
    return { allowed: true, status: 200 };
  }

  const isAssigned =
    Array.isArray(user.assignedProjectIds) && user.assignedProjectIds.includes(projectId);

  // 2. Organization scope (Opsi 2: read-all universal, mutations require explicit project assignment)
  if (user.hasOrgScope) {
    if (!isMutation) {
      return { allowed: true, status: 200 };
    }
    if (!isAssigned) {
      return {
        allowed: false,
        status: 403,
        error: 'Forbidden: Project mutations require explicit project assignment.',
      };
    }
    return { allowed: true, status: 200 };
  }

  // 3. Project scope user: must be assigned to project
  if (!isAssigned) {
    return { allowed: false, status: 403, error: 'Forbidden: Access to this project is denied.' };
  }

  return { allowed: true, status: 200 };
}

export function assertProjectAccess(
  user: AuthUser | null | undefined,
  projectId: string,
  res: Response,
  isMutation = false
): boolean {
  const check = checkProjectAccess(user, projectId, isMutation);
  if (!check.allowed) {
    res.status(check.status).json({ error: check.error });
    return false;
  }
  return true;
}

export function requireProjectAccess(paramName = 'projectId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const projectId =
      req.params?.[paramName] ||
      (req.query?.[paramName] as string) ||
      (req.body && typeof req.body === 'object' ? req.body[paramName] : null);

    if (!projectId) {
      next();
      return;
    }

    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
    const ok = assertProjectAccess(req.authUser, String(projectId), res, isMutation);
    if (!ok) return;

    next();
  };
}

export async function getProjectIdByStageId(stageId: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select({ projectId: workNodes.projectId })
      .from(workStages)
      .innerJoin(workWorkflows, eq(workStages.workflowId, workWorkflows.id))
      .innerJoin(workNodes, eq(workWorkflows.nodeId, workNodes.id))
      .where(eq(workStages.id, stageId as any))
      .limit(1);
    return rows[0]?.projectId ? String(rows[0].projectId) : null;
  } catch (err) {
    console.error('Error resolving projectId for stageId:', err);
    return null;
  }
}

export async function getProjectIdByInspectionId(inspectionId: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select({ projectId: inspections.projectId })
      .from(inspections)
      .where(eq(inspections.id, inspectionId as any))
      .limit(1);
    return rows[0]?.projectId ? String(rows[0].projectId) : null;
  } catch (err) {
    console.error('Error resolving projectId for inspectionId:', err);
    return null;
  }
}

export async function getProjectIdByActionId(actionId: string): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rows = await db
      .select({ projectId: correctiveActions.projectId })
      .from(correctiveActions)
      .where(eq(correctiveActions.id, actionId as any))
      .limit(1);
    return rows[0]?.projectId ? String(rows[0].projectId) : null;
  } catch (err) {
    console.error('Error resolving projectId for actionId:', err);
    return null;
  }
}

export async function getEffectiveProjectRole(
  userId: string,
  projectId: string,
  defaultRole: UserRole
): Promise<UserRole> {
  const db = getDb();
  if (!db) return defaultRole;

  try {
    const rows = await db
      .select({ projectRole: projectMembers.projectRole, isActive: projectMembers.isActive })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, userId as any), eq(projectMembers.projectId, projectId as any)))
      .limit(1);

    if (rows.length > 0 && rows[0].isActive) {
      return rows[0].projectRole;
    }
  } catch (err) {
    console.error('Error fetching project member role:', err);
  }

  return defaultRole;
}

