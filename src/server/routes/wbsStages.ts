import { type Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, desc, eq, inArray, or, ilike, sql } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import {
  auditLogs, checklistTemplates, correctiveActions, inspections, projects,
  masterProjects, users, workNodes, workWorkflows, workStages, inspectionAttempts,
  evidenceAttachments, plannedCurveOverrides, dailyWeatherLogs, projectMembers,
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

export function registerWbsStageRoutes(router: Router) {
router.get(
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

router.post(
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
        requiresChecklist: Boolean(body.requiresChecklist),
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

router.put(
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

    const updatedRequiresChecklist =
      hasStructurePerm && body.requiresChecklist !== undefined
        ? Boolean(body.requiresChecklist)
        : existingNode.requiresChecklist;

    if (
      !hasStructurePerm &&
      body.requiresChecklist !== undefined &&
      Boolean(body.requiresChecklist) !== existingNode.requiresChecklist
    ) {
      res.status(403).json({
        error: 'Hanya pemegang wbs.edit_structure (PMO/PM) yang dapat mengubah Mode Strict.',
      });
      return;
    }

    if (body.claimedProgressPercent !== undefined) {
      if (updatedRequiresChecklist) {
        res.status(422).json({
          error:
            'Node ini berada dalam Mode Strict (Wajib Ceklis Inspeksi). Progres hanya dapat naik melalui persetujuan tahapan inspeksi.',
        });
        return;
      }
      const val = Number(body.claimedProgressPercent);
      if (Number.isNaN(val) || val < 0 || val > 100) {
        res.status(400).json({ error: 'claimedProgressPercent harus antara 0 hingga 100.' });
        return;
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
        claimedProgressPercent: body.claimedProgressPercent !== undefined ? Math.round(Number(body.claimedProgressPercent)) : existingNode.claimedProgressPercent,
        verifiedProgressPercent:
          body.verifiedProgressPercent !== undefined
            ? Number(body.verifiedProgressPercent)
            : body.claimedProgressPercent !== undefined && !updatedRequiresChecklist
              ? Math.round(Number(body.claimedProgressPercent))
              : existingNode.verifiedProgressPercent,
        allowDetailing: updatedAllowDetailing,
        requiresChecklist: updatedRequiresChecklist,
        detailingStatus: updatedDetailingStatus,
        volume: body.volume !== undefined ? (body.volume != null && String(body.volume).trim() !== '' ? String(body.volume) : null) : existingNode.volume,
        unit: body.unit !== undefined ? (body.unit ? String(body.unit).trim() : null) : existingNode.unit,
        sortOrder: body.sortOrder !== undefined ? Number(body.sortOrder) : existingNode.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(workNodes.id, existingNode.id))
      .returning();

    if (body.claimedProgressPercent !== undefined) {
      const recordedDateStr =
        typeof body.progressDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.progressDate.trim())
          ? body.progressDate.trim()
          : new Date().toISOString().slice(0, 10);
      await db.insert(wbsProgressLogs).values({
        projectId: projectScopeId as any,
        nodeId: updatedNode.id,
        recordedDate: recordedDateStr,
        progressPercent: Math.round(Number(body.claimedProgressPercent)),
        notes: body.progressNotes ? String(body.progressNotes).trim() : null,
        recordedBy: req.authUser.id as any,
        recordedByName: req.authUser.name,
      });
    }

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

router.get(
  '/projects/:projectId/wbs/nodes/:nodeId/progress-logs',
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
    const logs = await db
      .select()
      .from(wbsProgressLogs)
      .where(
        and(
          eq(wbsProgressLogs.projectId, projectScopeId as any),
          eq(wbsProgressLogs.nodeId, nodeScopeId as any)
        )
      )
      .orderBy(desc(wbsProgressLogs.recordedDate), desc(wbsProgressLogs.createdAt));

    res.json({ logs });
  }
);

router.delete(
  '/projects/:projectId/wbs/nodes/:nodeId/progress-logs/:logId',
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
    const logId = String(req.params.logId || '');

    const [deleted] = await db
      .delete(wbsProgressLogs)
      .where(
        and(
          eq(wbsProgressLogs.id, logId as any),
          eq(wbsProgressLogs.projectId, projectScopeId as any),
          eq(wbsProgressLogs.nodeId, nodeScopeId as any)
        )
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Log progres tidak ditemukan.' });
      return;
    }

    const remaining = await db
      .select()
      .from(wbsProgressLogs)
      .where(
        and(
          eq(wbsProgressLogs.projectId, projectScopeId as any),
          eq(wbsProgressLogs.nodeId, nodeScopeId as any)
        )
      )
      .orderBy(desc(wbsProgressLogs.recordedDate), desc(wbsProgressLogs.createdAt))
      .limit(1);

    const [nodeRow] = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.id, nodeScopeId as any))
      .limit(1);

    if (nodeRow) {
      const latestPct = remaining[0]?.progressPercent ?? 0;
      await db
        .update(workNodes)
        .set({
          claimedProgressPercent: latestPct,
          verifiedProgressPercent: nodeRow.requiresChecklist ? nodeRow.verifiedProgressPercent : latestPct,
          updatedAt: new Date(),
        })
        .where(eq(workNodes.id, nodeRow.id));
      await recalculateAndSaveNodeRollups(db, projectScopeId);
    }

    res.json({ success: true });
  }
);

router.delete(
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
router.post(
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
router.post(
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
router.patch(
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
router.put(
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

router.post(
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

router.get(
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

router.post(
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

router.post(
  '/projects/:projectId/wbs/nodes/:nodeId/stages',
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
    const { name, stageType = 'work', requiresWetSignature = false } = req.body ?? {};

    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Nama tahapan wajib diisi.' });
      return;
    }

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
          title: `Alur Tahapan: ${matchedNode.name}`,
        })
        .returning();
      existingWf = newWf;
    }

    const existingStages = await db
      .select()
      .from(workStages)
      .where(eq(workStages.workflowId, existingWf.id))
      .orderBy(workStages.stageOrder);

    const nextOrder =
      existingStages.length > 0
        ? Math.max(...existingStages.map((s) => Number(s.stageOrder) || 0)) + 1
        : 1;

    const validType = ['work', 'hold', 'review'].includes(stageType) ? stageType : 'work';

    const [createdStage] = await db
      .insert(workStages)
      .values({
        workflowId: existingWf.id,
        stageOrder: nextOrder,
        stageType: validType,
        name: String(name).trim(),
        assignedRole: 'Project / Site Engineer',
        approvalRole: 'QA/QC Lead / Owner Inspector',
        requiresWetSignature: Boolean(requiresWetSignature),
        status: 'pending',
      })
      .returning();

    // Recompute node verified progress percentage based on total stages
    const allStages = [...existingStages, createdStage];
    const approvedCount = allStages.filter((s) => s.status === 'approved').length;
    const newVerified = Math.round((approvedCount / allStages.length) * 100);
    await db
      .update(workNodes)
      .set({ verifiedProgressPercent: newVerified, updatedAt: new Date() })
      .where(eq(workNodes.id, matchedNode.id));
    await recalculateAndSaveNodeRollups(db, projectScopeId);

    await logAudit(req.authUser.id, req.authUser.name, 'CREATE_WBS_STAGE', 'work_stage', createdStage.id, {
      nodeId: matchedNode.id,
      name: createdStage.name,
      stageType: createdStage.stageType,
    });

    res.status(201).json({ stage: createdStage });
  }
);

router.put(
  '/projects/:projectId/wbs/stages/:stageId',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectId = String(req.params.projectId || '');
    const stageId = String(req.params.stageId || '');
    const stageProjectId = await getProjectIdByStageId(stageId);
    if (!stageProjectId || stageProjectId !== projectId) {
      res.status(404).json({ error: 'Stage not found in this project.' });
      return;
    }

    const [targetStage] = await db
      .select()
      .from(workStages)
      .where(eq(workStages.id, stageId as any))
      .limit(1);

    if (!targetStage) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    const { name, stageType } = req.body ?? {};
    const updates: Partial<typeof workStages.$inferInsert> = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (stageType && ['work', 'hold', 'review'].includes(stageType)) updates.stageType = stageType;

    const [updated] = await db
      .update(workStages)
      .set(updates)
      .where(eq(workStages.id, stageId as any))
      .returning();

    await logAudit(req.authUser.id, req.authUser.name, 'UPDATE_WBS_STAGE', 'work_stage', stageId, updates);
    res.json({ stage: updated });
  }
);

router.delete(
  '/projects/:projectId/wbs/stages/:stageId',
  requireAuth,
  requireProjectAccess('projectId'),
  requirePermission([PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL]),
  async (req: Request, res: Response) => {
    const db = getDb();
    if (!db || !req.authUser) {
      res.status(503).json({ error: 'Database not configured.' });
      return;
    }

    const projectId = String(req.params.projectId || '');
    const stageId = String(req.params.stageId || '');
    const stageProjectId = await getProjectIdByStageId(stageId);
    if (!stageProjectId || stageProjectId !== projectId) {
      res.status(404).json({ error: 'Stage not found in this project.' });
      return;
    }

    const [targetStage] = await db
      .select()
      .from(workStages)
      .where(eq(workStages.id, stageId as any))
      .limit(1);

    if (!targetStage) {
      res.status(404).json({ error: 'Stage not found.' });
      return;
    }

    if (targetStage.status === 'approved') {
      res.status(409).json({ error: 'Tahapan yang sudah disetujui (approved) tidak dapat dihapus.' });
      return;
    }

    const [wf] = await db
      .select()
      .from(workWorkflows)
      .where(eq(workWorkflows.id, targetStage.workflowId))
      .limit(1);

    await db.delete(workStages).where(eq(workStages.id, targetStage.id));

    if (wf) {
      const remaining = await db
        .select()
        .from(workStages)
        .where(eq(workStages.workflowId, wf.id))
        .orderBy(workStages.stageOrder);

      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].stageOrder !== i + 1) {
          await db
            .update(workStages)
            .set({ stageOrder: i + 1 })
            .where(eq(workStages.id, remaining[i].id));
        }
      }

      const [node] = await db
        .select()
        .from(workNodes)
        .where(eq(workNodes.id, wf.nodeId))
        .limit(1);

      if (node) {
        const approvedCount = remaining.filter((s) => s.status === 'approved').length;
        const newVerified = remaining.length > 0 ? Math.round((approvedCount / remaining.length) * 100) : 0;
        await db
          .update(workNodes)
          .set({ verifiedProgressPercent: newVerified, updatedAt: new Date() })
          .where(eq(workNodes.id, node.id));
        await recalculateAndSaveNodeRollups(db, node.projectId);
      }
    }

    await logAudit(req.authUser.id, req.authUser.name, 'DELETE_WBS_STAGE', 'work_stage', stageId, {
      name: targetStage.name,
    });

    res.json({ success: true, message: 'Tahapan berhasil dihapus.' });
  }
);

router.get(
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
router.post(
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

router.post(
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

router.post(
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

}
