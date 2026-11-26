import type {
  SCurveSummary,
  SCurveWeekPoint,
  PlannedCurveOverride,
} from '../../types/index.ts';
import {
  generateProjectCalendarWeeks,
  type CalendarWeekInterval,
} from '../../utils/scurve.ts';

export interface SSOTStageData {
  id: string;
  workflowId: string;
  status: string;
  actualCompletedAt?: Date | string | null;
  submittedAt?: Date | string | null;
}

export interface SSOTWorkflowData {
  id: string;
  nodeId: string;
}

export interface SSOTProgressLogData {
  id: string;
  nodeId: string;
  recordedDate: Date | string;
  progressPercent: number;
  createdAt?: Date | string | null;
}

export interface SSOTNodeData {
  id: string;
  parentId: string | null;
  wbsCode: string;
  name: string;
  weightPercent: string | number;
  plannedStartDate?: Date | string | null;
  plannedEndDate?: Date | string | null;
  claimedProgressPercent?: number;
  verifiedProgressPercent?: number;
  requiresChecklist?: boolean;
  detailingStatus?: 'active' | 'pending_pm_approval' | 'rejected' | string;
  updatedAt?: Date | string | null;
}

export interface SSOTCapaData {
  id?: string;
  nodeId?: string | null;
  severity: string;
  status: string;
  createdAt: Date | string;
  resolvedAt?: Date | string | null;
}

export interface SSOTSCurveParams {
  projectId: string;
  projectName: string;
  nodes: SSOTNodeData[];
  weeks: CalendarWeekInterval[];
  stages?: SSOTStageData[];
  workflows?: SSOTWorkflowData[];
  overrides?: Array<{
    weekIndex: number;
    overridePlannedCumulative: string | number;
  }>;
  hasPunchlistOpenMap?: Map<string, boolean>;
  capaItems?: SSOTCapaData[];
  progressLogs?: SSOTProgressLogData[];
  asOfDate?: Date;
}

interface LeafAbsoluteAttribution {
  node: SSOTNodeData;
  absoluteWeight: number; // Percentage contribution to entire project (sum of all leaves = 100)
}

/**
 * Computes absolute weight attribution for leaf nodes based on the hierarchical WBS tree.
 * Sibling weights are relative to their parent; parent weights are relative to grandparents, etc.
 */
export function computeLeafAttributions(nodes: SSOTNodeData[]): LeafAbsoluteAttribution[] {
  if (!nodes || nodes.length === 0) return [];

  const childrenMap = new Map<string, SSOTNodeData[]>();
  const parentIds = new Set<string>();

  for (const node of nodes) {
    if (node.parentId) {
      parentIds.add(node.parentId);
      const list = childrenMap.get(node.parentId) || [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }

  const rootNodes = nodes.filter((n) => !n.parentId);
  const rootWeightSum = rootNodes.reduce((acc, r) => acc + (Number(r.weightPercent) || 0), 0) || 100;

  const attributions: LeafAbsoluteAttribution[] = [];

  function traverse(node: SSOTNodeData, parentAbsoluteShare: number) {
    const rawChildren = childrenMap.get(node.id) || [];
    const children = rawChildren.filter((c) => !c.detailingStatus || c.detailingStatus === 'active');
    if (children.length === 0) {
      // Leaf node
      attributions.push({
        node,
        absoluteWeight: parentAbsoluteShare,
      });
      return;
    }

    // Non-leaf: distribute parentAbsoluteShare to children proportionally
    const siblingWeightSum = children.reduce((acc, c) => acc + (Number(c.weightPercent) || 0), 0) || 100;
    for (const child of children) {
      const childShare = parentAbsoluteShare * ((Number(child.weightPercent) || 0) / siblingWeightSum);
      traverse(child, childShare);
    }
  }

  for (const root of rootNodes) {
    const rootShare = ((Number(root.weightPercent) || 0) / rootWeightSum) * 100;
    traverse(root, rootShare);
  }

  return attributions;
}

/**
 * SSOT S-Curve Engine:
 * Generates exact Planned, Claimed, and Verified S-Curve curves.
 * 
 * Crucially, Verified progress is aggregated directly from actual stage approval timestamps
 * (inspection_attempts.decided_at / work_stages.actual_completed_at) on or before each week's Sunday,
 * completely replacing linear interpolation (elapsedRatio) with the authentic site milestone step-curve.
 */
export function calculateSSOTSCurveData(params: SSOTSCurveParams): SCurveSummary {
  const {
    projectId,
    projectName,
    nodes,
    weeks,
    stages = [],
    workflows = [],
    overrides = [],
    hasPunchlistOpenMap = new Map(),
    capaItems = [],
    progressLogs = [],
    asOfDate = new Date(),
  } = params;

  // Group direct progress logs by nodeId (sorted ascending by recordedDate, then createdAt)
  const nodeLogsMap = new Map<string, SSOTProgressLogData[]>();
  for (const log of progressLogs) {
    const list = nodeLogsMap.get(log.nodeId) || [];
    list.push(log);
    nodeLogsMap.set(log.nodeId, list);
  }
  for (const [nid, list] of nodeLogsMap.entries()) {
    list.sort((a, b) => {
      const da = new Date(`${String(a.recordedDate).slice(0, 10)}T00:00:00Z`).getTime();
      const db = new Date(`${String(b.recordedDate).slice(0, 10)}T00:00:00Z`).getTime();
      if (da !== db) return da - db;
      const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ca - cb;
    });
    nodeLogsMap.set(nid, list);
  }

  // Build override map: weekIndex -> overridePlannedCumulative
  const overrideMap = new Map<number, number>();
  for (const ov of overrides) {
    overrideMap.set(ov.weekIndex, Number(ov.overridePlannedCumulative));
  }

  // Calculate leaf nodes and their absolute project weight attribution
  const leafAttributions = computeLeafAttributions(nodes);
  const totalProjectWeight = leafAttributions.reduce((acc, l) => acc + l.absoluteWeight, 0) || 100;

  // Map workflowId -> nodeId and nodeId -> stages
  const workflowToNodeMap = new Map<string, string>();
  for (const wf of workflows) {
    workflowToNodeMap.set(wf.id, wf.nodeId);
  }

  const nodeStagesMap = new Map<string, SSOTStageData[]>();
  for (const stage of stages) {
    const nodeId = workflowToNodeMap.get(stage.workflowId);
    if (nodeId) {
      const list = nodeStagesMap.get(nodeId) || [];
      list.push(stage);
      nodeStagesMap.set(nodeId, list);
    }
  }

  const asOfTime = asOfDate.getTime();
  let currentWeekIndex = 1;

  const points: SCurveWeekPoint[] = [];
  let prevTargetCum = 0;
  let prevClaimedCum = 0;
  let prevVerifiedCum = 0;

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const isPastOrCurrent = w.startDate.getTime() <= asOfTime;
    if (isPastOrCurrent) {
      currentWeekIndex = w.weekIndex;
    }

    // 1. TARGET PLANNED CUMULATIVE
    let targetCum = 0;
    if (overrideMap.has(w.weekIndex)) {
      targetCum = Math.min(100, Math.max(0, overrideMap.get(w.weekIndex)!));
    } else {
      let accumulatedPlanned = 0;
      for (const { node, absoluteWeight } of leafAttributions) {
        const pStart = node.plannedStartDate ? new Date(node.plannedStartDate).getTime() : weeks[0].startDate.getTime();
        const pEnd = node.plannedEndDate ? new Date(node.plannedEndDate).getTime() : weeks[weeks.length - 1].endDate.getTime();

        if (w.endDate.getTime() >= pEnd) {
          accumulatedPlanned += absoluteWeight;
        } else if (w.endDate.getTime() > pStart && pEnd > pStart) {
          const ratio = (w.endDate.getTime() - pStart) / (pEnd - pStart);
          accumulatedPlanned += absoluteWeight * Math.min(1, Math.max(0, ratio));
        }
      }
      targetCum = Math.round((accumulatedPlanned / totalProjectWeight) * 10000) / 100;
    }

    // 2. ACTUAL CLAIMED & VERIFIED CUMULATIVE
    let claimedCum = 0;
    let verifiedCum = 0;

    if (isPastOrCurrent) {
      let totalVerifiedEarned = 0;
      let totalClaimedEarned = 0;

      for (const { node, absoluteWeight } of leafAttributions) {
        const leafStages = nodeStagesMap.get(node.id) || [];

        let leafVerifiedPercent = 0;
        let leafClaimedPercent = 0;

        if (leafStages.length > 0) {
          // Stages exist for this node: SSOT timestamp evaluation
          const approvedStagesBeforeWeekEnd = leafStages.filter((s) => {
            if (s.status !== 'approved') return false;
            if (!s.actualCompletedAt) return false;
            return new Date(s.actualCompletedAt).getTime() <= w.endDate.getTime();
          });

          leafVerifiedPercent = (approvedStagesBeforeWeekEnd.length / leafStages.length) * 100;

          const submittedStagesBeforeWeekEnd = leafStages.filter((s) => {
            if (s.status !== 'submitted' && s.status !== 'approved') return false;
            const ts = s.actualCompletedAt || s.submittedAt;
            if (!ts) return false;
            return new Date(ts).getTime() <= w.endDate.getTime();
          });

          leafClaimedPercent = (submittedStagesBeforeWeekEnd.length / leafStages.length) * 100;
        } else {
          // Standalone task node without workflow stages:
          // Prefer historical direct progress logs per date so S-Curve shows real progression across weeks
          const logsForNode = nodeLogsMap.get(node.id);
          if (logsForNode && logsForNode.length > 0) {
            const weekEndTime = w.endDate.getTime();
            const logsUpToWeek = logsForNode.filter((l) => {
              const logTs = new Date(`${String(l.recordedDate).slice(0, 10)}T23:59:59.999Z`).getTime();
              return logTs <= weekEndTime;
            });
            if (logsUpToWeek.length > 0) {
              const latestLog = logsUpToWeek[logsUpToWeek.length - 1];
              const pct = Number(latestLog.progressPercent) || 0;
              leafClaimedPercent = pct;
              leafVerifiedPercent = node.requiresChecklist ? 0 : pct;
            }
          } else {
            // Fallback for legacy standalone nodes without progress logs
            const nodeUpdatedTime = node.updatedAt ? new Date(node.updatedAt).getTime() : 0;
            if (nodeUpdatedTime <= w.endDate.getTime()) {
              leafVerifiedPercent = Number(node.verifiedProgressPercent) || 0;
              leafClaimedPercent = Number(node.claimedProgressPercent) || 0;
            }
          }
        }

        // Zero-Tolerance CAPA Gate (99% Lockout on Open Critical/High Defect)
        let isLockedByCapa = Boolean(hasPunchlistOpenMap.get(node.id));

        if (capaItems && capaItems.length > 0) {
          const weekEndTs = w.endDate.getTime();
          const hasActiveCapaInWeek = capaItems.some((capa) => {
            if (!capa.nodeId || capa.nodeId !== node.id) return false;
            const sev = (capa.severity || '').toLowerCase();
            if (sev !== 'critical' && sev !== 'high') return false;

            const createdTs = new Date(capa.createdAt).getTime();
            if (createdTs > weekEndTs) return false;

            if (capa.resolvedAt) {
              const resolvedTs = new Date(capa.resolvedAt).getTime();
              if (resolvedTs <= weekEndTs) return false;
            }

            const st = (capa.status || '').toUpperCase();
            if (['CLOSED', 'CANCELLED', 'REJECTED', 'EFFECTIVENESS_MONITORING'].includes(st)) {
              if (!capa.resolvedAt) return false;
            }

            return true;
          });

          if (hasActiveCapaInWeek) {
            isLockedByCapa = true;
          }
        }

        if (isLockedByCapa && leafVerifiedPercent >= 100) {
          leafVerifiedPercent = 99;
        }

        totalVerifiedEarned += (leafVerifiedPercent * absoluteWeight) / 100;
        totalClaimedEarned += (Math.max(leafClaimedPercent, leafVerifiedPercent) * absoluteWeight) / 100;
      }

      verifiedCum = Math.round((totalVerifiedEarned / totalProjectWeight) * 10000) / 100;
      claimedCum = Math.round((totalClaimedEarned / totalProjectWeight) * 10000) / 100;
    } else {
      // Future weeks: plateau at the last recorded actual progress
      claimedCum = prevClaimedCum;
      verifiedCum = prevVerifiedCum;
    }

    // Monotonic non-decreasing guarantee
    targetCum = Math.max(prevTargetCum, Math.min(100, targetCum));
    claimedCum = Math.max(prevClaimedCum, Math.min(100, claimedCum));
    verifiedCum = Math.max(prevVerifiedCum, Math.min(100, verifiedCum));

    const targetInc = Math.round((targetCum - prevTargetCum) * 100) / 100;
    const claimedInc = Math.round((claimedCum - prevClaimedCum) * 100) / 100;
    const verifiedInc = Math.round((verifiedCum - prevVerifiedCum) * 100) / 100;
    const variance = Math.round((verifiedCum - targetCum) * 100) / 100;

    points.push({
      weekIndex: w.weekIndex,
      startDate: w.startDate.toISOString().slice(0, 10),
      endDate: w.endDate.toISOString().slice(0, 10),
      label: w.label,
      targetIncremental: targetInc,
      targetCumulative: targetCum,
      claimedIncremental: claimedInc,
      claimedCumulative: claimedCum,
      verifiedIncremental: verifiedInc,
      verifiedCumulative: verifiedCum,
      variance,
    });

    prevTargetCum = targetCum;
    prevClaimedCum = claimedCum;
    prevVerifiedCum = verifiedCum;
  }

  const currentPoint = points[currentWeekIndex - 1] || points[0];
  const currentVariance = currentPoint?.variance || 0;
  const status: 'ahead' | 'on_track' | 'delayed' =
    currentVariance > 2 ? 'ahead' : currentVariance < -5 ? 'delayed' : 'on_track';

  const totalHoldPoints = stages.filter((s: any) => s.stageType === 'hold').length;
  const activeHoldPoints = stages.filter((s: any) => s.stageType === 'hold' && s.status !== 'approved').length;

  return {
    projectId,
    projectName,
    totalWeeks: weeks.length,
    currentWeekIndex,
    currentPlannedPercent: currentPoint?.targetCumulative || 0,
    currentClaimedPercent: currentPoint?.claimedCumulative || 0,
    currentVerifiedPercent: currentPoint?.verifiedCumulative || 0,
    currentVariance,
    status,
    totalHoldPoints,
    activeHoldPoints,
    points,
  };
}
