import type {
  WorkNode,
  PlannedCurveOverride,
  SCurveSummary,
  SCurveWeekPoint,
  BottleneckItem,
  DailyWeatherLog,
  WorkStage,
  InspectionAttempt,
} from '../types';

/**
 * Normalizes any Date to the Monday 00:00:00 of that week.
 */
export function getMondayOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 is Sunday, 1 is Monday, ...
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Normalizes any Date to the Sunday 23:59:59 of that week.
 */
export function getSundayOfWeek(d: Date): Date {
  const monday = getMondayOfWeek(d);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return sunday;
}

export interface CalendarWeekInterval {
  weekIndex: number;
  startDate: Date;
  endDate: Date;
  label: string;
}

/**
 * Generates sequential calendar week buckets (Monday 00:00 - Sunday 23:59)
 * covering the timeline from project start to project end.
 */
export function generateProjectCalendarWeeks(
  startDateInput: Date | string,
  endDateInput: Date | string
): CalendarWeekInterval[] {
  const start = getMondayOfWeek(new Date(startDateInput));
  let end = getSundayOfWeek(new Date(endDateInput));

  // If start is after end, guarantee at least 4 weeks
  if (start.getTime() >= end.getTime()) {
    end = new Date(start);
    end.setDate(start.getDate() + 27);
    end.setHours(23, 59, 59, 999);
  }

  const weeks: CalendarWeekInterval[] = [];
  let currentMonday = new Date(start);
  let index = 1;

  while (currentMonday.getTime() <= end.getTime()) {
    const currentSunday = new Date(currentMonday);
    currentSunday.setDate(currentMonday.getDate() + 6);
    currentSunday.setHours(23, 59, 59, 999);

    const startStr = currentMonday.toISOString().slice(5, 10);
    const endStr = currentSunday.toISOString().slice(5, 10);

    weeks.push({
      weekIndex: index,
      startDate: new Date(currentMonday),
      endDate: new Date(currentSunday),
      label: `W${index} (${startStr} - ${endStr})`,
    });

    currentMonday.setDate(currentMonday.getDate() + 7);
    index++;
  }

  return weeks;
}

/**
 * Calculates S-Curve multi-line aggregation:
 * - Target Timeline (planned, supports PM manual overrides)
 * - Claimed Progress (field progress)
 * - Verified Physical Progress (inspected milestones, with Zero-Tolerance punchlist gate)
 */
export function calculateSCurveData(params: {
  projectId: string;
  projectName: string;
  nodes: WorkNode[];
  weeks: CalendarWeekInterval[];
  overrides?: PlannedCurveOverride[];
  hasPunchlistOpenMap?: Map<string, boolean>; // nodeId -> has open punchlists
  asOfDate?: Date;
}): SCurveSummary {
  const {
    projectId,
    projectName,
    nodes,
    weeks,
    overrides = [],
    hasPunchlistOpenMap = new Map(),
    asOfDate = new Date(),
  } = params;

  // Build override map: weekIndex -> overridePlannedCumulative
  const overrideMap = new Map<number, number>();
  for (const ov of overrides) {
    overrideMap.set(ov.weekIndex, Number(ov.overridePlannedCumulative));
  }

  const totalProjectWeight = nodes
    .filter((n) => !n.parentId)
    .reduce((acc, n) => acc + (Number(n.weightPercent) || 0), 0) || 100;

  const points: SCurveWeekPoint[] = [];
  let prevTargetCum = 0;
  let prevClaimedCum = 0;
  let prevVerifiedCum = 0;

  // Find leaf nodes (nodes with no children) for accurate progress distribution
  const parentIds = new Set(nodes.map((n) => n.parentId).filter(Boolean));
  const leafNodes = nodes.filter((n) => !parentIds.has(n.id));

  // Determine current week index
  const asOfTime = asOfDate.getTime();
  let currentWeekIndex = 1;

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    const isCurrentOrPast = w.startDate.getTime() <= asOfTime;
    if (isCurrentOrPast) {
      currentWeekIndex = w.weekIndex;
    }

    // 1. Calculate Target Planned Cumulative
    let targetCum = 0;
    const isOverridden = overrideMap.has(w.weekIndex);

    if (isOverridden) {
      targetCum = Math.min(100, Math.max(0, overrideMap.get(w.weekIndex)!));
    } else {
      // Standard linear S-Curve distribution across planned start and end dates
      let accumulatedWeight = 0;
      for (const node of leafNodes) {
        const weight = Number(node.weightPercent) || 0;
        const pStart = node.plannedStartDate ? new Date(node.plannedStartDate).getTime() : weeks[0].startDate.getTime();
        const pEnd = node.plannedEndDate ? new Date(node.plannedEndDate).getTime() : weeks[weeks.length - 1].endDate.getTime();

        if (w.endDate.getTime() >= pEnd) {
          accumulatedWeight += weight;
        } else if (w.endDate.getTime() > pStart && pEnd > pStart) {
          const ratio = (w.endDate.getTime() - pStart) / (pEnd - pStart);
          accumulatedWeight += weight * Math.min(1, Math.max(0, ratio));
        }
      }
      targetCum = Math.round((accumulatedWeight / totalProjectWeight) * 10000) / 100;
    }

    // 2. Calculate Claimed & Verified Progress for past/current weeks
    let claimedCum = 0;
    let verifiedCum = 0;

    if (isCurrentOrPast) {
      let totalClaimedWeighted = 0;
      let totalVerifiedWeighted = 0;

      for (const node of leafNodes) {
        const weight = Number(node.weightPercent) || 0;
        const claimed = node.claimedProgressPercent || 0;
        let verified = node.verifiedProgressPercent || 0;

        // Zero-Tolerance Punchlist Lockout:
        // If node has open punchlist items, verified cannot reach 100%!
        const hasOpenPunchlist = hasPunchlistOpenMap.get(node.id);
        if (hasOpenPunchlist && verified >= 100) {
          verified = 99; // Capped at 99% until verified_closed
        }

        totalClaimedWeighted += (claimed * weight) / 100;
        totalVerifiedWeighted += (verified * weight) / 100;
      }

      // Pro-rate progression across elapsed weeks up to current
      const elapsedRatio = Math.min(1, (i + 1) / currentWeekIndex);
      claimedCum = Math.round(((totalClaimedWeighted / totalProjectWeight) * 100 * elapsedRatio) * 100) / 100;
      verifiedCum = Math.round(((totalVerifiedWeighted / totalProjectWeight) * 100 * elapsedRatio) * 100) / 100;
    } else {
      // Future weeks: maintain last recorded actuals for plateau visualization
      claimedCum = prevClaimedCum;
      verifiedCum = prevVerifiedCum;
    }

    // Ensure non-decreasing cumulative lines
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
      isOverridden,
    });

    prevTargetCum = targetCum;
    prevClaimedCum = claimedCum;
    prevVerifiedCum = verifiedCum;
  }

  const currentPoint = points[Math.min(currentWeekIndex - 1, points.length - 1)] || points[0];
  const currentVariance = currentPoint?.variance || 0;
  const status: 'ahead' | 'on_track' | 'delayed' =
    currentVariance > 1 ? 'ahead' : currentVariance < -2 ? 'delayed' : 'on_track';

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
    totalHoldPoints: 0,
    activeHoldPoints: 0,
    points,
  };
}

/**
 * Calculates Bottleneck Radar SLA Aging metrics:
 * Δt = t_now - t_submitted
 * - normal: <24h
 * - warning: 24h - 48h
 * - critical: >48h
 */
export function calculateBottleneckAging(
  pendingStages: Array<{
    stage: WorkStage;
    wbsCode: string;
    nodeName: string;
    attempt: InspectionAttempt;
    submitterName: string;
  }>,
  now = new Date()
): BottleneckItem[] {
  const result: BottleneckItem[] = [];

  for (const item of pendingStages) {
    // Blueprint Tahap 2c: SLA aging is measured from requestedAt if available, otherwise submittedAt
    const baselineDate = item.attempt.requestedAt || item.attempt.submittedAt;
    const submittedTime = new Date(baselineDate).getTime();
    const nowTime = now.getTime();
    const diffMs = Math.max(0, nowTime - submittedTime);
    const waitingHours = Math.round((diffMs / (1000 * 60 * 60)) * 10) / 10;

    let status: 'normal' | 'warning' | 'critical' = 'normal';
    if (waitingHours > 48) {
      status = 'critical';
    } else if (waitingHours >= 24) {
      status = 'warning';
    }

    const scheduleImpactDays = waitingHours > 24 ? Math.round(((waitingHours - 24) / 24) * 10) / 10 : 0;

    result.push({
      stageId: item.stage.id,
      stageName: item.stage.name,
      stageType: item.stage.stageType,
      wbsCode: item.wbsCode,
      nodeName: item.nodeName,
      attemptNumber: item.attempt.attemptNumber,
      submitterName: item.submitterName,
      requestedAt: item.attempt.requestedAt,
      submittedAt: item.attempt.submittedAt,
      stageStatus: item.stage.status,
      approvalRole: item.stage.approvalRole || 'QA/QC Lead / Owner Inspector',
      waitingHours,
      status,
      scheduleImpactDays,
    });
  }

  // Sort: critical bottlenecks first, then descending by waitingHours
  return result.sort((a, b) => {
    if (a.status === 'critical' && b.status !== 'critical') return -1;
    if (b.status === 'critical' && a.status !== 'critical') return 1;
    return b.waitingHours - a.waitingHours;
  });
}

/**
 * Aggregates Daily Weather Logs and computes Extension of Time (EOT) claim impact.
 */
export function calculateWeatherEotImpact(logs: DailyWeatherLog[]): {
  totalRainDays: number;
  totalRainHours: number;
  stopTotalDays: number;
  partialDays: number;
  recommendedEotDays: number;
} {
  let totalRainDays = 0;
  let totalRainHours = 0;
  let stopTotalDays = 0;
  let partialDays = 0;

  for (const log of logs) {
    const rainHours = Number(log.rainHours) || 0;
    if (rainHours > 0 || log.weatherCondition === 'hujan_lebat' || log.weatherCondition === 'badai') {
      totalRainDays++;
      totalRainHours += rainHours;
    }

    if (log.workImpact === 'stop_total') {
      stopTotalDays += 1;
    } else if (log.workImpact === 'parsial') {
      partialDays += 1;
    }
  }

  // Recommended EOT formula standard in Indonesian FIDIC / LPJK contracts:
  // EOT Days = (1.0 * stop_total days) + (0.5 * partial stoppage days with significant rain)
  const recommendedEotDays = Math.round((stopTotalDays + partialDays * 0.5) * 10) / 10;

  return {
    totalRainDays,
    totalRainHours: Math.round(totalRainHours * 10) / 10,
    stopTotalDays,
    partialDays,
    recommendedEotDays,
  };
}
