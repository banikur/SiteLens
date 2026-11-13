import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import {
  auditLogs,
  checklistTemplates,
  correctiveActions,
  inspections,
  projects,
  users,
} from '../db/schema.ts';
import { hashSecret } from '../auth/crypto.ts';
import { requireAuth, requireRole } from '../auth/middleware.ts';
import { dispatchNotification } from '../services/notifications.ts';
import type {
  ApprovalDecision,
  ChecklistTemplate,
  InspectionStatus,
  UserRole,
  WorkflowStep,
} from '../../types/index.ts';

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

// ---------------- PROJECTS ----------------

apiRouter.get('/projects', async (_req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const allProjects = await db.select().from(projects);
  const allInspections = await db.select().from(inspections);
  const allActions = await db.select().from(correctiveActions);

  const enriched = allProjects.map((p) => {
    const pInspections = allInspections.filter((i) => i.projectId === p.id);
    const pActions = allActions.filter(
      (a) => a.projectId === p.id && (a.status === 'OPEN' || a.status === 'IN_PROGRESS' || a.status === 'PENDING_VERIFICATION')
    );
    const avgScore =
      pInspections.length > 0
        ? Math.round(
            pInspections.reduce((acc, i) => acc + i.scorePercent, 0) / pInspections.length
          )
        : 100;

    return {
      ...p,
      activeInspectionsCount: pInspections.length,
      openIssuesCount: pActions.length,
      complianceRate: avgScore,
    };
  });

  res.json({ projects: enriched });
});

apiRouter.post(
  '/projects',
  requireRole(['HSE / Quality Manager & Tenant Admin', 'Office / Integrity Engineer']),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const p = req.body;
    const id = p.id || `proj-${crypto.randomUUID().slice(0, 8)}`;
    const [saved] = await db
      .insert(projects)
      .values({
        id,
        name: p.name,
        code: p.code,
        client: p.client,
        location: p.location,
        status: p.status || 'active',
        zones: Array.isArray(p.zones) ? p.zones : [],
        leadManager: p.leadManager || req.authUser.name,
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
          leadManager: p.leadManager || req.authUser.name,
        },
      })
      .returning();

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

// ---------------- TEMPLATES (MASTER DATA + IMPORT) ----------------

apiRouter.get('/templates', async (_req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const rows = await db
    .select()
    .from(checklistTemplates)
    .orderBy(desc(checklistTemplates.updatedAt));

  res.json({
    templates: rows.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString().split('T')[0],
      updatedAt: t.updatedAt.toISOString().split('T')[0],
    })),
  });
});

apiRouter.post('/templates', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const t = req.body as ChecklistTemplate;
  const id = t.id || `tmpl-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();

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
      projectId: t.projectId || null,
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
        projectId: t.projectId || null,
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

apiRouter.post('/templates/import', async (req: Request, res: Response) => {
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
    const id = t.id || `tmpl-pack-${crypto.randomUUID().slice(0, 8)}`;
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
        projectId: t.projectId || null,
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

apiRouter.delete('/templates/:id', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  await db.delete(checklistTemplates).where(eq(checklistTemplates.id, req.params.id));
  await logAudit(req.authUser.id, req.authUser.name, 'DELETE_TEMPLATE', 'template', req.params.id);
  res.json({ success: true });
});

// ---------------- INSPECTIONS + DYNAMIC WORKFLOW ----------------

apiRouter.get('/inspections', async (_req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const rows = await db
    .select()
    .from(inspections)
    .orderBy(desc(inspections.createdAt));

  res.json({
    inspections: rows.map((r) => ({
      ...r,
      submittedAt: r.submittedAt?.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

apiRouter.post('/inspections', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const body = req.body;
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

  const applicableSteps = resolveApplicableWorkflowSteps(
    tmpl,
    Number(body.failedCount) || 0,
    Number(body.scorePercent) || 0
  );

  let initialStatus: InspectionStatus = body.status || 'submitted';
  if (initialStatus === 'submitted' || initialStatus === 'under_review') {
    initialStatus = applicableSteps.length > 0 ? 'under_review' : 'approved';
  }

  const id = body.id || `insp-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();

  const [saved] = await db
    .insert(inspections)
    .values({
      id,
      clientMutationId: body.clientMutationId || null,
      templateId: body.templateId,
      templateTitle: body.templateTitle,
      category: body.category,
      projectId: body.projectId,
      projectName: body.projectName,
      siteZone: body.siteZone,
      inspectorId: req.authUser.id,
      inspectorName: req.authUser.name,
      inspectorRole: req.authUser.role,
      status: initialStatus,
      currentStepIndex: 0,
      approvalHistory: Array.isArray(body.approvalHistory) ? body.approvalHistory : [],
      answers: body.answers || {},
      evidencePhotos: Array.isArray(body.evidencePhotos) ? body.evidencePhotos : [],
      signatureData: body.signatureData || null,
      scorePercent: Number(body.scorePercent) || 0,
      passedCount: Number(body.passedCount) || 0,
      failedCount: Number(body.failedCount) || 0,
      nonApplicableCount: Number(body.nonApplicableCount) || 0,
      notes: body.notes || null,
      submittedAt: body.submittedAt ? new Date(body.submittedAt) : now,
      createdAt: body.createdAt ? new Date(body.createdAt) : now,
    })
    .returning();

  await logAudit(req.authUser.id, req.authUser.name, 'SUBMIT_INSPECTION', 'inspection', saved.id, {
    templateTitle: saved.templateTitle,
    status: saved.status,
    applicableSteps: applicableSteps.length,
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

apiRouter.post('/inspections/:id/review', async (req: Request, res: Response) => {
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

  const [tmpl] = await db
    .select()
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, insp.templateId))
    .limit(1);

  const steps = resolveApplicableWorkflowSteps(tmpl, insp.failedCount, insp.scorePercent);
  const currentStep = steps[insp.currentStepIndex];

  if (
    currentStep &&
    req.authUser.role !== currentStep.role &&
    req.authUser.role !== 'HSE / Quality Manager & Tenant Admin' &&
    req.authUser.role !== 'Authorized Inspector (API 510/570) & Verifikator K3'
  ) {
    res.status(403).json({
      error: `Step "${currentStep.label}" requires role ${currentStep.role} (or Authorized Inspector / Tenant Admin).`,
    });
    return;
  }

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

apiRouter.delete('/inspections/:id', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  await db.delete(inspections).where(eq(inspections.id, req.params.id));
  await logAudit(req.authUser.id, req.authUser.name, 'DELETE_INSPECTION', 'inspection', req.params.id);
  res.json({ success: true });
});

// ---------------- CORRECTIVE ACTIONS (CAPA) ----------------

apiRouter.get('/actions', async (_req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const rows = await db
    .select()
    .from(correctiveActions)
    .orderBy(desc(correctiveActions.createdAt));

  res.json({
    actions: rows.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      resolvedAt: a.resolvedAt?.toISOString(),
    })),
  });
});

apiRouter.post('/actions', async (req: Request, res: Response) => {
  const db = getDb();
  if (!db || !req.authUser) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }

  const a = req.body;
  const id = a.id || `act-${crypto.randomUUID().slice(0, 8)}`;

  const [saved] = await db
    .insert(correctiveActions)
    .values({
      id,
      inspectionId: a.inspectionId,
      inspectionTitle: a.inspectionTitle,
      projectId: a.projectId,
      projectName: a.projectName,
      siteZone: a.siteZone,
      fieldLabel: a.fieldLabel,
      issueDescription: a.issueDescription,
      severity: a.severity || 'medium',
      assigneeId: a.assigneeId || null,
      assignedToName: a.assignedToName,
      assignedToRole: a.assignedToRole,
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

apiRouter.patch('/actions/:id', async (req: Request, res: Response) => {
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

  // Action Owner cannot self-verify or close their own corrective action
  if (status === 'CLOSED' || status === 'verified') {
    const isOwner =
      (existingCapa.assigneeId && existingCapa.assigneeId === req.authUser.id) ||
      existingCapa.assignedToName.toLowerCase() === req.authUser.name.toLowerCase();

    if (isOwner && req.authUser.role !== 'HSE / Quality Manager & Tenant Admin') {
      res.status(403).json({
        error: 'Four-eyes violation: Action Owner is strictly prohibited from verifying or closing their own action.',
      });
      return;
    }
    const verifierRoles: UserRole[] = [
      'Authorized Inspector (API 510/570) & Verifikator K3',
      'HSE / Quality Manager & Tenant Admin',
    ];
    if (!verifierRoles.includes(req.authUser.role)) {
      res.status(403).json({
        error: 'Only an Authorized Inspector (API 510/570) or HSE / Quality Manager can verify and close a CAPA.',
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
  requireRole(['HSE / Quality Manager & Tenant Admin']),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const { role, title, isActive, assignedProjects, certifications, password } = req.body ?? {};
    const updates: Record<string, any> = {};

    if (role) updates.role = role;
    if (typeof title === 'string') updates.title = title;
    if (typeof isActive === 'boolean') updates.isActive = isActive;
    if (Array.isArray(assignedProjects)) updates.assignedProjects = assignedProjects;
    if (Array.isArray(certifications)) updates.certifications = certifications;
    if (typeof password === 'string' && password.trim()) {
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

apiRouter.post('/users', requireRole(['HSE / Quality Manager & Tenant Admin']), async (req: Request, res: Response) => {
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

  const [created] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      username: String(username).trim(),
      name: String(name).trim(),
      email: String(email).trim(),
      passwordHash: hashSecret(String(password)),
      role,
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
  requireRole([
    'HSE / Quality Manager & Tenant Admin',
    'Authorized Inspector (API 510/570) & Verifikator K3',
    'Office / Integrity Engineer',
  ]),
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

