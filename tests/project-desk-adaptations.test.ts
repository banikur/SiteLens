import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeCsvCell, isSafeHttpUrl } from '../src/utils/sanitize.ts';
import { parseTanggalansHtml } from '../src/server/services/holidayService.ts';
import {
  calculateWorkingHoursBetween,
  classifyActivityDayType,
  calculateBottleneckAging,
  generateProjectCalendarWeeks,
  calculateSCurveData,
} from '../src/utils/scurve.ts';
import { computeWbsCriticalPath } from '../src/utils/wbs.ts';
import type { WorkNode, WorkStage, InspectionAttempt } from '../src/types/index.ts';

describe('Project Desk Adaptations', () => {
  it('escapes CSV formula injection while preserving valid negative numbers', () => {
    assert.equal(escapeCsvCell('=CMD("calc")'), `"'=CMD(""calc"")"`);
    assert.equal(escapeCsvCell('+1+1'), `"' +1+1"`.replace(' ', ''));
    assert.equal(escapeCsvCell('@SUM(A1)'), `"'@SUM(A1)"`);
    assert.equal(escapeCsvCell('-12.5%'), `"-12.5%"`);
    assert.equal(escapeCsvCell('Normal "Text"'), `"Normal ""Text"""`);
  });

  it('validates http/https URLs strictly', () => {
    assert.equal(isSafeHttpUrl('https://drive.google.com/file/d/123'), true);
    assert.equal(isSafeHttpUrl('http://intranet.local/doc.pdf'), true);
    assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
    assert.equal(isSafeHttpUrl('data:text/html,<script>'), false);
    assert.equal(isSafeHttpUrl(''), false);
  });

  it('parses national holidays from tanggalans.com HTML structure', () => {
    const sampleHtml = `
      <div class="kalender-indo">
        <div class="kal-title"><a class="kal-title-link">Januari 2026</a></div>
        <ul class="kal-libur-list">
          <li><div class="kal-libur-day">1</div> Tahun Baru 2026</li>
          <li><div class="kal-libur-day">16-17</div> Isra Miraj</li>
        </ul>
      </div>
    `;
    const holidays = parseTanggalansHtml(sampleHtml, 2026);
    assert.equal(holidays.length, 3);
    assert.deepEqual(holidays[0], { holidayDate: '2026-01-01', name: 'Tahun Baru 2026', year: 2026 });
    assert.equal(holidays[2].holidayDate, '2026-01-17');
  });

  it('computes SLA working hours respecting 08:00-17:00, weekends, and holidays', () => {
    const holidays = new Set(['2026-11-26']);
    const start = new Date(2026, 10, 25, 15, 0, 0); // Wed 15:00
    const end = new Date(2026, 10, 27, 10, 0, 0);   // Fri 10:00 (Thu 26 is holiday)

    const hours = calculateWorkingHoursBetween(
      start,
      end,
      {
        workStartHour: '08:00',
        workEndHour: '17:00',
        saturdayMode: 'non_working',
        sundayMode: 'non_working',
        holidayOverrides: {},
      },
      holidays
    );
    // Wed 15:00-17:00 (2h) + Thu holiday (0h) + Fri 08:00-10:00 (2h) = 4h
    assert.equal(hours, 4);
    assert.equal(classifyActivityDayType(new Date(2026, 10, 26, 10, 0), undefined, holidays), 'holiday');
    assert.equal(classifyActivityDayType(new Date(2026, 10, 28, 10, 0), undefined, holidays), 'weekend');
  });

  it('applies selective pause and critical path priority in calculateBottleneckAging', () => {
    const stage1: WorkStage = {
      id: 's1',
      workflowId: 'wf1',
      stageOrder: 1,
      stageType: 'hold',
      name: 'Pouring Approval',
      assignedRole: 'Project / Site Engineer',
      requiresWetSignature: false,
      status: 'submitted',
      createdAt: '2026-11-20T08:00:00Z',
    };
    const stage2: WorkStage = {
      ...stage1,
      id: 's2',
      status: 'rejected',
    };
    const attempt1: InspectionAttempt = {
      id: 'a1',
      stageId: 's1',
      attemptNumber: 1,
      submitterId: 'u1',
      submittedAt: '2026-11-25T08:00:00Z',
      status: 'submitted',
      answers: {},
      createdAt: '2026-11-25T08:00:00Z',
    };
    const attempt2: InspectionAttempt = {
      ...attempt1,
      id: 'a2',
      stageId: 's2',
      status: 'rejected',
      decidedAt: '2026-11-25T10:00:00Z',
    };

    const items = calculateBottleneckAging(
      [
        { stage: stage2, nodeId: 'n2', wbsCode: '1.2', nodeName: 'Non-Critical', attempt: attempt2, submitterName: 'Budi' },
        { stage: stage1, nodeId: 'n1', wbsCode: '1.1', nodeName: 'Critical', attempt: attempt1, submitterName: 'Andi' },
      ],
      new Date('2026-11-27T12:00:00Z'),
      { criticalNodeIds: new Set(['n1']) }
    );

    assert.equal(items[0].stageId, 's1');
    assert.equal(items[0].isCriticalPath, true);
    assert.equal(items[1].isPaused, true);
    assert.equal(items[1].waitingHours, 2);
  });

  it('computes CPM critical path and detects dependency cycles', () => {
    const baseNode = (id: string, days: number, preds: Array<{ nodeId: string; lagDays?: number }> = []): WorkNode => ({
      id,
      projectId: 'p1',
      wbsCode: id,
      name: id,
      weightPercent: '50',
      plannedStartDate: '2026-11-01',
      plannedEndDate: new Date(new Date('2026-11-01').getTime() + days * 86400000).toISOString(),
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 1,
      predecessorIds: preds,
      createdAt: '',
      updatedAt: '',
    });

    const cpm = computeWbsCriticalPath([
      baseNode('A', 4),
      baseNode('B', 3, [{ nodeId: 'A' }]),
      baseNode('C', 1, [{ nodeId: 'A' }]),
    ]);
    assert.equal(cpm.hasCycle, false);
    assert.equal(cpm.criticalNodeIds.has('A'), true);
    assert.equal(cpm.criticalNodeIds.has('B'), true);
    assert.equal(cpm.criticalNodeIds.has('C'), false);
    assert.equal(cpm.scheduleMap['C'].totalFloat, 2);

    const cyclic = computeWbsCriticalPath([
      baseNode('X', 2, [{ nodeId: 'Y' }]),
      baseNode('Y', 2, [{ nodeId: 'X' }]),
    ]);
    assert.equal(cyclic.hasCycle, true);
  });

  it('computes SV, SPI, and todayWeekIndex in calculateSCurveData', () => {
    const weeks = generateProjectCalendarWeeks('2026-11-02', '2026-11-29');
    const nodes: WorkNode[] = [
      {
        id: 'n1',
        projectId: 'p1',
        wbsCode: '1.1',
        name: 'Task 1',
        weightPercent: '100',
        plannedStartDate: '2026-11-02',
        plannedEndDate: '2026-11-29',
        claimedProgressPercent: 50,
        verifiedProgressPercent: 50,
        sortOrder: 1,
        createdAt: '',
        updatedAt: '',
      },
    ];
    const summary = calculateSCurveData({
      projectId: 'p1',
      projectName: 'Test',
      nodes,
      weeks,
      asOfDate: new Date('2026-11-16'),
    });
    assert.ok(typeof summary.scheduleVariance === 'number');
    assert.ok(typeof summary.schedulePerformanceIndex === 'number');
    assert.equal(summary.todayWeekIndex, summary.currentWeekIndex);
  });
});
