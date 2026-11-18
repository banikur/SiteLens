import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
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
import {
  extractEvidenceFilename,
  getUploadDir,
  verifyStoredEvidence,
} from '../services/evidenceIntegrity.ts';
import type {
  ApprovalDecision,
  ChecklistTemplate,
  InspectionEvidence,
  InspectionStatus,
  UserRole,
  WorkflowStep,
} from '../../types/index.ts';

const VALID_ROLES: readonly UserRole[] = [
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
  requireRole(['HSE / Quality Manager & Tenant Admin', 'Office / Integrity Engineer']),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
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

  const id = body.id || `insp-${crypto.randomUUID().slice(0, 8)}`;
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

apiRouter.delete(
  '/inspections/:id',
  requireRole(['HSE / Quality Manager & Tenant Admin']),
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

    // Never allow the last active administrator to be demoted or deactivated:
    // doing so would lock every tenant administrator out permanently.
    if (
      target.role === 'HSE / Quality Manager & Tenant Admin' &&
      (nextRole !== 'HSE / Quality Manager & Tenant Admin' || nextActive === false)
    ) {
      const admins = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, 'HSE / Quality Manager & Tenant Admin'),
            eq(users.isActive, true)
          )
        );
      if (admins.filter((a) => a.id !== target.id).length === 0) {
        res.status(409).json({
          error: 'Cannot remove the last active tenant administrator.',
        });
        return;
      }
    }

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

