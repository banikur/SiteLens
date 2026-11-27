import type {
  WorkNode,
  PlannedCurveOverride,
  SCurveSummary,
  SCurveWeekPoint,
  BottleneckItem,
  DailyWeatherLog,
  WorkStage,
  InspectionAttempt,
  ProjectCalendar,
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
        // Provisional work (pending VO approval) is tracked in claimed, excluded from official verified
        let verified = node.provisionalStatus === 'pending_vo' ? 0 : (node.verifiedProgressPercent || 0);

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
  const currentPlannedPercent = currentPoint?.targetCumulative || 0;
  const currentVerifiedPercent = currentPoint?.verifiedCumulative || 0;
  const scheduleVariance = Math.round((currentVerifiedPercent - currentPlannedPercent) * 100) / 100;
  const schedulePerformanceIndex =
    currentPlannedPercent > 0
      ? Math.round((currentVerifiedPercent / currentPlannedPercent) * 100) / 100
      : 1;
  const status: 'ahead' | 'on_track' | 'delayed' =
    currentVariance > 1 ? 'ahead' : currentVariance < -2 ? 'delayed' : 'on_track';

  return {
    projectId,
    projectName,
    totalWeeks: weeks.length,
    currentWeekIndex,
    todayWeekIndex: currentWeekIndex,
    currentPlannedPercent,
    currentClaimedPercent: currentPoint?.claimedCumulative || 0,
    currentVerifiedPercent,
    currentVariance,
    scheduleVariance,
    schedulePerformanceIndex,
    status,
    totalHoldPoints: 0,
    activeHoldPoints: 0,
    points,
  };
}

function parseHourMinute(hhmm: string, fallbackMinutes: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallbackMinutes;
  return h * 60 + m;
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Classifies a date as workday, weekend, or holiday based on project calendar & national holidays.
 * Used for overtime/attendance tagging without altering S-Curve physical progress weights.
 */
export function classifyActivityDayType(
  dateInput: Date | string,
  calendar?: Pick<ProjectCalendar, 'saturdayMode' | 'sundayMode' | 'holidayOverrides'>,
  holidayDates?: Set<string>
): 'workday' | 'weekend' | 'holiday' {
  const d = new Date(dateInput);
  const key = toLocalDateKey(d);
  const override = calendar?.holidayOverrides?.[key];
  if (override === 'working') return 'workday';
  if (override === 'non_working' || holidayDates?.has(key)) return 'holiday';
  const dow = d.getDay();
  if (dow === 6 || dow === 0) return 'weekend';
  return 'workday';
}

/**
 * Computes effective SLA working hours between two timestamps using project working hours,
 * Saturday/Sunday mode, and national holidays (default 08:00-17:00 Mon-Fri).
 */
export function calculateWorkingHoursBetween(
  startInput: Date | string,
  endInput: Date | string,
  calendar?: Pick<ProjectCalendar, 'workStartHour' | 'workEndHour' | 'saturdayMode' | 'sundayMode' | 'holidayOverrides'>,
  holidayDates?: Set<string>
): number {
  const start = new Date(startInput);
  const end = new Date(endInput);
  if (end.getTime() <= start.getTime()) return 0;

  const startMin = parseHourMinute(calendar?.workStartHour || '08:00', 8 * 60);
  const endMin = parseHourMinute(calendar?.workEndHour || '17:00', 17 * 60);
  if (endMin <= startMin) return 0;

  let totalMs = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= endDay.getTime()) {
    const key = toLocalDateKey(cursor);
    const dow = cursor.getDay();
    const override = calendar?.holidayOverrides?.[key];

    let dayFraction = 1;
    if (override === 'non_working' || (override !== 'working' && holidayDates?.has(key))) {
      dayFraction = 0;
    } else if (override !== 'working') {
      const mode = dow === 6 ? (calendar?.saturdayMode || 'non_working') : dow === 0 ? (calendar?.sundayMode || 'non_working') : 'full_working';
      if (mode === 'non_working') dayFraction = 0;
      else if (mode === 'half_day') dayFraction = 0.5;
    }

    if (dayFraction > 0) {
      const windowEndMin = startMin + Math.round((endMin - startMin) * dayFraction);
      const dayStartMs = new Date(cursor).setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
      const dayEndMs = new Date(cursor).setHours(Math.floor(windowEndMin / 60), windowEndMin % 60, 0, 0);
      const overlapStart = Math.max(start.getTime(), dayStartMs);
      const overlapEnd = Math.min(end.getTime(), dayEndMs);
      if (overlapEnd > overlapStart) {
        totalMs += overlapEnd - overlapStart;
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return Math.round((totalMs / (1000 * 60 * 60)) * 10) / 10;
}

/**
 * Calculates Bottleneck Radar SLA Aging metrics:
 * - Supports project working calendar & national holidays when provided
 * - Selective pause when stageStatus === 'rejected' (waiting on requester revision)
 */
export function calculateBottleneckAging(
  pendingStages: Array<{
    stage: WorkStage;
    nodeId?: string;
    wbsCode: string;
    nodeName: string;
    attempt: InspectionAttempt;
    submitterName: string;
  }>,
  now = new Date(),
  options?: {
    calendar?: Pick<ProjectCalendar, 'workStartHour' | 'workEndHour' | 'saturdayMode' | 'sundayMode' | 'holidayOverrides'>;
    holidayDates?: Set<string>;
    criticalNodeIds?: Set<string>;
  }
): BottleneckItem[] {
  const result: BottleneckItem[] = [];

  for (const item of pendingStages) {
    const baselineDate = item.attempt.requestedAt || item.attempt.submittedAt;
    const isPaused = item.stage.status === 'rejected' || item.attempt.status === 'rejected';
    const effectiveEnd = isPaused && item.attempt.decidedAt ? new Date(item.attempt.decidedAt) : now;

    const waitingHours = options?.calendar
      ? calculateWorkingHoursBetween(baselineDate, effectiveEnd, options.calendar, options.holidayDates)
      : Math.round((Math.max(0, effectiveEnd.getTime() - new Date(baselineDate).getTime()) / (1000 * 60 * 60)) * 10) / 10;

    let status: 'normal' | 'warning' | 'critical' = 'normal';
    if (waitingHours > 48) {
      status = 'critical';
    } else if (waitingHours >= 24) {
      status = 'warning';
    }

    const scheduleImpactDays = waitingHours > 24 ? Math.round(((waitingHours - 24) / 24) * 10) / 10 : 0;
    const dayType = classifyActivityDayType(baselineDate, options?.calendar, options?.holidayDates);
    const isCriticalPath = item.nodeId ? Boolean(options?.criticalNodeIds?.has(item.nodeId)) : false;

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
      isPaused,
      isCriticalPath,
      dayType,
      status,
      scheduleImpactDays,
    });
  }

  return result.sort((a, b) => {
    if (a.isCriticalPath && !b.isCriticalPath) return -1;
    if (b.isCriticalPath && !a.isCriticalPath) return 1;
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
