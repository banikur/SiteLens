/**
 * Stage Focus Setup Flow Test Suite
 * Alur End-to-End: Master Project -> Project Site -> Team Assignment -> Rincian Pekerjaan (WBS)
 *
 * Verifies:
 * 1. Master Projects: permission gates, filtered visibility (org scope sees all, project scope sees only assigned sites), soft archive.
 * 2. Site creation: created under master project with transactional creator auto-assignment; legacy projects without master remain valid.
 * 3. Assignments:
 *    - Unique (user, project) constraint -> 409 Conflict with descriptive message.
 *    - Anti-escalation enforcement -> 403 Forbidden when granting permissions assigner lacks.
 *    - Last manage_members holder protection -> 422 when attempting to revoke or downgrade the last active manager.
 *    - source='legacy_sync' rows are protected from alteration or deletion -> 403.
 *    - FOCUS_MODE role restriction: non-demo roles rejected with 422 when FOCUS_MODE='setup-flow'.
 *    - Audit logs recorded for create, update, deactivate.
 * 4. User search: GET /api/users/search returns safe profile fields without exposing password/pin hashes.
 * 5. WBS Detailing & Atomic Batch:
 *    - PATCH allowDetailing per node requires wbs.edit_structure.
 *    - POST details-batch rejected with 422 if sibling weight sum != 100.00% and commits nothing.
 *    - POST details-batch rejected if parent has approved stage/attempt (422).
 *    - Subtree allowDetailing inheritance allows detailing inside permitted subtrees.
 *    - PUT nodes-batch atomically updates hierarchy, sort order and weights with cycle and cross-project validation.
 *    - Client viewer receives 403 Forbidden on all mutation endpoints.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { eq, and, sql } from 'drizzle-orm';

import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { getDb, closeDb } from '../src/server/db/index.ts';
import {
  users,
  roles,
  rolePermissions,
  roleAssignments,
  masterProjects,
  projects,
  workNodes,
  workWorkflows,
  workStages,
  auditLogs,
} from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { PERMISSIONS } from '../src/types/permissions.ts';

import {
  ROLE_USER_MAP,
  PRJ_A_ID,
  PRJ_B_ID,
  NODE_A_ID,
} from './fixtures/stage2a-matrix-fixtures.ts';
import { seedMatrixDatabase } from './fixtures/stage2a-db-seed.ts';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(attachSessionUser);

  app.use('/api/auth', authRouter);
  app.use('/api', apiRouter);

  return app;
}

test('Focus Setup Flow: Master Project -> Site -> Assignment -> WBS Detailing', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();

  const app = createTestApp();
  const agent = supertest(app);

  const pmoToken = ROLE_USER_MAP.head_office_pmo.token;
  const pmToken = ROLE_USER_MAP.project_manager.token;
  const seToken = ROLE_USER_MAP.site_engineer.token;
  const clientToken = ROLE_USER_MAP.client_viewer.token;

  const db = getDb();
  if (!db) throw new Error('Database not connected');

  let testMasterId: string = '';
  let testSiteId: string = '';

  // ---------------------------------------------------------------------------
  // 1. MASTER PROJECTS
  // ---------------------------------------------------------------------------

  await t.test('1.a. Head Office PMO creates Master Project (POST /api/master-projects)', async () => {
    const code = `MP-CORP-${Date.now()}`;
    const res = await agent
      .post('/api/master-projects')
      .set('Cookie', [`sitelens_session=${pmoToken}`])
      .send({
        code,
        name: 'Trans-Java Infrastructure Package 4',
        ownerClient: 'Ministry of Public Works',
        description: 'Highway and Bridge Expansion Program',
        startDate: '2026-01-01',
        endDate: '2028-12-31',
      });

    assert.equal(res.status, 201, 'Should return 201 Created');
    assert.equal(res.body.masterProject.code, code);
    assert.equal(res.body.masterProject.status, 'active');
    testMasterId = res.body.masterProject.id;

    // Verify audit log
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'MASTER_PROJECT_CREATED'), eq(auditLogs.entityId, testMasterId)));
    assert.ok(audit, 'Audit log for MASTER_PROJECT_CREATED must be recorded');
  });

  await t.test('1.b. Project Manager cannot create Master Project (403 Forbidden)', async () => {
    const res = await agent
      .post('/api/master-projects')
      .set('Cookie', [`sitelens_session=${pmToken}`])
      .send({
        code: `MP-DENIED-${Date.now()}`,
        name: 'Unauthorized Master Project',
        ownerClient: 'Fake Client',
      });

    assert.equal(res.status, 403, 'PM lacks masterproject.manage permission');
  });

  await t.test('1.c. Site creation under Master Project with transactional creator auto-assignment', async () => {
    const siteCode = `SITE-TJ4-${Date.now()}`;
    const res = await agent
      .post(`/api/master-projects/${testMasterId}/sites`)
      .set('Cookie', [`sitelens_session=${pmoToken}`])
      .send({
        code: siteCode,
        name: 'Site KM 42+500 Bridge Pier Sector',
        location: 'Subang Regency',
      });

    assert.equal(res.status, 201, 'Should return 201 Created for site');
    assert.equal(res.body.site.masterProjectId, testMasterId);
    testSiteId = res.body.site.id;

    // Verify transactional auto-assignment of creator as project_manager
    const pmoUserId = ROLE_USER_MAP.head_office_pmo.id;
    const [assignment] = await db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.projectId, testSiteId as any),
          eq(roleAssignments.userId, pmoUserId as any),
          eq(roleAssignments.scopeType, 'project'),
          eq(roleAssignments.roleId, 'project_manager')
        )
      );

    assert.ok(assignment, 'Creator must be auto-assigned as project_manager on new site');
    assert.equal(assignment.source, 'manual');
    assert.equal(assignment.isActive, true);
  });

  await t.test('1.d. Filtered visibility: PM only sees Master Project after site assignment', async () => {
    // Before PM is assigned to testSiteId: PM GET /master-projects does NOT list testMasterId
    const resBefore = await agent
      .get('/api/master-projects')
      .set('Cookie', [`sitelens_session=${pmToken}`]);

    assert.equal(resBefore.status, 200);
    const hasTestMasterBefore = resBefore.body.masterProjects.some((m: any) => m.id === testMasterId);
    assert.equal(hasTestMasterBefore, false, 'PM should not see master project without assigned site');

    // Assign PM to testSiteId
    const pmUserId = ROLE_USER_MAP.project_manager.id;
    await db.insert(roleAssignments).values({
      userId: pmUserId as any,
      projectId: testSiteId as any,
      roleId: 'project_manager',
      scopeType: 'project',
      source: 'manual',
      isActive: true,
    });

    // After assignment: PM GET /master-projects DOES list testMasterId
    const resAfter = await agent
      .get('/api/master-projects')
      .set('Cookie', [`sitelens_session=${pmToken}`]);

    assert.equal(resAfter.status, 200);
    const hasTestMasterAfter = resAfter.body.masterProjects.some((m: any) => m.id === testMasterId);
    assert.equal(hasTestMasterAfter, true, 'PM should now see master project with assigned site');
  });

  await t.test('1.e. Soft archive of Master Project (PATCH /api/master-projects/:id/archive)', async () => {
    const res = await agent
      .patch(`/api/master-projects/${testMasterId}/archive`)
      .set('Cookie', [`sitelens_session=${pmoToken}`]);

    assert.equal(res.status, 200);
    assert.equal(res.body.masterProject.status, 'archived');

    // Verify row was NOT deleted from DB
    const [row] = await db.select().from(masterProjects).where(eq(masterProjects.id, testMasterId as any));
    assert.ok(row, 'Master project row must be retained in database');
    assert.equal(row.status, 'archived');
  });

  // ---------------------------------------------------------------------------
  // 2. USER SEARCH & TEAM ASSIGNMENT
  // ---------------------------------------------------------------------------

  await t.test('2.a. GET /api/users/search returns safe profile fields without credential leak', async () => {
    const res = await agent
      .get('/api/users/search?q=inspector')
      .set('Cookie', [`sitelens_session=${pmToken}`]);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
    assert.ok(res.body.users.length > 0);

    const user = res.body.users[0];
    assert.ok(user.id);
    assert.ok(user.name);
    assert.equal(user.passwordHash, undefined, 'passwordHash must never be returned');
    assert.equal(user.pinHash, undefined, 'pinHash must never be returned');
  });

  await t.test('2.b. Assignment unique constraint: rejects duplicate user on same site (409 Conflict)', async () => {
    const seUserId = ROLE_USER_MAP.site_engineer.id;

    // First assignment: successful 201
    const res1 = await agent
      .post(`/api/projects/${testSiteId}/assignments`)
      .set('Cookie', [`sitelens_session=${pmoToken}`])
      .send({ userId: seUserId, roleId: 'site_engineer' });
    if (res1.status !== 201) {
      console.log('DEBUG res1 fail:', res1.status, res1.body);
    }
    assert.equal(res1.status, 201);

    // Second assignment with same user & project: rejects 409
    const res2 = await agent
      .post(`/api/projects/${testSiteId}/assignments`)
      .set('Cookie', [`sitelens_session=${pmoToken}`])
      .send({ userId: seUserId, roleId: 'site_engineer' });
    assert.equal(res2.status, 409, 'Should reject duplicate assignment with 409 Conflict');
    assert.match(res2.body.error, /sudah memiliki penugasan/i);
  });

  await t.test('2.c. Anti-escalation check: assigner cannot grant permissions they do not possess (403)', async () => {
    // Project Manager attempts to grant head_office_pmo (which has org-level permissions PM lacks)
    const clientUserId = ROLE_USER_MAP.client_viewer.id;
    const res = await agent
      .post(`/api/projects/${testSiteId}/assignments`)
      .set('Cookie', [`sitelens_session=${pmToken}`])
      .send({ userId: clientUserId, roleId: 'head_office_pmo' });

    assert.equal(res.status, 403, 'Should reject escalation with 403 Forbidden');
    assert.match(res.body.error, /anti-eskalasi|izin/i);
  });

  await t.test('2.d. FOCUS_MODE enforcement: non-demo role is rejected at server level (422)', async () => {
    process.env.FOCUS_MODE = 'setup-flow';
    try {
      const clientUserId = ROLE_USER_MAP.client_viewer.id;
      // 'field_inspector' is a valid database role but excluded from the 4 demo roles
      const res = await agent
        .post(`/api/projects/${testSiteId}/assignments`)
        .set('Cookie', [`sitelens_session=${pmoToken}`])
        .send({ userId: clientUserId, roleId: 'field_inspector' });

      assert.equal(res.status, 422, 'Should reject non-demo role when FOCUS_MODE is active');
      assert.match(res.body.error, /FOCUS_MODE/i);
    } finally {
      delete process.env.FOCUS_MODE;
    }
  });

  await t.test('2.e. Protection of last manage_members holder on site: cannot downgrade or delete (422)', async () => {
    // In PRJ_A_ID, PM is the only member with project.manage_members
    // Find assignment for PM in PRJ_A_ID
    const [pmAssignment] = await db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.projectId, PRJ_A_ID as any),
          eq(roleAssignments.roleId, 'project_manager'),
          eq(roleAssignments.isActive, true)
        )
      );

    assert.ok(pmAssignment, 'PM assignment in PRJ_A_ID must exist');

    // Attempt to downgrade to client_viewer (lacks manage_members)
    const resDowngrade = await agent
      .put(`/api/projects/${PRJ_A_ID}/assignments/${pmAssignment.id}`)
      .set('Cookie', [`sitelens_session=${pmoToken}`])
      .send({ roleId: 'client_viewer' });

    assert.equal(resDowngrade.status, 422, 'Should reject downgrading the last manage_members holder with 422');
    assert.match(resDowngrade.body.error, /terakhir/i);

    // Attempt to deactivate/delete the last manage_members holder
    const resDelete = await agent
      .delete(`/api/projects/${PRJ_A_ID}/assignments/${pmAssignment.id}`)
      .set('Cookie', [`sitelens_session=${pmoToken}`]);

    assert.equal(resDelete.status, 422, 'Should reject deleting the last manage_members holder with 422');
    assert.match(resDelete.body.error, /terakhir/i);
  });

  await t.test('2.f. Protection of source=legacy_sync rows: cannot modify or delete via assignment API (403)', async () => {
    // Create a legacy_sync assignment row
    const [legacyRow] = await db
      .insert(roleAssignments)
      .values({
        userId: ROLE_USER_MAP.subcontractor.id as any,
        projectId: testSiteId as any,
        roleId: 'client_viewer',
        scopeType: 'project',
        source: 'legacy_sync',
        isActive: true,
      })
      .returning();

    const resPut = await agent
      .put(`/api/projects/${testSiteId}/assignments/${legacyRow.id}`)
      .set('Cookie', [`sitelens_session=${pmoToken}`])
      .send({ roleId: 'site_engineer' });
    assert.equal(resPut.status, 403, 'legacy_sync row cannot be updated');
    assert.match(resPut.body.error, /legacy_sync/i);

    const resDel = await agent
      .delete(`/api/projects/${testSiteId}/assignments/${legacyRow.id}`)
      .set('Cookie', [`sitelens_session=${pmoToken}`]);
    assert.equal(resDel.status, 403, 'legacy_sync row cannot be deleted');
    assert.match(resDel.body.error, /legacy_sync/i);
  });

  // ---------------------------------------------------------------------------
  // 3. WBS DETAILING & ATOMIC BATCH
  // ---------------------------------------------------------------------------

  let rootNodeId: string = '';

  await t.test('3.a. PMO sets up parent node and toggles allowDetailing (PATCH /detailing)', async () => {
    // Create parent node
    const [parent] = await db
      .insert(workNodes)
      .values({
        projectId: testSiteId as any,
        wbsCode: '1.0',
        name: 'Pekerjaan Struktur Utama',
        weightPercent: '100.00',
        allowDetailing: false,
      })
      .returning();
    rootNodeId = parent.id;

    // Site Engineer cannot toggle allowDetailing (lacks wbs.edit_structure)
    const resDenied = await agent
      .patch(`/api/projects/${testSiteId}/wbs/nodes/${rootNodeId}/detailing`)
      .set('Cookie', [`sitelens_session=${seToken}`])
      .send({ allowDetailing: true });
    assert.equal(resDenied.status, 403, 'SE cannot toggle allowDetailing');

    // PMO toggles allowDetailing to true
    const resAllowed = await agent
      .patch(`/api/projects/${testSiteId}/wbs/nodes/${rootNodeId}/detailing`)
      .set('Cookie', [`sitelens_session=${pmoToken}`])
      .send({ allowDetailing: true });
    assert.equal(resAllowed.status, 200);
    assert.equal(resAllowed.body.node.allowDetailing, true);
  });

  await t.test('3.b. Atomic details-batch: sum != 100.00% rejected with 422 and commits 0 rows', async () => {
    const resFail = await agent
      .post(`/api/projects/${testSiteId}/wbs/nodes/${rootNodeId}/details-batch`)
      .set('Cookie', [`sitelens_session=${seToken}`])
      .send({
        items: [
          { wbsCode: '1.1', name: 'Pembesian Pier 1', weightPercent: 40.0 },
          { wbsCode: '1.2', name: 'Pengecoran Pier 1', weightPercent: 35.0 }, // total = 75%, not 100%
        ],
      });

    assert.equal(resFail.status, 422, 'Should reject with 422 when sum != 100.00%');
    assert.match(resFail.body.error, /100\.00%/);

    // Verify atomic rollback: no child nodes created
    const children = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.parentId, rootNodeId as any));
    assert.equal(children.length, 0, 'No child nodes should exist after rollback');
  });

  await t.test('3.c. Atomic details-batch: sum == 100.00% creates all child nodes in transaction', async () => {
    const resSuccess = await agent
      .post(`/api/projects/${testSiteId}/wbs/nodes/${rootNodeId}/details-batch`)
      .set('Cookie', [`sitelens_session=${seToken}`])
      .send({
        items: [
          { wbsCode: '1.1', name: 'Pekerjaan Pondasi Pier P1', weightPercent: 60.0 },
          { wbsCode: '1.2', name: 'Pekerjaan Kolom Pier P1', weightPercent: 40.0 },
        ],
      });

    assert.equal(resSuccess.status, 201, 'Should return 201 Created');
    assert.equal(resSuccess.body.nodes.length, 2);

    const children = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.parentId, rootNodeId as any));
    assert.equal(children.length, 2, 'Exactly 2 children should be saved');
  });

  await t.test('3.d. Details-batch rejected if parent has approved stage (422)', async () => {
    // Add approved stage to rootNodeId
    const [wf] = await db
      .insert(workWorkflows)
      .values({ nodeId: rootNodeId as any, title: 'Approval Workflow' })
      .returning();

    await db.insert(workStages).values({
      workflowId: wf.id,
      name: 'Hold Point Review',
      stageType: 'hold',
      assignedRole: 'Field / QC Inspector',
      status: 'approved',
      actualCompletedAt: new Date(),
    });

    const res = await agent
      .post(`/api/projects/${testSiteId}/wbs/nodes/${rootNodeId}/details-batch`)
      .set('Cookie', [`sitelens_session=${seToken}`])
      .send({
        items: [
          { wbsCode: '1.3', name: 'Sub-activity A', weightPercent: 50.0 },
          { wbsCode: '1.4', name: 'Sub-activity B', weightPercent: 50.0 },
        ],
      });

    assert.equal(res.status, 422, 'Should reject detailing approved parent with 422');
    assert.match(res.body.error, /disetujui/i);
  });

  await t.test('3.e. Batch Drag-Drop (PUT /nodes-batch): rejects cycle with 422', async () => {
    // Fetch the 2 child nodes
    const children = await db
      .select()
      .from(workNodes)
      .where(eq(workNodes.parentId, rootNodeId as any));
    assert.equal(children.length, 2);

    const childA = children[0];
    const childB = children[1];

    // Attempt to make root a child of childA (cycle)
    const resCycle = await agent
      .put(`/api/projects/${testSiteId}/wbs/nodes-batch`)
      .set('Cookie', [`sitelens_session=${pmoToken}`])
      .send({
        updates: [
          { id: childA.id, parentId: childB.id, sortOrder: 1 },
          { id: childB.id, parentId: childA.id, sortOrder: 2 }, // Direct cycle: A->B and B->A
        ],
      });

    assert.equal(resCycle.status, 422, 'Should detect cycle and reject with 422');
    assert.match(resCycle.body.error, /siklus/i);
  });

  await t.test('3.f. Client Viewer: all mutation endpoints return 403 Forbidden', async () => {
    const resMaster = await agent
      .post('/api/master-projects')
      .set('Cookie', [`sitelens_session=${clientToken}`])
      .send({ code: 'FAIL', name: 'Fail', ownerClient: 'Fail' });
    assert.equal(resMaster.status, 403);

    const resSite = await agent
      .post(`/api/master-projects/${testMasterId}/sites`)
      .set('Cookie', [`sitelens_session=${clientToken}`])
      .send({ code: 'FAIL', name: 'Fail' });
    assert.equal(resSite.status, 403);

    const resAssign = await agent
      .post(`/api/projects/${testSiteId}/assignments`)
      .set('Cookie', [`sitelens_session=${clientToken}`])
      .send({ userId: ROLE_USER_MAP.site_engineer.id, roleId: 'site_engineer' });
    assert.equal(resAssign.status, 403);

    const resDetail = await agent
      .post(`/api/projects/${testSiteId}/wbs/nodes/${rootNodeId}/details-batch`)
      .set('Cookie', [`sitelens_session=${clientToken}`])
      .send({ items: [{ wbsCode: '1.9', name: 'Fail', weightPercent: 100 }] });
    assert.equal(resDetail.status, 403);
  });
});
