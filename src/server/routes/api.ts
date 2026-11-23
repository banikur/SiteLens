import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import {
  auditLogs,
  checklistTemplates,
  correctiveActions,
  inspections,
  projects,
  users,
  workNodes,
  workWorkflows,
  workStages,
  inspectionAttempts,
  evidenceAttachments,
  punchlistItems,
  plannedCurveOverrides,
  dailyWeatherLogs,
  projectMembers,
  roleAssignments,
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
      const [savedProject] = await tx
        .insert(projects)
        .values({
          id,
          name: p.name,
          code: p.code,
          client: p.client,
          location: p.location,
          status: p.status || 'active',
          zones: Array.isArray(p.zones) ? p.zones : [],
          leadManager: p.leadManager || req.authUser!.name,
        })
        .onConflictDoUpdate({
          target: projects.id,
          set: {
            name: p.name,
            code: p.code,
            client: p.client,
            location: p.location,
            status: p.status || 'active',
            zones: Array.isArray(p.zones) ? p.zones : [],
            leadManager: p.leadManager || req.authUser!.name,
          },
        })
        .returning();

      // Auto-assign project creator (F.1.D)
      await tx
        .insert(roleAssignments)
        .values({
          userId: req.authUser!.id as any,
          roleId: 'project_manager',
          scopeType: 'project',
          projectId: savedProject.id as any,
          isActive: true,
        })
        .onConflictDoNothing();

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
      .select({ id: projects.id })
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
    if (verifiedParentId) {
      const [parent] = await db
        .select({ id: workNodes.id })
        .from(workNodes)
        .where(and(eq(workNodes.id, verifiedParentId), eq(workNodes.projectId, targetProject.id)))
        .limit(1);
      if (!parent) {
        res.status(400).json({ error: 'Parent WBS node not found in this project.' });
        return;
      }
    }

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
        sortOrder: Number(body.sortOrder) || 0,
      })
      .returning();

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
        sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : existingNode.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(workNodes.id, existingNode.id))
      .returning();

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
  requirePermission(PERMISSIONS.WBS_EDIT_STRUCTURE),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectScopeId = String(req.params.projectId || '');
    const nodeScopeId = String(req.params.nodeId || '');
    const [existingNode] = await db
      .select({ id: workNodes.id, name: workNodes.name, wbsCode: workNodes.wbsCode })
      .from(workNodes)
      .where(and(eq(workNodes.id, nodeScopeId as any), eq(workNodes.projectId, projectScopeId as any)))
      .limit(1);

    if (!existingNode) {
      res.status(404).json({ error: 'WBS node not found.' });
      return;
    }

    await db.delete(workNodes).where(eq(workNodes.id, existingNode.id));

    await logAudit(req.authUser.id, req.authUser.name, 'DELETE_WBS_NODE', 'work_node', existingNode.id, {
      wbsCode: existingNode.wbsCode,
      name: existingNode.name,
    });

    res.json({ success: true, deletedId: existingNode.id });
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

    // Determine attempt number
    const existingAttempts = await db
      .select()
      .from(inspectionAttempts)
      .where(eq(inspectionAttempts.stageId, targetStage.id));

    const nextAttemptNumber = getNextAttemptNumber(existingAttempts);

    const [newAttempt] = await db
      .insert(inspectionAttempts)
      .values({
        stageId: targetStage.id,
        attemptNumber: nextAttemptNumber,
        submitterId: req.authUser.id as any,
        status: 'submitted',
        answers: body.answers || {},
        signatureCanvasUrl: body.signatureCanvasUrl || null,
        wetSignatureDocumentUrl: body.wetSignatureDocumentUrl || null,
        offlineSyncId: body.offlineSyncId || null,
      })
      .returning();

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
      attemptNumber: nextAttemptNumber,
      signatureType: sigCheck.signatureType,
    });

    res.status(201).json({
      attempt: newAttempt,
      stage: updatedStage,
      message: `Inspeksi tahapan "${targetStage.name}" berhasil diajukan (Percobaan #${nextAttemptNumber}).`,
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

    // Strict Four-Eyes Principle check: Submitter cannot approve their own inspection attempt
    if (!validateFourEyes(latestAttempt.submitterId, req.authUser.id)) {
      res.status(403).json({
        error: 'Pelanggaran Prinsip Four-Eyes: Pelaksana/Submitter inspeksi tidak diizinkan menyetujui pemeriksaannya sendiri.',
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

    // Fetch open punchlist items for Zero-Tolerance lockout
    const allPunchlists = await db
      .select({ nodeId: punchlistItems.nodeId, status: punchlistItems.status })
      .from(punchlistItems);

    const openPunchlistMap = new Map<string, boolean>();
    for (const pl of allPunchlists) {
      if (pl.status !== 'verified_closed') {
        openPunchlistMap.set(pl.nodeId, true);
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

    const scurve = calculateSCurveData({
      projectId: targetProject.id,
      projectName: targetProject.name,
      nodes,
      weeks,
      overrides,
      hasPunchlistOpenMap: openPunchlistMap,
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

    // Get pending/submitted stages
    const allStages = await db.select().from(workStages);
    const pendingStages = allStages.filter(
      (s) => workflowIds.includes(s.workflowId) && s.status === 'submitted'
    );

    const stageIds = pendingStages.map((s) => s.id);
    const allAttempts = await db.select().from(inspectionAttempts).orderBy(desc(inspectionAttempts.attemptNumber));
    const allUsers = await db.select({ id: users.id, name: users.name }).from(users);
    const userMap = new Map<string, string>();
    for (const u of allUsers) userMap.set(u.id, u.name);

    const itemsForAging: any[] = [];
    for (const stg of pendingStages) {
      const attempt = allAttempts.find((a) => a.stageId === stg.id && a.status === 'submitted');
      if (attempt) {
        const nodeId = wfNodeMap.get(stg.workflowId) || '';
        const nodeInfo = nodeMap.get(nodeId) || { wbsCode: '?', name: 'Node' };
        const submitterName = userMap.get(attempt.submitterId) || 'Inspector';

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

  const queryProjectId = req.query.projectId ? String(req.query.projectId) : null;
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
  if (a.inspectionId) {
    const [existingInspection] = await db
      .select({
        projectId: inspections.projectId,
        projectName: inspections.projectName,
      })
      .from(inspections)
      .where(eq(inspections.id, a.inspectionId))
      .limit(1);
    if (existingInspection) {
      actionProjectId = existingInspection.projectId;
      actionProjectName = existingInspection.projectName;
    }
  } else if (a.projectId) {
    const [existingProj] = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, a.projectId))
      .limit(1);
    if (existingProj) {
      actionProjectId = existingProj.id;
      actionProjectName = existingProj.name;
    }
  }

  if (!actionProjectId) {
    res.status(400).json({ error: 'projectId or valid inspectionId is required.' });
    return;
  }

  if (!assertProjectAccess(req.authUser, actionProjectId, res, true)) {
    return;
  }

  const [saved] = await db
    .insert(correctiveActions)
    .values({
      id,
      inspectionId: a.inspectionId,
      inspectionTitle: a.inspectionTitle,
      projectId: actionProjectId,
      projectName: actionProjectName,
      siteZone: a.siteZone,
      fieldLabel: a.fieldLabel,
      issueDescription: a.issueDescription,
      severity: a.severity || 'medium',
      assigneeId: a.assigneeId || null,
      assignedToName: a.assignedToName || 'Unassigned',
      assignedToRole: a.assignedToRole || 'Unassigned',
      dueDate: a.dueDate,
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

