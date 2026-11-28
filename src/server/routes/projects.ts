import { type Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, desc, eq, inArray, or, ilike, sql } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import {
  auditLogs, checklistTemplates, correctiveActions, inspections, projects,
  masterProjects, users, workNodes, workWorkflows, workStages, inspectionAttempts,
  evidenceAttachments, plannedCurveOverrides, dailyWeatherLogs,
  roleAssignments, roles, permissions, rolePermissions, flowPresets, flowPresetSteps,
  wbsProgressLogs, companySettings, nationalHolidays, projectCalendars,
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

export function registerProjectRoutes(router: Router) {
// ---------------- PROJECTS ----------------

router.get('/projects', async (req: Request, res: Response) => {
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

router.get(
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

router.post(
  '/master-projects',
  requirePermission(PERMISSIONS.MASTERPROJECT_MANAGE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { code, name, ownerClient, description, startDate, endDate, status, pmoUserId } = req.body ?? {};
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
        pmoUserId: (pmoUserId ? String(pmoUserId) : req.authUser.id) as any,
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

router.get(
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

router.patch(
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

    const { name, ownerClient, description, startDate, endDate, status, pmoUserId } = req.body ?? {};
    const updatePayload: Record<string, any> = { updatedAt: new Date() };
    if (name !== undefined) updatePayload.name = String(name).trim();
    if (ownerClient !== undefined) updatePayload.ownerClient = String(ownerClient).trim();
    if (description !== undefined) updatePayload.description = description ? String(description).trim() : null;
    if (startDate !== undefined) updatePayload.startDate = startDate ? String(startDate) : null;
    if (endDate !== undefined) updatePayload.endDate = endDate ? String(endDate) : null;
    if (status !== undefined) updatePayload.status = status === 'archived' ? 'archived' : 'active';
    if (pmoUserId !== undefined) updatePayload.pmoUserId = pmoUserId ? String(pmoUserId) : null;

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

router.patch(
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

router.delete(
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

    const childSites = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.masterProjectId, id as any));

    if (childSites.length > 0) {
      res.status(409).json({
        error: `Tidak dapat menghapus Project karena masih memiliki ${childSites.length} Site Lapangan. Hapus site di dalamnya terlebih dahulu, atau gunakan Arsip.`,
      });
      return;
    }

    await db.delete(masterProjects).where(eq(masterProjects.id, id as any));

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'MASTER_PROJECT_DELETED',
      'master_project',
      id,
      { code: existing.code, name: existing.name }
    );

    res.json({ success: true, message: 'Master project deleted.' });
  }
);

router.post(
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

    let appointedPmUser: { id: string; name: string } | null = null;
    if (p.leadManagerUserId && typeof p.leadManagerUserId === 'string') {
      const [u] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, p.leadManagerUserId as any));
      if (!u) {
        res.status(404).json({ error: 'Selected Project Manager user not found.' });
        return;
      }
      appointedPmUser = u;
    }

    const creatorPerms = await resolveUserPermissions(req.authUser.id);

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
          leadManager: appointedPmUser?.name || p.leadManager || req.authUser!.name,
        })
        .returning();

      const pmTargetId = appointedPmUser ? appointedPmUser.id : req.authUser!.id;

      // Assign appointed PM (or creator) in the SAME transaction
      await tx.insert(roleAssignments).values({
        userId: pmTargetId as any,
        projectId: newProj.id as any,
        roleId: 'project_manager',
        scopeType: 'project',
        source: 'manual',
        isActive: true,
      });

      // If creator appointed someone else and creator does NOT have org scope, ensure creator retains site access
      if (appointedPmUser && appointedPmUser.id !== req.authUser!.id && !creatorPerms.hasOrgScope) {
        await tx.insert(roleAssignments).values({
          userId: req.authUser!.id as any,
          projectId: newProj.id as any,
          roleId: 'project_manager',
          scopeType: 'project',
          source: 'manual',
          isActive: true,
        });
      }

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

router.get(
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

router.post(
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
router.get(
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
router.put(
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

router.delete(
  '/projects/:projectId',
  requirePermission([PERMISSIONS.PROJECT_CREATE, PERMISSIONS.MASTERPROJECT_MANAGE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectId = String(req.params.projectId);
    const [existing] = await db.select().from(projects).where(eq(projects.id, projectId as any));
    if (!existing) {
      res.status(404).json({ error: 'Project site not found.' });
      return;
    }

    const [inspRow] = await db
      .select({ id: inspections.id })
      .from(inspections)
      .where(eq(inspections.projectId, projectId as any))
      .limit(1);
    const [capaRow] = await db
      .select({ id: correctiveActions.id })
      .from(correctiveActions)
      .where(eq(correctiveActions.projectId, projectId as any))
      .limit(1);

    if (inspRow || capaRow) {
      res.status(409).json({
        error: 'Tidak dapat menghapus Site karena sudah memiliki riwayat inspeksi atau temuan CAPA. Ubah status menjadi On Hold.',
      });
      return;
    }

    await db.delete(projects).where(eq(projects.id, projectId as any));

    await logAudit(
      req.authUser.id,
      req.authUser.name,
      'PROJECT_SITE_DELETED',
      'project',
      projectId,
      { code: existing.code, name: existing.name }
    );

    res.json({ success: true, message: 'Project site deleted.' });
  }
);

// Blueprint Tahap 2b (Bagian B.2 & Section 124): Project Members Management
router.get(
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

router.post(
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

router.delete(
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
router.get('/users/search', requireAuth, async (req: Request, res: Response) => {
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

router.get(
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

router.post(
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

router.put(
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

router.delete(
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

}
