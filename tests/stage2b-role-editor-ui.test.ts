/**
 * Tahap 2b: Role & Permission Editor UI Endpoints & Dynamic Project Membership Tests
 * Corresponds to RECONSTRUCTION_BLUEPRINT.md v2.3 Section 8, Bagian B.2, and Bagian F.5.
 *
 * Verifies:
 * 1. GET /api/admin/roles returns list of all system and custom roles with permissions.
 * 2. GET /api/admin/permissions returns complete permission catalogue.
 * 3. POST /api/admin/roles creates custom role with validation & audit log.
 * 4. PUT /api/admin/roles/:id updates role name & permissions with Super Admin protection.
 * 5. DELETE /api/admin/roles/:id protects system roles and roles in active use.
 * 6. GET/POST/DELETE /api/projects/:projectId/members manages contextual project assignments.
 * 7. Real-time authorization: assigning a custom role to a user immediately affects /my-permissions.
 * 8. Protection of last active organization admin on assignments and demotions.
 * 9. PUT /api/projects/:projectId updates project metadata.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { eq, and } from 'drizzle-orm';

import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { getDb, closeDb } from '../src/server/db/index.ts';
import { users, roles, rolePermissions, roleAssignments, projects } from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { PERMISSIONS } from '../src/types/permissions.ts';

import {
  ROLE_USER_MAP,
  PRJ_A_ID,
  PRJ_B_ID,
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

test('Tahap 2b: Role & Permission Editor and Project Membership Endpoints', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();

  const app = createTestApp();
  const agent = supertest(app);

  const pmoToken = ROLE_USER_MAP.head_office_pmo.token;
  const engineerToken = ROLE_USER_MAP.site_engineer.token;
  const inspectorToken = ROLE_USER_MAP.field_inspector.token;

  t.after(async () => {
    await closeDb();
  });

  // 1. GET /api/admin/roles
  await t.test('1. GET /api/admin/roles lists system roles with permissions', async () => {
    const resForbidden = await agent
      .get('/api/admin/roles')
      .set('Cookie', `sitelens_session=${engineerToken}`);
    assert.equal(resForbidden.status, 403, 'Site Engineer must be denied accessing /admin/roles');

    const res = await agent
      .get('/api/admin/roles')
      .set('Cookie', `sitelens_session=${pmoToken}`);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.roles));

    const roleMap = new Map(res.body.roles.map((r: any) => [r.id, r]));
    assert.ok(roleMap.has('head_office_pmo'), 'head_office_pmo role must exist');
    assert.ok(roleMap.has('site_engineer'), 'site_engineer role must exist');
    assert.ok(roleMap.has('client_viewer'), 'client_viewer role must exist');

    const pmoRole: any = roleMap.get('head_office_pmo');
    assert.equal(pmoRole.isSystem, true, 'Built-in role must be marked isSystem=true');
    assert.ok(pmoRole.permissions.includes(PERMISSIONS.ADMIN_ROLES), 'head_office_pmo must have admin.roles');
  });

  // 2. GET /api/admin/permissions
  await t.test('2. GET /api/admin/permissions returns complete permission catalogue', async () => {
    const res = await agent
      .get('/api/admin/permissions')
      .set('Cookie', `sitelens_session=${pmoToken}`);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.permissions));
    assert.ok(res.body.permissions.length >= 25, 'Catalogue must contain all registered permissions');

    const permIds = new Set(res.body.permissions.map((p: any) => p.id));
    assert.ok(permIds.has(PERMISSIONS.PROJECT_VIEW));
    assert.ok(permIds.has(PERMISSIONS.WBS_EDIT_DETAIL));
    assert.ok(permIds.has(PERMISSIONS.STAGE_APPROVE));
    assert.ok(permIds.has(PERMISSIONS.ADMIN_ROLES));
  });

  // 3. POST /api/admin/roles - Create custom role
  const customRoleId = 'junior_qa_tester';
  await t.test('3. POST /api/admin/roles creates custom role with permissions', async () => {
    const res = await agent
      .post('/api/admin/roles')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        id: customRoleId,
        name: 'Junior QA Tester',
        permissions: [PERMISSIONS.PROJECT_VIEW, PERMISSIONS.WBS_VIEW, PERMISSIONS.STAGE_EXECUTE],
      });

    assert.equal(res.status, 201);
    assert.equal(res.body.role.id, customRoleId);
    assert.equal(res.body.role.name, 'Junior QA Tester');
    assert.equal(res.body.role.isSystem, false, 'Custom role must be isSystem=false');
    assert.deepEqual(res.body.role.permissions.sort(), [
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.STAGE_EXECUTE,
      PERMISSIONS.WBS_VIEW,
    ].sort());

    // Duplicate ID returns 409
    const resDup = await agent
      .post('/api/admin/roles')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        id: customRoleId,
        name: 'Duplicate Role',
      });
    assert.equal(resDup.status, 409);
  });

  // 4. PUT /api/admin/roles/:id - Update custom role & Super Admin protection
  await t.test('4. PUT /api/admin/roles/:id updates role & protects Super Admin', async () => {
    // 4.a Update custom role
    const resUpdate = await agent
      .put(`/api/admin/roles/${customRoleId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        name: 'Junior Quality Specialist',
        permissions: [PERMISSIONS.PROJECT_VIEW, PERMISSIONS.STAGE_EXECUTE],
      });

    assert.equal(resUpdate.status, 200);
    assert.equal(resUpdate.body.role.name, 'Junior Quality Specialist');
    assert.equal(resUpdate.body.role.permissions.length, 2);

    // 4.b Attempting to strip admin.roles or system.break_glass from head_office_pmo returns 400
    const resSuperAdminStrip = await agent
      .put('/api/admin/roles/head_office_pmo')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        permissions: [PERMISSIONS.PROJECT_VIEW], // Missing admin.roles & system.break_glass
      });

    assert.equal(resSuperAdminStrip.status, 400);
    assert.ok(resSuperAdminStrip.body.error.includes('head_office_pmo'));
  });

  // 5. DELETE /api/admin/roles/:id - Protection rules
  await t.test('5. DELETE /api/admin/roles/:id protects system roles and active assignments', async () => {
    // 5.a Cannot delete system role
    const resDelSystem = await agent
      .delete('/api/admin/roles/site_engineer')
      .set('Cookie', `sitelens_session=${pmoToken}`);
    assert.equal(resDelSystem.status, 400);
    assert.ok(resDelSystem.body.error.includes('bawaan sistem'));

    // 5.b Assign custom role to a user, then verify deletion is blocked
    const db = getDb()!;
    const inspectorId = ROLE_USER_MAP.field_inspector.id;
    await db.insert(roleAssignments).values({
      userId: inspectorId as any,
      roleId: customRoleId,
      scopeType: 'project',
      projectId: PRJ_B_ID as any,
      isActive: true,
      source: 'manual',
    });

    const resDelInUse = await agent
      .delete(`/api/admin/roles/${customRoleId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`);
    assert.equal(resDelInUse.status, 400);
    assert.ok(resDelInUse.body.error.includes('aktif'));

    // Remove assignment and delete succeeds
    await db.delete(roleAssignments).where(
      and(
        eq(roleAssignments.userId, inspectorId as any),
        eq(roleAssignments.roleId, customRoleId)
      )
    );

    const resDelSuccess = await agent
      .delete(`/api/admin/roles/${customRoleId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`);
    assert.equal(resDelSuccess.status, 204);
  });

  // 6. Project Members Management: GET/POST/DELETE /api/projects/:projectId/members
  await t.test('6. Project Members: GET/POST/DELETE manages contextual membership', async () => {
    // 6.a GET project members
    const resGet = await agent
      .get(`/api/projects/${PRJ_A_ID}/members`)
      .set('Cookie', `sitelens_session=${pmoToken}`);

    assert.equal(resGet.status, 200);
    assert.ok(Array.isArray(resGet.body.members));
    assert.ok(resGet.body.members.length > 0);

    // 6.b Add member to Project B
    const inspectorId = ROLE_USER_MAP.field_inspector.id;
    const resAdd = await agent
      .post(`/api/projects/${PRJ_B_ID}/members`)
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        userId: inspectorId,
        roleId: 'field_inspector',
      });

    assert.equal(resAdd.status, 201);
    assert.equal(resAdd.body.assignment.userId, inspectorId);
    assert.equal(resAdd.body.assignment.projectId, PRJ_B_ID);

    // Verify member is now in GET list
    const resGetB = await agent
      .get(`/api/projects/${PRJ_B_ID}/members`)
      .set('Cookie', `sitelens_session=${pmoToken}`);
    const memberUserIds = resGetB.body.members.map((m: any) => m.userId);
    assert.ok(memberUserIds.includes(inspectorId));

    // 6.c Remove member from Project B
    const resRemove = await agent
      .delete(`/api/projects/${PRJ_B_ID}/members/${inspectorId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`);
    assert.equal(resRemove.status, 204);

    // Verify member is no longer active in Project B
    const resGetBAfter = await agent
      .get(`/api/projects/${PRJ_B_ID}/members`)
      .set('Cookie', `sitelens_session=${pmoToken}`);
    const memberUserIdsAfter = resGetBAfter.body.members.map((m: any) => m.userId);
    assert.ok(!memberUserIdsAfter.includes(inspectorId));
  });

  // 7. Real-Time Authorization Resolution with Custom Role
  await t.test('7. Real-time authorization: custom role assignment immediately reflects in my-permissions', async () => {
    // Create new custom role with specific permissions
    const auditorRoleId = 'safety_compliance_auditor';
    await agent
      .post('/api/admin/roles')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        id: auditorRoleId,
        name: 'Safety Compliance Auditor',
        permissions: [PERMISSIONS.PROJECT_VIEW, PERMISSIONS.WEATHER_LOG],
      });

    // Inspector currently has NO weather.log permission
    const resBefore = await agent
      .get(`/api/projects/${PRJ_A_ID}/my-permissions`)
      .set('Cookie', `sitelens_session=${inspectorToken}`);
    assert.ok(!resBefore.body.effectivePermissions.includes(PERMISSIONS.WEATHER_LOG));

    // Assign auditor role to inspector on PRJ_A
    const inspectorId = ROLE_USER_MAP.field_inspector.id;
    await agent
      .post(`/api/projects/${PRJ_A_ID}/members`)
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        userId: inspectorId,
        roleId: auditorRoleId,
      });

    // Inspector now immediately HAS weather.log permission on PRJ_A!
    const resAfter = await agent
      .get(`/api/projects/${PRJ_A_ID}/my-permissions`)
      .set('Cookie', `sitelens_session=${inspectorToken}`);
    assert.ok(resAfter.body.effectivePermissions.includes(PERMISSIONS.WEATHER_LOG));
  });

  // 8. Protection of Last Active Tenant Admin
  await t.test('8. Protection of last active tenant admin prevents lockout', async () => {
    const pmoUserId = ROLE_USER_MAP.head_office_pmo.id;

    // Attempting to demote the sole active PMO user via PATCH /users/:id returns 409
    const resDemote = await agent
      .patch(`/api/users/${pmoUserId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        role: 'Field / QC Inspector',
      });
    assert.equal(resDemote.status, 409);
    assert.ok(resDemote.body.error.includes('last active'));

    // Attempting to deactivate the sole active PMO user returns 409
    const resDeactivate = await agent
      .patch(`/api/users/${pmoUserId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        isActive: false,
      });
    assert.equal(resDeactivate.status, 409);
  });

  // 9. PUT /api/projects/:projectId - Update project metadata
  await t.test('9. PUT /api/projects/:projectId updates project metadata', async () => {
    const res = await agent
      .put(`/api/projects/${PRJ_A_ID}`)
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        leadManager: 'Budi Santoso, M.T.',
        location: 'Surabaya Timur',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.project.leadManager, 'Budi Santoso, M.T.');
    assert.equal(res.body.project.location, 'Surabaya Timur');
  });
});
