import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMondayOfWeek,
  getSundayOfWeek,
  generateProjectCalendarWeeks,
  calculateSCurveData,
  calculateBottleneckAging,
  calculateWeatherEotImpact,
} from '../src/utils/scurve';
import type { WorkNode, WorkStage, InspectionAttempt, DailyWeatherLog } from '../src/types';

test('S-Curve Engine: calendar week cycle strictly aligns Monday 00:00 to Sunday 23:59', () => {
  // 2026-01-07 is Wednesday
  const sampleWednesday = new Date('2026-01-07T14:30:00Z');
  const monday = getMondayOfWeek(sampleWednesday);
  const sunday = getSundayOfWeek(sampleWednesday);

  assert.equal(monday.getDay(), 1); // Monday
  assert.equal(monday.getHours(), 0);
  assert.equal(monday.getMinutes(), 0);

  assert.equal(sunday.getDay(), 0); // Sunday
  assert.equal(sunday.getHours(), 23);
  assert.equal(sunday.getMinutes(), 59);

  // Generate 4 weeks from 2026-01-05 to 2026-01-31
  const weeks = generateProjectCalendarWeeks('2026-01-05', '2026-01-31');
  assert.equal(weeks.length, 4);
  assert.equal(weeks[0].label.startsWith('W1'), true);
  assert.equal(weeks[3].label.startsWith('W4'), true);
});

test('S-Curve Engine: calculates multi-line curves and PM manual override', () => {
  const nodes: WorkNode[] = [
    {
      id: 'node-1',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '1.0',
      name: 'Engineering',
      weightPercent: 30,
      claimedProgressPercent: 100,
      verifiedProgressPercent: 100,
      plannedStartDate: '2026-01-05',
      plannedEndDate: '2026-01-18', // 2 weeks
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-2',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '2.0',
      name: 'Procurement',
      weightPercent: 70,
      claimedProgressPercent: 50,
      verifiedProgressPercent: 40,
      plannedStartDate: '2026-01-19',
      plannedEndDate: '2026-02-01', // 2 weeks
      sortOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const weeks = generateProjectCalendarWeeks('2026-01-05', '2026-02-01'); // 4 weeks

  // Without override
  const result = calculateSCurveData({
    projectId: 'prj-101',
    projectName: 'Bontang LNG Terminal',
    nodes,
    weeks,
    asOfDate: new Date('2026-01-22'),
  });

  assert.equal(result.totalWeeks, 4);
  assert.equal(result.points.length, 4);
  assert.equal(result.points[0].targetCumulative > 0, true);
  assert.equal(result.points[3].targetCumulative, 100);

  // With PM manual override on Week 2 to 45.00%
  const resultWithOverride = calculateSCurveData({
    projectId: 'prj-101',
    projectName: 'Bontang LNG Terminal',
    nodes,
    weeks,
    overrides: [
      {
        id: 'ov-1',
        projectId: 'prj-101',
        weekIndex: 2,
        overridePlannedCumulative: 45,
        overriddenBy: 'usr-admin',
        reason: 'Client accelerated schedule directive',
        createdAt: '2026-01-10',
      },
    ],
    asOfDate: new Date('2026-01-22'),
  });

  assert.equal(resultWithOverride.points[1].isOverridden, true);
  assert.equal(resultWithOverride.points[1].targetCumulative, 45);
});

test('S-Curve Engine: Zero-Tolerance Punchlist Lockout caps node verified progress at 99%', () => {
  const nodes: WorkNode[] = [
    {
      id: 'node-substructure',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '2.1',
      name: 'Substructure Piling',
      weightPercent: 100,
      claimedProgressPercent: 100,
      verifiedProgressPercent: 100, // Contractor claims 100%
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const weeks = generateProjectCalendarWeeks('2026-01-05', '2026-01-18');

  // Case 1: Has OPEN punchlist item
  const openPunchlistMap = new Map<string, boolean>();
  openPunchlistMap.set('node-substructure', true); // Open defect exists!

  const resultBlocked = calculateSCurveData({
    projectId: 'prj-101',
    projectName: 'Test Site',
    nodes,
    weeks,
    hasPunchlistOpenMap: openPunchlistMap,
    asOfDate: new Date('2026-01-18'),
  });

  // Verified progress is capped at 99% because of open defect!
  assert.equal(resultBlocked.currentVerifiedPercent, 99);

  // Case 2: Once defect is verified_closed (openPunchlistMap has false)
  openPunchlistMap.set('node-substructure', false);
  const resultClean = calculateSCurveData({
    projectId: 'prj-101',
    projectName: 'Test Site',
    nodes,
    weeks,
    hasPunchlistOpenMap: openPunchlistMap,
    asOfDate: new Date('2026-01-18'),
  });

  assert.equal(resultClean.currentVerifiedPercent, 100);
});

test('Bottleneck Radar: calculates SLA aging and flags normal, warning, and critical bottlenecks', () => {
  const now = new Date('2026-01-10T12:00:00Z');

  const pendingItems: Array<{
    stage: WorkStage;
    wbsCode: string;
    nodeName: string;
    attempt: InspectionAttempt;
    submitterName: string;
  }> = [
    {
      stage: {
        id: 'stg-1',
        workflowId: 'wf-1',
        stageOrder: 1,
        stageType: 'hold',
        name: 'Hydrotest Inspection',
        assignedRole: 'Field / QC Inspector',
        approvalRole: 'QA/QC Lead / Owner Inspector',
        requiresWetSignature: true,
        status: 'submitted',
        createdAt: '2026-01-01',
      },
      wbsCode: '3.1',
      nodeName: 'Piping Section A',
      attempt: {
        id: 'att-1',
        stageId: 'stg-1',
        attemptNumber: 1,
        submitterId: 'usr-1',
        submittedAt: new Date('2026-01-08T08:00:00Z'), // ~52 hours waiting -> CRITICAL (>48h)
        status: 'submitted',
        answers: {},
        createdAt: '2026-01-08',
      },
      submitterName: 'Budi Inspector',
    },
    {
      stage: {
        id: 'stg-2',
        workflowId: 'wf-2',
        stageOrder: 2,
        stageType: 'work',
        name: 'Cable Pulling Inspection',
        assignedRole: 'Field / QC Inspector',
        approvalRole: 'Project / Site Engineer',
        requiresWetSignature: false,
        status: 'submitted',
        createdAt: '2026-01-01',
      },
      wbsCode: '4.2',
      nodeName: 'Electrical Substation',
      attempt: {
        id: 'att-2',
        stageId: 'stg-2',
        attemptNumber: 1,
        submitterId: 'usr-2',
        submittedAt: new Date('2026-01-09T08:00:00Z'), // ~28 hours waiting -> WARNING (24-48h)
        status: 'submitted',
        answers: {},
        createdAt: '2026-01-09',
      },
      submitterName: 'Rian Site Eng',
    },
    {
      stage: {
        id: 'stg-3',
        workflowId: 'wf-3',
        stageOrder: 1,
        stageType: 'review',
        name: 'Pre-Pour Rebar Check',
        assignedRole: 'Field / QC Inspector',
        approvalRole: 'QA/QC Lead / Owner Inspector',
        requiresWetSignature: false,
        status: 'submitted',
        createdAt: '2026-01-01',
      },
      wbsCode: '2.2',
      nodeName: 'Column Pouring',
      attempt: {
        id: 'att-3',
        stageId: 'stg-3',
        attemptNumber: 1,
        submitterId: 'usr-3',
        submittedAt: new Date('2026-01-10T06:00:00Z'), // ~6 hours waiting -> NORMAL (<24h)
        status: 'submitted',
        answers: {},
        createdAt: '2026-01-10',
      },
      submitterName: 'Agus QC',
    },
  ];

  const radar = calculateBottleneckAging(pendingItems, now);
  assert.equal(radar.length, 3);

  // Critical item sorted to top
  assert.equal(radar[0].stageName, 'Hydrotest Inspection');
  assert.equal(radar[0].status, 'critical');
  assert.equal(radar[0].waitingHours > 48, true);

  // Warning item
  assert.equal(radar[1].stageName, 'Cable Pulling Inspection');
  assert.equal(radar[1].status, 'warning');

  // Normal item
  assert.equal(radar[2].stageName, 'Pre-Pour Rebar Check');
  assert.equal(radar[2].status, 'normal');
});

test('Weather & Rain Log: aggregates rain hours and calculates recommended EOT claim days', () => {
  const sampleLogs: DailyWeatherLog[] = [
    {
      id: 'w-1',
      projectId: 'prj-101',
      logDate: '2026-01-05',
      weatherCondition: 'hujan_lebat',
      rainHours: 6.5,
      workImpact: 'stop_total', // Full stoppage day
      notes: 'Hujan deras disertai angin kencang menghentikan pekerjaan crane',
      recordedBy: 'usr-admin',
      createdAt: '2026-01-05',
    },
    {
      id: 'w-2',
      projectId: 'prj-101',
      logDate: '2026-01-06',
      weatherCondition: 'hujan_ringan',
      rainHours: 4.0,
      workImpact: 'parsial', // Partial stoppage day (counts as 0.5 day)
      notes: 'Pekerjaan luar ruangan ditunda sebagian',
      recordedBy: 'usr-admin',
      createdAt: '2026-01-06',
    },
    {
      id: 'w-3',
      projectId: 'prj-101',
      logDate: '2026-01-07',
      weatherCondition: 'cerah',
      rainHours: 0,
      workImpact: 'tidak_ada',
      notes: 'Cerah, operasional normal',
      recordedBy: 'usr-admin',
      createdAt: '2026-01-07',
    },
  ];

  const impact = calculateWeatherEotImpact(sampleLogs);
  assert.equal(impact.totalRainDays, 2);
  assert.equal(impact.totalRainHours, 10.5);
  assert.equal(impact.stopTotalDays, 1);
  assert.equal(impact.partialDays, 1);
  // EOT = 1.0 (stop_total) + 0.5 (parsial) = 1.5 days
  assert.equal(impact.recommendedEotDays, 1.5);
});
