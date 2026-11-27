import { Router, type Request, type Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import {
  auditLogs,
  baselineSnapshots,
  nationalHolidays,
  projectCalendars,
  variationOrders,
  workNodes,
} from '../db/schema.ts';
import { requireAuth, requireProjectAccess } from '../auth/middleware.ts';
import { PERMISSIONS, requirePermission } from '../auth/rbac.ts';
import { syncNationalHolidaysFromTanggalans } from '../services/holidayService.ts';

export const projectControlRouter = Router();

async function writeAuditLog(
  actorId: string,
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, any> = {}
) {
  const db = getDb();
  if (!db) return;
  await db.insert(auditLogs).values({
    actorId: actorId as any,
    actorName,
    action,
    entityType,
    entityId,
    metadata,
  });
}

// ---------------- NATIONAL HOLIDAYS & PROJECT WORKING CALENDAR ----------------

projectControlRouter.get('/holidays', requireAuth, async (req: Request, res: Response) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ error: 'Database not configured.' });
    return;
  }
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = await db.select().from(nationalHolidays).where(eq(nationalHolidays.year, year));
  res.json({ year, holidays: rows });
});

projectControlRouter.post(
  '/holidays/sync',
  requireAuth,
  requirePermission([PERMISSIONS.ADMIN_SETTINGS, PERMISSIONS.PROJECT_EDIT]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const year = Number(req.body?.year) || new Date().getFullYear();
    try {
      const holidays = await syncNationalHolidaysFromTanggalans(year);
      await writeAuditLog(req.authUser.id, req.authUser.name, 'HOLIDAYS_SYNCED', 'national_holidays', String(year), {
        count: holidays.length,
        source: 'tanggalans.com',
      });
      res.json({ year, holidays, count: holidays.length });
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Gagal mengambil data hari libur dari tanggalans.com.' });
    }
  }
);

projectControlRouter.get(
  '/projects/:projectId/calendar',
  requireAuth,
  requireProjectAccess('projectId'),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const [cal] = await db
      .select()
      .from(projectCalendars)
      .where(eq(projectCalendars.projectId, projectId as any))
      .limit(1);

    res.json({
      calendar: cal || {
        projectId,
        workStartHour: '08:00',
        workEndHour: '17:00',
        saturdayMode: 'non_working',
        sundayMode: 'non_working',
        holidayOverrides: {},
      },
    });
  }
);

projectControlRouter.put(
  '/projects/:projectId/calendar',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.PROJECT_EDIT, PERMISSIONS.SCHEDULE_MANAGE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const {
      workStartHour = '08:00',
      workEndHour = '17:00',
      saturdayMode = 'non_working',
      sundayMode = 'non_working',
      holidayOverrides = {},
    } = req.body ?? {};

    const [calendar] = await db
      .insert(projectCalendars)
      .values({
        projectId: projectId as any,
        workStartHour: String(workStartHour),
        workEndHour: String(workEndHour),
        saturdayMode,
        sundayMode,
        holidayOverrides,
      })
      .onConflictDoUpdate({
        target: projectCalendars.projectId,
        set: {
          workStartHour: String(workStartHour),
          workEndHour: String(workEndHour),
          saturdayMode,
          sundayMode,
          holidayOverrides,
          updatedAt: new Date(),
        },
      })
      .returning();

    await writeAuditLog(req.authUser.id, req.authUser.name, 'PROJECT_CALENDAR_UPDATED', 'project', projectId, {
      workStartHour,
      workEndHour,
      saturdayMode,
      sundayMode,
    });

    res.json({ calendar });
  }
);

// ---------------- BASELINE SNAPSHOTS ----------------

projectControlRouter.get(
  '/projects/:projectId/baselines',
  requireAuth,
  requireProjectAccess('projectId'),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const baselines = await db
      .select()
      .from(baselineSnapshots)
      .where(eq(baselineSnapshots.projectId, projectId as any))
      .orderBy(desc(baselineSnapshots.version));
    res.json({ baselines });
  }
);

projectControlRouter.post(
  '/projects/:projectId/baselines',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_FREEZE_BASELINE, PERMISSIONS.SCURVE_OVERRIDE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const { label, curvePoints } = req.body ?? {};
    const existing = await db
      .select({ version: baselineSnapshots.version })
      .from(baselineSnapshots)
      .where(eq(baselineSnapshots.projectId, projectId as any))
      .orderBy(desc(baselineSnapshots.version))
      .limit(1);

    const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;
    const [baseline] = await db
      .insert(baselineSnapshots)
      .values({
        projectId: projectId as any,
        version: nextVersion,
        label: String(label || `Baseline v${nextVersion}`),
        curvePoints: Array.isArray(curvePoints) ? curvePoints : [],
        createdBy: req.authUser.id as any,
      })
      .returning();

    await writeAuditLog(req.authUser.id, req.authUser.name, 'BASELINE_CREATED', 'project', projectId, {
      baselineId: baseline.id,
      version: nextVersion,
    });

    res.status(201).json({ baseline });
  }
);

// ---------------- VARIATION ORDERS (NON-BLOCKING FIELD EXECUTION) ----------------

projectControlRouter.get(
  '/projects/:projectId/variation-orders',
  requireAuth,
  requireProjectAccess('projectId'),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const items = await db
      .select()
      .from(variationOrders)
      .where(eq(variationOrders.projectId, projectId as any))
      .orderBy(desc(variationOrders.createdAt));
    res.json({ variationOrders: items });
  }
);

projectControlRouter.post(
  '/projects/:projectId/variation-orders',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_REQUEST_CHANGE, PERMISSIONS.WBS_EDIT_STRUCTURE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const {
      title,
      description,
      voType = 'scope_addition',
      allowWorkBeforeApproval = true,
      targetNodeId = null,
      proposedChanges = {},
    } = req.body ?? {};

    if (!title || !description) {
      res.status(400).json({ error: 'title and description are required.' });
      return;
    }

    const existingCount = await db
      .select({ id: variationOrders.id })
      .from(variationOrders)
      .where(eq(variationOrders.projectId, projectId as any));
    const voNumber = `VO-${String(existingCount.length + 1).padStart(3, '0')}`;

    const [vo] = await db
      .insert(variationOrders)
      .values({
        projectId: projectId as any,
        voNumber,
        title: String(title),
        description: String(description),
        voType,
        status: 'pending_approval',
        allowWorkBeforeApproval: Boolean(allowWorkBeforeApproval),
        targetNodeId: targetNodeId ? (targetNodeId as any) : null,
        proposedChanges,
        requestedBy: req.authUser.id as any,
      })
      .returning();

    if (allowWorkBeforeApproval && targetNodeId) {
      await db
        .update(workNodes)
        .set({ isUnplanned: true, provisionalStatus: 'pending_vo', updatedAt: new Date() })
        .where(and(eq(workNodes.id, targetNodeId as any), eq(workNodes.projectId, projectId as any)));
    }

    await writeAuditLog(req.authUser.id, req.authUser.name, 'VARIATION_ORDER_CREATED', 'variation_order', vo.id, {
      projectId,
      voNumber,
      allowWorkBeforeApproval,
    });

    res.status(201).json({ variationOrder: vo });
  }
);

projectControlRouter.post(
  '/projects/:projectId/variation-orders/:voId/decide',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_APPROVE_CHANGE, PERMISSIONS.WBS_FREEZE_BASELINE]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }
    const projectId = String(req.params.projectId);
    const voId = String(req.params.voId);
    const { decision, decisionNotes } = req.body ?? {};

    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: 'decision must be approved or rejected.' });
      return;
    }

    const [vo] = await db
      .select()
      .from(variationOrders)
      .where(and(eq(variationOrders.id, voId as any), eq(variationOrders.projectId, projectId as any)))
      .limit(1);

    if (!vo) {
      res.status(404).json({ error: 'Variation order not found.' });
      return;
    }

    if (vo.requestedBy === req.authUser.id) {
      res.status(403).json({
        error: 'Four-eyes principle: pengaju Variation Order tidak dapat menyetujui pengajuannya sendiri.',
      });
      return;
    }

    const [updated] = await db
      .update(variationOrders)
      .set({
        status: decision,
        approvedBy: req.authUser.id as any,
        decidedAt: new Date(),
        decisionNotes: decisionNotes ? String(decisionNotes) : null,
      })
      .where(eq(variationOrders.id, vo.id))
      .returning();

    if (decision === 'approved' && vo.targetNodeId) {
      const updates: Record<string, any> = {
        provisionalStatus: 'confirmed',
        updatedAt: new Date(),
      };
      if (vo.proposedChanges?.newWeightPercent !== undefined) {
        updates.weightPercent = String(vo.proposedChanges.newWeightPercent);
      }
      if (vo.proposedChanges?.plannedStartDate) {
        updates.plannedStartDate = new Date(vo.proposedChanges.plannedStartDate);
      }
      if (vo.proposedChanges?.plannedEndDate) {
        updates.plannedEndDate = new Date(vo.proposedChanges.plannedEndDate);
      }
      await db
        .update(workNodes)
        .set(updates)
        .where(and(eq(workNodes.id, vo.targetNodeId as any), eq(workNodes.projectId, projectId as any)));
    }

    await writeAuditLog(
      req.authUser.id,
      req.authUser.name,
      `VARIATION_ORDER_${decision.toUpperCase()}`,
      'variation_order',
      vo.id,
      {
        projectId,
        voNumber: vo.voNumber,
        decision,
      }
    );

    res.json({ variationOrder: updated });
  }
);
