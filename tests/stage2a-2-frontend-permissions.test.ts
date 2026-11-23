/**
 * Tahap 2a-2: Rollout Frontend Otorisasi Integration Tests
 * Corresponds to Blueprint Section H (Tahap 2a-2) and Section 6 (Sub-Tahap 2a-2).
 *
 * Verifies:
 * 1. GET /api/auth/me returns user + globalPermissions.
 * 2. GET /api/projects/:projectId/my-permissions returns real-time effectivePermissions.
 * 3. Cross-project isolation: User assigned to PRJ_A has permissions on PRJ_A, but empty on PRJ_B.
 * 4. Client Viewer has 0 mutation permissions in effectivePermissions.
 * 5. Head Office / PMO has universal org-level permissions in globalPermissions.
 * 6. Unauthenticated requests are rejected with 401.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';

import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { closeDb } from '../src/server/db/index.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { PERMISSIONS } from '../src/types/permissions.ts';

// Modular fixtures from stage2a
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

test('Tahap 2a-2: Frontend Permission Endpoints & Authorization Resolution', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();

  const app = createTestApp();
  const agent = supertest(app);

  t.after(async () => {
    await closeDb();
  });

  // 1. GET /api/auth/me returns globalPermissions
  await t.test('1. GET /api/auth/me returns globalPermissions array', async () => {
    const pmoToken = ROLE_USER_MAP.head_office_pmo.token;
    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', `sitelens_session=${pmoToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
    assert.ok(Array.isArray(res.body.globalPermissions), 'globalPermissions must be an array');

    // Head Office / PMO must have organization-level permissions
    const globalPerms = new Set(res.body.globalPermissions);
    assert.ok(globalPerms.has(PERMISSIONS.PROJECT_CREATE), 'PMO must have project.create in globalPermissions');
    assert.ok(globalPerms.has(PERMISSIONS.ADMIN_ROLES), 'PMO must have admin.roles in globalPermissions');
    assert.ok(globalPerms.has(PERMISSIONS.ADMIN_USERS), 'PMO must have admin.users in globalPermissions');
    assert.ok(globalPerms.has(PERMISSIONS.SYSTEM_BREAK_GLASS), 'PMO must have system.break_glass in globalPermissions');
  });

  // 2. Non-org user has empty globalPermissions
  await t.test('2. Non-org role (field_inspector) has empty globalPermissions', async () => {
    const inspectorToken = ROLE_USER_MAP.field_inspector.token;
    const res = await agent
      .get('/api/auth/me')
      .set('Cookie', `sitelens_session=${inspectorToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.authenticated, true);
    assert.ok(Array.isArray(res.body.globalPermissions));
    // Field inspector has only project-scope assignments, so globalPermissions is empty
    assert.equal(res.body.globalPermissions.length, 0, 'Field inspector should have 0 org-level permissions');
  });

  // 3. GET /api/projects/:projectId/my-permissions returns effective permissions on assigned project
  await t.test('3. GET /api/projects/:projectId/my-permissions returns project permissions', async () => {
    const engineerToken = ROLE_USER_MAP.site_engineer.token;
    const res = await agent
      .get(`/api/projects/${PRJ_A_ID}/my-permissions`)
      .set('Cookie', `sitelens_session=${engineerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.projectId, PRJ_A_ID);
    assert.ok(Array.isArray(res.body.effectivePermissions));

    const effective = new Set(res.body.effectivePermissions);
    assert.ok(effective.has(PERMISSIONS.WBS_EDIT_DETAIL), 'Site Engineer must have wbs.edit_detail on PRJ_A');
    assert.ok(effective.has(PERMISSIONS.STAGE_REQUEST), 'Site Engineer must have stage.request on PRJ_A');
    assert.ok(effective.has(PERMISSIONS.WEATHER_LOG), 'Site Engineer must have weather.log on PRJ_A');
    assert.ok(effective.has(PERMISSIONS.EVIDENCE_UPLOAD), 'Site Engineer must have evidence.upload on PRJ_A');
  });

  // 4. Cross-project isolation: Site Engineer assigned to PRJ_A has NO permissions on PRJ_B
  await t.test('4. Cross-project isolation: Site Engineer assigned to PRJ_A has empty permissions on PRJ_B', async () => {
    const engineerToken = ROLE_USER_MAP.site_engineer.token;
    const res = await agent
      .get(`/api/projects/${PRJ_B_ID}/my-permissions`)
      .set('Cookie', `sitelens_session=${engineerToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.projectId, PRJ_B_ID);

    const effective = new Set(res.body.effectivePermissions);
    // User is NOT assigned to PRJ_B and has no org scope, so effective permissions must be empty
    assert.equal(effective.size, 0, 'User not assigned to PRJ_B must have 0 effective permissions on PRJ_B');
  });

  // 5. Client Viewer has 0 mutation permissions in effectivePermissions
  await t.test('5. Client Viewer has read permissions but 0 mutation permissions in effectivePermissions', async () => {
    const viewerToken = ROLE_USER_MAP.client_viewer.token;
    const res = await agent
      .get(`/api/projects/${PRJ_A_ID}/my-permissions`)
      .set('Cookie', `sitelens_session=${viewerToken}`);

    assert.equal(res.status, 200);
    const effective = new Set(res.body.effectivePermissions);

    // Read permissions allowed
    assert.ok(effective.has(PERMISSIONS.PROJECT_VIEW), 'Client Viewer has project.view');
    assert.ok(effective.has(PERMISSIONS.WBS_VIEW), 'Client Viewer has wbs.view');
    assert.ok(effective.has(PERMISSIONS.REPORT_VIEW), 'Client Viewer has report.view');

    // Mutation permissions strictly absent
    const MUTATION_PERMISSIONS = [
      PERMISSIONS.STAGE_REQUEST,
      PERMISSIONS.STAGE_EXECUTE,
      PERMISSIONS.STAGE_APPROVE,
      PERMISSIONS.WBS_EDIT_DETAIL,
      PERMISSIONS.WBS_EDIT_STRUCTURE,
      PERMISSIONS.CAPA_CREATE,
      PERMISSIONS.CAPA_UPDATE_PROGRESS,
      PERMISSIONS.CAPA_CLOSE,
      PERMISSIONS.WEATHER_LOG,
      PERMISSIONS.EVIDENCE_UPLOAD,
      PERMISSIONS.ADMIN_USERS,
      PERMISSIONS.ADMIN_ROLES,
    ];

    for (const mutationPerm of MUTATION_PERMISSIONS) {
      assert.equal(
        effective.has(mutationPerm),
        false,
        `Client Viewer MUST NOT have mutation permission: ${mutationPerm}`
      );
    }
  });

  // 6. Unauthenticated requests are rejected with 401
  await t.test('6. Unauthenticated requests to permission endpoints return 401', async () => {
    const [meRes, projRes] = await Promise.all([
      agent.get('/api/auth/me'),
      agent.get(`/api/projects/${PRJ_A_ID}/my-permissions`),
    ]);

    assert.equal(meRes.status, 401, '/api/auth/me without session must return 401');
    assert.equal(projRes.status, 401, '/api/projects/:id/my-permissions without session must return 401');
  });
});
