/**
 * Tahap 3b: WBS Canvas-First Studio UI & Flag allow_detailing Enforcement Tests
 * Corresponds to RECONSTRUCTION_BLUEPRINT.md v2.3 Section 1049-1077, 1356-1371.
 *
 * Verifies:
 * 1. Site Officer (wbs.edit_detail without wbs.edit_structure) cannot create root nodes.
 * 2. Site Officer cannot add detail to a node with allow_detailing = false (403 Forbidden).
 * 3. Site Officer cannot add detail to a node with approved stages / verified progress (400 Bad Request - requires Change Request).
 * 4. Site Officer cannot toggle allow_detailing on existing nodes (403 Forbidden). PM (wbs.edit_structure) can.
 * 5. POST /projects/:projectId/wbs/nodes/:parentId/details-batch rejects if sibling weights != 100.00% (400 Bad Request).
 * 6. POST /details-batch commits atomically when sum == 100.00%.
 * 7. requirePmApprovalForDetailing creates nodes in 'pending_pm_approval', and PM can approve them via /approve-details.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { eq, and } from 'drizzle-orm';

import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { getDb, closeDb } from '../src/server/db/index.ts';
import {
  projects,
  workNodes,
  workWorkflows,
  workStages,
} from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { apiRouter } from '../src/server/routes/api.ts';
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

test('Tahap 3b: WBS allow_detailing Enforcement and Atomic Details Batch', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();
  const db = getDb()!;
  const app = createTestApp();

  const siteEngUser = ROLE_USER_MAP['site_engineer'];
  const hoUser = ROLE_USER_MAP['head_office_pmo'];

  // 1. Site Officer cannot create root node
  await t.test('1. Site Officer (wbs.edit_detail) cannot create root node (must have parentId)', async () => {
    const res = await supertest(app)
      .post(`/api/projects/${PRJ_A_ID}/wbs/nodes`)
      .set('Cookie', [`sitelens_session=${siteEngUser.token}`])
      .send({
        wbsCode: 'ROOT-DENIED',
        name: 'Root Attempt by Site Officer',
        weightPercent: '10.00',
      });

    assert.equal(res.status, 400, 'Should reject root node creation by detail-only user with 400');
    assert.match(res.body.error, /simpul induk/i);
  });

  // 2. Site Officer cannot add detail to parent with allow_detailing = false
  let parentLockedId: string;
  await t.test('2. Site Officer cannot add detail to parent where allow_detailing = false', async () => {
    // PM creates a parent with allowDetailing = false
    const [lockedNode] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        wbsCode: '2.0-LOCKED',
        name: 'Pekerjaan Struktur Baku (allow_detailing = false)',
        weightPercent: '20.00',
        allowDetailing: false,
      })
      .returning();
    parentLockedId = lockedNode.id;

    const res = await supertest(app)
      .post(`/api/projects/${PRJ_A_ID}/wbs/nodes`)
      .set('Cookie', [`sitelens_session=${siteEngUser.token}`])
      .send({
        parentId: parentLockedId,
        wbsCode: '2.1-FAIL',
        name: 'Sub-detail on locked parent',
        weightPercent: '50.00',
      });

    assert.equal(res.status, 403, 'Should reject with 403 when allow_detailing is false');
    assert.match(res.body.error, /allow_detailing = false/i);
  });

  // 3. Site Officer cannot add detail if parent has approved stage (requires Change Request)
  await t.test('3. Site Officer cannot add detail if parent already has approved stages (requires Change Request)', async () => {
    // Create parent with allowDetailing = true but has approved stage
    const [progressNode] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        wbsCode: '3.0-APPROVED-STAGE',
        name: 'Pekerjaan dengan Stage Approved',
        weightPercent: '30.00',
        allowDetailing: true,
        verifiedProgressPercent: 50,
      })
      .returning();

    const [wf] = await db
      .insert(workWorkflows)
      .values({
        nodeId: progressNode.id,
        title: 'Workflow 3.0',
      })
      .returning();

    await db.insert(workStages).values({
      workflowId: wf.id,
      stageOrder: 1,
      stageType: 'work',
      name: 'Stage 1 Approved',
      status: 'approved',
      assignedRole: 'Project / Site Engineer',
    });

    const res = await supertest(app)
      .post(`/api/projects/${PRJ_A_ID}/wbs/nodes`)
      .set('Cookie', [`sitelens_session=${siteEngUser.token}`])
      .send({
        parentId: progressNode.id,
        wbsCode: '3.1-FAIL',
        name: 'Sub-detail on active node',
        weightPercent: '50.00',
      });

    assert.equal(res.status, 400, 'Should reject with 400 when parent has approved stages');
    assert.match(res.body.error, /Change Request/i);
  });

  // 4. Site Officer cannot toggle allow_detailing on existing node via PUT (HO PMO can)
  await t.test('4. Site Officer cannot toggle allow_detailing on existing node via PUT', async () => {
    // Site Officer attempts to change allowDetailing of parentLockedId
    const resDeny = await supertest(app)
      .put(`/api/projects/${PRJ_A_ID}/wbs/nodes/${parentLockedId}`)
      .set('Cookie', [`sitelens_session=${siteEngUser.token}`])
      .send({
        allowDetailing: true,
      });

    assert.equal(resDeny.status, 403, 'Should reject allow_detailing modification by detail-only user with 403');

    // HO PMO modifies allowDetailing to true -> 200 OK
    const resAllow = await supertest(app)
      .put(`/api/projects/${PRJ_A_ID}/wbs/nodes/${parentLockedId}`)
      .set('Cookie', [`sitelens_session=${hoUser.token}`])
      .send({
        allowDetailing: true,
      });

    assert.equal(resAllow.status, 200, 'HO PMO should successfully update allow_detailing to true');
    assert.equal(resAllow.body.node.allowDetailing, true);
  });

  // 5. Batch detailing rejects when children sibling weights sum != 100.00%
  let parentOpenId: string;
  await t.test('5. POST /details-batch rejects when sibling weights != 100.00%', async () => {
    // Create an open parent with allowDetailing = true
    const [openParent] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        wbsCode: '4.0-OPEN',
        name: 'Paket Pekerjaan Pondasi Bored Pile',
        weightPercent: '25.00',
        allowDetailing: true,
        verifiedProgressPercent: 0,
      })
      .returning();
    parentOpenId = openParent.id;

    // Send batch with 40% + 30% = 70% (not 100%)
    const resFail = await supertest(app)
      .post(`/api/projects/${PRJ_A_ID}/wbs/nodes/${parentOpenId}/details-batch`)
      .set('Cookie', [`sitelens_session=${siteEngUser.token}`])
      .send({
        children: [
          { wbsCode: '4.1', name: 'Pengeboran Lubang', weightPercent: 40.0, volume: '10', unit: 'titik' },
          { wbsCode: '4.2', name: 'Penulangan Besi', weightPercent: 30.0, volume: '15', unit: 'ton' },
        ],
      });

    assert.equal(resFail.status, 400, 'Should reject batch detailing when sum != 100.00%');
    assert.match(resFail.body.error, /100\.00%/);

    // Verify no child nodes were created (atomic transaction rollback)
    const existingChildren = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.parentId, parentOpenId));
    assert.equal(existingChildren.length, 0, 'No child nodes should exist after rollback');
  });

  // 6. Batch detailing accepts when sum == 100.00% and commits atomically
  await t.test('6. POST /details-batch accepts and commits atomically when sum == 100.00%', async () => {
    const resSuccess = await supertest(app)
      .post(`/api/projects/${PRJ_A_ID}/wbs/nodes/${parentOpenId}/details-batch`)
      .set('Cookie', [`sitelens_session=${siteEngUser.token}`])
      .send({
        children: [
          { wbsCode: '4.1', name: 'Pengeboran Lubang Bored Pile', weightPercent: 40.0, volume: '10', unit: 'titik' },
          { wbsCode: '4.2', name: 'Fabrikasi dan Instalasi Tulangan', weightPercent: 30.0, volume: '15', unit: 'ton' },
          { wbsCode: '4.3', name: 'Pengecoran Beton Ready-Mix K-350', weightPercent: 30.0, volume: '45', unit: 'm3' },
        ],
      });

    assert.equal(resSuccess.status, 201, 'Should return 201 Created');
    assert.equal(resSuccess.body.count, 3);
    assert.equal(resSuccess.body.detailingStatus, 'active');

    // Verify in database
    const created = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.parentId, parentOpenId));
    assert.equal(created.length, 3, 'All 3 children should exist in database');
    assert.equal(created[0].volume, '10.00');
    assert.equal(created[0].unit, 'titik');
  });

  // 7. requirePmApprovalForDetailing creates nodes in 'pending_pm_approval' and PM approves them
  await t.test('7. requirePmApprovalForDetailing: creates pending_pm_approval and PM can approve', async () => {
    // Enable requirePmApprovalForDetailing on PRJ_A
    await db
      .update(projects)
      .set({ requirePmApprovalForDetailing: true })
      .where(eq(projects.id, PRJ_A_ID));

    // Create a new parent with allowDetailing = true
    const [parentPmReq] = await db
      .insert(workNodes)
      .values({
        projectId: PRJ_A_ID,
        wbsCode: '5.0-PM-APPROVAL-REQUIRED',
        name: 'Pekerjaan Struktur Atap Baja',
        weightPercent: '15.00',
        allowDetailing: true,
        verifiedProgressPercent: 0,
      })
      .returning();

    // Site Officer adds batch details
    const resBatch = await supertest(app)
      .post(`/api/projects/${PRJ_A_ID}/wbs/nodes/${parentPmReq.id}/details-batch`)
      .set('Cookie', [`sitelens_session=${siteEngUser.token}`])
      .send({
        children: [
          { wbsCode: '5.1', name: 'Fabrikasi Kuda-Kuda Baja WF', weightPercent: 60.0, volume: '25', unit: 'ton' },
          { wbsCode: '5.2', name: 'Ereksi Struktur Atap', weightPercent: 40.0, volume: '25', unit: 'ton' },
        ],
      });

    assert.equal(resBatch.status, 201);
    assert.equal(resBatch.body.detailingStatus, 'pending_pm_approval');

    // Verify in DB that detailingStatus is pending_pm_approval
    const pendingNodes = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.parentId, parentPmReq.id));
    assert.equal(pendingNodes.length, 2);
    assert.equal(pendingNodes[0].detailingStatus, 'pending_pm_approval');
    assert.equal(pendingNodes[1].detailingStatus, 'pending_pm_approval');

    // HO PMO approves details via /approve-details
    const resApprove = await supertest(app)
      .post(`/api/projects/${PRJ_A_ID}/wbs/nodes/${parentPmReq.id}/approve-details`)
      .set('Cookie', [`sitelens_session=${hoUser.token}`]);

    assert.equal(resApprove.status, 200);
    assert.equal(resApprove.body.approvedCount, 2);

    // Verify in DB that detailingStatus is now active
    const activeNodes = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.parentId, parentPmReq.id));
    assert.equal(activeNodes[0].detailingStatus, 'active');
    assert.equal(activeNodes[1].detailingStatus, 'active');
  });

  t.after(async () => {
    await closeDb();
  });
});
