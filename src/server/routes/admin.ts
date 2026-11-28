import { type Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, desc, eq, inArray, or, ilike, sql } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import {
  auditLogs, checklistTemplates, correctiveActions, inspections, projects,
  masterProjects, users, workNodes, workWorkflows, workStages, inspectionAttempts,
  evidenceAttachments, plannedCurveOverrides, dailyWeatherLogs,
  roleAssignments, roles, permissions, rolePermissions, flowPresets, flowPresetSteps,
  wbsProgressLogs, companySettings, nationalHolidays, projectCalendars, webauthnCredentials,
} from "../db/schema.ts";
import { hashSecret } from "../auth/crypto.ts";
import { requireAuth, requireProjectAccess, assertProjectAccess, getProjectIdByStageId } from "../auth/middleware.ts";
import { requirePermission, PERMISSIONS, PERMISSION_DEFINITIONS, resolveUserPermissions, seedLegacyRoleAssignments, syncUserLegacyAssignments } from "../auth/rbac.ts";
import { dispatchNotification } from "../services/notifications.ts";
import { canProceedToStage, validateFourEyes, validateFourEyesDetails, validateDualTrackSignature, getNextAttemptNumber, generateDefaultStages } from "../../utils/workflow.ts";
import { generateProjectCalendarWeeks, calculateSCurveData, calculateBottleneckAging, calculateWeatherEotImpact } from "../../utils/scurve.ts";
import { recalculateAndSaveNodeRollups } from "../wbs.ts";
import { calculateSSOTSCurveData } from "../services/scurveEngine.ts";
import { computeWbsCriticalPath } from "../../utils/wbs.ts";
import type { ApprovalDecision, ChecklistTemplate, InspectionEvidence, InspectionStatus, UserRole, WorkflowStep } from "../../types/index.ts";
import { VALID_ROLES, resolveClientTimestamp, resolveUuid, logAudit, resolveApplicableWorkflowSteps, computeInspectionScore, applyEvidenceIntegrity } from "./shared.ts";

const EXTERNAL_DEFAULT_ROLES = new Set<string>([
  'Action Owner / Subcontractor',
  'Action Owner / Pelaksana Perbaikan',
  'Client / Vendor Viewer',
]);

function resolveUserCategory(category: unknown, role: string): 'internal' | 'external' {
  if (EXTERNAL_DEFAULT_ROLES.has(role)) return 'external';
  if (category === 'internal' || category === 'external') return category;
  return 'internal';
}

export function registerAdminRoutes(router: Router) {
router.get('/users', async (_req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const rows = await db.select().from(users);
  res.json({
    users: rows.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email,
      role: u.role,
      title: u.title,
      userCategory: resolveUserCategory(u.userCategory, u.role),
      employeeCode: u.employeeCode,
      phone: u.phone,
      organizationName: u.organizationName,
      avatar: u.avatar,
      assignedProjects: u.assignedProjects,
      isActive: u.isActive,
    })),
  });
});

const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,40}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+?[0-9\s-]{8,18}$/;
const EMPLOYEE_CODE_REGEX = /^[A-Za-z0-9._/-]{2,40}$/;

function isValidAvatarValue(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (val === '') return true;
  if (val.length > 2_500_000) return false;
  return (
    /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(val) ||
    /^https?:\/\/\S+$/i.test(val)
  );
}

router.patch(
  '/users/:id',
  requirePermission(PERMISSIONS.ADMIN_USERS),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const {
      name,
      role,
      title,
      avatar,
      isActive,
      assignedProjects,
      password,
      pin,
      resetPin,
      resetBiometrics,
      userCategory,
      employeeCode,
      phone,
      organizationName,
    } = req.body ?? {};
    const updates: Record<string, any> = {};

    if (role !== undefined && (typeof role !== 'string' || !VALID_ROLES.includes(role as UserRole))) {
      res.status(400).json({ error: 'Invalid role.' });
      return;
    }

    const [target] = await db.select().from(users).where(eq(users.id, req.params.id)).limit(1);
    if (!target) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const nextRole = (role as UserRole | undefined) ?? target.role;
    const nextActive = typeof isActive === 'boolean' ? isActive : target.isActive;

    // Never allow the last active administrator to be demoted or deactivated (F.5.B #23)
    const targetPerms = await resolveUserPermissions(target.id);
    const isTargetAdmin = targetPerms.orgPermissions.has('admin.roles') || targetPerms.orgPermissions.has('admin.users');
    if (isTargetAdmin && (nextActive === false || (role !== undefined && role !== target.role))) {
      const activeAdmins = await db
        .select({ userId: roleAssignments.userId })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.scopeType, 'organization'),
            eq(roleAssignments.isActive, true)
          )
        );
      if (activeAdmins.filter((a) => a.userId !== target.id).length === 0) {
        res.status(409).json({
          error: 'Cannot remove the last active tenant administrator.',
        });
        return;
      }
    }

    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (role) updates.role = nextRole;
    if (typeof title === 'string') updates.title = title.slice(0, 120);
    if (avatar !== undefined) {
      if (!isValidAvatarValue(avatar)) {
        res.status(400).json({ error: 'Invalid avatar image format or size (max ~1.8MB PNG/JPG/WEBP).' });
        return;
      }
      updates.avatar = avatar;
    }
    if (typeof isActive === 'boolean') updates.isActive = isActive;
    if (Array.isArray(assignedProjects)) updates.assignedProjects = assignedProjects;
    if (userCategory === 'internal' || userCategory === 'external') updates.userCategory = userCategory;
    if (employeeCode !== undefined) {
      const trimmedCode = employeeCode ? String(employeeCode).trim() : '';
      if (trimmedCode && !EMPLOYEE_CODE_REGEX.test(trimmedCode)) {
        res.status(400).json({ error: 'Invalid employee/vendor code format (2-40 chars: letters, numbers, . _ / -).' });
        return;
      }
      updates.employeeCode = trimmedCode ? trimmedCode.slice(0, 60) : null;
    }
    if (phone !== undefined) {
      const trimmedPhone = phone ? String(phone).trim() : '';
      if (trimmedPhone && !PHONE_REGEX.test(trimmedPhone)) {
        res.status(400).json({ error: 'Invalid phone number format (8-18 digits, optional +, spaces, or -).' });
        return;
      }
      updates.phone = trimmedPhone ? trimmedPhone.slice(0, 40) : null;
    }
    if (organizationName !== undefined) updates.organizationName = organizationName ? String(organizationName).trim().slice(0, 120) : null;
    if (typeof password === 'string' && password.trim()) {
      if (password.trim().length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters.' });
        return;
      }
      updates.passwordHash = hashSecret(password.trim());
    }
    if (resetPin === true) {
      updates.pinHash = null;
    } else if (typeof pin === 'string' && pin.trim()) {
      if (!/^\d{4,6}$/.test(pin.trim())) {
        res.status(400).json({ error: 'PIN must be 4 to 6 numeric digits.' });
        return;
      }
      updates.pinHash = hashSecret(pin.trim());
    }

    let revokedPasskeys = 0;
    if (resetBiometrics === true) {
      const deleted = await db
        .delete(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, target.id))
        .returning({ id: webauthnCredentials.id });
      revokedPasskeys = deleted.length;
    }

    let updated = target;
    if (Object.keys(updates).length > 0) {
      const [row] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, req.params.id))
        .returning();
      if (!row) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }
      updated = row;
    }

    await logAudit(req.authUser.id, req.authUser.name, 'UPDATE_USER', 'user', updated.id, {
      updatedFields: [
        ...Object.keys(updates),
        ...(resetBiometrics === true ? [`resetBiometrics(${revokedPasskeys})`] : []),
      ],
    });

    // Tahap 2a item 3: sync per-user legacy role_assignments when role, assignedProjects, or isActive changed
    if (role !== undefined || assignedProjects !== undefined || isActive !== undefined) {
      await syncUserLegacyAssignments(updated.id).catch((e) =>
        console.error('[rbac] syncUserLegacyAssignments failed:', e)
      );
    }

    res.json({
      user: {
        id: updated.id,
        username: updated.username,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        title: updated.title,
        userCategory: resolveUserCategory(updated.userCategory, updated.role),
        employeeCode: updated.employeeCode,
        phone: updated.phone,
        organizationName: updated.organizationName,
        avatar: updated.avatar,
        assignedProjects: updated.assignedProjects,
        isActive: updated.isActive,
      },
    });
  }
);

router.post('/users', requirePermission(PERMISSIONS.ADMIN_USERS), async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const {
    username,
    name,
    email,
    password,
    role,
    title,
    avatar,
    assignedProjects,
    userCategory,
    employeeCode,
    phone,
    organizationName,
  } = req.body ?? {};
  if (!username || !name || !email || !password || !role) {
    res.status(400).json({ error: 'username, name, email, password, and role are required.' });
    return;
  }
  const trimmedUsername = String(username).trim();
  const trimmedEmail = String(email).trim();
  const trimmedCode = employeeCode ? String(employeeCode).trim() : '';
  const trimmedPhone = phone ? String(phone).trim() : '';

  if (!USERNAME_REGEX.test(trimmedUsername)) {
    res.status(400).json({ error: 'Username must be 3-40 characters (letters, numbers, ., _, -).' });
    return;
  }
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    res.status(400).json({ error: 'Invalid email address format.' });
    return;
  }
  if (trimmedCode && !EMPLOYEE_CODE_REGEX.test(trimmedCode)) {
    res.status(400).json({ error: 'Invalid employee/vendor code format.' });
    return;
  }
  if (trimmedPhone && !PHONE_REGEX.test(trimmedPhone)) {
    res.status(400).json({ error: 'Invalid phone number format.' });
    return;
  }
  if (avatar !== undefined && !isValidAvatarValue(avatar)) {
    res.status(400).json({ error: 'Invalid avatar image format or size (max ~1.8MB PNG/JPG/WEBP).' });
    return;
  }
  if (typeof role !== 'string' || !VALID_ROLES.includes(role as UserRole)) {
    res.status(400).json({ error: 'Invalid role.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  const [created] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      username: trimmedUsername,
      name: String(name).trim(),
      email: trimmedEmail,
      passwordHash: hashSecret(String(password)),
      role: role as UserRole,
      title: title || role,
      userCategory: resolveUserCategory(userCategory, role),
      employeeCode: trimmedCode ? trimmedCode.slice(0, 60) : null,
      phone: trimmedPhone ? trimmedPhone.slice(0, 40) : null,
      organizationName: organizationName ? String(organizationName).trim().slice(0, 120) : null,
      avatar: typeof avatar === 'string' ? avatar : '',
      assignedProjects: Array.isArray(assignedProjects) ? assignedProjects : [],
      isActive: true,
    })
    .returning();

  await logAudit(req.authUser.id, req.authUser.name, 'CREATE_USER', 'user', created.id, {
    username: created.username,
    role: created.role,
  });

  // Shim (Tahap 2a): Write role_assignments from legacy role + assignedProjects fields.
  // Runs idempotently — same mapping as seedLegacyRoleAssignments (rbac.ts:398).
  // This ensures new users are not locked out before Tahap 2a-2 frontend rollout.
  await syncUserLegacyAssignments(created.id);

  res.status(201).json({
    user: {
      id: created.id,
      username: created.username,
      name: created.name,
      email: created.email,
      role: created.role,
      title: created.title,
      userCategory: resolveUserCategory(created.userCategory, created.role),
      employeeCode: created.employeeCode,
      phone: created.phone,
      organizationName: created.organizationName,
      avatar: created.avatar,
      assignedProjects: created.assignedProjects,
    },
  });
});

router.post('/users/import', requirePermission(PERMISSIONS.ADMIN_USERS), async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) {
    res.status(400).json({ error: 'rows array is required.' });
    return;
  }

  const existing = await db.select({ username: users.username, email: users.email }).from(users);
  const existingUsernames = new Set(existing.map((u) => u.username.toLowerCase()));
  const existingEmails = new Set(existing.map((u) => u.email.toLowerCase()));

  let importedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const username = String(r.username || '').trim();
    const name = String(r.name || '').trim();
    const email = String(r.email || '').trim();
    const role = String(r.role || '').trim();

    if (!username || !name || !email || !VALID_ROLES.includes(role as UserRole)) {
      skippedCount++;
      errors.push(`Baris ${i + 1}: data wajib atau role tidak valid.`);
      continue;
    }
    if (existingUsernames.has(username.toLowerCase()) || existingEmails.has(email.toLowerCase())) {
      skippedCount++;
      errors.push(`Baris ${i + 1}: username/email '${username}' sudah terdaftar.`);
      continue;
    }

    const rawPwd = typeof r.password === 'string' && r.password.trim().length >= 8
      ? r.password.trim()
      : 'SiteLens#2026';

    const [created] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        username,
        name,
        email,
        passwordHash: hashSecret(rawPwd),
        role: role as UserRole,
        title: String(r.title || role).trim().slice(0, 120),
        userCategory: resolveUserCategory(r.userCategory, role),
        employeeCode: r.employeeCode ? String(r.employeeCode).trim().slice(0, 60) : null,
        phone: r.phone ? String(r.phone).trim().slice(0, 40) : null,
        organizationName: r.organizationName ? String(r.organizationName).trim().slice(0, 120) : null,
        avatar: '',
        assignedProjects: [],
        isActive: true,
      })
      .returning();

    existingUsernames.add(username.toLowerCase());
    existingEmails.add(email.toLowerCase());
    await syncUserLegacyAssignments(created.id);
    importedCount++;
  }

  await logAudit(req.authUser.id, req.authUser.name, 'IMPORT_USERS', 'user', 'batch', {
    importedCount,
    skippedCount,
  });

  res.status(201).json({ importedCount, skippedCount, errors });
});

const DEFAULT_COMPANY_FALLBACK = {
  id: 'default',
  companyName: 'PT SITELENS KONSTRUKSI NUSANTARA',
  companyAddress: 'Gedung Cyber 2 Tower Lt. 18, Jl. H.R. Rasuna Said Blok X-5 No. 13, Jakarta Selatan 12950',
  companyPhone: '+62 21 5290 8800',
  companyEmail: 'corsec@sitelens-construct.id',
  companyWebsite: 'www.sitelens-construct.id',
  companyLogo: '',
  letterheadHeader: 'KONTRAKTOR UTAMA & MANAJEMEN KONSTRUKSI TERPADU',
  letterheadSubheader: 'Sistem Manajemen Mutu, K3 & Lingkungan (ISO 9001:2015 / ISO 45001:2018 / SMK3 PP 50/2012)',
  documentRegistrationNo: 'DOC-REF-SL/2026/01',
};

router.get(
  '/audit-logs',
  requirePermission(PERMISSIONS.ADMIN_AUDIT),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = (page - 1) * limit;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const whereClause = search
      ? or(
          ilike(auditLogs.actorName, `%${search}%`),
          ilike(auditLogs.action, `%${search}%`),
          ilike(auditLogs.entityType, `%${search}%`),
          ilike(auditLogs.entityId, `%${search}%`)
        )
      : undefined;

    const [rows, countRes] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(whereClause),
    ]);

    const total = countRes[0]?.count ?? 0;

    res.json({
      auditLogs: rows.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    });
  }
);

router.get('/company-settings', async (_req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.json({ settings: DEFAULT_COMPANY_FALLBACK });
    return;
  }

  try {
    let [row] = await db.select().from(companySettings).where(eq(companySettings.id, 'default')).limit(1);
    if (!row) {
      const [created] = await db
        .insert(companySettings)
        .values(DEFAULT_COMPANY_FALLBACK)
        .onConflictDoNothing()
        .returning();
      if (!created) {
        [row] = await db.select().from(companySettings).where(eq(companySettings.id, 'default')).limit(1);
      }
      res.json({ settings: created || row || DEFAULT_COMPANY_FALLBACK });
      return;
    }
    res.json({ settings: row });
  } catch (err) {
    res.json({ settings: DEFAULT_COMPANY_FALLBACK });
  }
});

router.put(
  '/company-settings',
  requirePermission([PERMISSIONS.ADMIN_SETTINGS, PERMISSIONS.ADMIN_ROLES]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const b = req.body ?? {};
    const [saved] = await db
      .insert(companySettings)
      .values({
        id: 'default',
        companyName: b.companyName || 'PT SITELENS KONSTRUKSI NUSANTARA',
        companyAddress: b.companyAddress || '',
        companyPhone: b.companyPhone || '',
        companyEmail: b.companyEmail || '',
        companyWebsite: b.companyWebsite || '',
        companyLogo: b.companyLogo || '',
        letterheadHeader: b.letterheadHeader || 'KONTRAKTOR UTAMA & MANAJEMEN KONSTRUKSI TERPADU',
        letterheadSubheader: b.letterheadSubheader || 'Sistem Manajemen Mutu, K3 & Lingkungan',
        documentRegistrationNo: b.documentRegistrationNo || 'DOC-REF-SL/2026/01',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: companySettings.id,
        set: {
          companyName: b.companyName || 'PT SITELENS KONSTRUKSI NUSANTARA',
          companyAddress: b.companyAddress ?? '',
          companyPhone: b.companyPhone ?? '',
          companyEmail: b.companyEmail ?? '',
          companyWebsite: b.companyWebsite ?? '',
          companyLogo: b.companyLogo ?? '',
          letterheadHeader: b.letterheadHeader ?? '',
          letterheadSubheader: b.letterheadSubheader ?? '',
          documentRegistrationNo: b.documentRegistrationNo ?? '',
          updatedAt: new Date(),
        },
      })
      .returning();

    await logAudit(req.authUser.id, req.authUser.name, 'UPDATE_COMPANY_SETTINGS', 'company_settings', 'default', {
      companyName: saved.companyName,
      hasLogo: Boolean(saved.companyLogo),
    });

    res.json({ settings: saved });
  }
);

// Blueprint Tahap 2b: Role & Permission Editor API
router.get(
  '/admin/permissions',
  requirePermission(PERMISSIONS.ADMIN_ROLES),
  async (_req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const allPerms = await db.select().from(permissions);
    res.json({ permissions: allPerms });
  }
);

router.get(
  '/admin/roles',
  requirePermission(PERMISSIONS.ADMIN_ROLES),
  async (_req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const allRoles = await db.select().from(roles);
    const allRolePerms = await db.select().from(rolePermissions);

    const permsMap = new Map<string, string[]>();
    for (const rp of allRolePerms) {
      if (!permsMap.has(rp.roleId)) permsMap.set(rp.roleId, []);
      permsMap.get(rp.roleId)!.push(rp.permissionId);
    }

    const result = allRoles.map((r) => ({
      ...r,
      permissions: permsMap.get(r.id) ?? [],
    }));

    res.json({ roles: result });
  }
);

router.post(
  '/admin/roles',
  requirePermission(PERMISSIONS.ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { name, id, permissions: perms } = req.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Role name must be at least 2 characters.' });
      return;
    }

    const roleId =
      typeof id === 'string' && id.trim()
        ? id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
        : name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 50);

    if (!roleId) {
      res.status(400).json({ error: 'Invalid role id.' });
      return;
    }

    const [existing] = await db.select().from(roles).where(eq(roles.id, roleId));
    if (existing) {
      res.status(409).json({ error: `Role with ID '${roleId}' already exists.` });
      return;
    }

    const targetPermissions = Array.isArray(perms) ? perms.filter((p: unknown) => typeof p === 'string') : [];

    const [createdRole] = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(roles)
        .values({
          id: roleId,
          name: name.trim(),
          isSystem: false,
        })
        .returning();

      if (targetPermissions.length > 0) {
        await tx.insert(rolePermissions).values(
          targetPermissions.map((permissionId: string) => ({
            roleId,
            permissionId,
          }))
        );
      }
      return [inserted];
    });

    await logAudit(req.authUser.id, req.authUser.name, 'ROLE_CREATED', 'role', roleId, {
      name: createdRole.name,
      permissions: targetPermissions,
    });

    res.status(201).json({
      role: {
        ...createdRole,
        permissions: targetPermissions,
      },
    });
  }
);

router.put(
  '/admin/roles/:id',
  requirePermission(PERMISSIONS.ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const roleId = String(req.params.id);
    const [existingRole] = await db.select().from(roles).where(eq(roles.id, roleId));
    if (!existingRole) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }

    const { name, permissions: perms } = req.body ?? {};

    // Super Admin protection: head_office_pmo cannot lose admin.roles or system.break_glass
    if (roleId === 'head_office_pmo' && Array.isArray(perms)) {
      if (!perms.includes(PERMISSIONS.ADMIN_ROLES) || !perms.includes(PERMISSIONS.SYSTEM_BREAK_GLASS)) {
        res.status(400).json({
          error: 'Role Administrator Utama (head_office_pmo) wajib memiliki izin admin.roles dan system.break_glass.',
        });
        return;
      }
    }

    const updates: Partial<typeof roles.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof name === 'string' && name.trim()) {
      updates.name = name.trim();
    }

    await db.transaction(async (tx) => {
      if (Object.keys(updates).length > 0) {
        await tx.update(roles).set(updates).where(eq(roles.id, roleId));
      }

      if (Array.isArray(perms)) {
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
        if (perms.length > 0) {
          await tx.insert(rolePermissions).values(
            perms.map((permissionId: string) => ({
              roleId,
              permissionId,
            }))
          );
        }
      }
    });

    const [updatedRole] = await db.select().from(roles).where(eq(roles.id, roleId));
    const currentPerms = await db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));

    await logAudit(req.authUser.id, req.authUser.name, 'ROLE_UPDATED', 'role', roleId, {
      name: updatedRole.name,
      permissions: currentPerms.map((p) => p.permissionId),
    });

    res.json({
      role: {
        ...updatedRole,
        permissions: currentPerms.map((p) => p.permissionId),
      },
    });
  }
);

router.delete(
  '/admin/roles/:id',
  requirePermission(PERMISSIONS.ADMIN_ROLES),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const roleId = String(req.params.id);
    const [existingRole] = await db.select().from(roles).where(eq(roles.id, roleId));
    if (!existingRole) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }

    if (existingRole.isSystem) {
      res.status(400).json({ error: 'Role bawaan sistem dilarang dihapus.' });
      return;
    }

    // Check active assignments
    const activeAssignments = await db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.roleId, roleId), eq(roleAssignments.isActive, true)));

    if (activeAssignments.length > 0) {
      res.status(400).json({
        error: 'Role masih digunakan oleh penugasan personil aktif.',
      });
      return;
    }

    await db.delete(roles).where(eq(roles.id, roleId));

    await logAudit(req.authUser.id, req.authUser.name, 'ROLE_DELETED', 'role', roleId, {
      name: existingRole.name,
    });

    res.status(204).end();
  }
);

// Blueprint Tahap 2b: Role Assignment Management
router.post(
  '/admin/assignments',
  requirePermission(PERMISSIONS.ADMIN_USERS),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { userId, roleId, scopeType, projectId } = req.body ?? {};
    if (!userId || !roleId || !scopeType) {
      res.status(400).json({ error: 'userId, roleId, and scopeType are required.' });
      return;
    }

    if (!['organization', 'project'].includes(scopeType)) {
      res.status(400).json({ error: 'scopeType must be organization or project.' });
      return;
    }

    if (scopeType === 'project' && !projectId) {
      res.status(400).json({ error: 'projectId is required for project scope.' });
      return;
    }

    const [targetUser] = await db.select().from(users).where(eq(users.id, userId as any));
    if (!targetUser) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const [targetRole] = await db.select().from(roles).where(eq(roles.id, String(roleId)));
    if (!targetRole) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }

    let assignment;
    if (scopeType === 'organization') {
      const [existing] = await db
        .select()
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, userId as any),
            eq(roleAssignments.scopeType, 'organization')
          )
        );

      if (existing) {
        // Last admin protection if demoting existing org admin
        const targetPerms = await resolveUserPermissions(userId);
        const isTargetAdmin = targetPerms.orgPermissions.has('admin.roles') || targetPerms.orgPermissions.has('admin.users');
        if (isTargetAdmin && roleId !== 'head_office_pmo') {
          const activeAdmins = await db
            .select({ userId: roleAssignments.userId })
            .from(roleAssignments)
            .where(
              and(
                eq(roleAssignments.scopeType, 'organization'),
                eq(roleAssignments.isActive, true),
                eq(roleAssignments.roleId, 'head_office_pmo')
              )
            );
          if (activeAdmins.filter((a) => a.userId !== userId).length === 0) {
            res.status(409).json({ error: 'Cannot remove the last active tenant administrator.' });
            return;
          }
        }

        [assignment] = await db
          .update(roleAssignments)
          .set({ roleId: String(roleId), isActive: true, source: 'manual' })
          .where(eq(roleAssignments.id, existing.id))
          .returning();
      } else {
        [assignment] = await db
          .insert(roleAssignments)
          .values({
            userId: userId as any,
            roleId: String(roleId),
            scopeType: 'organization',
            projectId: null,
            isActive: true,
            source: 'manual',
          })
          .returning();
      }
    } else {
      // project scope
      const [existing] = await db
        .select()
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, userId as any),
            eq(roleAssignments.projectId, projectId as any),
            eq(roleAssignments.scopeType, 'project')
          )
        );

      if (existing) {
        [assignment] = await db
          .update(roleAssignments)
          .set({ roleId: String(roleId), isActive: true, source: 'manual' })
          .where(eq(roleAssignments.id, existing.id))
          .returning();
      } else {
        [assignment] = await db
          .insert(roleAssignments)
          .values({
            userId: userId as any,
            roleId: String(roleId),
            scopeType: 'project',
            projectId: projectId as any,
            isActive: true,
            source: 'manual',
          })
          .returning();
      }
    }

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'ROLE_ASSIGNMENT_CREATED',
      'role_assignment',
      assignment.id,
      { userId, roleId, scopeType, projectId }
    );

    res.status(201).json({ assignment });
  }
);

router.delete(
  '/admin/assignments/:assignmentId',
  requirePermission(PERMISSIONS.ADMIN_USERS),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const assignmentId = String(req.params.assignmentId);
    const [existing] = await db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.id, assignmentId as any));

    if (!existing) {
      res.status(404).json({ error: 'Role assignment not found.' });
      return;
    }

    // Last admin protection
    if (existing.scopeType === 'organization' && existing.roleId === 'head_office_pmo' && existing.isActive) {
      const activeAdmins = await db
        .select({ userId: roleAssignments.userId })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.scopeType, 'organization'),
            eq(roleAssignments.isActive, true),
            eq(roleAssignments.roleId, 'head_office_pmo')
          )
        );
      if (activeAdmins.filter((a) => a.userId !== existing.userId).length === 0) {
        res.status(409).json({ error: 'Cannot remove the last active tenant administrator.' });
        return;
      }
    }

    await db
      .update(roleAssignments)
      .set({ isActive: false })
      .where(eq(roleAssignments.id, existing.id));

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'ROLE_ASSIGNMENT_DELETED',
      'role_assignment',
      assignmentId,
      { userId: existing.userId, roleId: existing.roleId, scopeType: existing.scopeType }
    );

    res.status(204).end();
  }
);

// ---------------------------------------------------------------------------
// Blueprint Tahap 2c (Section 1320-1335): Flow Presets Management Endpoints
// ---------------------------------------------------------------------------

router.get(
  '/flow-presets',
  requireAuth,
  async (_req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const presets = await db.select().from(flowPresets);
    const steps = await db.select().from(flowPresetSteps).orderBy(flowPresetSteps.stepOrder);

    const stepsByPreset = new Map<string, typeof steps>();
    for (const step of steps) {
      const list = stepsByPreset.get(step.presetId) || [];
      list.push(step);
      stepsByPreset.set(step.presetId, list);
    }

    const result = presets.map((p) => ({
      ...p,
      steps: stepsByPreset.get(p.id) || [],
    }));

    res.json({ presets: result });
  }
);

router.get(
  '/flow-presets/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const presetId = String(req.params.id);
    const [preset] = await db
      .select()
      .from(flowPresets)
      .where(eq(flowPresets.id, presetId as any))
      .limit(1);

    if (!preset) {
      res.status(404).json({ error: 'Flow preset not found.' });
      return;
    }

    const steps = await db
      .select()
      .from(flowPresetSteps)
      .where(eq(flowPresetSteps.presetId, preset.id))
      .orderBy(flowPresetSteps.stepOrder);

    res.json({ preset: { ...preset, steps } });
  }
);

router.post(
  '/flow-presets',
  requireAuth,
  requirePermission(PERMISSIONS.FLOW_PRESET_MANAGE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { name, description, isOrganizationDefault, steps } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Nama preset alur RFI wajib diisi.' });
      return;
    }

    if (!Array.isArray(steps) || steps.length < 2) {
      res.status(400).json({
        error: 'Preset alur RFI wajib memiliki minimal 2 langkah (misal: pengajuan/eksekusi dan persetujuan).',
      });
      return;
    }

    const validTypes = new Set(['request', 'execute', 'approve']);
    let hasApprove = false;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step.name || typeof step.name !== 'string' || !step.name.trim()) {
        res.status(400).json({ error: `Langkah urutan #${i + 1} wajib memiliki nama.` });
        return;
      }
      if (!validTypes.has(step.stepType)) {
        res.status(400).json({
          error: `Langkah "${step.name}" memiliki tipe tidak valid: "${step.stepType}". Tipe yang diizinkan: request, execute, approve.`,
        });
        return;
      }
      if (step.stepType === 'approve') {
        hasApprove = true;
        if (step.canCombineWithNext) {
          res.status(400).json({
            error: 'Batas Keras Four-Eyes: Langkah "approve" tidak dapat digabung dengan langkah berikutnya (canCombineWithNext dilarang true).',
          });
          return;
        }
      }
    }

    if (!hasApprove) {
      res.status(400).json({
        error: 'Preset alur RFI wajib memiliki minimal satu tahapan persetujuan (approve).',
      });
      return;
    }

    if (isOrganizationDefault) {
      await db.update(flowPresets).set({ isOrganizationDefault: false });
    }

    const [preset] = await db
      .insert(flowPresets)
      .values({
        name: name.trim(),
        description: description?.trim() || null,
        isOrganizationDefault: Boolean(isOrganizationDefault),
      })
      .returning();

    const insertedSteps: any[] = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const [insertedStep] = await db
        .insert(flowPresetSteps)
        .values({
          presetId: preset.id,
          stepOrder: i + 1,
          stepType: s.stepType,
          name: s.name.trim(),
          requiredPermission: s.requiredPermission || null,
          canCombineWithNext: Boolean(s.canCombineWithNext),
          requiresSignature: Boolean(s.requiresSignature),
        })
        .returning();
      insertedSteps.push(insertedStep);
    }

    await logAudit(req.authUser.id, req.authUser.name, 'CREATE_FLOW_PRESET', 'flow_preset', preset.id, {
      name: preset.name,
      stepsCount: insertedSteps.length,
    });

    res.status(201).json({
      preset: {
        ...preset,
        steps: insertedSteps,
      },
    });
  }
);

router.put(
  '/flow-presets/:id',
  requireAuth,
  requirePermission(PERMISSIONS.FLOW_PRESET_MANAGE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const presetId = String(req.params.id);
    const [existing] = await db
      .select()
      .from(flowPresets)
      .where(eq(flowPresets.id, presetId as any))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Flow preset not found.' });
      return;
    }

    const { name, description, isOrganizationDefault, steps } = req.body || {};

    if (name !== undefined && (!name || typeof name !== 'string' || !name.trim())) {
      res.status(400).json({ error: 'Nama preset alur RFI tidak boleh kosong.' });
      return;
    }

    const updates: Partial<typeof flowPresets.$inferInsert> = {};
    if (typeof name === 'string') updates.name = name.trim();
    if (typeof description === 'string') updates.description = description.trim();
    if (typeof isOrganizationDefault === 'boolean') {
      updates.isOrganizationDefault = isOrganizationDefault;
      if (isOrganizationDefault) {
        await db.update(flowPresets).set({ isOrganizationDefault: false });
      }
    }

    const [updatedPreset] = await db
      .update(flowPresets)
      .set(updates)
      .where(eq(flowPresets.id, existing.id))
      .returning();

    let updatedSteps = await db
      .select()
      .from(flowPresetSteps)
      .where(eq(flowPresetSteps.presetId, existing.id))
      .orderBy(flowPresetSteps.stepOrder);

    if (Array.isArray(steps)) {
      if (steps.length < 2) {
        res.status(400).json({ error: 'Preset alur RFI wajib memiliki minimal 2 langkah.' });
        return;
      }

      const validTypes = new Set(['request', 'execute', 'approve']);
      let hasApprove = false;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step.name || typeof step.name !== 'string' || !step.name.trim()) {
          res.status(400).json({ error: `Langkah urutan #${i + 1} wajib memiliki nama.` });
          return;
        }
        if (!validTypes.has(step.stepType)) {
          res.status(400).json({
            error: `Langkah "${step.name}" memiliki tipe tidak valid: "${step.stepType}".`,
          });
          return;
        }
        if (step.stepType === 'approve') {
          hasApprove = true;
          if (step.canCombineWithNext) {
            res.status(400).json({
              error: 'Batas Keras Four-Eyes: Langkah "approve" tidak dapat digabung dengan langkah berikutnya.',
            });
            return;
          }
        }
      }

      if (!hasApprove) {
        res.status(400).json({
          error: 'Preset alur RFI wajib memiliki minimal satu tahapan persetujuan (approve).',
        });
        return;
      }

      await db.delete(flowPresetSteps).where(eq(flowPresetSteps.presetId, existing.id));

      updatedSteps = [];
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const [insertedStep] = await db
          .insert(flowPresetSteps)
          .values({
            presetId: existing.id,
            stepOrder: i + 1,
            stepType: s.stepType,
            name: s.name.trim(),
            requiredPermission: s.requiredPermission || null,
            canCombineWithNext: Boolean(s.canCombineWithNext),
            requiresSignature: Boolean(s.requiresSignature),
          })
          .returning();
        updatedSteps.push(insertedStep);
      }
    }

    await logAudit(req.authUser.id, req.authUser.name, 'UPDATE_FLOW_PRESET', 'flow_preset', existing.id, {
      updates,
      stepsCount: updatedSteps.length,
    });

    res.json({
      preset: {
        ...updatedPreset,
        steps: updatedSteps,
      },
    });
  }
);

router.delete(
  '/flow-presets/:id',
  requireAuth,
  requirePermission(PERMISSIONS.FLOW_PRESET_MANAGE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const presetId = String(req.params.id);
    const [existing] = await db
      .select()
      .from(flowPresets)
      .where(eq(flowPresets.id, presetId as any))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Flow preset not found.' });
      return;
    }

    const referencingProjects = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.flowPresetId, existing.id));

    if (referencingProjects.length > 0) {
      res.status(409).json({
        error: `Preset "${existing.name}" sedang digunakan oleh proyek "${referencingProjects[0].name}" dan tidak dapat dihapus.`,
      });
      return;
    }

    await db.delete(flowPresets).where(eq(flowPresets.id, existing.id));

    await logAudit(req.authUser.id, req.authUser.name, 'DELETE_FLOW_PRESET', 'flow_preset', existing.id, {
      name: existing.name,
    });

    res.json({ success: true, message: `Preset "${existing.name}" berhasil dihapus.` });
  }
);


}
