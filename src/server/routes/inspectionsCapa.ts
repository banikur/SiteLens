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

export function registerInspectionCapaRoutes(router: Router) {
router.get('/templates', async (req: Request, res: Response) => {
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

router.post('/templates', requirePermission(PERMISSIONS.TEMPLATE_MANAGE), async (req: Request, res: Response) => {
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

router.post('/templates/import', requirePermission(PERMISSIONS.TEMPLATE_MANAGE), async (req: Request, res: Response) => {
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

router.delete(
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

router.get('/inspections', async (req: Request, res: Response) => {
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

router.post(
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

router.post(
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

router.delete(
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

router.get('/actions', async (req: Request, res: Response) => {
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

router.post('/actions', requirePermission(PERMISSIONS.CAPA_CREATE), async (req: Request, res: Response) => {
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

router.patch(
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

}
