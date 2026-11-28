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

export function registerScurveWeatherRoutes(router: Router) {
router.get(
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
      .select({
        id: projects.id,
        name: projects.name,
        code: projects.code,
        masterProjectId: projects.masterProjectId,
      })
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

    // Determine project start and end dates: prioritize Master Project start/end dates, then WBS node dates, then 12-week default
    let masterStart: Date | null = null;
    let masterEnd: Date | null = null;
    if (targetProject.masterProjectId) {
      const [mp] = await db
        .select({ startDate: masterProjects.startDate, endDate: masterProjects.endDate })
        .from(masterProjects)
        .where(eq(masterProjects.id, targetProject.masterProjectId as any))
        .limit(1);
      if (mp?.startDate) masterStart = new Date(`${String(mp.startDate).slice(0, 10)}T00:00:00Z`);
      if (mp?.endDate) masterEnd = new Date(`${String(mp.endDate).slice(0, 10)}T00:00:00Z`);
    }

    let earliestStart = new Date();
    let latestEnd = new Date();
    latestEnd.setDate(latestEnd.getDate() + 84); // 12 weeks default

    const validStarts = nodes.map((n) => n.plannedStartDate).filter(Boolean) as Date[];
    const validEnds = nodes.map((n) => n.plannedEndDate).filter(Boolean) as Date[];

    if (masterStart && !Number.isNaN(masterStart.getTime())) {
      earliestStart = masterStart;
    } else if (validStarts.length > 0) {
      earliestStart = new Date(Math.min(...validStarts.map((d) => new Date(d).getTime())));
    }

    if (masterEnd && !Number.isNaN(masterEnd.getTime())) {
      latestEnd = masterEnd;
    } else if (validEnds.length > 0) {
      latestEnd = new Date(Math.max(...validEnds.map((d) => new Date(d).getTime())));
    }

    if (latestEnd.getTime() <= earliestStart.getTime()) {
      latestEnd = new Date(earliestStart);
      latestEnd.setDate(latestEnd.getDate() + 84);
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

    const projectProgressLogs = await db
      .select({
        id: wbsProgressLogs.id,
        nodeId: wbsProgressLogs.nodeId,
        recordedDate: wbsProgressLogs.recordedDate,
        progressPercent: wbsProgressLogs.progressPercent,
        createdAt: wbsProgressLogs.createdAt,
      })
      .from(wbsProgressLogs)
      .where(eq(wbsProgressLogs.projectId, targetProject.id));

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
      progressLogs: projectProgressLogs,
      asOfDate: new Date(),
    });

    res.json({ scurve });
  }
);

router.post(
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

router.get(
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
      .select()
      .from(workNodes)
      .where(eq(workNodes.projectId, targetProject.id));

    const nodeIds = nodes.map((n) => n.id);
    if (nodeIds.length === 0) {
      res.json({ bottlenecks: [], criticalCount: 0, warningCount: 0, normalCount: 0 });
      return;
    }

    const { criticalNodeIds } = computeWbsCriticalPath(nodes as any);
    const [calRow] = await db
      .select()
      .from(projectCalendars)
      .where(eq(projectCalendars.projectId, targetProject.id))
      .limit(1);
    const holidayRows = await db
      .select({ holidayDate: nationalHolidays.holidayDate })
      .from(nationalHolidays);
    const holidayDates = new Set(holidayRows.map((h) => h.holidayDate));
    const calendar = calRow || {
      workStartHour: '08:00',
      workEndHour: '17:00',
      saturdayMode: 'non_working' as const,
      sundayMode: 'non_working' as const,
      holidayOverrides: {},
    };

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
          nodeId,
          wbsCode: nodeInfo.wbsCode,
          nodeName: nodeInfo.name,
          attempt,
          submitterName,
        });
      }
    }

    const bottlenecks = calculateBottleneckAging(itemsForAging, new Date(), {
      calendar,
      holidayDates,
      criticalNodeIds,
    });
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

router.get(
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

router.post(
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

}
