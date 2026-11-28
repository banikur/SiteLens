/**
 * Tahap 5: Konsolidasi CAPA 99% Lockout & Drop punchlist_items Tests
 * Corresponds to RECONSTRUCTION_BLUEPRINT.md v2.3 Section 1394-1408.
 *
 * Verifies:
 * 1. POST /api/actions creates CAPA linked to a WBS node (node_id) and returns nodeId.
 * 2. GET /api/actions?nodeId=:nodeId filters findings strictly by WBS node.
 * 3. Open critical or high CAPA linked to a WBS node locks out verified progress at 99.00%.
 * 4. Resolving the CAPA (status 'CLOSED' with resolvedAt) unlocks the 99% gate, allowing 100.00% verified progress.
 * 5. Historical weekly S-Curve reconstruction accurately reflects creation and resolution dates.
 * 6. Findings with severity 'medium' or 'low' do NOT trigger the 99% lockout.
 * 7. Non-WBS findings (node_id = NULL) do not lock out any WBS nodes.
 * 8. punchlist_items table is completely dropped from schema and database.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { eq } from 'drizzle-orm';

import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { getDb } from '../src/server/db/index.ts';
import {
  users,
  projects,
  workNodes,
  workWorkflows,
  workStages,
  correctiveActions,
  roleAssignments,
} from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { calculateSSOTSCurveData } from '../src/server/services/scurveEngine.ts';
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

test('Tahap 5: Konsolidasi CAPA 99% Lockout & Drop punchlist_items', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();
  const db = getDb()!;
  const app = createTestApp();

  const qaqcUser = ROLE_USER_MAP['qaqc_lead'];
  const siteEngUser = ROLE_USER_MAP['site_engineer'];

  // Create dedicated project for isolated S-Curve 99% vs 100% lockout assertions
  const dedicatedProjectId = crypto.randomUUID();
  await db.insert(projects).values({
    id: dedicatedProjectId,
    name: 'Dedicated CAPA Test Project',
    client: 'QA Corp',
    leadManager: 'Site Lead',
    location: 'Jakarta',
    code: 'PRJ-CAPA-DEDICATED',
    status: 'active',
    capaLockoutSeverities: ['critical', 'high'],
  });

  await db.insert(roleAssignments).values([
    {
      userId: siteEngUser.id,
      roleId: 'site_engineer',
      scopeType: 'project',
      projectId: dedicatedProjectId as any,
      isActive: true,
    },
    {
      userId: qaqcUser.id,
      roleId: 'qaqc_lead',
      scopeType: 'project',
      projectId: dedicatedProjectId as any,
      isActive: true,
    },
  ]);

  // Create dedicated WBS test node for CAPA tests
  const testNodeId = crypto.randomUUID();
  await db.insert(workNodes).values({
    id: testNodeId,
    projectId: dedicatedProjectId,
    parentId: null,
    wbsCode: '5.0',
    name: 'Pekerjaan Pier Cap P20 (CAPA Test Node)',
    weightPercent: '100.00',
    claimedProgressPercent: 100,
    verifiedProgressPercent: 100,
    allowDetailing: false,
    detailingStatus: 'active',
  });

  const testWorkflowId = crypto.randomUUID();
  await db.insert(workWorkflows).values({
    id: testWorkflowId,
    nodeId: testNodeId,
    title: 'Pier Cap Quality Workflow',
  });

  const testStageId = crypto.randomUUID();
  await db.insert(workStages).values({
    id: testStageId,
    workflowId: testWorkflowId,
    stageOrder: 1,
    stageType: 'work',
    name: 'Pengecoran Beton Pier Cap P20',
    assignedRole: 'Project / Site Engineer',
    status: 'approved',
    actualCompletedAt: new Date('2026-01-10T10:00:00Z'),
  });

  await t.test('1. POST /api/actions creates CAPA linked to a WBS node (node_id)', async () => {
    const res = await supertest(app)
      .post('/api/actions')
      .set('Cookie', `sitelens_session=${siteEngUser.token}`)
      .send({
        nodeId: testNodeId,
        projectId: dedicatedProjectId,
        fieldLabel: 'Keropos Beton Selimut Pier Cap P20',
        issueDescription: 'Ditemukan sarang kerikil / honeycomb pada sisi barat pier cap.',
        severity: 'critical',
        siteZone: 'Pier 20',
        assignedToName: 'Subkon Struktur Bawah',
        assignedToRole: 'Mandor Pembesian',
        dueDate: '2026-01-20',
      });

    assert.equal(res.status, 201, `Expected 201 Created, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.action.nodeId, testNodeId);
    assert.equal(res.body.action.severity, 'critical');
    assert.equal(res.body.action.status, 'OPEN');

    // Verify persisted in PostgreSQL
    const [savedInDb] = await db
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.id, res.body.action.id))
      .limit(1);

    assert.notEqual(savedInDb, undefined);
    assert.equal(savedInDb.nodeId, testNodeId);
  });

  await t.test('2. GET /api/actions?nodeId=:nodeId filters findings strictly by WBS node', async () => {
    const res = await supertest(app)
      .get(`/api/actions?nodeId=${testNodeId}`)
      .set('Cookie', `sitelens_session=${siteEngUser.token}`);

    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.body.actions), true);
    assert.equal(res.body.actions.length >= 1, true);
    for (const a of res.body.actions) {
      assert.equal(a.nodeId, testNodeId);
    }
  });

  await t.test('3. Open critical CAPA on WBS node locks out verified progress at 99.00% in S-Curve', async () => {
    const res = await supertest(app)
      .get(`/api/projects/${dedicatedProjectId}/scurve`)
      .set('Cookie', `sitelens_session=${siteEngUser.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.scurve.currentVerifiedPercent, 99.00, 'Must be locked at 99% due to open critical CAPA');
  });

  await t.test('4. Direct scurveEngine unit test: open critical/high CAPA locks node at 99%', () => {
    const weeks = generateProjectCalendarWeeks(
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-01-12T00:00:00Z')
    );

    const nodes = [
      { id: 'node-test-capa', parentId: null, wbsCode: '1.0', name: 'Superstructure Deck', weightPercent: '100.00' },
    ];
    const workflows = [{ id: 'wf-test', nodeId: 'node-test-capa' }];
    const stages = [
      {
        id: 'stg-test',
        workflowId: 'wf-test',
        status: 'approved',
        actualCompletedAt: new Date('2026-01-08T00:00:00Z'),
      },
    ];

    const capaItems = [
      {
        id: 'capa-critical-1',
        nodeId: 'node-test-capa',
        severity: 'critical',
        status: 'OPEN',
        createdAt: new Date('2026-01-06T00:00:00Z'),
        resolvedAt: null,
      },
    ];

    const scurve = calculateSSOTSCurveData({
      projectId: 'prj-test',
      projectName: 'Test Project',
      nodes,
      weeks,
      stages,
      workflows,
      capaItems,
      asOfDate: new Date('2026-01-10T00:00:00Z'),
    });

    assert.equal(scurve.points[0].verifiedCumulative, 99.00, 'Must be locked at 99.00% when open critical CAPA exists');
  });

  await t.test('5. Resolving the CAPA (CLOSED with resolvedAt) unlocks the 99% cap to 100.00%', async () => {
    // Fetch the active CAPA on testNodeId
    const [capa] = await db
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.nodeId, testNodeId))
      .limit(1);

    assert.notEqual(capa, undefined);

    // QA/QC Lead approves resolution & closes CAPA
    const patchRes = await supertest(app)
      .patch(`/api/actions/${capa.id}`)
      .set('Cookie', `sitelens_session=${qaqcUser.token}`)
      .send({
        status: 'CLOSED',
        resolutionNotes: 'Perbaikan grouting semen non-shrink telah diperiksa dan disetujui QA/QC.',
      });

    assert.equal(patchRes.status, 200, `Failed to close CAPA: ${JSON.stringify(patchRes.body)}`);
    assert.equal(patchRes.body.action.status, 'CLOSED');
    assert.notEqual(patchRes.body.action.resolvedAt, null);

    // Re-query S-Curve: progress must now unlock and reach 100.00%!
    const scurveRes = await supertest(app)
      .get(`/api/projects/${dedicatedProjectId}/scurve`)
      .set('Cookie', `sitelens_session=${siteEngUser.token}`);

    assert.equal(scurveRes.status, 200);
    assert.equal(
      scurveRes.body.scurve.currentVerifiedPercent,
      100.00,
      'Verified progress must reach 100% after CAPA resolution'
    );
  });

  await t.test('6. Historical S-Curve reconstruction reflects creation (capped at 99%) and resolution (100%)', () => {
    // 3 weeks of calendar
    const weeks = generateProjectCalendarWeeks(
      new Date('2026-01-05T00:00:00Z'), // Week 0: Jan 5 - Jan 11
      new Date('2026-01-26T00:00:00Z')  // Week 1: Jan 12 - Jan 18, Week 2: Jan 19 - Jan 25
    );

    const nodes = [
      { id: 'node-pier', parentId: null, wbsCode: '1.0', name: 'Pier Construction', weightPercent: '100.00' },
    ];
    const workflows = [{ id: 'wf-pier', nodeId: 'node-pier' }];
    const stages = [
      {
        id: 'stg-pier',
        workflowId: 'wf-pier',
        status: 'approved',
        actualCompletedAt: new Date('2026-01-08T00:00:00Z'), // Approved in Week 0
      },
    ];

    // CAPA created on Jan 10 (Week 0) and resolved on Jan 20 (Week 2)
    const capaItems = [
      {
        id: 'capa-hist-1',
        nodeId: 'node-pier',
        severity: 'high',
        status: 'CLOSED',
        createdAt: new Date('2026-01-10T12:00:00Z'), // Created in Week 0
        resolvedAt: new Date('2026-01-20T12:00:00Z'), // Resolved in Week 2
      },
    ];

    const scurve = calculateSSOTSCurveData({
      projectId: 'prj-hist',
      projectName: 'Hist Test',
      nodes,
      weeks,
      stages,
      workflows,
      capaItems,
      asOfDate: new Date('2026-01-26T00:00:00Z'),
    });

    // Week 0 (ends Jan 11): CAPA was open -> capped at 99%
    assert.equal(scurve.points[0].verifiedCumulative, 99.00, 'Week 0 must be capped at 99%');

    // Week 1 (ends Jan 18): CAPA was STILL open -> capped at 99%
    assert.equal(scurve.points[1].verifiedCumulative, 99.00, 'Week 1 must be capped at 99%');

    // Week 2 (ends Jan 25): CAPA was resolved on Jan 20 -> reaches 100%!
    assert.equal(scurve.points[2].verifiedCumulative, 100.00, 'Week 2 must reach 100% after resolvedAt');
  });

  await t.test('7. Findings with severity "medium" or "low" do NOT trigger 99% lockout', () => {
    const weeks = generateProjectCalendarWeeks(
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-01-12T00:00:00Z')
    );

    const nodes = [
      { id: 'node-med-test', parentId: null, wbsCode: '2.0', name: 'Finishing Node', weightPercent: '100.00' },
    ];
    const workflows = [{ id: 'wf-med', nodeId: 'node-med-test' }];
    const stages = [
      {
        id: 'stg-med',
        workflowId: 'wf-med',
        status: 'approved',
        actualCompletedAt: new Date('2026-01-08T00:00:00Z'),
      },
    ];

    const capaItems = [
      {
        id: 'capa-medium',
        nodeId: 'node-med-test',
        severity: 'medium',
        status: 'OPEN',
        createdAt: new Date('2026-01-06T00:00:00Z'),
        resolvedAt: null,
      },
      {
        id: 'capa-low',
        nodeId: 'node-med-test',
        severity: 'low',
        status: 'OPEN',
        createdAt: new Date('2026-01-06T00:00:00Z'),
        resolvedAt: null,
      },
    ];

    const scurve = calculateSSOTSCurveData({
      projectId: 'prj-med',
      projectName: 'Med Test',
      nodes,
      weeks,
      stages,
      workflows,
      capaItems,
      asOfDate: new Date('2026-01-10T00:00:00Z'),
    });

    assert.equal(
      scurve.points[0].verifiedCumulative,
      100.00,
      'Medium and low severity findings must NOT lock out progress at 99%'
    );
  });

  await t.test('8. Non-WBS findings (node_id = NULL) do NOT lock out WBS nodes', () => {
    const weeks = generateProjectCalendarWeeks(
      new Date('2026-01-05T00:00:00Z'),
      new Date('2026-01-12T00:00:00Z')
    );

    const nodes = [
      { id: 'node-unlocked', parentId: null, wbsCode: '3.0', name: 'Independent Node', weightPercent: '100.00' },
    ];
    const workflows = [{ id: 'wf-unlocked', nodeId: 'node-unlocked' }];
    const stages = [
      {
        id: 'stg-unlocked',
        workflowId: 'wf-unlocked',
        status: 'approved',
        actualCompletedAt: new Date('2026-01-08T00:00:00Z'),
      },
    ];

    // Critical CAPA but with nodeId = null (general site housekeeping / PPE finding)
    const capaItems = [
      {
        id: 'capa-non-wbs',
        nodeId: null,
        severity: 'critical',
        status: 'OPEN',
        createdAt: new Date('2026-01-06T00:00:00Z'),
        resolvedAt: null,
      },
    ];

    const scurve = calculateSSOTSCurveData({
      projectId: 'prj-non-wbs',
      projectName: 'Non WBS Test',
      nodes,
      weeks,
      stages,
      workflows,
      capaItems,
      asOfDate: new Date('2026-01-10T00:00:00Z'),
    });

    assert.equal(
      scurve.points[0].verifiedCumulative,
      100.00,
      'Non-WBS finding (nodeId = null) must not affect WBS physical progress'
    );
  });

  await t.test('9. Verify punchlist_items table is completely dropped from database', async () => {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();

    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'punchlist_items'
    `);

    await client.end();
    assert.equal(
      result.rows.length,
      0,
      'punchlist_items table must not exist in PostgreSQL public schema'
    );
  });
});
