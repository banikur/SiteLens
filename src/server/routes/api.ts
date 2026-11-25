import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { and, desc, eq, inArray, or, ilike, sql } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import {
  auditLogs,
  checklistTemplates,
  correctiveActions,
  inspections,
  projects,
  masterProjects,
  users,
  workNodes,
  workWorkflows,
  workStages,
  inspectionAttempts,
  evidenceAttachments,
  plannedCurveOverrides,
  dailyWeatherLogs,
  projectMembers,
  roleAssignments,
  roles,
  permissions,
  rolePermissions,
  flowPresets,
  flowPresetSteps,
} from '../db/schema.ts';
import { hashSecret } from '../auth/crypto.ts';
import {
  requireAuth,
  requireProjectAccess,
  assertProjectAccess,
  getProjectIdByStageId,
} from '../auth/middleware.ts';
import {
  requirePermission,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  resolveUserPermissions,
  seedLegacyRoleAssignments,
  syncUserLegacyAssignments,
} from '../auth/rbac.ts';
import { dispatchNotification } from '../services/notifications.ts';
import {
  extractEvidenceFilename,
  getUploadDir,
  verifyStoredEvidence,
} from '../services/evidenceIntegrity.ts';
import {
  canProceedToStage,
  validateFourEyes,
  validateFourEyesDetails,
  validateDualTrackSignature,
  getNextAttemptNumber,
  generateDefaultStages,
} from '../../utils/workflow.ts';
import {
  generateProjectCalendarWeeks,
  calculateSCurveData,
  calculateBottleneckAging,
  calculateWeatherEotImpact,
} from '../../utils/scurve.ts';
import { recalculateAndSaveNodeRollups } from '../wbs.ts';
import { calculateSSOTSCurveData } from '../services/scurveEngine.ts';
import type {
  ApprovalDecision,
  ChecklistTemplate,
  InspectionEvidence,
  InspectionStatus,
  UserRole,
  WorkflowStep,
} from '../../types/index.ts';

const VALID_ROLES: readonly UserRole[] = [
  'Field / QC Inspector',
  'Action Owner / Subcontractor',
  'Project / Site Engineer',
  'QA/QC Lead / Owner Inspector',
  'Project Director & Tenant Admin',
  'Client / Vendor Viewer',
  'Field Inspector / Petugas K3',
  'Action Owner / Pelaksana Perbaikan',
  'Office / Integrity Engineer',
  'Authorized Inspector (API 510/570) & Verifikator K3',
  'HSE / Quality Manager & Tenant Admin',
];

const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Offline inspections are legitimately submitted with a field timestamp, but a
 * client must not be able to backdate evidence arbitrarily or stamp the future.
 * Anything outside a sane window is replaced by server time.
 */
function resolveClientTimestamp(value: unknown, now: Date): Date {
  if (typeof value !== 'string') return now;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return now;
  const skew = now.getTime() - parsed.getTime();
  if (skew < -5 * 60 * 1000 || skew > MAX_BACKDATE_MS) return now;
  return parsed;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function resolveUuid(id: unknown): string {
  return typeof id === 'string' && UUID_REGEX.test(id) ? id : crypto.randomUUID();
}


export const apiRouter = Router();
apiRouter.use(requireAuth);

async function logAudit(
  actorId: string,
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, any> = {}
) {
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLogs).values({
      actorId,
      actorName,
      action,
      entityType,
      entityId,
      metadata,
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

function resolveApplicableWorkflowSteps(
  template: typeof checklistTemplates.$inferSelect | undefined,
  failedCount: number,
  scorePercent: number
): WorkflowStep[] {
  if (!template) return [];
  let steps = Array.isArray(template.workflowSteps) ? [...template.workflowSteps] : [];

  if (steps.length === 0 && template.requiresApproval && template.approvalRole) {
    steps = [
      {
        order: 1,
        label: `${template.approvalRole} Sign-off`,
        role: template.approvalRole,
        trigger: 'always',
        requiresSignature: true,
      },
    ];
  }

  const hasFail = failedCount > 0;
  const isCritical = failedCount >= 3 || scorePercent < 60;

  return steps
    .filter((s) => {
      if (s.trigger === 'always') return true;
      if (s.trigger === 'on_fail') return hasFail;
      if (s.trigger === 'on_critical') return isCritical;
      return true;
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * Scores an inspection from the template definition and the submitted answers.
 * The client sends its own score, but that value is never trusted: a failing
 * checklist must not be able to approve itself by claiming 100%.
 */
function computeInspectionScore(
  template: typeof checklistTemplates.$inferSelect | undefined,
  answers: Record<string, unknown> | null | undefined
): {
  scorePercent: number;
  passedCount: number;
  failedCount: number;
  nonApplicableCount: number;
} {
  let totalPassFail = 0;
  let passed = 0;
  let failed = 0;
  let na = 0;

  const sections = Array.isArray(template?.sections) ? template!.sections : [];
  for (const section of sections) {
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    for (const field of fields) {
      if (field?.type !== 'pass_fail') continue;
      const raw = answers?.[field.id];
      const value = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
      if (value === 'pass') {
        totalPassFail += 1;
        passed += 1;
      } else if (value === 'fail') {
        totalPassFail += 1;
        failed += 1;
      } else if (value === 'na') {
        na += 1;
      }
    }
  }

  return {
    scorePercent: totalPassFail === 0 ? 100 : Math.round((passed / totalPassFail) * 100),
    passedCount: passed,
    failedCount: failed,
    nonApplicableCount: na,
  };
}

interface EvidenceIntegrityResult {
  photos: InspectionEvidence[];
  fatal: string[];
  warnings: string[];
}

/**
 * Rebuilds the evidence list from server-side truth. Client-supplied hashes,
 * GPS and "verified" flags are discarded; only the manifest written at upload
 * time is trusted. A file that is missing or whose bytes no longer match its
 * manifest is fatal, because that is exactly the tampering this feature exists
 * to detect.
 */
function applyEvidenceIntegrity(rawPhotos: unknown): EvidenceIntegrityResult {
  const photos: InspectionEvidence[] = [];
  const fatal: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(rawPhotos)) return { photos, fatal, warnings };

  const uploadDir = getUploadDir();

  for (const raw of rawPhotos.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    if (!url) continue;

    const base: InspectionEvidence = {
      fieldId: typeof entry.fieldId === 'string' ? entry.fieldId.slice(0, 200) : '',
      url,
      caption: typeof entry.caption === 'string' ? entry.caption.slice(0, 500) : '',
      timestamp:
        typeof entry.timestamp === 'string' ? entry.timestamp.slice(0, 100) : new Date().toISOString(),
      location: typeof entry.location === 'string' ? entry.location.slice(0, 200) : undefined,
    };

    const filename = extractEvidenceFilename(url);
    if (!filename) {
      // Sample assets / external URLs cannot be integrity-checked, so they are
      // retained but explicitly marked unverified instead of trusted.
      photos.push({ ...base, integrityVerified: false, integrityReason: 'external_url' });
      continue;
    }

    const check = verifyStoredEvidence(uploadDir, filename);
    if (!check.ok) {
      if (check.reason === 'missing_file' || check.reason === 'hash_mismatch') {
        fatal.push(check.reason === 'missing_file' ? `missing_file:${filename}` : `hash_mismatch:${filename}`);
        continue;
      }
      warnings.push(`${check.reason ?? 'unverified'}:${filename}`);
      photos.push({
        ...base,
        integrityVerified: false,
        integrityReason: check.reason ?? 'unverified',
      });
      continue;
    }

    const manifest = check.manifest!;
    photos.push({
      ...base,
      sha256: manifest.sha256,
      sizeBytes: manifest.size,
      integrityVersion: manifest.integrityVersion,
      integrityVerified: true,
      gps: manifest.gps,
      gpsSource: manifest.gpsSource,
      capturedAt: manifest.capturedAt,
      capturedAtSource: manifest.capturedAtSource,
    });
  }

  return { photos, fatal, warnings };
}

// ---------------- PROJECTS ----------------

apiRouter.get('/projects', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const isGlobalAdmin = Boolean(req.authUser?.hasOrgScope || req.authUser?.hasBreakGlass);

  const allProjects = await db.select().from(projects);
  const visibleProjects = isGlobalAdmin
    ? allProjects
    : allProjects.filter((p) => Array.isArray(req.authUser?.assignedProjectIds) && req.authUser.assignedProjectIds.includes(p.id));

  const allInspections = await db.select().from(inspections);
  const allActions = await db.select().from(correctiveActions);

  // Group metrics by project ID using Maps to avoid repeated filter passes
  const countsByProject = new Map<string, { inspections: number; openActions: number; totalScore: number }>();
  for (const insp of allInspections) {
    const entry = countsByProject.get(insp.projectId) || { inspections: 0, openActions: 0, totalScore: 0 };
    entry.inspections += 1;
    entry.totalScore += insp.scorePercent;
    countsByProject.set(insp.projectId, entry);
  }
  for (const act of allActions) {
    if (act.status === 'OPEN' || act.status === 'IN_PROGRESS' || act.status === 'PENDING_VERIFICATION') {
      const entry = countsByProject.get(act.projectId) || { inspections: 0, openActions: 0, totalScore: 0 };
      entry.openActions += 1;
      countsByProject.set(act.projectId, entry);
    }
  }

  const enriched = visibleProjects.map((projectItem) => {
    const stats = countsByProject.get(projectItem.id) || { inspections: 0, openActions: 0, totalScore: 0 };
    const avgScore = stats.inspections > 0 ? Math.round(stats.totalScore / stats.inspections) : 100;

    return {
      ...projectItem,
      activeInspectionsCount: stats.inspections,
      openIssuesCount: stats.openActions,
      complianceRate: avgScore,
    };
  });

  res.json({ projects: enriched });
});

// =============================================================================
// Master Projects Management (Fase B3)
// =============================================================================

apiRouter.get(
  '/master-projects',
  requirePermission([PERMISSIONS.MASTERPROJECT_VIEW, PERMISSIONS.MASTERPROJECT_MANAGE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const perms = await resolveUserPermissions(req.authUser.id);
    const hasOrgAccess =
      perms.hasOrgScope ||
      perms.orgPermissions.has(PERMISSIONS.MASTERPROJECT_MANAGE) ||
      perms.orgPermissions.has(PERMISSIONS.PROJECT_CREATE);

    const allMasters = await db
      .select()
      .from(masterProjects)
      .orderBy(desc(masterProjects.createdAt));

    let allowedSiteIds: Set<string> | null = null;
    if (!hasOrgAccess) {
      const userAssignments = await db
        .select({ projectId: roleAssignments.projectId })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, req.authUser.id as any),
            eq(roleAssignments.scopeType, 'project'),
            eq(roleAssignments.isActive, true)
          )
        );
      allowedSiteIds = new Set(
        userAssignments.map((a) => a.projectId).filter(Boolean) as string[]
      );
    }

    const allSites = await db.select().from(projects);

    const enriched = allMasters
      .map((mp) => {
        let sitesOfMaster = allSites.filter((s) => s.masterProjectId === mp.id);
        if (allowedSiteIds !== null) {
          sitesOfMaster = sitesOfMaster.filter((s) => allowedSiteIds!.has(s.id));
        }
        return {
          ...mp,
          sitesCount: sitesOfMaster.length,
          sites: sitesOfMaster,
        };
      })
      .filter((mp) => {
        if (hasOrgAccess) return true;
        return mp.sitesCount > 0;
      });

    res.json({ masterProjects: enriched });
  }
);

apiRouter.post(
  '/master-projects',
  requirePermission(PERMISSIONS.MASTERPROJECT_MANAGE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { code, name, ownerClient, description, startDate, endDate, status } = req.body ?? {};
    if (!code || !name || !ownerClient) {
      res.status(400).json({ error: 'code, name, and ownerClient are required.' });
      return;
    }

    const [existing] = await db
      .select({ id: masterProjects.id })
      .from(masterProjects)
      .where(eq(masterProjects.code, String(code).trim()));
    if (existing) {
      res.status(409).json({ error: `Master project dengan kode '${code}' sudah ada.` });
      return;
    }

    const [created] = await db
      .insert(masterProjects)
      .values({
        code: String(code).trim(),
        name: String(name).trim(),
        ownerClient: String(ownerClient).trim(),
        description: description ? String(description).trim() : null,
        startDate: startDate ? String(startDate) : null,
        endDate: endDate ? String(endDate) : null,
        status: status === 'archived' ? 'archived' : 'active',
        createdBy: req.authUser.id as any,
      })
      .returning();

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'MASTER_PROJECT_CREATED',
      'master_project',
      created.id,
      { code: created.code, name: created.name }
    );

    res.status(201).json({ masterProject: created });
  }
);

apiRouter.get(
  '/master-projects/:id',
  requirePermission([PERMISSIONS.MASTERPROJECT_VIEW, PERMISSIONS.MASTERPROJECT_MANAGE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const id = String(req.params.id);
    const [mp] = await db.select().from(masterProjects).where(eq(masterProjects.id, id as any));
    if (!mp) {
      res.status(404).json({ error: 'Master project not found.' });
      return;
    }

    const perms = await resolveUserPermissions(req.authUser.id);
    const hasOrgAccess =
      perms.hasOrgScope ||
      perms.orgPermissions.has(PERMISSIONS.MASTERPROJECT_MANAGE) ||
      perms.orgPermissions.has(PERMISSIONS.PROJECT_CREATE);

    let sitesOfMaster = await db.select().from(projects).where(eq(projects.masterProjectId, id as any));

    if (!hasOrgAccess) {
      const userAssignments = await db
        .select({ projectId: roleAssignments.projectId })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, req.authUser.id as any),
            eq(roleAssignments.scopeType, 'project'),
            eq(roleAssignments.isActive, true)
          )
        );
      const allowedSiteIds = new Set(
        userAssignments.map((a) => a.projectId).filter(Boolean) as string[]
      );
      sitesOfMaster = sitesOfMaster.filter((s) => allowedSiteIds.has(s.id));
      if (sitesOfMaster.length === 0) {
        res.status(403).json({ error: 'Anda tidak memiliki akses ke Master Project ini.' });
        return;
      }
    }

    res.json({
      masterProject: {
        ...mp,
        sitesCount: sitesOfMaster.length,
        sites: sitesOfMaster,
      },
    });
  }
);

apiRouter.patch(
  '/master-projects/:id',
  requirePermission(PERMISSIONS.MASTERPROJECT_MANAGE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const id = String(req.params.id);
    const [existing] = await db.select().from(masterProjects).where(eq(masterProjects.id, id as any));
    if (!existing) {
      res.status(404).json({ error: 'Master project not found.' });
      return;
    }

    const { name, ownerClient, description, startDate, endDate, status } = req.body ?? {};
    const updatePayload: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updatePayload.name = String(name).trim();
    if (ownerClient !== undefined) updatePayload.ownerClient = String(ownerClient).trim();
    if (description !== undefined) updatePayload.description = description ? String(description).trim() : null;
    if (startDate !== undefined) updatePayload.startDate = startDate ? String(startDate) : null;
    if (endDate !== undefined) updatePayload.endDate = endDate ? String(endDate) : null;
    if (status !== undefined) updatePayload.status = status === 'archived' ? 'archived' : 'active';

    const [updated] = await db
      .update(masterProjects)
      .set(updatePayload)
      .where(eq(masterProjects.id, id as any))
      .returning();

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'MASTER_PROJECT_UPDATED',
      'master_project',
      id,
      updatePayload
    );

    res.json({ masterProject: updated });
  }
);

apiRouter.patch(
  '/master-projects/:id/archive',
  requirePermission(PERMISSIONS.MASTERPROJECT_MANAGE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const id = String(req.params.id);
    const [existing] = await db.select().from(masterProjects).where(eq(masterProjects.id, id as any));
    if (!existing) {
      res.status(404).json({ error: 'Master project not found.' });
      return;
    }

    const [updated] = await db
      .update(masterProjects)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(eq(masterProjects.id, id as any))
      .returning();

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'MASTER_PROJECT_ARCHIVED',
      'master_project',
      id,
      { previousStatus: existing.status }
    );

    res.json({ masterProject: updated });
  }
);

apiRouter.post(
  '/master-projects/:id/sites',
  requirePermission(PERMISSIONS.PROJECT_CREATE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const masterId = String(req.params.id);
    const [master] = await db.select().from(masterProjects).where(eq(masterProjects.id, masterId as any));
    if (!master) {
      res.status(404).json({ error: 'Master project not found.' });
      return;
    }

    const p = req.body ?? {};
    if (!p.name || !p.code) {
      res.status(400).json({ error: 'Site name and code are required.' });
      return;
    }

    const [existingSite] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.code, String(p.code).trim()));
    if (existingSite) {
      res.status(409).json({ error: `Site project dengan kode '${p.code}' sudah ada.` });
      return;
    }

    const id = resolveUuid(p.id);
    const sitesList = Array.isArray(p.sites) ? p.sites : [];
    const primarySite = sitesList.find((s: any) => s.isPrimary) || sitesList[0];
    const derivedLocation = p.location || primarySite?.name || 'Site Industrial Area';

    const savedProject = await db.transaction(async (tx) => {
      const [newProj] = await tx
        .insert(projects)
        .values({
          id,
          masterProjectId: master.id,
          name: String(p.name).trim(),
          code: String(p.code).trim(),
          client: p.client || master.ownerClient,
          location: derivedLocation,
          status: p.status || 'active',
          zones: Array.isArray(p.zones) ? p.zones : [],
          sites: sitesList,
          leadManager: p.leadManager || req.authUser!.name,
        })
        .returning();

      // Auto-assign creator in the SAME transaction (B3 requirement)
      await tx.insert(roleAssignments).values({
        userId: req.authUser!.id as any,
        projectId: newProj.id as any,
        roleId: 'project_manager',
        scopeType: 'project',
        source: 'manual',
        isActive: true,
      });

      return newProj;
    });

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'PROJECT_SITE_CREATED',
      'project',
      savedProject.id,
      { masterProjectId: master.id, code: savedProject.code, name: savedProject.name }
    );

    res.status(201).json({ site: savedProject });
  }
);

apiRouter.get(
  '/master-projects/:id/sites',
  requirePermission([PERMISSIONS.PROJECT_VIEW, PERMISSIONS.MASTERPROJECT_VIEW]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const masterId = String(req.params.id);
    const [master] = await db.select().from(masterProjects).where(eq(masterProjects.id, masterId as any));
    if (!master) {
      res.status(404).json({ error: 'Master project not found.' });
      return;
    }

    const perms = await resolveUserPermissions(req.authUser.id);
    const hasOrgAccess =
      perms.hasOrgScope ||
      perms.orgPermissions.has(PERMISSIONS.MASTERPROJECT_MANAGE) ||
      perms.orgPermissions.has(PERMISSIONS.PROJECT_CREATE);

    let siteRows = await db
      .select()
      .from(projects)
      .where(eq(projects.masterProjectId, master.id))
      .orderBy(desc(projects.createdAt));

    if (!hasOrgAccess) {
      const userAssignments = await db
        .select({ projectId: roleAssignments.projectId })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, req.authUser.id as any),
            eq(roleAssignments.scopeType, 'project'),
            eq(roleAssignments.isActive, true)
          )
        );
      const allowedSiteIds = new Set(
        userAssignments.map((a) => a.projectId).filter(Boolean) as string[]
      );
      siteRows = siteRows.filter((s) => allowedSiteIds.has(s.id));
    }

    res.json({ sites: siteRows });
  }
);

apiRouter.post(
  '/projects',
  requirePermission(PERMISSIONS.PROJECT_CREATE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const p = req.body;
    const id = resolveUuid(p.id);

    const [saved] = await db.transaction(async (tx) => {
      const sitesList = Array.isArray(p.sites) ? p.sites : [];
      const primarySite = sitesList.find((s: any) => s.isPrimary) || sitesList[0];
      const derivedLocation = p.location || primarySite?.name || 'Central Industrial Sector';

      const [savedProject] = await tx
        .insert(projects)
        .values({
          id,
          masterProjectId: p.masterProjectId || null,
          name: p.name,
          code: p.code,
          client: p.client,
          location: derivedLocation,
          status: p.status || 'active',
          zones: Array.isArray(p.zones) ? p.zones : [],
          sites: sitesList,
          leadManager: p.leadManager || req.authUser!.name,
        })
        .onConflictDoUpdate({
          target: projects.id,
          set: {
            masterProjectId: p.masterProjectId || null,
            name: p.name,
            code: p.code,
            client: p.client,
            location: derivedLocation,
            status: p.status || 'active',
            zones: Array.isArray(p.zones) ? p.zones : [],
            sites: sitesList,
            leadManager: p.leadManager || req.authUser!.name,
          },
        })
        .returning();

      // Auto-assign project creator (F.1.D)
      const [creatorExisting] = await tx
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, req.authUser!.id as any),
            eq(roleAssignments.projectId, savedProject.id as any),
            eq(roleAssignments.scopeType, 'project')
          )
        )
        .limit(1);

      if (!creatorExisting) {
        await tx.insert(roleAssignments).values({
          userId: req.authUser!.id as any,
          roleId: 'project_manager',
          scopeType: 'project',
          projectId: savedProject.id as any,
          isActive: true,
        });
      }

      // Merged employee assignments if provided in the same payload
      if (Array.isArray(p.teamMembers)) {
        for (const member of p.teamMembers) {
          if (member.userId && member.roleId) {
            const [memberExisting] = await tx
              .select({ id: roleAssignments.id })
              .from(roleAssignments)
              .where(
                and(
                  eq(roleAssignments.userId, member.userId as any),
                  eq(roleAssignments.projectId, savedProject.id as any),
                  eq(roleAssignments.scopeType, 'project')
                )
              )
              .limit(1);

            if (memberExisting) {
              await tx
                .update(roleAssignments)
                .set({
                  roleId: member.roleId,
                  isActive: true,
                })
                .where(eq(roleAssignments.id, memberExisting.id));
            } else {
              await tx.insert(roleAssignments).values({
                userId: member.userId as any,
                roleId: member.roleId,
                scopeType: 'project',
                projectId: savedProject.id as any,
                isActive: true,
              });
            }
          }
        }
      }

      return [savedProject];
    });

    await logAudit(req.authUser.id, req.authUser.name, 'UPSERT_PROJECT', 'project', saved.id, {
      code: saved.code,
    });

    res.status(201).json({
      project: {
        ...saved,
        activeInspectionsCount: 0,
        openIssuesCount: 0,
        complianceRate: 100,
      },
    });
  }
);

// Blueprint Tahap 2a-2 (Bagian 6.C): Real-time effective permissions for active project
apiRouter.get(
  '/projects/:projectId/my-permissions',
  requireAuth,
  async (req: Request, res: Response) => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const targetProjectId = String(req.params.projectId);
    const perms = await resolveUserPermissions(req.authUser.id, targetProjectId);
    const effective = new Set([...perms.orgPermissions, ...perms.projectPermissions]);
    res.json({
      projectId: targetProjectId,
      effectivePermissions: Array.from(effective),
    });
  }
);

// Blueprint Tahap 2b (Bagian 882 & Section F.5): Project metadata update
apiRouter.put(
  '/projects/:projectId',
  requirePermission([PERMISSIONS.PROJECT_EDIT, PERMISSIONS.PROJECT_CREATE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const [existing] = await db.select().from(projects).where(eq(projects.id, projectId as any));
    if (!existing) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const { name, code, client, location, status, zones, sites, leadManager, capaLockoutSeverities, requirePmApprovalForDetailing, teamMembers } = req.body ?? {};
    const updates: Partial<typeof projects.$inferInsert> = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof code === 'string' && code.trim()) updates.code = code.trim();
    if (typeof client === 'string' && client.trim()) updates.client = client.trim();
    if (typeof location === 'string' && location.trim()) updates.location = location.trim();
    if (status && ['active', 'completed', 'on_hold'].includes(status)) updates.status = status;
    if (Array.isArray(zones)) updates.zones = zones;
    if (Array.isArray(sites)) {
      updates.sites = sites;
      if (!updates.location && sites.length > 0) {
        const primarySite = sites.find((s: any) => s.isPrimary) || sites[0];
        if (primarySite?.name) updates.location = primarySite.name;
      }
    }
    if (typeof leadManager === 'string' && leadManager.trim()) updates.leadManager = leadManager.trim();
    if (Array.isArray(capaLockoutSeverities)) updates.capaLockoutSeverities = capaLockoutSeverities;
    if (typeof requirePmApprovalForDetailing === 'boolean') updates.requirePmApprovalForDetailing = requirePmApprovalForDetailing;

    const [updated] = await db.transaction(async (tx) => {
      const [proj] = await tx
        .update(projects)
        .set(updates)
        .where(eq(projects.id, projectId as any))
        .returning();

      // Merged employee assignments if provided in the same payload
      if (Array.isArray(teamMembers)) {
        for (const member of teamMembers) {
          if (member.userId && member.roleId) {
            const [memberExisting] = await tx
              .select({ id: roleAssignments.id })
              .from(roleAssignments)
              .where(
                and(
                  eq(roleAssignments.userId, member.userId as any),
                  eq(roleAssignments.projectId, projectId as any),
                  eq(roleAssignments.scopeType, 'project')
                )
              )
              .limit(1);

            if (memberExisting) {
              await tx
                .update(roleAssignments)
                .set({
                  roleId: member.roleId,
                  isActive: true,
                })
                .where(eq(roleAssignments.id, memberExisting.id));
            } else {
              await tx.insert(roleAssignments).values({
                userId: member.userId as any,
                roleId: member.roleId,
                scopeType: 'project',
                projectId: projectId as any,
                isActive: true,
              });
            }
          }
        }
      }

      return [proj];
    });

    await logAudit(req.authUser.id, req.authUser.name, 'UPDATE_PROJECT', 'project', projectId, updates);

    res.json({ project: updated });
  }
);

// Blueprint Tahap 2b (Bagian B.2 & Section 124): Project Members Management
apiRouter.get(
  '/projects/:projectId/members',
  requirePermission([PERMISSIONS.PROJECT_MANAGE_MEMBERS, PERMISSIONS.ADMIN_USERS]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);

    const rows = await db
      .select({
        id: roleAssignments.id,
        userId: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        title: users.title,
        avatar: users.avatar,
        roleId: roles.id,
        roleName: roles.name,
        isSystem: roles.isSystem,
        source: roleAssignments.source,
        isActive: roleAssignments.isActive,
        createdAt: roleAssignments.createdAt,
      })
      .from(roleAssignments)
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.scopeType, 'project'),
          eq(roleAssignments.projectId, projectId as any),
          eq(roleAssignments.isActive, true)
        )
      );

    res.json({ members: rows });
  }
);

apiRouter.post(
  '/projects/:projectId/members',
  requirePermission([PERMISSIONS.PROJECT_MANAGE_MEMBERS, PERMISSIONS.ADMIN_USERS]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const { userId, roleId } = req.body ?? {};

    if (!userId || !roleId) {
      res.status(400).json({ error: 'userId and roleId are required.' });
      return;
    }

    const [targetProject] = await db.select().from(projects).where(eq(projects.id, projectId as any));
    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
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

    // Upsert assignment for (userId, projectId)
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

    let assignment;
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

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'PROJECT_MEMBER_ASSIGNED',
      'project',
      projectId,
      { userId, roleId, assignmentId: assignment.id }
    );

    res.status(201).json({ assignment });
  }
);

apiRouter.delete(
  '/projects/:projectId/members/:userId',
  requirePermission([PERMISSIONS.PROJECT_MANAGE_MEMBERS, PERMISSIONS.ADMIN_USERS]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const userId = String(req.params.userId);

    const [existing] = await db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, userId as any),
          eq(roleAssignments.projectId, projectId as any),
          eq(roleAssignments.scopeType, 'project'),
          eq(roleAssignments.isActive, true)
        )
      );

    if (!existing) {
      res.status(404).json({ error: 'Project member assignment not found.' });
      return;
    }

    await db
      .update(roleAssignments)
      .set({ isActive: false })
      .where(eq(roleAssignments.id, existing.id));

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'PROJECT_MEMBER_REMOVED',
      'project',
      projectId,
      { userId, assignmentId: existing.id }
    );

    res.status(204).end();
  }
);

// =============================================================================
// Project Assignments & Team Management (Fase B3)
// =============================================================================

// User search endpoint for assignment picker (safe fields only)
apiRouter.get('/users/search', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }
  const q = String(req.query.q || '').trim();
  const searchPattern = `%${q}%`;

  const foundUsers = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      avatar: users.avatar,
      title: users.title,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        q
          ? or(
              ilike(users.name, searchPattern),
              ilike(users.email, searchPattern),
              ilike(users.username, searchPattern)
            )
          : sql`true`
      )
    )
    .limit(30);

  res.json({ users: foundUsers });
});

apiRouter.get(
  '/projects/:projectId/assignments',
  requirePermission([PERMISSIONS.PROJECT_MANAGE_MEMBERS, PERMISSIONS.PROJECT_VIEW, PERMISSIONS.ADMIN_USERS]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);

    const rows = await db
      .select({
        id: roleAssignments.id,
        userId: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        title: users.title,
        avatar: users.avatar,
        roleId: roles.id,
        roleName: roles.name,
        isSystem: roles.isSystem,
        source: roleAssignments.source,
        isActive: roleAssignments.isActive,
        createdAt: roleAssignments.createdAt,
      })
      .from(roleAssignments)
      .innerJoin(users, eq(roleAssignments.userId, users.id))
      .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
      .where(
        and(
          eq(roleAssignments.scopeType, 'project'),
          eq(roleAssignments.projectId, projectId as any),
          eq(roleAssignments.isActive, true)
        )
      )
      .orderBy(desc(roleAssignments.createdAt));

    res.json({ assignments: rows });
  }
);

apiRouter.post(
  '/projects/:projectId/assignments',
  requirePermission(PERMISSIONS.PROJECT_MANAGE_MEMBERS),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const { userId, roleId } = req.body ?? {};

    if (!userId || !roleId) {
      res.status(400).json({ error: 'userId and roleId are required.' });
      return;
    }

    // FOCUS_MODE server-side role restriction: only 4 demo roles permitted
    if (process.env.FOCUS_MODE === 'setup-flow') {
      const ALLOWED_DEMO_ROLES = ['head_office_pmo', 'project_manager', 'site_engineer', 'client_viewer'];
      if (!ALLOWED_DEMO_ROLES.includes(String(roleId))) {
        res.status(422).json({
          error: `Penugasan role '${roleId}' ditolak. Saat FOCUS_MODE aktif, hanya 4 role demo yang diizinkan: ${ALLOWED_DEMO_ROLES.join(', ')}.`,
        });
        return;
      }
    }

    const [targetProject] = await db.select().from(projects).where(eq(projects.id, projectId as any));
    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
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

    // Unique check (user_id, project_id)
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

    if (existing && existing.isActive) {
      res.status(409).json({
        error: 'Pengguna sudah memiliki penugasan peran aktif pada proyek/site ini (duplikasi ditolak).',
      });
      return;
    }

    // Anti-escalation check:
    // If assigner has org scope (HO PMO / Admin), they have org-level authority to assign project roles.
    // If assigner is project-scoped (e.g. Project Manager), they cannot grant permissions they do not possess
    // (such as org-level permissions or higher privileges).
    const assignerPerms = await resolveUserPermissions(req.authUser.id, projectId);
    if (!assignerPerms.hasOrgScope) {
      const assignerAllPerms = new Set([...assignerPerms.orgPermissions, ...assignerPerms.projectPermissions]);
      const targetRolePerms = await db
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, String(roleId)));

      for (const rp of targetRolePerms) {
        const def = PERMISSION_DEFINITIONS.find((p) => p.id === rp.permissionId);
        const isOrgLevel = def?.scopeLevel === 'organization';
        if (isOrgLevel || (!assignerAllPerms.has(rp.permissionId) && rp.permissionId !== 'capa.update_progress')) {
          res.status(403).json({
            error: `Anti-eskalasi: Anda tidak dapat menugaskan peran '${targetRole.name}' karena memuat izin ('${rp.permissionId}') yang tidak Anda miliki di site ini.`,
          });
          return;
        }
      }
    }

    let assignment;
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

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'PROJECT_ASSIGNMENT_CREATED',
      'project',
      projectId,
      { userId, roleId, assignmentId: assignment.id }
    );

    res.status(201).json({ assignment });
  }
);

apiRouter.put(
  '/projects/:projectId/assignments/:assignmentId',
  requirePermission(PERMISSIONS.PROJECT_MANAGE_MEMBERS),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const assignmentId = String(req.params.assignmentId);
    const { roleId } = req.body ?? {};

    if (!roleId) {
      res.status(400).json({ error: 'roleId is required.' });
      return;
    }

    if (process.env.FOCUS_MODE === 'setup-flow') {
      const ALLOWED_DEMO_ROLES = ['head_office_pmo', 'project_manager', 'site_engineer', 'client_viewer'];
      if (!ALLOWED_DEMO_ROLES.includes(String(roleId))) {
        res.status(422).json({
          error: `Role '${roleId}' tidak diizinkan saat FOCUS_MODE aktif.`,
        });
        return;
      }
    }

    const [assignment] = await db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.id, assignmentId as any), eq(roleAssignments.projectId, projectId as any)));

    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found.' });
      return;
    }

    if (assignment.source === 'legacy_sync') {
      res.status(403).json({
        error: 'Penugasan yang bersumber dari sinkronisasi legacy (source=legacy_sync) tidak dapat diubah lewat API ini.',
      });
      return;
    }

    // Last manage_members holder protection
    const currentRolePerms = await db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, assignment.roleId),
          eq(rolePermissions.permissionId, PERMISSIONS.PROJECT_MANAGE_MEMBERS)
        )
      );

    const newRolePerms = await db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, String(roleId)),
          eq(rolePermissions.permissionId, PERMISSIONS.PROJECT_MANAGE_MEMBERS)
        )
      );

    if (currentRolePerms.length > 0 && newRolePerms.length === 0) {
      const otherManagers = await db
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .innerJoin(rolePermissions, eq(roleAssignments.roleId, rolePermissions.roleId))
        .where(
          and(
            eq(roleAssignments.projectId, projectId as any),
            eq(roleAssignments.scopeType, 'project'),
            eq(roleAssignments.isActive, true),
            sql`${roleAssignments.id} != ${assignment.id}`,
            eq(rolePermissions.permissionId, PERMISSIONS.PROJECT_MANAGE_MEMBERS)
          )
        );

      if (otherManagers.length === 0) {
        res.status(422).json({
          error: 'Tidak dapat menurunkan role: pengguna ini adalah pemegang izin pengelola tim (project.manage_members) terakhir yang aktif pada proyek ini.',
        });
        return;
      }
    }

    // Anti-escalation check
    const assignerPerms = await resolveUserPermissions(req.authUser.id, projectId);
    if (!assignerPerms.hasOrgScope) {
      const assignerAllPerms = new Set([...assignerPerms.orgPermissions, ...assignerPerms.projectPermissions]);
      const targetPerms = await db
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, String(roleId)));

      for (const rp of targetPerms) {
        const def = PERMISSION_DEFINITIONS.find((p) => p.id === rp.permissionId);
        const isOrgLevel = def?.scopeLevel === 'organization';
        if (isOrgLevel || (!assignerAllPerms.has(rp.permissionId) && rp.permissionId !== 'capa.update_progress')) {
          res.status(403).json({
            error: `Anti-eskalasi: Anda tidak dapat memberikan peran dengan izin ('${rp.permissionId}') yang tidak Anda miliki.`,
          });
          return;
        }
      }
    }

    const [updated] = await db
      .update(roleAssignments)
      .set({ roleId: String(roleId), isActive: true, source: 'manual' })
      .where(eq(roleAssignments.id, assignment.id))
      .returning();

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'PROJECT_ASSIGNMENT_UPDATED',
      'project',
      projectId,
      { assignmentId: updated.id, previousRoleId: assignment.roleId, newRoleId: updated.roleId }
    );

    res.json({ assignment: updated });
  }
);

apiRouter.delete(
  '/projects/:projectId/assignments/:assignmentId',
  requirePermission(PERMISSIONS.PROJECT_MANAGE_MEMBERS),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const assignmentId = String(req.params.assignmentId);

    const [assignment] = await db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.id, assignmentId as any), eq(roleAssignments.projectId, projectId as any)));

    if (!assignment) {
      res.status(404).json({ error: 'Assignment not found.' });
      return;
    }

    if (assignment.source === 'legacy_sync') {
      res.status(403).json({
        error: 'Penugasan yang bersumber dari legacy sync (source=legacy_sync) tidak dapat dihapus/dinonaktifkan lewat API ini.',
      });
      return;
    }

    // Last manage_members holder protection
    const currentRolePerms = await db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, assignment.roleId),
          eq(rolePermissions.permissionId, PERMISSIONS.PROJECT_MANAGE_MEMBERS)
        )
      );

    if (currentRolePerms.length > 0 && assignment.isActive) {
      const otherManagers = await db
        .select({ id: roleAssignments.id })
        .from(roleAssignments)
        .innerJoin(rolePermissions, eq(roleAssignments.roleId, rolePermissions.roleId))
        .where(
          and(
            eq(roleAssignments.projectId, projectId as any),
            eq(roleAssignments.scopeType, 'project'),
            eq(roleAssignments.isActive, true),
            sql`${roleAssignments.id} != ${assignment.id}`,
            eq(rolePermissions.permissionId, PERMISSIONS.PROJECT_MANAGE_MEMBERS)
          )
        );

      if (otherManagers.length === 0) {
        res.status(422).json({
          error: 'Tidak dapat menonaktifkan penugasan: pengguna ini adalah pemegang izin pengelola tim (project.manage_members) terakhir yang aktif pada proyek ini.',
        });
        return;
      }
    }

    await db
      .update(roleAssignments)
      .set({ isActive: false })
      .where(eq(roleAssignments.id, assignment.id));

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'PROJECT_ASSIGNMENT_DEACTIVATED',
      'project',
      projectId,
      { assignmentId: assignment.id, userId: assignment.userId, roleId: assignment.roleId }
    );

    res.json({ success: true, message: 'Assignment successfully deactivated.' });
  }
);

// ---------------- WBS TREE & WORKFLOWS (FASE 2) ----------------

apiRouter.get(
  '/projects/:projectId/wbs',
  requireAuth,
  requireProjectAccess('projectId'),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');

    const [matchedProject] = await db
      .select({ id: projects.id, name: projects.name, code: projects.code })
      .from(projects)
      .where(eq(projects.id, projectScopeId as any))
      .limit(1);

    if (!matchedProject) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const nodes = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.projectId, matchedProject.id))
      .orderBy(workNodes.sortOrder, workNodes.wbsCode);

    const workflows = await db.select().from(workWorkflows);
    const stages = await db.select().from(workStages).orderBy(workStages.stageOrder);

    res.json({
      project: matchedProject,
      nodes,
      workflows,
      stages,
    });
  }
);

apiRouter.post(
  '/projects/:projectId/wbs/nodes',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const [targetProject] = await db
      .select({
        id: projects.id,
        requirePmApprovalForDetailing: projects.requirePmApprovalForDetailing,
      })
      .from(projects)
      .where(eq(projects.id, projectScopeId as any))
      .limit(1);

    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const body = req.body || {};
    if (!body.wbsCode || !body.name) {
      res.status(400).json({ error: 'wbsCode and name are required.' });
      return;
    }

    const verifiedParentId = body.parentId || null;
    let parentNode: any = null;
    if (verifiedParentId) {
      const [parent] = await db
        .select()
        .from(workNodes)
        .where(and(eq(workNodes.id, verifiedParentId), eq(workNodes.projectId, targetProject.id)))
        .limit(1);
      if (!parent) {
        res.status(400).json({ error: 'Parent WBS node not found in this project.' });
        return;
      }
      parentNode = parent;
    }

    // Check granular permissions (wbs.edit_structure vs wbs.edit_detail)
    const userPerms = await resolveUserPermissions(req.authUser.id, targetProject.id);
    const hasStructurePerm =
      userPerms.orgPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE) ||
      userPerms.projectPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE);
    const hasDetailPerm =
      userPerms.orgPermissions.has(PERMISSIONS.WBS_EDIT_DETAIL) ||
      userPerms.projectPermissions.has(PERMISSIONS.WBS_EDIT_DETAIL);

    if (!hasStructurePerm && hasDetailPerm) {
      // Detail-only user (Site Officer / Planner)
      if (!verifiedParentId || !parentNode) {
        res.status(400).json({ error: 'Simpul induk (parentId) wajib disertakan untuk penambahan rincian aktivitas.' });
        return;
      }

      if (!parentNode.allowDetailing) {
        res.status(403).json({
          error: 'Penambahan detail dilarang pada paket kerja ini (allow_detailing = false).',
        });
        return;
      }

      // Check if parent node has approved stages or verified progress
      const approvedStages = await db
        .select({ id: workStages.id })
        .from(workStages)
        .innerJoin(workWorkflows, eq(workStages.workflowId, workWorkflows.id))
        .where(and(eq(workWorkflows.nodeId, parentNode.id), eq(workStages.status, 'approved')))
        .limit(1);

      if (approvedStages.length > 0 || Number(parentNode.verifiedProgressPercent) > 0) {
        res.status(400).json({
          error: 'Simpul WBS telah memiliki tahapan yang disetujui; pemecahan wajib melalui Change Request.',
        });
        return;
      }
    }

    const detailingStatus =
      !hasStructurePerm && targetProject.requirePmApprovalForDetailing
        ? 'pending_pm_approval'
        : (body.detailingStatus || 'active');

    const allowDetailing = hasStructurePerm && body.allowDetailing !== undefined ? Boolean(body.allowDetailing) : false;

    const [newNode] = await db
      .insert(workNodes)
      .values({
        id: body.id || undefined,
        projectId: targetProject.id,
        parentId: verifiedParentId,
        wbsCode: String(body.wbsCode).trim(),
        name: String(body.name).trim(),
        weightPercent: body.weightPercent ? String(body.weightPercent) : '0.00',
        plannedStartDate: body.plannedStartDate ? new Date(body.plannedStartDate) : null,
        plannedEndDate: body.plannedEndDate ? new Date(body.plannedEndDate) : null,
        documentReferenceNo: body.documentReferenceNo || null,
        activeRevision: body.activeRevision || null,
        claimedProgressPercent: Number(body.claimedProgressPercent) || 0,
        verifiedProgressPercent: Number(body.verifiedProgressPercent) || 0,
        allowDetailing,
        detailingStatus,
        volume: body.volume != null && String(body.volume).trim() !== '' ? String(body.volume) : null,
        unit: body.unit ? String(body.unit).trim() : null,
        sortOrder: Number(body.sortOrder) || 0,
      })
      .returning();

    if (detailingStatus === 'active') {
      await recalculateAndSaveNodeRollups(db, targetProject.id);
    }

    await logAudit(req.authUser.id, req.authUser.name, 'CREATE_WBS_NODE', 'work_node', newNode.id, {
      projectId: targetProject.id,
      wbsCode: newNode.wbsCode,
      name: newNode.name,
    });

    res.status(201).json({ node: newNode });
  }
);

apiRouter.put(
  '/projects/:projectId/wbs/nodes/:nodeId',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const nodeScopeId = String(req.params.nodeId || '');
    const [existingNode] = await db
      .select()
      .from(workNodes)
      .where(and(eq(workNodes.id, nodeScopeId as any), eq(workNodes.projectId, projectScopeId as any)))
      .limit(1);

    if (!existingNode) {
      res.status(404).json({ error: 'WBS node not found.' });
      return;
    }

    const body = req.body || {};

    let newParentId: string | null = existingNode.parentId;
    if (body.parentId !== undefined) {
      if (body.parentId === null || body.parentId === '') {
        newParentId = null;
      } else {
        const requestedParentId = String(body.parentId);
        if (requestedParentId === existingNode.id) {
          res.status(400).json({ error: 'Cannot set parent to self (cycle detected).' });
          return;
        }

        const [targetParent] = await db
          .select()
          .from(workNodes)
          .where(and(eq(workNodes.id, requestedParentId as any), eq(workNodes.projectId, projectScopeId as any)))
          .limit(1);

        if (!targetParent) {
          res.status(400).json({ error: 'Parent node does not exist or does not belong to this project.' });
          return;
        }

        // Cycle check: verify targetParent is not a descendant of existingNode
        const projectNodes = await db
          .select({ id: workNodes.id, parentId: workNodes.parentId })
          .from(workNodes)
          .where(eq(workNodes.projectId, projectScopeId as any));

        const parentMap = new Map<string, string | null>();
        for (const n of projectNodes) {
          parentMap.set(n.id, n.parentId);
        }

        let currId: string | null = targetParent.id;
        const visited = new Set<string>();
        while (currId) {
          if (currId === existingNode.id) {
            res.status(400).json({ error: 'Cannot set parent to a descendant node (cycle detected).' });
            return;
          }
          if (visited.has(currId)) break;
          visited.add(currId);
          currId = parentMap.get(currId) || null;
        }

        newParentId = targetParent.id;
      }
    }

    const userPerms = await resolveUserPermissions(req.authUser.id, projectScopeId);
    const hasStructurePerm =
      userPerms.orgPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE) ||
      userPerms.projectPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE);

    if (
      !hasStructurePerm &&
      body.allowDetailing !== undefined &&
      Boolean(body.allowDetailing) !== existingNode.allowDetailing
    ) {
      res.status(403).json({
        error: 'Hanya pemegang wbs.edit_structure yang dapat mengubah allow_detailing.',
      });
      return;
    }

    const updatedAllowDetailing =
      hasStructurePerm && body.allowDetailing !== undefined
        ? Boolean(body.allowDetailing)
        : existingNode.allowDetailing;

    const updatedDetailingStatus =
      hasStructurePerm && body.detailingStatus !== undefined
        ? body.detailingStatus
        : existingNode.detailingStatus;

    const [updatedNode] = await db
      .update(workNodes)
      .set({
        parentId: newParentId,
        wbsCode: body.wbsCode ? String(body.wbsCode).trim() : existingNode.wbsCode,
        name: body.name ? String(body.name).trim() : existingNode.name,
        weightPercent: body.weightPercent !== undefined ? String(body.weightPercent) : existingNode.weightPercent,
        plannedStartDate: body.plannedStartDate !== undefined ? (body.plannedStartDate ? new Date(body.plannedStartDate) : null) : existingNode.plannedStartDate,
        plannedEndDate: body.plannedEndDate !== undefined ? (body.plannedEndDate ? new Date(body.plannedEndDate) : null) : existingNode.plannedEndDate,
        documentReferenceNo: body.documentReferenceNo !== undefined ? body.documentReferenceNo : existingNode.documentReferenceNo,
        activeRevision: body.activeRevision !== undefined ? body.activeRevision : existingNode.activeRevision,
        claimedProgressPercent: body.claimedProgressPercent !== undefined ? Number(body.claimedProgressPercent) : existingNode.claimedProgressPercent,
        verifiedProgressPercent: body.verifiedProgressPercent !== undefined ? Number(body.verifiedProgressPercent) : existingNode.verifiedProgressPercent,
        allowDetailing: updatedAllowDetailing,
        detailingStatus: updatedDetailingStatus,
        volume: body.volume !== undefined ? (body.volume != null && String(body.volume).trim() !== '' ? String(body.volume) : null) : existingNode.volume,
        unit: body.unit !== undefined ? (body.unit ? String(body.unit).trim() : null) : existingNode.unit,
        sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : existingNode.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(workNodes.id, existingNode.id))
      .returning();

    await recalculateAndSaveNodeRollups(db, projectScopeId);

    await logAudit(req.authUser.id, req.authUser.name, 'UPDATE_WBS_NODE', 'work_node', updatedNode.id, {
      wbsCode: updatedNode.wbsCode,
      name: updatedNode.name,
      parentId: updatedNode.parentId,
      sortOrder: updatedNode.sortOrder,
    });

    res.json({ node: updatedNode });
  }
);

apiRouter.delete(
  '/projects/:projectId/wbs/nodes/:nodeId',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const nodeScopeId = String(req.params.nodeId || '');
    const [existingNode] = await db
      .select({ id: workNodes.id, name: workNodes.name, wbsCode: workNodes.wbsCode, parentId: workNodes.parentId })
      .from(workNodes)
      .where(and(eq(workNodes.id, nodeScopeId as any), eq(workNodes.projectId, projectScopeId as any)))
      .limit(1);

    if (!existingNode) {
      res.status(404).json({ error: 'WBS node not found.' });
      return;
    }

    // Role check: users with only wbs.edit_detail can only delete sub-items (parentId !== null)
    const userPerms = await resolveUserPermissions(req.authUser.id, projectScopeId);
    const hasStructure =
      userPerms.orgPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE) ||
      userPerms.projectPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE);

    if (!hasStructure && !existingNode.parentId) {
      res.status(403).json({
        error: 'Hanya Head Office / PMO dengan izin wbs.edit_structure yang dapat menghapus Node Tingkat Induk (Root).',
      });
      return;
    }

    // Recursively collect all descendant child node IDs to ensure clean cascade delete
    const allProjectNodes = await db
      .select({ id: workNodes.id, parentId: workNodes.parentId })
      .from(workNodes)
      .where(eq(workNodes.projectId, projectScopeId as any));

    const toDeleteIds = new Set<string>([existingNode.id]);
    let added = true;
    while (added) {
      added = false;
      for (const n of allProjectNodes) {
        if (n.parentId && toDeleteIds.has(n.parentId) && !toDeleteIds.has(n.id)) {
          toDeleteIds.add(n.id);
          added = true;
        }
      }
    }

    await db.delete(workNodes).where(inArray(workNodes.id, Array.from(toDeleteIds) as any));
    await recalculateAndSaveNodeRollups(db, projectScopeId);

    await logAudit(req.authUser.id, req.authUser.name, 'DELETE_WBS_NODE', 'work_node', existingNode.id, {
      wbsCode: existingNode.wbsCode,
      name: existingNode.name,
      deletedCount: toDeleteIds.size,
    });

    res.json({ success: true, deletedId: existingNode.id, deletedCount: toDeleteIds.size });
  }
);

// Blueprint Tahap 3b (Section 9.2 & Section H.3b): Atomic Batch Detailing
apiRouter.post(
  '/projects/:projectId/wbs/nodes/:parentId/details-batch',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectId = String(req.params.projectId);
    const parentId = String(req.params.parentId);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId as any))
      .limit(1);

    if (!project) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const [parent] = await db
      .select()
      .from(workNodes)
      .where(and(eq(workNodes.id, parentId as any), eq(workNodes.projectId, project.id)))
      .limit(1);

    if (!parent) {
      res.status(404).json({ error: 'Parent WBS node not found in this project.' });
      return;
    }

    const userPerms = await resolveUserPermissions(req.authUser.id, project.id);
    const hasStructurePerm =
      userPerms.orgPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE) ||
      userPerms.projectPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE);

    if (!hasStructurePerm) {
      // Detail-only user (Site Officer): Must check allowDetailing on parent or within subtree
      let isAllowed = parent.allowDetailing;
      if (!isAllowed && parent.parentId) {
        let currParentId: string | null = parent.parentId;
        const allNodes = await db
          .select({ id: workNodes.id, parentId: workNodes.parentId, allowDetailing: workNodes.allowDetailing })
          .from(workNodes)
          .where(eq(workNodes.projectId, project.id));
        const nodeLookup = new Map(allNodes.map((n) => [n.id, n]));
        while (currParentId) {
          const anc = nodeLookup.get(currParentId);
          if (anc?.allowDetailing) {
            isAllowed = true;
            break;
          }
          currParentId = anc?.parentId || null;
        }
      }

      if (!isAllowed) {
        res.status(403).json({
          error: 'Penambahan detail dilarang pada paket kerja ini (allow_detailing = false).',
        });
        return;
      }

      // Must check if parent has approved stages or verified progress
      const approvedStages = await db
        .select({ id: workStages.id })
        .from(workStages)
        .innerJoin(workWorkflows, eq(workStages.workflowId, workWorkflows.id))
        .where(and(eq(workWorkflows.nodeId, parent.id), eq(workStages.status, 'approved')))
        .limit(1);

      if (approvedStages.length > 0 || Number(parent.verifiedProgressPercent) > 0) {
        res.status(422).json({
          error: 'Simpul WBS telah memiliki tahapan inspeksi yang disetujui; pemecahan wajib melalui Change Request.',
        });
        return;
      }
    }

    const children = Array.isArray(req.body.items) ? req.body.items : (Array.isArray(req.body.children) ? req.body.children : []);
    if (!Array.isArray(children) || children.length === 0) {
      res.status(400).json({ error: 'Array children/items wajib diisi.' });
      return;
    }

    // Sum sibling weights - MUST equal 100.00% within 0.01 tolerance
    let sumWeight = 0;
    for (const child of children) {
      if (!child.name || !child.wbsCode) {
        res.status(400).json({ error: 'Setiap child wajib memiliki wbsCode dan name.' });
        return;
      }
      const w = Number(child.weightPercent);
      if (isNaN(w) || w <= 0) {
        res.status(400).json({ error: 'Bobot setiap child wajib lebih besar dari 0%.' });
        return;
      }
      sumWeight += w;
    }

    if (Math.abs(sumWeight - 100.0) > 0.01) {
      res.status(422).json({
        error: `Total bobot sibling wajib tepat 100.00% (saat ini ${sumWeight.toFixed(2)}%).`,
      });
      return;
    }

    const detailingStatus =
      !hasStructurePerm && project.requirePmApprovalForDetailing
        ? 'pending_pm_approval'
        : 'active';

    const insertedNodes = await db.transaction(async (tx) => {
      const createdList: any[] = [];
      let sortOrder = 0;

      for (const child of children) {
        const [newNode] = await tx
          .insert(workNodes)
          .values({
            projectId: project.id,
            parentId: parent.id,
            wbsCode: String(child.wbsCode).trim(),
            name: String(child.name).trim(),
            weightPercent: Number(child.weightPercent).toFixed(2),
            volume: child.volume != null && String(child.volume).trim() !== '' ? String(child.volume) : null,
            unit: child.unit ? String(child.unit).trim() : null,
            plannedStartDate: child.plannedStartDate
              ? new Date(child.plannedStartDate)
              : parent.plannedStartDate,
            plannedEndDate: child.plannedEndDate
              ? new Date(child.plannedEndDate)
              : parent.plannedEndDate,
            documentReferenceNo: child.documentReferenceNo || parent.documentReferenceNo || null,
            activeRevision: child.activeRevision || parent.activeRevision || null,
            claimedProgressPercent: 0,
            verifiedProgressPercent: 0,
            allowDetailing: false,
            detailingStatus,
            sortOrder: child.sortOrder !== undefined ? Number(child.sortOrder) : sortOrder++,
          })
          .returning();

        createdList.push(newNode);
      }

      if (detailingStatus === 'active') {
        await recalculateAndSaveNodeRollups(tx, project.id);
      }

      return createdList;
    });

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'CREATE_WBS_DETAIL',
      'work_node',
      parent.id,
      {
        projectId: project.id,
        parentId: parent.id,
        count: insertedNodes.length,
        detailingStatus,
      }
    );

    res.status(201).json({
      success: true,
      count: insertedNodes.length,
      detailingStatus,
      nodes: insertedNodes,
    });
  }
);

// Blueprint Tahap 3b: PM Approval for pending batch details
apiRouter.post(
  '/projects/:projectId/wbs/nodes/:parentId/approve-details',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission(PERMISSIONS.WBS_EDIT_STRUCTURE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectId = String(req.params.projectId);
    const parentId = String(req.params.parentId);

    const approvedList = await db
      .update(workNodes)
      .set({ detailingStatus: 'active', updatedAt: new Date() })
      .where(
        and(
          eq(workNodes.projectId, projectId as any),
          eq(workNodes.parentId, parentId as any),
          eq(workNodes.detailingStatus, 'pending_pm_approval')
        )
      )
      .returning();

    await recalculateAndSaveNodeRollups(db, projectId);

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'APPROVE_WBS_DETAILS',
      'work_node',
      parentId,
      {
        projectId,
        parentId,
        approvedCount: approvedList.length,
      }
    );

    res.json({
      success: true,
      approvedCount: approvedList.length,
      nodes: approvedList,
    });
  }
);

// Blueprint Fase B3: PATCH allowDetailing per node
apiRouter.patch(
  '/projects/:projectId/wbs/nodes/:nodeId/detailing',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission(PERMISSIONS.WBS_EDIT_STRUCTURE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const nodeId = String(req.params.nodeId);
    const { allowDetailing } = req.body ?? {};

    const [node] = await db
      .select()
      .from(workNodes)
      .where(and(eq(workNodes.id, nodeId as any), eq(workNodes.projectId, projectId as any)));

    if (!node) {
      res.status(404).json({ error: 'Node not found.' });
      return;
    }

    const [updated] = await db
      .update(workNodes)
      .set({ allowDetailing: Boolean(allowDetailing), updatedAt: new Date() })
      .where(eq(workNodes.id, node.id))
      .returning();

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'WBS_NODE_DETAILING_TOGGLED',
      'work_node',
      node.id,
      { projectId, allowDetailing: updated.allowDetailing }
    );

    res.json({ node: updated });
  }
);

// Blueprint Fase B3: Atomic Batch Drag-and-Drop (Reparent + Order + Weights)
apiRouter.put(
  '/projects/:projectId/wbs/nodes-batch',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const updates = Array.isArray(req.body.updates) ? req.body.updates : req.body.nodes;

    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ error: 'Array updates wajib diisi.' });
      return;
    }

    const allProjectNodes = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.projectId, projectId as any));

    const nodeMap = new Map(allProjectNodes.map((n) => [n.id, n]));

    for (const u of updates) {
      if (!nodeMap.has(u.id)) {
        res.status(404).json({ error: `Simpul ${u.id} bukan milik proyek ini.` });
        return;
      }
      if (u.parentId) {
        if (!nodeMap.has(u.parentId)) {
          res.status(404).json({ error: `Simpul induk ${u.parentId} bukan milik proyek ini.` });
          return;
        }
        if (u.parentId === u.id) {
          res.status(422).json({ error: `Terdeteksi siklus: Simpul ${u.id} tidak dapat menjadi induk dirinya sendiri.` });
          return;
        }
      }
    }

    const parentOf = new Map<string, string | null>();
    for (const n of allProjectNodes) {
      parentOf.set(n.id, n.parentId);
    }
    for (const u of updates) {
      if (u.parentId !== undefined) {
        parentOf.set(u.id, u.parentId);
      }
    }

    // Cycle detection
    for (const u of updates) {
      let curr = parentOf.get(u.id);
      const visited = new Set<string>([u.id]);
      while (curr) {
        if (visited.has(curr)) {
          res.status(422).json({ error: `Terdeteksi siklus hierarki melibatkan simpul ${curr}.` });
          return;
        }
        visited.add(curr);
        curr = parentOf.get(curr) || null;
      }
    }

    // Check detail permissions on reparenting if not structure editor
    const userPerms = await resolveUserPermissions(req.authUser.id, projectId);
    const hasStructurePerm =
      userPerms.orgPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE) ||
      userPerms.projectPermissions.has(PERMISSIONS.WBS_EDIT_STRUCTURE);

    if (!hasStructurePerm) {
      for (const u of updates) {
        if (u.parentId !== undefined) {
          const targetParent = u.parentId ? nodeMap.get(u.parentId) : null;
          if (targetParent && !targetParent.allowDetailing) {
            res.status(403).json({
              error: `Penambahan/pemindahan rincian ke simpul '${targetParent.name}' dilarang (allow_detailing = false).`,
            });
            return;
          }
        }
      }
    }

    await db.transaction(async (tx) => {
      for (const u of updates) {
        const setPayload: Record<string, any> = { updatedAt: new Date() };
        if (u.parentId !== undefined) setPayload.parentId = u.parentId;
        if (u.sortOrder !== undefined) setPayload.sortOrder = Number(u.sortOrder);
        if (u.weightPercent !== undefined) setPayload.weightPercent = Number(u.weightPercent).toFixed(2);
        if (u.name !== undefined) setPayload.name = String(u.name).trim();

        await tx
          .update(workNodes)
          .set(setPayload)
          .where(and(eq(workNodes.id, u.id as any), eq(workNodes.projectId, projectId as any)));
      }
      await recalculateAndSaveNodeRollups(tx, projectId);
    });

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'WBS_NODES_BATCH_UPDATED',
      'project',
      projectId,
      { count: updates.length }
    );

    res.json({ success: true, updatedCount: updates.length });
  }
);

apiRouter.post(
  '/projects/:projectId/wbs/apply-preset',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission(PERMISSIONS.WBS_EDIT_STRUCTURE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const [targetProject] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectScopeId as any))
      .limit(1);

    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const { preset } = req.body || {};

    // Clear existing nodes for clean preset application
    await db.delete(workNodes).where(eq(workNodes.projectId, targetProject.id));

    if (preset === 'blank') {
      res.json({ message: 'Blank canvas initiated. All existing nodes cleared.', nodes: [] });
      return;
    }

    const createdNodes = [];

    if (preset === 'civil_building') {
      const [n1] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        wbsCode: '1.0',
        name: 'Pekerjaan Persiapan & Mobilisasi',
        weightPercent: '10.00',
        sortOrder: 1,
      }).returning();
      const [n2] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        wbsCode: '2.0',
        name: 'Pekerjaan Struktur Bawah (Substructure)',
        weightPercent: '30.00',
        documentReferenceNo: 'DWG-FND-001',
        activeRevision: 'Rev A',
        sortOrder: 2,
      }).returning();
      const [n3] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        wbsCode: '3.0',
        name: 'Pekerjaan Struktur Atas & Arsitektur',
        weightPercent: '40.00',
        documentReferenceNo: 'DWG-STR-201',
        activeRevision: 'Rev B',
        sortOrder: 3,
      }).returning();
      const [n4] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        wbsCode: '4.0',
        name: 'Pekerjaan Mekanikal, Elektrikal & Plumbing (MEP)',
        weightPercent: '20.00',
        documentReferenceNo: 'DWG-MEP-001',
        activeRevision: 'Rev A',
        sortOrder: 4,
      }).returning();
      createdNodes.push(n1, n2, n3, n4);
    } else {
      // Default: 'general_epc'
      const [n1] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        wbsCode: '1.0',
        name: 'Engineering & Detailed Design',
        weightPercent: '15.00',
        sortOrder: 1,
      }).returning();
      const [n2] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        wbsCode: '2.0',
        name: 'Procurement & Long-Lead Equipment',
        weightPercent: '35.00',
        sortOrder: 2,
      }).returning();
      const [n3] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        wbsCode: '3.0',
        name: 'Civil & Structural Construction',
        weightPercent: '45.00',
        sortOrder: 3,
      }).returning();
      const [n31] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        parentId: n3.id,
        wbsCode: '3.1',
        name: 'Substructure & Piling Inspection',
        weightPercent: '20.00',
        documentReferenceNo: 'DWG-CIV-001',
        activeRevision: 'Rev B',
        sortOrder: 4,
      }).returning();
      const [n32] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        parentId: n3.id,
        wbsCode: '3.2',
        name: 'Superstructure & Core Wall Pouring',
        weightPercent: '25.00',
        documentReferenceNo: 'DWG-STR-104',
        activeRevision: 'Rev C',
        sortOrder: 5,
      }).returning();
      const [n4] = await db.insert(workNodes).values({
        projectId: targetProject.id,
        wbsCode: '4.0',
        name: 'Pre-Commissioning & Handover',
        weightPercent: '5.00',
        sortOrder: 6,
      }).returning();
      createdNodes.push(n1, n2, n3, n31, n32, n4);
    }

    await logAudit(req.authUser.id, req.authUser.name, 'APPLY_WBS_PRESET', 'project', targetProject.id, {
      preset: preset || 'general_epc',
      nodeCount: createdNodes.length,
    });

    res.json({ message: `Preset '${preset || 'general_epc'}' applied successfully.`, nodes: createdNodes });
  }
);

// ---------------- MULTI-STAGE WORKFLOW & DUAL-TRACK SIGNATURES (FASE 3) ----------------

apiRouter.get(
  '/projects/:projectId/wbs/nodes/:nodeId/workflow',
  requireAuth,
  requireProjectAccess('projectId'),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const nodeScopeId = String(req.params.nodeId || '');

    const [matchedNode] = await db
      .select()
      .from(workNodes)
      .where(and(eq(workNodes.id, nodeScopeId as any), eq(workNodes.projectId, projectScopeId as any)))
      .limit(1);

    if (!matchedNode) {
      res.status(404).json({ error: 'WBS node not found in this project.' });
      return;
    }

    const [matchedWorkflow] = await db
      .select()
      .from(workWorkflows)
      .where(eq(workWorkflows.nodeId, matchedNode.id))
      .limit(1);

    if (!matchedWorkflow) {
      res.json({
        node: matchedNode,
        workflow: null,
        stages: [],
        attempts: [],
      });
      return;
    }

    const stages = await db
      .select()
      .from(workStages)
      .where(eq(workStages.workflowId, matchedWorkflow.id))
      .orderBy(workStages.stageOrder);

    const stageIds = stages.map((s) => s.id);
    let attempts: any[] = [];
    if (stageIds.length > 0) {
      const allAttempts = await db
        .select()
        .from(inspectionAttempts)
        .orderBy(desc(inspectionAttempts.attemptNumber));
      attempts = allAttempts.filter((a) => stageIds.includes(a.stageId));
    }

    res.json({
      node: matchedNode,
      workflow: matchedWorkflow,
      stages,
      attempts,
    });
  }
);

apiRouter.post(
  '/projects/:projectId/wbs/nodes/:nodeId/workflow/init-default',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission(PERMISSIONS.WBS_EDIT_STRUCTURE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const nodeScopeId = String(req.params.nodeId || '');

    const [matchedNode] = await db
      .select()
      .from(workNodes)
      .where(and(eq(workNodes.id, nodeScopeId as any), eq(workNodes.projectId, projectScopeId as any)))
      .limit(1);

    if (!matchedNode) {
      res.status(404).json({ error: 'WBS node not found.' });
      return;
    }

    let [existingWf] = await db
      .select()
      .from(workWorkflows)
      .where(eq(workWorkflows.nodeId, matchedNode.id))
      .limit(1);

    if (!existingWf) {
      const [newWf] = await db
        .insert(workWorkflows)
        .values({
          nodeId: matchedNode.id,
          title: `Inspection Workflow: ${matchedNode.name}`,
        })
        .returning();
      existingWf = newWf;
    }

    // Check existing stages
    const existingStages = await db
      .select()
      .from(workStages)
      .where(eq(workStages.workflowId, existingWf.id));

    if (existingStages.length === 0) {
      const templates = generateDefaultStages(matchedNode.name);
      for (const tpl of templates) {
        await db.insert(workStages).values({
          workflowId: existingWf.id,
          stageOrder: tpl.stageOrder,
          stageType: tpl.stageType,
          name: tpl.name,
          assignedRole: tpl.assignedRole,
          approvalRole: tpl.approvalRole,
          requiresWetSignature: tpl.requiresWetSignature,
          status: 'pending',
        });
      }
    }

    const updatedStages = await db
      .select()
      .from(workStages)
      .where(eq(workStages.workflowId, existingWf.id))
      .orderBy(workStages.stageOrder);

    await logAudit(req.authUser.id, req.authUser.name, 'INIT_DEFAULT_WORKFLOW', 'work_workflow', existingWf.id, {
      nodeId: matchedNode.id,
      stageCount: updatedStages.length,
    });

    res.json({
      workflow: existingWf,
      stages: updatedStages,
    });
  }
);

apiRouter.get(
  '/stages/:stageId/attempts',
  requireAuth,
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const stageScopeId = String(req.params.stageId || '');
    const projectId = await getProjectIdByStageId(stageScopeId);
    if (!projectId) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    if (!assertProjectAccess(req.authUser, projectId, res, false)) {
      return;
    }

    const [targetStage] = await db
      .select()
      .from(workStages)
      .where(eq(workStages.id, stageScopeId as any))
      .limit(1);

    if (!targetStage) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    const attempts = await db
      .select()
      .from(inspectionAttempts)
      .where(eq(inspectionAttempts.stageId, targetStage.id))
      .orderBy(desc(inspectionAttempts.attemptNumber));

    const attemptIds = attempts.map((a) => a.id);
    let attachments: any[] = [];
    if (attemptIds.length > 0) {
      attachments = await db
        .select()
        .from(evidenceAttachments)
        .where(inArray(evidenceAttachments.attemptId, attemptIds));
    }

    res.json({
      stage: targetStage,
      attempts,
      attachments,
    });
  }
);

// Blueprint Tahap 2c: RFI Stage Request (pending -> requested)
apiRouter.post(
  '/stages/:stageId/request',
  requireAuth,
  requirePermission(PERMISSIONS.STAGE_REQUEST),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const stageScopeId = String(req.params.stageId || '');
    const projectId = await getProjectIdByStageId(stageScopeId);
    if (!projectId) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    if (!assertProjectAccess(req.authUser, projectId, res, true)) {
      return;
    }

    const [targetStage] = await db
      .select()
      .from(workStages)
      .where(eq(workStages.id, stageScopeId as any))
      .limit(1);

    if (!targetStage) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    if (targetStage.status !== 'pending' && targetStage.status !== 'rejected') {
      res.status(400).json({
        error: `Tahapan "${targetStage.name}" saat ini berstatus "${targetStage.status}" dan tidak dapat diajukan (hanya tahapan pending atau rejected yang dapat diajukan).`,
      });
      return;
    }

    // Check Hold Point Lockout across sibling stages in this workflow
    const siblingStages = await db
      .select()
      .from(workStages)
      .where(eq(workStages.workflowId, targetStage.workflowId))
      .orderBy(workStages.stageOrder);

    const progressionCheck = canProceedToStage(siblingStages, targetStage.id);
    if (!progressionCheck.allowed) {
      res.status(400).json({
        error: progressionCheck.reason,
        blockingStage: progressionCheck.blockingStage,
      });
      return;
    }

    // Determine attempt number
    const existingAttempts = await db
      .select()
      .from(inspectionAttempts)
      .where(eq(inspectionAttempts.stageId, targetStage.id));

    const nextAttemptNumber = getNextAttemptNumber(existingAttempts);
    const now = new Date();

    // Insert attempt record in 'requested' status with requester_id and requested_at (Blueprint Keputusan 9 Opsi A)
    const [newAttempt] = await db
      .insert(inspectionAttempts)
      .values({
        stageId: targetStage.id,
        attemptNumber: nextAttemptNumber,
        submitterId: req.authUser.id as any,
        requesterId: req.authUser.id as any,
        requestedAt: now,
        submittedAt: now,
        status: 'requested',
        answers: {},
      })
      .returning();

    // Transition stage status to 'requested'
    const [updatedStage] = await db
      .update(workStages)
      .set({
        status: 'requested',
      })
      .where(eq(workStages.id, targetStage.id))
      .returning();

    await logAudit(req.authUser.id, req.authUser.name, 'REQUEST_STAGE_RFI', 'work_stage', targetStage.id, {
      attemptId: newAttempt.id,
      attemptNumber: nextAttemptNumber,
      requesterId: req.authUser.id,
      requestedAt: now.toISOString(),
    });

    res.status(201).json({
      attempt: newAttempt,
      stage: updatedStage,
      message: `RFI untuk tahapan "${targetStage.name}" berhasil diajukan (Percobaan #${nextAttemptNumber}).`,
    });
  }
);

apiRouter.post(
  '/stages/:stageId/submit',
  requireAuth,
  requirePermission(PERMISSIONS.STAGE_EXECUTE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const stageScopeId = String(req.params.stageId || '');
    const projectId = await getProjectIdByStageId(stageScopeId);
    if (!projectId) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    if (!assertProjectAccess(req.authUser, projectId, res, true)) {
      return;
    }

    const [targetStage] = await db
      .select()
      .from(workStages)
      .where(eq(workStages.id, stageScopeId as any))
      .limit(1);

    if (!targetStage) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    // Check Hold Point Lockout across sibling stages in this workflow
    const siblingStages = await db
      .select()
      .from(workStages)
      .where(eq(workStages.workflowId, targetStage.workflowId))
      .orderBy(workStages.stageOrder);

    const progressionCheck = canProceedToStage(siblingStages, targetStage.id);
    if (!progressionCheck.allowed) {
      res.status(400).json({
        error: progressionCheck.reason,
        blockingStage: progressionCheck.blockingStage,
      });
      return;
    }

    const body = req.body || {};

    // Validate dual-track signature
    const sigCheck = validateDualTrackSignature(
      {
        signatureCanvasUrl: body.signatureCanvasUrl,
        wetSignatureDocumentUrl: body.wetSignatureDocumentUrl,
      },
      targetStage.requiresWetSignature
    );

    if (!sigCheck.valid) {
      res.status(400).json({ error: sigCheck.message });
      return;
    }

    // Check if there is an open attempt in 'requested' or 'draft' status
    const existingAttempts = await db
      .select()
      .from(inspectionAttempts)
      .where(eq(inspectionAttempts.stageId, targetStage.id))
      .orderBy(desc(inspectionAttempts.attemptNumber));

    const openAttempt = existingAttempts.find((a) => a.status === 'requested' || a.status === 'draft');
    let newAttempt: any;

    if (openAttempt) {
      // Update existing open attempt initiated during request step
      const [updated] = await db
        .update(inspectionAttempts)
        .set({
          submitterId: req.authUser.id as any,
          status: 'submitted',
          submittedAt: new Date(),
          answers: body.answers || {},
          signatureCanvasUrl: body.signatureCanvasUrl || null,
          wetSignatureDocumentUrl: body.wetSignatureDocumentUrl || null,
          offlineSyncId: body.offlineSyncId || null,
        })
        .where(eq(inspectionAttempts.id, openAttempt.id))
        .returning();
      newAttempt = updated;
    } else {
      const nextAttemptNumber = getNextAttemptNumber(existingAttempts);
      const [inserted] = await db
        .insert(inspectionAttempts)
        .values({
          stageId: targetStage.id,
          attemptNumber: nextAttemptNumber,
          submitterId: req.authUser.id as any,
          requesterId: req.authUser.id as any,
          requestedAt: new Date(),
          status: 'submitted',
          answers: body.answers || {},
          signatureCanvasUrl: body.signatureCanvasUrl || null,
          wetSignatureDocumentUrl: body.wetSignatureDocumentUrl || null,
          offlineSyncId: body.offlineSyncId || null,
        })
        .returning();
      newAttempt = inserted;
    }

    // If wet signature document provided, record in evidence attachments as well
    if (body.wetSignatureDocumentUrl) {
      const sha = crypto
        .createHash('sha256')
        .update(body.wetSignatureDocumentUrl + Date.now())
        .digest('hex');

      await db.insert(evidenceAttachments).values({
        attemptId: newAttempt.id,
        fileUrl: body.wetSignatureDocumentUrl,
        attachmentType: 'wet_signature_scan',
        sha256: sha,
        uploaderId: req.authUser.id as any,
      });
    }

    // Update stage status to 'submitted'
    const [updatedStage] = await db
      .update(workStages)
      .set({
        status: 'submitted',
      })
      .where(eq(workStages.id, targetStage.id))
      .returning();

    await logAudit(req.authUser.id, req.authUser.name, 'SUBMIT_STAGE_INSPECTION', 'work_stage', targetStage.id, {
      attemptId: newAttempt.id,
      attemptNumber: newAttempt.attemptNumber,
      signatureType: sigCheck.signatureType,
    });

    res.status(201).json({
      attempt: newAttempt,
      stage: updatedStage,
      message: `Inspeksi tahapan "${targetStage.name}" berhasil diajukan (Percobaan #${newAttempt.attemptNumber}).`,
    });
  }
);

apiRouter.post(
  '/stages/:stageId/review',
  requireAuth,
  requirePermission(PERMISSIONS.STAGE_APPROVE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const stageScopeId = String(req.params.stageId || '');
    const projectId = await getProjectIdByStageId(stageScopeId);
    if (!projectId) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    if (!assertProjectAccess(req.authUser, projectId, res, true)) {
      return;
    }

    const [targetStage] = await db
      .select()
      .from(workStages)
      .where(eq(workStages.id, stageScopeId as any))
      .limit(1);

    if (!targetStage) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    const body = req.body || {};
    const decision: 'approved' | 'rejected' = body.decision;
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: 'Decision must be either "approved" or "rejected".' });
      return;
    }

    // Get latest submitted attempt
    const [latestAttempt] = await db
      .select()
      .from(inspectionAttempts)
      .where(eq(inspectionAttempts.stageId, targetStage.id))
      .orderBy(desc(inspectionAttempts.attemptNumber))
      .limit(1);

    if (!latestAttempt) {
      res.status(400).json({ error: 'No inspection attempt found to review.' });
      return;
    }

    // Strict Four-Eyes Principle check: Submitter/requester cannot approve and minimum 2 distinct individuals
    const fourEyesCheck = validateFourEyesDetails(
      latestAttempt.requesterId,
      latestAttempt.submitterId,
      req.authUser.id
    );

    if (!fourEyesCheck.valid) {
      res.status(403).json({
        error: fourEyesCheck.reason || 'Pelanggaran Prinsip Four-Eyes: Pelaksana atau pemohon inspeksi tidak diizinkan menyetujui pemeriksaannya sendiri.',
      });
      return;
    }

    // Update attempt
    const [updatedAttempt] = await db
      .update(inspectionAttempts)
      .set({
        status: decision,
        approverId: req.authUser.id as any,
        decidedAt: new Date(),
        rejectionReason: decision === 'rejected' ? (body.notes || 'Ditolak dengan catatan perbaikan.') : null,
      })
      .where(eq(inspectionAttempts.id, latestAttempt.id))
      .returning();

    // Update stage status
    const [updatedStage] = await db
      .update(workStages)
      .set({
        status: decision,
        actualCompletedAt: decision === 'approved' ? new Date() : null,
      })
      .where(eq(workStages.id, targetStage.id))
      .returning();

    // If approved, update progress on the parent WBS node
    if (decision === 'approved') {
      const [wf] = await db
        .select({ nodeId: workWorkflows.nodeId })
        .from(workWorkflows)
        .where(eq(workWorkflows.id, targetStage.workflowId))
        .limit(1);

      if (wf && wf.nodeId) {
        const [node] = await db.select().from(workNodes).where(eq(workNodes.id, wf.nodeId)).limit(1);
        if (node) {
          // Increment verified progress proportionally based on approved stages
          const allStages = await db
            .select()
            .from(workStages)
            .where(eq(workStages.workflowId, targetStage.workflowId));
          const approvedCount = allStages.filter((s) => s.status === 'approved' || s.id === targetStage.id).length;
          const newVerified = Math.round((approvedCount / allStages.length) * 100);
          await db
            .update(workNodes)
            .set({
              verifiedProgressPercent: newVerified,
              claimedProgressPercent: Math.max(node.claimedProgressPercent, newVerified),
              updatedAt: new Date(),
            })
            .where(eq(workNodes.id, node.id));

          // Trigger server-side hierarchical roll-up to all ancestor parent nodes
          await recalculateAndSaveNodeRollups(db, projectId);
        }
      }
    }

    await logAudit(req.authUser.id, req.authUser.name, 'REVIEW_STAGE_INSPECTION', 'work_stage', targetStage.id, {
      attemptId: latestAttempt.id,
      decision,
      stageName: targetStage.name,
    });

    res.json({
      stage: updatedStage,
      attempt: updatedAttempt,
      message: `Tahapan "${targetStage.name}" telah di-${decision === 'approved' ? 'setujui' : 'tolak'}.`,
    });
  }
);

// ---------------- S-CURVE, BOTTLENECK RADAR & WEATHER LOGS (FASE 4) ----------------

apiRouter.get(
  '/projects/:projectId/scurve',
  requireAuth,
  requireProjectAccess('projectId'),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const [targetProject] = await db
      .select({ id: projects.id, name: projects.name, code: projects.code })
      .from(projects)
      .where(eq(projects.id, projectScopeId as any))
      .limit(1);

    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const nodes = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.projectId, targetProject.id))
      .orderBy(workNodes.sortOrder, workNodes.wbsCode);

    const overrides = await db
      .select()
      .from(plannedCurveOverrides)
      .where(eq(plannedCurveOverrides.projectId, targetProject.id))
      .orderBy(plannedCurveOverrides.weekIndex);

    // Fetch CAPA items linked to nodes for Zero-Tolerance 99% lockout
    const projectCapa = await db
      .select({
        id: correctiveActions.id,
        nodeId: correctiveActions.nodeId,
        severity: correctiveActions.severity,
        status: correctiveActions.status,
        createdAt: correctiveActions.createdAt,
        resolvedAt: correctiveActions.resolvedAt,
      })
      .from(correctiveActions)
      .where(eq(correctiveActions.projectId, targetProject.id));

    const openLockoutMap = new Map<string, boolean>();
    for (const c of projectCapa) {
      if (
        c.nodeId &&
        (c.severity === 'critical' || c.severity === 'high') &&
        !['CLOSED', 'CANCELLED', 'REJECTED', 'EFFECTIVENESS_MONITORING'].includes(c.status) &&
        !c.resolvedAt
      ) {
        openLockoutMap.set(c.nodeId, true);
      }
    }

    // Determine project start and end dates from nodes or default 12-week window
    let earliestStart = new Date();
    let latestEnd = new Date();
    latestEnd.setDate(latestEnd.getDate() + 84); // 12 weeks default

    const validStarts = nodes.map((n) => n.plannedStartDate).filter(Boolean) as Date[];
    const validEnds = nodes.map((n) => n.plannedEndDate).filter(Boolean) as Date[];

    if (validStarts.length > 0) {
      earliestStart = new Date(Math.min(...validStarts.map((d) => new Date(d).getTime())));
    }
    if (validEnds.length > 0) {
      latestEnd = new Date(Math.max(...validEnds.map((d) => new Date(d).getTime())));
    }

    const weeks = generateProjectCalendarWeeks(earliestStart, latestEnd);

    // Query workflows and stages belonging to the project's nodes for SSOT milestone calculations
    const nodeIds = nodes.map((n) => n.id);
    let projectWorkflows: Array<{ id: string; nodeId: string }> = [];
    let projectStages: Array<{ id: string; workflowId: string; status: string; actualCompletedAt: Date | null }> = [];

    if (nodeIds.length > 0) {
      projectWorkflows = await db
        .select({ id: workWorkflows.id, nodeId: workWorkflows.nodeId })
        .from(workWorkflows)
        .where(inArray(workWorkflows.nodeId, nodeIds as any));

      const workflowIds = projectWorkflows.map((w) => w.id);
      if (workflowIds.length > 0) {
        projectStages = await db
          .select({
            id: workStages.id,
            workflowId: workStages.workflowId,
            status: workStages.status,
            actualCompletedAt: workStages.actualCompletedAt,
          })
          .from(workStages)
          .where(inArray(workStages.workflowId, workflowIds as any));
      }
    }

    const scurve = calculateSSOTSCurveData({
      projectId: targetProject.id,
      projectName: targetProject.name,
      nodes,
      weeks,
      stages: projectStages,
      workflows: projectWorkflows,
      overrides,
      hasPunchlistOpenMap: openLockoutMap,
      capaItems: projectCapa,
      asOfDate: new Date(),
    });

    res.json({ scurve });
  }
);

apiRouter.post(
  '/projects/:projectId/scurve/override',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission(PERMISSIONS.SCURVE_OVERRIDE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const [targetProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectScopeId as any))
      .limit(1);

    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const body = req.body || {};
    const weekIndex = Number(body.weekIndex);
    const overrideValue = Number(body.overridePlannedCumulative);

    if (!weekIndex || isNaN(overrideValue) || overrideValue < 0 || overrideValue > 100) {
      res.status(400).json({ error: 'weekIndex and valid overridePlannedCumulative (0-100) are required.' });
      return;
    }

    const [existing] = await db
      .select({ id: plannedCurveOverrides.id })
      .from(plannedCurveOverrides)
      .where(
        and(
          eq(plannedCurveOverrides.projectId, targetProject.id),
          eq(plannedCurveOverrides.weekIndex, weekIndex)
        )
      )
      .limit(1);

    let savedOverride;
    if (existing) {
      const [updated] = await db
        .update(plannedCurveOverrides)
        .set({
          overridePlannedCumulative: String(overrideValue),
          overriddenBy: req.authUser.id as any,
          reason: body.reason || null,
        })
        .where(eq(plannedCurveOverrides.id, existing.id))
        .returning();
      savedOverride = updated;
    } else {
      const [created] = await db
        .insert(plannedCurveOverrides)
        .values({
          projectId: targetProject.id,
          weekIndex,
          overridePlannedCumulative: String(overrideValue),
          overriddenBy: req.authUser.id as any,
          reason: body.reason || null,
        })
        .returning();
      savedOverride = created;
    }

    await logAudit(req.authUser.id, req.authUser.name, 'OVERRIDE_SCURVE_PLANNED', 'planned_curve_override', savedOverride.id, {
      projectId: targetProject.id,
      weekIndex,
      overrideValue,
      reason: body.reason,
    });

    res.json({
      override: savedOverride,
      message: `Kurva S Rencana Minggu #${weekIndex} berhasil di-override ke ${overrideValue}%.`,
    });
  }
);

apiRouter.get(
  '/projects/:projectId/bottleneck-radar',
  requireAuth,
  requireProjectAccess('projectId'),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const [targetProject] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectScopeId as any))
      .limit(1);

    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    // Get nodes of project
    const nodes = await db
      .select({ id: workNodes.id, wbsCode: workNodes.wbsCode, name: workNodes.name })
      .from(workNodes)
      .where(eq(workNodes.projectId, targetProject.id));

    const nodeIds = nodes.map((n) => n.id);
    if (nodeIds.length === 0) {
      res.json({ bottlenecks: [], criticalCount: 0, warningCount: 0, normalCount: 0 });
      return;
    }

    const nodeMap = new Map<string, { wbsCode: string; name: string }>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // Get workflows
    const allWorkflows = await db.select().from(workWorkflows);
    const workflows = allWorkflows.filter((wf) => nodeIds.includes(wf.nodeId));
    const workflowIds = workflows.map((wf) => wf.id);

    if (workflowIds.length === 0) {
      res.json({ bottlenecks: [], criticalCount: 0, warningCount: 0, normalCount: 0 });
      return;
    }

    const wfNodeMap = new Map<string, string>();
    for (const wf of workflows) wfNodeMap.set(wf.id, wf.nodeId);

    // Get pending/submitted/requested stages
    const allStages = await db.select().from(workStages);
    const pendingStages = allStages.filter(
      (s) => workflowIds.includes(s.workflowId) && (s.status === 'submitted' || s.status === 'requested')
    );

    const stageIds = pendingStages.map((s) => s.id);
    const allAttempts = await db.select().from(inspectionAttempts).orderBy(desc(inspectionAttempts.attemptNumber));
    const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
    const userMap = new Map<string, string>();
    for (const u of allUsers) userMap.set(u.id, u.name);

    const itemsForAging: any[] = [];
    for (const stg of pendingStages) {
      const attempt = allAttempts.find((a) => a.stageId === stg.id && (a.status === 'submitted' || a.status === 'requested'));
      if (attempt) {
        const nodeId = wfNodeMap.get(stg.workflowId) || '';
        const nodeInfo = nodeMap.get(nodeId) || { wbsCode: '?', name: 'Node' };
        const submitterName = userMap.get(attempt.submitterId) || (attempt.requesterId ? userMap.get(attempt.requesterId) : null) || 'Field Personnel';

        itemsForAging.push({
          stage: stg,
          wbsCode: nodeInfo.wbsCode,
          nodeName: nodeInfo.name,
          attempt,
          submitterName,
        });
      }
    }

    const bottlenecks = calculateBottleneckAging(itemsForAging, new Date());
    const criticalCount = bottlenecks.filter((b) => b.status === 'critical').length;
    const warningCount = bottlenecks.filter((b) => b.status === 'warning').length;
    const normalCount = bottlenecks.filter((b) => b.status === 'normal').length;

    res.json({
      bottlenecks,
      criticalCount,
      warningCount,
      normalCount,
    });
  }
);

apiRouter.get(
  '/projects/:projectId/weather-logs',
  requireAuth,
  requireProjectAccess('projectId'),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const [targetProject] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectScopeId as any))
      .limit(1);

    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const logs = await db
      .select()
      .from(dailyWeatherLogs)
      .where(eq(dailyWeatherLogs.projectId, targetProject.id))
      .orderBy(desc(dailyWeatherLogs.logDate));

    const impact = calculateWeatherEotImpact(logs as any);

    res.json({
      logs,
      impact,
    });
  }
);

apiRouter.post(
  '/projects/:projectId/weather-logs',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission(PERMISSIONS.WEATHER_LOG),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const [targetProject] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectScopeId as any))
      .limit(1);

    if (!targetProject) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }

    const body = req.body || {};
    const logDate = body.logDate ? new Date(body.logDate) : new Date();

    const [newLog] = await db
      .insert(dailyWeatherLogs)
      .values({
        projectId: targetProject.id,
        logDate,
        weatherCondition: body.weatherCondition || 'cerah',
        rainHours: body.rainHours ? String(body.rainHours) : '0.00',
        workImpact: body.workImpact || 'tidak_ada',
        notes: body.notes || null,
        recordedBy: req.authUser.id as any,
      })
      .returning();

    await logAudit(req.authUser.id, req.authUser.name, 'RECORD_WEATHER_LOG', 'daily_weather_log', newLog.id, {
      projectId: targetProject.id,
      weatherCondition: newLog.weatherCondition,
      rainHours: newLog.rainHours,
      workImpact: newLog.workImpact,
    });

    res.status(201).json({
      log: newLog,
      message: 'Catatan cuaca dan curah hujan harian berhasil disimpan.',
    });
  }
);

// ---------------- TEMPLATES (MASTER DATA + IMPORT) ----------------

apiRouter.get('/templates', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const isGlobalAdmin = Boolean(req.authUser?.hasOrgScope || req.authUser?.hasBreakGlass);

  const userProjects = req.authUser?.assignedProjectIds || [];

  const rows = await db
    .select()
    .from(checklistTemplates)
    .orderBy(desc(checklistTemplates.updatedAt));

  const visible = isGlobalAdmin
    ? rows
    : rows.filter((t) => !t.projectId || t.isMasterTemplate || userProjects.includes(t.projectId));

  res.json({
    templates: visible.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString().split('T')[0],
      updatedAt: t.updatedAt.toISOString().split('T')[0],
    })),
  });
});

apiRouter.post('/templates', requirePermission(PERMISSIONS.TEMPLATE_MANAGE), async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const t = req.body as ChecklistTemplate;
  const id = resolveUuid(t.id);
  const now = new Date();

  let verifiedProjectId: string | null = null;
  if (t.projectId) {
    const [matchedProject] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, t.projectId))
      .limit(1);
    if (!matchedProject) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    verifiedProjectId = matchedProject.id;
  }

  const [saved] = await db
    .insert(checklistTemplates)
    .values({
      id,
      title: t.title,
      category: t.category,
      description: t.description || '',
      version: t.version || '1.0',
      standardBody: t.standardBody || 'Custom',
      standardCode: t.standardCode || null,
      documentControlNo: t.documentControlNo || null,
      projectId: verifiedProjectId,
      targetRole: t.targetRole || null,
      requiresApproval: Boolean(t.requiresApproval || (t.workflowSteps && t.workflowSteps.length > 0)),
      approvalRole: t.approvalRole || t.workflowSteps?.[0]?.role || null,
      workflowSteps: Array.isArray(t.workflowSteps) ? t.workflowSteps : [],
      estimatedMinutes: Number(t.estimatedMinutes) || 20,
      sections: Array.isArray(t.sections) ? t.sections : [],
      tags: Array.isArray(t.tags) ? t.tags : [],
      isMasterTemplate: Boolean(t.isMasterTemplate),
      authorId: req.authUser.id,
      authorName: t.authorName || req.authUser.name,
      authorRole: t.authorRole || req.authUser.role,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: checklistTemplates.id,
      set: {
        title: t.title,
        category: t.category,
        description: t.description || '',
        version: t.version || '1.0',
        standardBody: t.standardBody || 'Custom',
        standardCode: t.standardCode || null,
        documentControlNo: t.documentControlNo || null,
        projectId: verifiedProjectId,
        targetRole: t.targetRole || null,
        requiresApproval: Boolean(t.requiresApproval || (t.workflowSteps && t.workflowSteps.length > 0)),
        approvalRole: t.approvalRole || t.workflowSteps?.[0]?.role || null,
        workflowSteps: Array.isArray(t.workflowSteps) ? t.workflowSteps : [],
        estimatedMinutes: Number(t.estimatedMinutes) || 20,
        sections: Array.isArray(t.sections) ? t.sections : [],
        tags: Array.isArray(t.tags) ? t.tags : [],
        isMasterTemplate: Boolean(t.isMasterTemplate),
        updatedAt: now,
      },
    })
    .returning();

  await logAudit(req.authUser.id, req.authUser.name, 'UPSERT_TEMPLATE', 'template', saved.id, {
    title: saved.title,
    standardBody: saved.standardBody,
  });

  res.status(201).json({
    template: {
      ...saved,
      createdAt: saved.createdAt.toISOString().split('T')[0],
      updatedAt: saved.updatedAt.toISOString().split('T')[0],
    },
  });
});

apiRouter.post('/templates/import', requirePermission(PERMISSIONS.TEMPLATE_MANAGE), async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const incoming = Array.isArray(req.body?.templates) ? req.body.templates : [];
  if (incoming.length === 0) {
    res.status(400).json({ error: 'Provide a non-empty templates array.' });
    return;
  }

  const now = new Date();
  let importedCount = 0;

  for (const t of incoming as ChecklistTemplate[]) {
    if (!t.title || !t.category) continue;
    const id = resolveUuid(t.id);
    const templateProjectId: string | null = null;
    await db
      .insert(checklistTemplates)
      .values({
        id,
        title: t.title,
        category: t.category,
        description: t.description || '',
        version: t.version || '1.0',
        standardBody: t.standardBody || 'Custom',
        standardCode: t.standardCode || null,
        documentControlNo: t.documentControlNo || null,
        projectId: templateProjectId,
        targetRole: t.targetRole || null,
        requiresApproval: Boolean(t.requiresApproval || (t.workflowSteps && t.workflowSteps.length > 0)),
        approvalRole: t.approvalRole || t.workflowSteps?.[0]?.role || null,
        workflowSteps: Array.isArray(t.workflowSteps) ? t.workflowSteps : [],
        estimatedMinutes: Number(t.estimatedMinutes) || 20,
        sections: Array.isArray(t.sections) ? t.sections : [],
        tags: Array.isArray(t.tags) ? t.tags : [],
        isMasterTemplate: true,
        authorId: req.authUser.id,
        authorName: t.authorName || req.authUser.name,
        authorRole: t.authorRole || req.authUser.role,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: checklistTemplates.id,
        set: {
          title: t.title,
          category: t.category,
          description: t.description || '',
          version: t.version || '1.0',
          standardBody: t.standardBody || 'Custom',
          standardCode: t.standardCode || null,
          documentControlNo: t.documentControlNo || null,
          workflowSteps: Array.isArray(t.workflowSteps) ? t.workflowSteps : [],
          sections: Array.isArray(t.sections) ? t.sections : [],
          tags: Array.isArray(t.tags) ? t.tags : [],
          isMasterTemplate: true,
          updatedAt: now,
        },
      });
    importedCount += 1;
  }

  await logAudit(req.authUser.id, req.authUser.name, 'IMPORT_TEMPLATE_PACK', 'template', 'batch', {
    importedCount,
  });

  res.json({ importedCount });
});

apiRouter.delete(
  '/templates/:id',
  requirePermission(PERMISSIONS.TEMPLATE_DELETE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const [targetTmpl] = await db
      .select()
      .from(checklistTemplates)
      .where(eq(checklistTemplates.id, req.params.id))
      .limit(1);
    if (!targetTmpl) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }

    if (targetTmpl.projectId && !assertProjectAccess(req.authUser, targetTmpl.projectId, res, true)) {
      return;
    }

    // Templates referenced by inspections are part of the audit record; deleting
    // them would orphan the evidence trail, so the delete is refused instead.
    const linked = await db
      .select({ id: inspections.id })
      .from(inspections)
      .where(eq(inspections.templateId, req.params.id))
      .limit(1);
    if (linked.length > 0) {
      res.status(409).json({
        error: 'Template is referenced by existing inspections and cannot be deleted.',
      });
      return;
    }

    await db.delete(checklistTemplates).where(eq(checklistTemplates.id, req.params.id));
    await logAudit(req.authUser.id, req.authUser.name, 'DELETE_TEMPLATE', 'template', req.params.id);
    res.json({ success: true });
  }
);

// ---------------- INSPECTIONS + DYNAMIC WORKFLOW ----------------

apiRouter.get('/inspections', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const isGlobalAdmin = Boolean(req.authUser?.hasOrgScope || req.authUser?.hasBreakGlass);

  const queryProjectId = req.query.projectId ? String(req.query.projectId) : null;

  if (queryProjectId) {
    if (!assertProjectAccess(req.authUser, queryProjectId, res, false)) {
      return;
    }
    const filtered = await db
      .select()
      .from(inspections)
      .where(eq(inspections.projectId, queryProjectId as any))
      .orderBy(desc(inspections.createdAt));
    res.json({
      inspections: filtered.map((r) => ({
        ...r,
        submittedAt: r.submittedAt?.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    });
    return;
  }

  const rows = await db
    .select()
    .from(inspections)
    .orderBy(desc(inspections.createdAt));

  const userProjects = req.authUser?.assignedProjectIds || [];
  const visible = isGlobalAdmin
    ? rows
    : rows.filter((r) => userProjects.includes(r.projectId));

  res.json({
    inspections: visible.map((r) => ({
      ...r,
      submittedAt: r.submittedAt?.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

apiRouter.post(
  '/inspections',
  requirePermission([PERMISSIONS.INSPECTION_ROUTINE, PERMISSIONS.INSPECTION_ADHOC]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const body = req.body || {};
    const requestedProjectId = String(body.projectId || '');
    if (!requestedProjectId) {
      res.status(400).json({ error: 'projectId is required.' });
      return;
    }

    if (!assertProjectAccess(req.authUser, requestedProjectId, res, true)) {
      return;
    }
    if (body.clientMutationId) {
      const [existing] = await db
        .select()
        .from(inspections)
        .where(eq(inspections.clientMutationId, body.clientMutationId))
        .limit(1);
      if (existing) {
        res.json({
          inspection: {
            ...existing,
            submittedAt: existing.submittedAt?.toISOString(),
            reviewedAt: existing.reviewedAt?.toISOString(),
            createdAt: existing.createdAt.toISOString(),
          },
          deduplicated: true,
        });
        return;
      }
    }

    const [tmpl] = await db
      .select()
      .from(checklistTemplates)
      .where(eq(checklistTemplates.id, body.templateId))
      .limit(1);

    const answers =
      body.answers && typeof body.answers === 'object' ? (body.answers as Record<string, unknown>) : {};

    // The client-supplied score, counts and status are ignored. Everything that
    // decides whether an inspection passes is recomputed here from the template.
    const score = computeInspectionScore(tmpl, answers);
    const applicableSteps = resolveApplicableWorkflowSteps(
      tmpl,
      score.failedCount,
      score.scorePercent
    );

    const initialStatus: InspectionStatus = applicableSteps.length > 0 ? 'under_review' : 'approved';

    const evidence = applyEvidenceIntegrity(body.evidencePhotos);
    if (evidence.fatal.length > 0) {
      res.status(409).json({
        error: 'Evidence integrity verification failed. Re-upload the affected photos.',
        issues: evidence.fatal,
      });
      return;
    }

    const [matchedProj] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, body.projectId))
      .limit(1);

    const targetProjectId = matchedProj ? matchedProj.id : body.projectId;
    const targetProjectName = matchedProj ? matchedProj.name : body.projectName;

    const id = resolveUuid(body.id);
    const now = new Date();
    const submittedAt = resolveClientTimestamp(body.submittedAt, now);

    const [saved] = await db
      .insert(inspections)
      .values({
        id,
        clientMutationId: body.clientMutationId || null,
        templateId: body.templateId,
        templateTitle: tmpl?.title ?? body.templateTitle,
        category: tmpl?.category ?? body.category,
        projectId: targetProjectId,
        projectName: targetProjectName,
        siteZone: body.siteZone,
        inspectorId: req.authUser.id,
        inspectorName: req.authUser.name,
        inspectorRole: req.authUser.role,
        status: initialStatus,
        currentStepIndex: 0,
        approvalHistory: [],
        answers,
        evidencePhotos: evidence.photos,
        signatureData: body.signatureData || null,
        scorePercent: score.scorePercent,
        passedCount: score.passedCount,
        failedCount: score.failedCount,
        nonApplicableCount: score.nonApplicableCount,
        notes: typeof body.notes === 'string' ? body.notes.slice(0, 4000) : null,
        submittedAt,
        createdAt: now,
      })
      .returning();

    await logAudit(req.authUser.id, req.authUser.name, 'SUBMIT_INSPECTION', 'inspection', saved.id, {
      templateTitle: saved.templateTitle,
      status: saved.status,
      applicableSteps: applicableSteps.length,
      scorePercent: saved.scorePercent,
      evidencePhotos: saved.evidencePhotos.length,
      evidenceWarnings: evidence.warnings,
    });

    if (saved.status === 'under_review') {
      void dispatchNotification({
        eventType: 'approval',
        title: `Approval Required: ${saved.templateTitle}`,
        message: `${saved.inspectorName} submitted an inspection for ${saved.projectName} (${saved.siteZone}). Score: ${saved.scorePercent}%.`,
        metadata: { inspectionId: saved.id, projectId: saved.projectId },
      });
    }

    res.status(201).json({
      inspection: {
        ...saved,
        submittedAt: saved.submittedAt?.toISOString(),
        reviewedAt: saved.reviewedAt?.toISOString(),
        createdAt: saved.createdAt.toISOString(),
      },
    });
  });

apiRouter.post(
  '/inspections/:id/review',
  requirePermission(PERMISSIONS.INSPECTION_REVIEW),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { decision, notes } = req.body ?? {};
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: 'Decision must be approved or rejected.' });
      return;
    }

    const [insp] = await db
      .select()
      .from(inspections)
      .where(eq(inspections.id, req.params.id))
      .limit(1);

    if (!insp) {
      res.status(404).json({ error: 'Inspection not found.' });
      return;
    }

    if (!assertProjectAccess(req.authUser, insp.projectId, res, true)) {
      return;
    }

    const [tmpl] = await db
      .select()
      .from(checklistTemplates)
      .where(eq(checklistTemplates.id, insp.templateId))
      .limit(1);

    const steps = resolveApplicableWorkflowSteps(tmpl, insp.failedCount, insp.scorePercent);
    const currentStep = steps[insp.currentStepIndex];

    const entry: ApprovalDecision = {
      stepOrder: currentStep?.order ?? insp.currentStepIndex + 1,
      stepLabel: currentStep?.label ?? 'Final Review',
      role: req.authUser.role,
      actorId: req.authUser.id,
      actorName: req.authUser.name,
      decision,
      notes: typeof notes === 'string' ? notes : undefined,
      decidedAt: new Date().toISOString(),
    };

    const nextHistory = [...(insp.approvalHistory || []), entry];
    const nextStepIndex = insp.currentStepIndex + 1;
    const isFinalApproved = decision === 'approved' && nextStepIndex >= steps.length;
    const nextStatus: InspectionStatus =
      decision === 'rejected'
        ? 'rejected'
        : isFinalApproved
          ? 'approved'
          : 'under_review';

    const now = new Date();
    const [updated] = await db
      .update(inspections)
      .set({
        status: nextStatus,
        currentStepIndex: decision === 'approved' ? nextStepIndex : insp.currentStepIndex,
        approvalHistory: nextHistory,
        reviewedBy: req.authUser.name,
        reviewedRole: req.authUser.role,
        reviewedAt: now,
        reviewNotes: typeof notes === 'string' ? notes : insp.reviewNotes,
      })
      .where(eq(inspections.id, insp.id))
      .returning();

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      decision === 'approved' ? 'APPROVE_INSPECTION_STEP' : 'REJECT_INSPECTION',
      'inspection',
      updated.id,
      { step: entry.stepLabel, nextStatus }
    );

    void dispatchNotification({
      eventType: 'approval',
      title: `Inspection ${nextStatus.toUpperCase()}: ${updated.templateTitle}`,
      message: `${req.authUser.name} (${req.authUser.role}) marked "${entry.stepLabel}" as ${decision}.`,
      metadata: { inspectionId: updated.id, nextStatus },
    });

    res.json({
      inspection: {
        ...updated,
        submittedAt: updated.submittedAt?.toISOString(),
        reviewedAt: updated.reviewedAt?.toISOString(),
        createdAt: updated.createdAt.toISOString(),
      },
    });
  });

apiRouter.delete(
  '/inspections/:id',
  requirePermission(PERMISSIONS.INSPECTION_DELETE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const [existing] = await db
      .select()
      .from(inspections)
      .where(eq(inspections.id, req.params.id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Inspection not found.' });
      return;
    }

    if (!assertProjectAccess(req.authUser, existing.projectId, res, true)) {
      return;
    }

    // Approved inspections are signed audit evidence. They may be rejected or
    // superseded, but never silently erased.
    if (existing.status === 'approved') {
      res.status(409).json({
        error: 'Approved inspections are part of the audit record and cannot be deleted.',
      });
      return;
    }

    await db.delete(inspections).where(eq(inspections.id, req.params.id));
    await logAudit(req.authUser.id, req.authUser.name, 'DELETE_INSPECTION', 'inspection', req.params.id, {
      templateTitle: existing.templateTitle,
      status: existing.status,
      inspectorId: existing.inspectorId,
    });
    res.json({ success: true });
  }
);

// ---------------- CORRECTIVE ACTIONS (CAPA) ----------------

apiRouter.get('/actions', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const isGlobalAdmin = Boolean(req.authUser?.hasOrgScope || req.authUser?.hasBreakGlass);

  const queryNodeId = req.query.nodeId ? String(req.query.nodeId) : null;
  const queryProjectId = req.query.projectId ? String(req.query.projectId) : null;

  if (queryNodeId) {
    const filtered = await db
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.nodeId, queryNodeId as any))
      .orderBy(desc(correctiveActions.createdAt));
    res.json({
      actions: filtered.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        resolvedAt: a.resolvedAt?.toISOString(),
      })),
    });
    return;
  }

  if (queryProjectId) {
    if (!assertProjectAccess(req.authUser, queryProjectId, res, false)) {
      return;
    }
    const filtered = await db
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.projectId, queryProjectId as any))
      .orderBy(desc(correctiveActions.createdAt));
    res.json({
      actions: filtered.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        resolvedAt: a.resolvedAt?.toISOString(),
      })),
    });
    return;
  }

  const rows = await db
    .select()
    .from(correctiveActions)
    .orderBy(desc(correctiveActions.createdAt));

  const userProjects = req.authUser?.assignedProjectIds || [];
  const visible = isGlobalAdmin
    ? rows
    : rows.filter((a) => a.projectId && userProjects.includes(a.projectId));

  res.json({
    actions: visible.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString(),
    })),
  });
});

apiRouter.post('/actions', requirePermission(PERMISSIONS.CAPA_CREATE), async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const a = req.body;
  const id = resolveUuid(a.id);

  let actionProjectId: string = a.projectId;
  let actionProjectName: string = a.projectName;
  let targetNode: any = null;

  if (a.nodeId) {
    const [existingNode] = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.id, resolveUuid(a.nodeId)))
      .limit(1);

    if (existingNode) {
      targetNode = existingNode;
      if (!actionProjectId) {
        actionProjectId = existingNode.projectId;
      }
    }
  }

  if (a.inspectionId) {
    const [existingInspection] = await db
      .select({
        projectId: inspections.projectId,
        projectName: inspections.projectName,
      })
      .from(inspections)
      .where(eq(inspections.id, resolveUuid(a.inspectionId)))
      .limit(1);
    if (existingInspection) {
      actionProjectId = existingInspection.projectId;
      actionProjectName = existingInspection.projectName;
    }
  } else if (actionProjectId) {
    const [existingProj] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, actionProjectId as any))
      .limit(1);
    if (existingProj) {
      actionProjectId = existingProj.id;
      actionProjectName = existingProj.name;
    }
  }

  if (!actionProjectId) {
    res.status(400).json({ error: 'projectId, nodeId, or valid inspectionId is required.' });
    return;
  }

  if (!assertProjectAccess(req.authUser, actionProjectId, res, true)) {
    return;
  }

  const [saved] = await db
    .insert(correctiveActions)
    .values({
      id,
      nodeId: targetNode?.id || (a.nodeId ? resolveUuid(a.nodeId) : null),
      inspectionId: a.inspectionId ? resolveUuid(a.inspectionId) : null,
      inspectionTitle:
        a.inspectionTitle ||
        (targetNode ? `WBS: ${targetNode.wbsCode} ${targetNode.name}` : 'Direct Finding'),
      projectId: actionProjectId,
      projectName: actionProjectName || 'Project',
      siteZone: a.siteZone || targetNode?.name || 'General Zone',
      fieldLabel: a.fieldLabel,
      issueDescription: a.issueDescription,
      severity: a.severity || 'medium',
      assigneeId: a.assigneeId || null,
      assignedToName: a.assignedToName || 'Unassigned',
      assignedToRole: a.assignedToRole || 'Unassigned',
      dueDate: a.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      status: a.status || 'OPEN',
      resolutionNotes: a.resolutionNotes || null,
      evidencePhotoUrl: a.evidencePhotoUrl || null,
    })
    .returning();

  await logAudit(req.authUser.id, req.authUser.name, 'CREATE_CAPA', 'corrective_action', saved.id, {
    severity: saved.severity,
  });

  if (saved.severity === 'critical' || saved.severity === 'high') {
    void dispatchNotification({
      eventType: 'critical_capa',
      title: `[${saved.severity.toUpperCase()}] CAPA Raised: ${saved.projectName}`,
      message: `${saved.fieldLabel} (${saved.siteZone}) — ${saved.issueDescription}`,
      metadata: { actionId: saved.id, inspectionId: saved.inspectionId },
    });
  }

  res.status(201).json({
    action: {
      ...saved,
      createdAt: saved.createdAt.toISOString(),
      resolvedAt: saved.resolvedAt?.toISOString(),
    },
  });
});

apiRouter.patch(
  '/actions/:id',
  requirePermission([PERMISSIONS.CAPA_UPDATE_PROGRESS, PERMISSIONS.CAPA_CLOSE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { status, resolutionNotes } = req.body ?? {};
    const isResolved =
      status === 'CLOSED' ||
      status === 'EFFECTIVENESS_MONITORING' ||
      status === 'resolved' ||
      status === 'verified';

    // Four-Eyes Principle Enforcement (PRD Section 1 & 7.2)
    const [existingCapa] = await db
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.id, req.params.id))
      .limit(1);

    if (!existingCapa) {
      res.status(404).json({ error: 'Corrective action not found.' });
      return;
    }

    if (existingCapa.projectId && !assertProjectAccess(req.authUser, existingCapa.projectId, res, true)) {
      return;
    }

    // Action Owner cannot self-verify or close their own corrective action (Four-Eyes Principle F.5.B #21 & #22)
    if (status === 'CLOSED' || status === 'verified') {
      const isOwner =
        (existingCapa.assigneeId && existingCapa.assigneeId === req.authUser.id) ||
        (existingCapa.assignedToName && existingCapa.assignedToName.toLowerCase() === req.authUser.name.toLowerCase());

      if (isOwner) {
        res.status(403).json({
          error: 'Four-eyes violation: Action Owner is strictly prohibited from verifying or closing their own action.',
        });
        return;
      }

      const perms = await resolveUserPermissions(req.authUser.id, existingCapa.projectId);
      if (!perms.hasBreakGlass && !perms.projectPermissions.has('capa.close') && !perms.orgPermissions.has('capa.close')) {
        res.status(403).json({
          error: 'Only users with capa.close permission can verify and close a CAPA.',
        });
        return;
      }
    }

    const [updated] = await db
      .update(correctiveActions)
      .set({
        status,
        resolutionNotes: resolutionNotes ?? undefined,
        resolvedAt: isResolved ? new Date() : undefined,
      })
      .where(eq(correctiveActions.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Corrective action not found.' });
      return;
    }

    await logAudit(req.authUser.id, req.authUser.name, 'UPDATE_CAPA', 'corrective_action', updated.id, {
      status: updated.status,
    });

    res.json({
      action: {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        resolvedAt: updated.resolvedAt?.toISOString(),
      },
    });
  });

// ---------------- USERS & AUDIT LOGS ----------------

apiRouter.get('/users', async (_req: Request, res: Response) => {
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
      avatar: u.avatar,
      assignedProjects: u.assignedProjects,
      certifications: u.certifications,
      isActive: u.isActive,
    })),
  });
});

apiRouter.patch(
  '/users/:id',
  requirePermission(PERMISSIONS.ADMIN_USERS),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { name, role, title, isActive, assignedProjects, certifications, password } = req.body ?? {};
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
    if (typeof isActive === 'boolean') updates.isActive = isActive;
    if (Array.isArray(assignedProjects)) updates.assignedProjects = assignedProjects;
    if (Array.isArray(certifications)) updates.certifications = certifications;
    if (typeof password === 'string' && password.trim()) {
      if (password.trim().length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters.' });
        return;
      }
      updates.passwordHash = hashSecret(password.trim());
    }

    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, req.params.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    await logAudit(req.authUser.id, req.authUser.name, 'UPDATE_USER', 'user', updated.id, {
      updatedFields: Object.keys(updates),
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
        avatar: updated.avatar,
        assignedProjects: updated.assignedProjects,
        certifications: updated.certifications,
        isActive: updated.isActive,
      },
    });
  }
);

apiRouter.post('/users', requirePermission(PERMISSIONS.ADMIN_USERS), async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const { username, name, email, password, role, title, assignedProjects, certifications } =
    req.body ?? {};
  if (!username || !name || !email || !password || !role) {
    res.status(400).json({ error: 'username, name, email, password, and role are required.' });
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
      username: String(username).trim(),
      name: String(name).trim(),
      email: String(email).trim(),
      passwordHash: hashSecret(String(password)),
      role: role as UserRole,
      title: title || role,
      avatar: '',
      assignedProjects: Array.isArray(assignedProjects) ? assignedProjects : [],
      certifications: Array.isArray(certifications) ? certifications : [],
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
      avatar: created.avatar,
      assignedProjects: created.assignedProjects,
      certifications: created.certifications,
    },
  });
});

apiRouter.get(
  '/audit-logs',
  requirePermission(PERMISSIONS.ADMIN_AUDIT),
  async (_req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const rows = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);

    res.json({
      auditLogs: rows.map((l) => ({
        ...l,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  }
);

// Blueprint Tahap 2b: Role & Permission Editor API
apiRouter.get(
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

apiRouter.get(
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

apiRouter.post(
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

apiRouter.put(
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

apiRouter.delete(
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
apiRouter.post(
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

apiRouter.delete(
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

apiRouter.get(
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

apiRouter.get(
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

apiRouter.post(
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

apiRouter.put(
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

apiRouter.delete(
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

