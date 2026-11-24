/**
 * Tahap 3a: Server-Side WBS Roll-up & SSOT Kurva-S Riil Tests
 * Corresponds to RECONSTRUCTION_BLUEPRINT.md v2.3 Section 1339-1353 and Bagian A.1, A.6.
 *
 * Verifies:
 * 1. computeHierarchicalRollups correctly calculates multi-level weighted progress in memory.
 * 2. recalculateAndSaveNodeRollups updates ancestor parent nodes in the database.
 * 3. calculateSSOTSCurveData produces authentic step curve based on actual_completed_at milestone timestamps.
 * 4. Zero-Tolerance Punchlist Lockout caps verified progress at 99% for affected nodes.
 * 5. HTTP Integration: POST /stages/:stageId/review triggers automatic parent rollups and reflects in GET /projects/:projectId/scurve.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { eq } from 'drizzle-orm';

import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { getDb, closeDb } from '../src/server/db/index.ts';
import {
  users,
  projects,
  workNodes,
  workWorkflows,
  workStages,
  inspectionAttempts,
  punchlistItems,
} from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { computeHierarchicalRollups, recalculateAndSaveNodeRollups } from '../src/server/wbs.ts';
import { calculateSSOTSCurveData, computeLeafAttributions } from '../src/server/services/scurveEngine.ts';
import { generateProjectCalendarWeeks } from '../src/utils/scurve.ts';
import {
  ROLE_USER_MAP,
  PRJ_A_ID,
} from './fixtures/stage2a-matrix-fixtures.ts';
import { seedMatrixDatabase } from './fixtures/stage2a-db-seed.ts';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachSessionUser);
  app.use('/api', authRouter);
  app.use('/api', apiRouter);
  return app;
}

test('Tahap 3a: Server-Side WBS Roll-up & SSOT Kurva-S Riil', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();
  const db = getDb()!;

  await t.test('1. computeHierarchicalRollups computes multi-level weighted progress in memory', () => {
    // Structure:
    // Root: Total Project (weight 100)
    //   Parent A: Substructure (weight 40)
    //     Leaf A1: Excavation (weight 50, verified: 100%)
    //     Leaf A2: Foundation (weight 50, verified: 50%)
    //   Parent B: Superstructure (weight 60)
    //     Leaf B1: Columns (weight 100, verified: 0%)

    const testNodes = [
      { id: 'root', parentId: null, weightPercent: 100 },
      { id: 'pA', parentId: 'root', weightPercent: 40 },
      { id: 'pB', parentId: 'root', weightPercent: 60 },
      { id: 'leafA1', parentId: 'pA', weightPercent: 50, verifiedProgressPercent: 100, claimedProgressPercent: 100 },
      { id: 'leafA2', parentId: 'pA', weightPercent: 50, verifiedProgressPercent: 50, claimedProgressPercent: 70 },
      { id: 'leafB1', parentId: 'pB', weightPercent: 100, verifiedProgressPercent: 0, claimedProgressPercent: 20 },
    ];

    const rollups = computeHierarchicalRollups(testNodes);

    // Leaf nodes keep their own progress
    assert.equal(rollups.get('leafA1')?.verifiedProgressPercent, 100);
    assert.equal(rollups.get('leafA2')?.verifiedProgressPercent, 50);
    assert.equal(rollups.get('leafB1')?.verifiedProgressPercent, 0);

    // Parent A: (100 * 50 + 50 * 50) / 100 = 75% verified, (100 * 50 + 70 * 50) / 100 = 85% claimed
    assert.equal(rollups.get('pA')?.verifiedProgressPercent, 75);
    assert.equal(rollups.get('pA')?.claimedProgressPercent, 85);

    // Parent B: (0 * 100) / 100 = 0% verified, 20% claimed
    assert.equal(rollups.get('pB')?.verifiedProgressPercent, 0);
    assert.equal(rollups.get('pB')?.claimedProgressPercent, 20);

    // Root: (75 * 40 + 0 * 60) / 100 = 30% verified, (85 * 40 + 20 * 60) / 100 = 46% claimed
    assert.equal(rollups.get('root')?.verifiedProgressPercent, 30);
    assert.equal(rollups.get('root')?.claimedProgressPercent, 46);
  });

  await t.test('2. recalculateAndSaveNodeRollups updates ancestor parent nodes in database', async () => {
    // Create isolated test nodes under PRJ_A_ID
    const [pNode] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        parentId: null,
        wbsCode: '3A.1',
        name: 'Parent Structure Test',
        weightPercent: '100.00',
        verifiedProgressPercent: 0,
        claimedProgressPercent: 0,
      })
      .returning();

    const [child1] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        parentId: pNode.id,
        wbsCode: '3A.1.1',
        name: 'Child Leaf 1',
        weightPercent: '60.00',
        verifiedProgressPercent: 100,
        claimedProgressPercent: 100,
      })
      .returning();

    const [child2] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        parentId: pNode.id,
        wbsCode: '3A.1.2',
        name: 'Child Leaf 2',
        weightPercent: '40.00',
        verifiedProgressPercent: 50,
        claimedProgressPercent: 50,
      })
      .returning();

    // Run database recalculation
    const res = await recalculateAndSaveNodeRollups(db, PRJ_A_ID);
    assert.ok(res.updatedCount >= 1, 'At least 1 parent node should be updated');

    // Query parent node from database
    const [updatedParent] = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.id, pNode.id));

    // (100 * 60 + 50 * 40) / 100 = 80%
    assert.equal(Number(updatedParent.verifiedProgressPercent), 80);
    assert.equal(Number(updatedParent.claimedProgressPercent), 80);

    // Clean up test nodes
    await db.delete(workNodes).where(eq(workNodes.id, child1.id));
    await db.delete(workNodes).where(eq(workNodes.id, child2.id));
    await db.delete(workNodes).where(eq(workNodes.id, pNode.id));
  });

  await t.test('3. calculateSSOTSCurveData produces authentic step curve based on milestone dates', () => {
    // 4 calendar weeks
    const weeks = generateProjectCalendarWeeks(
      new Date('2026-01-05T00:00:00Z'), // Monday W1
      new Date('2026-01-26T00:00:00Z')  // W4
    );
    assert.equal(weeks.length, 4, 'Should generate 4 weeks');

    // Project with 2 leaf tasks (each 50% absolute weight)
    const nodes = [
      { id: 'node-A', parentId: null, wbsCode: '1.0', name: 'Task A', weightPercent: '50.00' },
      { id: 'node-B', parentId: null, wbsCode: '2.0', name: 'Task B', weightPercent: '50.00' },
    ];

    const workflows = [
      { id: 'wf-A', nodeId: 'node-A' },
      { id: 'wf-B', nodeId: 'node-B' },
    ];

    // Stage A completed in W2 (e.g. 2026-01-14)
    // Stage B completed in W3 (e.g. 2026-01-21)
    const stages = [
      {
        id: 'stg-A',
        workflowId: 'wf-A',
        status: 'approved',
        actualCompletedAt: new Date('2026-01-14T10:00:00Z'),
      },
      {
        id: 'stg-B',
        workflowId: 'wf-B',
        status: 'approved',
        actualCompletedAt: new Date('2026-01-21T14:00:00Z'),
      },
    ];

    // Evaluate as of end of W4
    const asOfDate = new Date('2026-02-01T00:00:00Z');

    const scurve = calculateSSOTSCurveData({
      projectId: 'prj-test',
      projectName: 'Test Project',
      nodes,
      weeks,
      stages,
      workflows,
      asOfDate,
    });

    const pts = scurve.points;
    assert.equal(pts.length, 4);

    // Week 1 (Jan 5 - Jan 11): No stages approved yet -> verified MUST BE 0% (NO linear smearing!)
    assert.equal(pts[0].verifiedCumulative, 0, 'W1 verified should be 0%');

    // Week 2 (Jan 12 - Jan 18): Stage A approved (50% project weight) -> verified MUST BE 50%
    assert.equal(pts[1].verifiedCumulative, 50, 'W2 verified should step up to 50%');
    assert.equal(pts[1].verifiedIncremental, 50, 'W2 increment should be 50%');

    // Week 3 (Jan 19 - Jan 25): Stage B approved (50% project weight) -> verified MUST BE 100%
    assert.equal(pts[2].verifiedCumulative, 100, 'W3 verified should step up to 100%');
    assert.equal(pts[2].verifiedIncremental, 50, 'W3 increment should be 50%');

    // Week 4 (Jan 26 - Feb 1): Remains 100%
    assert.equal(pts[3].verifiedCumulative, 100, 'W4 verified should remain 100%');
    assert.equal(pts[3].verifiedIncremental, 0, 'W4 increment should be 0%');
  });

  await t.test('4. Zero-Tolerance Punchlist Gate caps verified progress at 99%', () => {
    const weeks = generateProjectCalendarWeeks(
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-01-12T00:00:00Z')
    );

    const nodes = [
      { id: 'node-punched', parentId: null, wbsCode: '1.0', name: 'Punchlist Task', weightPercent: '100.00' },
    ];
    const workflows = [{ id: 'wf-p', nodeId: 'node-punched' }];
    const stages = [
      {
        id: 'stg-p',
        workflowId: 'wf-p',
        status: 'approved',
        actualCompletedAt: new Date('2026-01-06T10:00:00Z'),
      },
    ];

    const openPunchlistMap = new Map<string, boolean>();
    openPunchlistMap.set('node-punched', true); // Open critical finding

    const scurve = calculateSSOTSCurveData({
      projectId: 'prj-test',
      projectName: 'Test Project',
      nodes,
      weeks,
      stages,
      workflows,
      hasPunchlistOpenMap: openPunchlistMap,
      asOfDate: new Date('2026-01-10T00:00:00Z'),
    });

    // 100% stage approved, but punchlist open -> capped at 99%!
    assert.equal(scurve.points[0].verifiedCumulative, 99, 'Must be locked out at 99% due to open defect');
  });

  await t.test('5. HTTP Integration: Stage review triggers parent rollup and reflects in GET /scurve', async () => {
    const app = createTestApp();
    const qaqcUser = ROLE_USER_MAP['qaqc_lead'];
    const qaqcSession = qaqcUser.token;

    // 1. Create a parent node and child node in PRJ_A_ID
    const [pNode] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        parentId: null,
        wbsCode: 'HTTP.3A',
        name: 'HTTP Parent WBS',
        weightPercent: '100.00',
        verifiedProgressPercent: 0,
        claimedProgressPercent: 0,
        plannedStartDate: new Date('2026-01-01T00:00:00Z'),
        plannedEndDate: new Date('2026-03-31T00:00:00Z'),
      })
      .returning();

    const [cNode] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        parentId: pNode.id,
        wbsCode: 'HTTP.3A.1',
        name: 'HTTP Child Leaf',
        weightPercent: '100.00',
        verifiedProgressPercent: 0,
        claimedProgressPercent: 0,
        plannedStartDate: new Date('2026-01-01T00:00:00Z'),
        plannedEndDate: new Date('2026-03-31T00:00:00Z'),
      })
      .returning();

    // 2. Attach workflow & stage to child leaf
    const [wf] = await db
      .insert(workWorkflows)
      .values({
        nodeId: cNode.id,
        title: 'HTTP Test Workflow',
      })
      .returning();

    const [stg] = await db
      .insert(workStages)
      .values({
        workflowId: wf.id,
        stageOrder: 1,
        stageType: 'work',
        name: 'Inspection Hold Stage',
        assignedRole: 'Field / QC Inspector',
        approvalRole: 'QA/QC Lead / Owner Inspector',
        status: 'submitted',
      })
      .returning();

    // Create submitted attempt submitted by site engineer
    const siteEngUser = ROLE_USER_MAP['site_engineer'];
    await db.insert(inspectionAttempts).values({
      stageId: stg.id,
      attemptNumber: 1,
      submitterId: siteEngUser.id,
      requesterId: siteEngUser.id,
      status: 'submitted',
    });

    // 3. QA/QC approves stage via HTTP POST /api/stages/:id/review
    const reviewRes = await supertest(app)
      .post(`/api/stages/${stg.id}/review`)
      .set('Cookie', [`sitelens_session=${qaqcSession}`])
      .send({
        decision: 'approved',
        notes: 'Verified compliance on site.',
      });

    assert.equal(reviewRes.status, 200, 'Stage review should succeed with 200');
    assert.equal(reviewRes.body.stage.status, 'approved');

    // 4. Verify parent node in database received rolled-up verifiedProgressPercent = 100
    const [freshParent] = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.id, pNode.id));

    assert.equal(Number(freshParent.verifiedProgressPercent), 100, 'Parent node must roll up to 100% in DB');

    // 5. Query S-Curve via HTTP GET /api/projects/:id/scurve
    const scurveRes = await supertest(app)
      .get(`/api/projects/${PRJ_A_ID}/scurve`)
      .set('Cookie', [`sitelens_session=${qaqcSession}`]);

    assert.equal(scurveRes.status, 200);
    assert.ok(scurveRes.body.scurve, 'Should return scurve object');
    assert.ok(Array.isArray(scurveRes.body.scurve.points), 'Points should be an array');
    assert.ok(scurveRes.body.scurve.points.length > 0, 'Points should have intervals');

    // Clean up test data
    await db.delete(workStages).where(eq(workStages.id, stg.id));
    await db.delete(workWorkflows).where(eq(workWorkflows.id, wf.id));
    await db.delete(workNodes).where(eq(workNodes.id, cNode.id));
    await db.delete(workNodes).where(eq(workNodes.id, pNode.id));
  });

  await closeDb();
});
