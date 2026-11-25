/**
 * Tahap 2a: RBAC Matrix, Route Registry Reflection & Isolation Verification
 *
 * Optimized for speed:
 *   - supertest(app) — no listen/close per suite.
 *   - Single DB connection for the whole suite.
 *   - Sessions inserted directly (pre-hashed SHA-256, zero Argon2 per test).
 *   - Matrix 7.a runs all 7 roles in parallel (Promise.all).
 *   - Each role uses an empty / minimal body — only tests authz, not business logic.
 *   - restoreDeletables() called once before 7.d (not 7x inside 7.a).
 *
 * Coverage: 7 roles × 23 mutation routes from Table F.5 (incl. POST /uploads) = 161 assertions.
 * NOTE: PUT /projects/:projectId is listed in F.5 but not yet implemented (Tahap 2b).
 *
 * Allowed criteria: status ∈ {200,201,204,400,404,409,422} — not 401/403/5xx.
 * Forbidden criteria: status === 403 exactly.
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
import { users, roleAssignments } from '../src/server/db/schema.ts';
import { attachSessionUser, requireAuth } from '../src/server/auth/middleware.ts';
import {
  PERMISSIONS,
  BUILTIN_ROLES,
  PERMISSION_DEFINITIONS,
  seedLegacyRoleAssignments,
  syncUserLegacyAssignments,
  requirePermission,
} from '../src/server/auth/rbac.ts';
import { hashSecret, hashSessionToken } from '../src/server/auth/crypto.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { tenantRouter } from '../src/server/routes/tenant.ts';
import { notificationsRouter } from '../src/server/routes/notifications.ts';
import { uploadsRouter } from '../src/server/routes/uploads.ts';
import { authRouter } from '../src/server/routes/auth.ts';

// Modular fixtures
import {
  ROLE_KEYS, ROLE_USER_MAP, PRJ_A_ID, PRJ_B_ID,
  NODE_B_ID, type BuiltinRoleKey,
} from './fixtures/stage2a-matrix-fixtures.ts';
import { MUTATION_ROUTES } from './fixtures/stage2a-mutation-routes.ts';
import { seedMatrixDatabase, restoreDeletables } from './fixtures/stage2a-db-seed.ts';
import { scanAppRoutes } from './helpers/express-route-scanner.ts';

// ---------------------------------------------------------------------------
// App factory (created once per suite)
// ---------------------------------------------------------------------------
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser);

  app.use('/api/auth', authRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/tenant', tenantRouter);
  app.use('/api', apiRouter);

  // Registered as in server.ts
  app.post(
    '/api/templates/generate',
    requireAuth,
    requirePermission(PERMISSIONS.TEMPLATE_MANAGE),
    async (_req: Request, res: Response) => { res.json({ success: true }); }
  );

  return app;
}

// ---------------------------------------------------------------------------
// Supertest helper — sets Cookie header, sends JSON body when provided
// ---------------------------------------------------------------------------
function makeAgent(app: ReturnType<typeof createTestApp>) {
  const agent = supertest(app);

  return async function req(
    method: string,
    path: string,
    token: string,
    body?: Record<string, unknown>
  ): Promise<{ status: number; body: any }> {
    let r = (agent as any)[method.toLowerCase()](path)
      .set('Cookie', `sitelens_session=${token}`);
    if (body !== undefined) r = r.send(body).set('Content-Type', 'application/json');
    const res = await r;
    return { status: res.status, body: res.body };
  };
}

// ---------------------------------------------------------------------------
// Permission resolution helper (mirrors runtime logic for expected outcomes)
// ---------------------------------------------------------------------------
function isRoleAllowed(roleKey: BuiltinRoleKey, route: (typeof MUTATION_ROUTES)[number]): boolean {
  const roleDef = BUILTIN_ROLES.find((r) => r.id === roleKey);
  if (!roleDef) return false;

  const rolePermSet = new Set(roleDef.permissions);

  for (const permKey of route.requiredPermissions) {
    if (!rolePermSet.has(permKey as any)) continue;

    const permDef = PERMISSION_DEFINITIONS.find((p) => p.id === permKey);
    const scopeLevel = permDef?.scopeLevel ?? 'project';

    if (roleKey === 'head_office_pmo') {
      // org-scope: allowed for [ORG] and [ORG/PRJ]
      if (scopeLevel === 'organization' || scopeLevel === 'organization_or_project') return true;
    } else {
      // project-scope: allowed for [PRJ] and [ORG/PRJ]
      if (scopeLevel === 'project' || scopeLevel === 'organization_or_project') return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
test('Tahap 2a: RBAC Matrix, Route Registry Reflection & Isolation Verification', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();

  const app = createTestApp();
  const req = makeAgent(app);

  t.after(async () => { await closeDb(); });

  // =========================================================================
  // 7.a. Matrix-Driven HTTP Test: 7 roles × all mutation routes from F.5
  //      Runs all 7 roles IN PARALLEL — read-only authz checks, no mutations.
  // =========================================================================
  await t.test('7.a. Matrix-Driven HTTP Test: 7 roles x all mutation routes match F.4 matrix', async () => {
    // Allowed status codes: permission passed but business logic may reject.
    // 401/403 from allowed roles = authz failure. 5xx = bug.
    const ALLOWED_STATUSES = new Set([200, 201, 204, 400, 404, 409, 422]);
    let checkedCount = 0;
    const authzBugs: string[] = [];

    for (const roleKey of ROLE_KEYS) {
      const { token } = ROLE_USER_MAP[roleKey];
      await restoreDeletables();

      const results = await Promise.all(MUTATION_ROUTES.map(async (route) => {
        const expectedAllowed = isRoleAllowed(roleKey, route);
        const res = await req(route.method, route.path, token, route.body ?? {});
        return { route, expectedAllowed, res };
      }));

      for (const { route, expectedAllowed, res } of results) {
        if (expectedAllowed) {
          // Role has permission: must NOT get 401/403/5xx
          const statusOk = ALLOWED_STATUSES.has(res.status);
          if (!statusOk) {
            authzBugs.push(
              `AUTHZ BUG: role='${roleKey}' on ${route.name} → ${res.status} (expected one of ${[...ALLOWED_STATUSES].join(',')}): ${JSON.stringify(res.body)}`
            );
          }
          assert.ok(
            statusOk,
            `Role '${roleKey}' SHOULD HAVE ACCESS to ${route.name}, got ${res.status}: ${JSON.stringify(res.body)}`
          );
        } else {
          // Role lacks permission: must get exactly 403
          assert.equal(
            res.status, 403,
            `Role '${roleKey}' MUST BE FORBIDDEN from ${route.name}, got ${res.status}: ${JSON.stringify(res.body)}`
          );
        }
        checkedCount++;
      }
    }

    assert.equal(checkedCount, ROLE_KEYS.length * MUTATION_ROUTES.length,
      `Expected ${ROLE_KEYS.length * MUTATION_ROUTES.length} checks, got ${checkedCount}`);

    if (authzBugs.length > 0) {
      console.log('\n--- AUTHZ BUGS ---\n' + authzBugs.join('\n') + '\n---');
    }
  });

  // =========================================================================
  // 7.b. Route Registry Catch-All: every mutation route must declare requirePermission
  // =========================================================================
  await t.test('7.b. Route Registry Catch-All: Every mutation route must declare requirePermission', async () => {
    // Public (no-auth) routes: login flows only. WebAuthn register-* require requireAuth → NOT here.
    // POST /api/auth/pin-setup requires requireAuth but no additional permission → whitelist.
    const publicWhitelist = new Set([
      'POST /api/auth/login',
      'POST /api/auth/pin-login',
      'POST /api/auth/logout',
      'POST /api/auth/webauthn/login-options',
      'POST /api/auth/webauthn/login-verify',
      'POST /api/auth/pin-setup',
      // register-options and register-verify require requireAuth (session required).
      // They are NOT public — scanner may not detect requireAuth as a permission guard,
      // so they are whitelisted here with explicit comment: auth-only, no additional permission needed.
      'POST /api/auth/webauthn/register-options',
      'POST /api/auth/webauthn/register-verify',
      // POST /api/uploads now has requirePermission(EVIDENCE_UPLOAD) — removed from whitelist (Tahap 2a item 4)
    ]);

    const discovered = scanAppRoutes(app);
    const unmapped = discovered.filter((r) => {
      const key = `${r.method} ${r.fullPath}`;
      return !publicWhitelist.has(key) && !r.hasPermission;
    });

    assert.equal(
      unmapped.length, 0,
      `Fail-Closed Security Violation! Mutation routes lacking requirePermission:\n${unmapped.map((r) => `  ${r.method} ${r.fullPath}`).join('\n')}`
    );
  });

  // =========================================================================
  // 7.c. Isolation regression + Org-Scope behavior + Legacy Seed (G.1.C)
  // =========================================================================
  await t.test('7.c. Isolation regression, Org-Scope behavior & Legacy Seeding', async () => {
    const engineerToken = ROLE_USER_MAP.site_engineer.token;
    const pmoToken      = ROLE_USER_MAP.head_office_pmo.token;

    // 1. Project isolation: site engineer on A cannot access B
    const [bReadRes, bWriteRes] = await Promise.all([
      req('GET', `/api/projects/${PRJ_B_ID}/wbs`, engineerToken),
      req('PUT', `/api/projects/${PRJ_B_ID}/wbs/nodes/${NODE_B_ID}`, engineerToken, { name: 'illicit' }),
    ]);
    assert.equal(bReadRes.status,  403, 'Site Engineer must be denied reading Project B WBS');
    assert.equal(bWriteRes.status, 403, 'Site Engineer must be denied editing Project B node');

    // 2. Org-scope (PMO): universal read across all projects
    const [pmoA, pmoB] = await Promise.all([
      req('GET', `/api/projects/${PRJ_A_ID}/wbs`, pmoToken),
      req('GET', `/api/projects/${PRJ_B_ID}/wbs`, pmoToken),
    ]);
    assert.equal(pmoA.status, 200, 'PMO must have universal read on Project A');
    assert.equal(pmoB.status, 200, 'PMO must have universal read on Project B');

    // 3. Org-scope without project assignment denied [PRJ] mutations
    const pmoWeather = await req('POST', `/api/projects/${PRJ_A_ID}/weather-logs`, pmoToken,
      { logDate: '2026-11-24', rainHours: 1, weatherCondition: 'Clear', isWorkHalted: false });
    assert.equal(pmoWeather.status, 403, 'PMO without project assignment must be denied project-scoped mutations');

    // 4. Org-scope allowed [ORG] mutations (project creation)
    const pmoCreate = await req('POST', '/api/projects', pmoToken, {
      name: 'PMO Created Project', client: 'Gamma Client', leadManager: 'PMO Lead',
      location: 'Medan', code: 'PRJ-GAMMA-7C',
      zones: [{ id: 'z1', name: 'Z1', description: 'Zone', safetyLevel: 'Standard' }],
    });
    assert.equal(pmoCreate.status, 201, 'PMO must be allowed [ORG] project creation');

    // 5. Atomic auto-assignment of project creator (F.1.D)
    const newPrjId = pmoCreate.body.project?.id;
    assert.ok(newPrjId, 'New project ID should be returned');
    const db = getDb();
    if (!db) throw new Error('DB unavailable');
    const autoAssignments = await db.select().from(roleAssignments).where(eq(roleAssignments.projectId, newPrjId));
    assert.equal(autoAssignments.length, 1, 'Project creator must be auto-assigned');
    assert.equal(autoAssignments[0].userId, ROLE_USER_MAP.head_office_pmo.id);
    assert.equal(autoAssignments[0].roleId, 'project_manager');

    // 6. Legacy seed (G.1.C) — run twice to prove idempotency
    const legacyAdminId = '90000000-0000-4000-8000-000000000001';
    const legacyEngId   = '90000000-0000-4000-8000-000000000002';

    await db.insert(users).values([
      { id: legacyAdminId, username: 'legacy_admin', email: 'legacy.admin@sitelens.local', name: 'Legacy Admin', title: 'Director', role: 'Project Director & Tenant Admin', assignedProjects: [], passwordHash: hashSecret('pass123'), isActive: true },
      { id: legacyEngId,   username: 'legacy_eng',   email: 'legacy.engineer@sitelens.local', name: 'Legacy Engineer', title: 'Engineer', role: 'Project / Site Engineer', assignedProjects: [PRJ_A_ID], passwordHash: hashSecret('pass123'), isActive: true },
    ]);

    await seedLegacyRoleAssignments();
    await seedLegacyRoleAssignments(); // idempotency check

    const adminAssign = await db.select().from(roleAssignments).where(eq(roleAssignments.userId, legacyAdminId));
    assert.ok(adminAssign.some((a) => a.scopeType === 'organization' && a.roleId === 'head_office_pmo'),
      'Legacy admin must get org-scope head_office_pmo');
    assert.ok(adminAssign.some((a) => a.scopeType === 'project' && a.projectId === PRJ_A_ID && a.roleId === 'project_manager'),
      'Legacy admin must get project_manager on PRJ_A');

    const engAssign = await db.select().from(roleAssignments).where(eq(roleAssignments.userId, legacyEngId));
    assert.ok(engAssign.some((a) => a.scopeType === 'project' && a.projectId === PRJ_A_ID && a.roleId === 'site_engineer'),
      'Legacy engineer must get site_engineer on PRJ_A');
  });

  // =========================================================================
  // 7.d. Client Viewer: all mutations rejected due to lack of permission (not role name)
  // =========================================================================
  await t.test('7.d. Client Viewer: all mutations rejected due to lack of permission', async () => {
    await restoreDeletables();
    const { token } = ROLE_USER_MAP.client_viewer;

    for (const route of MUTATION_ROUTES) {
      const res = await req(route.method, route.path, token, route.body ?? {});
      assert.equal(res.status, 403,
        `Client Viewer MUST be rejected with 403 on ${route.name}, got: ${res.status}`);
      assert.match(res.body.error ?? '', /Forbidden: Insufficient permissions/,
        `Error must indicate permission-based rejection on ${route.name}: ${JSON.stringify(res.body)}`);
    }
  });

  // =========================================================================
  // 7.e. POST /users shim: new user gets role_assignments on creation
  // =========================================================================
  await t.test('7.e. POST /users shim: new user gets role_assignments seeded automatically', async () => {
    const db = getDb();
    if (!db) throw new Error('DB unavailable');
    const { token } = ROLE_USER_MAP.head_office_pmo; // has ADMIN_USERS

    const newUserEmail = `shim-test-${Date.now()}@sitelens.local`;
    const res = await req('POST', '/api/users', token, {
      email: newUserEmail,
      name: 'Shim Test User',
      username: `shimuser_${Date.now()}`,
      role: 'Field / QC Inspector',
      password: 'Str0ngPass!99',
      assignedProjects: [PRJ_A_ID],
    });

    // 201: user created
    assert.equal(res.status, 201, `POST /users should return 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const newUserId = res.body.user?.id;
    assert.ok(newUserId, 'Response must include new user id');

    // Check role_assignments populated (shim writes them on creation)
    const assignments = await db.select().from(roleAssignments).where(eq(roleAssignments.userId, newUserId));
    assert.ok(
      assignments.length > 0,
      `New user must have role_assignments seeded. Got 0. ` +
      `[NOTE] If shim not implemented, user is locked out of all project routes. ` +
      `Current state: ${JSON.stringify(assignments)}`
    );
  });

  // =========================================================================
  // 7.f. WebAuthn: register-options and register-verify require active session
  // =========================================================================
  await t.test('7.f. WebAuthn register routes require session (not public)', async () => {
    // With NO session cookie, register-options and register-verify must return 401.
    // login-options and login-verify are genuinely public (no session needed).
    const noAuth = supertest(app);

    const [regOpts, regVerify, loginOpts, loginVerify] = await Promise.all([
      noAuth.post('/api/auth/webauthn/register-options').send({ password: 'x' }).set('Content-Type', 'application/json'),
      noAuth.post('/api/auth/webauthn/register-verify').send({}).set('Content-Type', 'application/json'),
      noAuth.post('/api/auth/webauthn/login-options').send({}).set('Content-Type', 'application/json'),
      noAuth.post('/api/auth/webauthn/login-verify').send({ challengeToken: 'x', response: { id: 'y' } }).set('Content-Type', 'application/json'),
    ]);

    // register-* need session → 401 without cookie
    assert.equal(regOpts.status, 401,
      `register-options must reject unauthenticated requests (got ${regOpts.status})`);
    assert.equal(regVerify.status, 401,
      `register-verify must reject unauthenticated requests (got ${regVerify.status})`);

    // login-* are public — should NOT return 401 (may return 400 for bad payload)
    assert.notEqual(loginOpts.status, 401,
      `login-options must be public (got ${loginOpts.status})`);
    assert.notEqual(loginVerify.status, 401,
      `login-verify must be public (got ${loginVerify.status})`);
  });

  // =========================================================================
  // 7.g. Golden Test: scanner-discovered routes match MUTATION_ROUTES catalogue
  // =========================================================================
  await t.test('7.g. Golden: scanner-discovered mutation routes match F.5 catalogue', async () => {
    const publicAuthPaths = new Set([
      '/api/auth/login', '/api/auth/pin-login', '/api/auth/logout',
      '/api/auth/webauthn/login-options', '/api/auth/webauthn/login-verify',
      '/api/auth/pin-setup', '/api/auth/webauthn/register-options',
      '/api/auth/webauthn/register-verify',
    ]);

    const discovered = scanAppRoutes(app)
      .filter((r) => r.method !== 'GET' && !publicAuthPaths.has(r.fullPath));

    const discoveredKeys = new Set(discovered.map((r) => `${r.method} ${r.fullPath}`));

    // Normalize MUTATION_ROUTES names (e.g. "POST /projects/:projectId/wbs/nodes" -> "POST /api/projects/:projectId/wbs/nodes")
    const cataloguePatternKeys = new Set(
      MUTATION_ROUTES.map((r) => {
        const parts = r.name.split(' ');
        const method = parts[0];
        const p = parts.slice(1).join(' ');
        return `${method} /api${p.startsWith('/') ? p : '/' + p}`;
      })
    );

    // Routes in Express scanner that are not in MUTATION_ROUTES:
    // 1. POST /api/notifications/test (test webhook/email notification)
    // 2. POST /api/projects/:projectId/scurve/override (F.5 row 9 manual curve override)
    // 3. POST /api/templates/import (template batch import)
    // 4. POST /api/templates/generate (AI-assisted checklist generation)
    // Tahap 2b: Role & Permission Editor and Project Members routes
    const expectedAdditionalRoutes = new Set([
      'POST /api/notifications/test',
      'POST /api/projects/:projectId/scurve/override',
      'POST /api/templates/import',
      'POST /api/templates/generate',
      'PUT /api/projects/:projectId',
      'POST /api/projects/:projectId/members',
      'DELETE /api/projects/:projectId/members/:userId',
      'POST /api/admin/roles',
      'PUT /api/admin/roles/:id',
      'DELETE /api/admin/roles/:id',
      'POST /api/admin/assignments',
      'DELETE /api/admin/assignments/:assignmentId',
      // Tahap 2c: RFI Stage Request & Flow Presets Management
      'POST /api/stages/:stageId/request',
      'POST /api/flow-presets',
      'PUT /api/flow-presets/:id',
      'DELETE /api/flow-presets/:id',
      // Tahap 3b: WBS allow_detailing & Batch Detailing
      'POST /api/projects/:projectId/wbs/nodes/:parentId/details-batch',
      'POST /api/projects/:projectId/wbs/nodes/:parentId/approve-details',
      // Focus Setup Flow (Fase B3)
      'POST /api/master-projects',
      'PATCH /api/master-projects/:id',
      'PATCH /api/master-projects/:id/archive',
      'DELETE /api/master-projects/:id',
      'POST /api/master-projects/:id/sites',
      'DELETE /api/projects/:projectId',
      'POST /api/projects/:projectId/assignments',
      'PUT /api/projects/:projectId/assignments/:assignmentId',
      'DELETE /api/projects/:projectId/assignments/:assignmentId',
      'PATCH /api/projects/:projectId/wbs/nodes/:nodeId/detailing',
      'PUT /api/projects/:projectId/wbs/nodes-batch',
      'POST /api/projects/:projectId/wbs/nodes/:nodeId/stages',
      'PUT /api/projects/:projectId/wbs/stages/:stageId',
      'DELETE /api/projects/:projectId/wbs/stages/:stageId',
    ]);

    // Golden check 1: All 23 catalogue routes MUST exist in discovered Express registry
    for (const key of cataloguePatternKeys) {
      assert.ok(
        discoveredKeys.has(key),
        `Catalogue route '${key}' not found in Express router registry!`
      );
    }

    // Golden check 2: All discovered routes beyond the 23 must be explicitly accounted for
    const unaccountedRoutes = [...discoveredKeys].filter(
      (k) => !cataloguePatternKeys.has(k) && !expectedAdditionalRoutes.has(k)
    );

    assert.equal(
      unaccountedRoutes.length,
      0,
      `Unexpected undocumented mutation routes in Express registry:\n${unaccountedRoutes.join('\n')}`
    );
  });

  // =========================================================================
  // 7.h. Break-glass: audit written; non-break_glass role rejected
  //      Break-glass permission held by: head_office_pmo only
  // =========================================================================
  await t.test('7.h. break_glass: audit written; non-break_glass role rejected', async () => {
    const db = getDb();
    if (!db) throw new Error('DB unavailable');

    const { auditLogs } = await import('../src/server/db/schema.ts');

    // 1. head_office_pmo has system.break_glass → with X-Break-Glass: true, any protected route passes
    const pmoToken = ROLE_USER_MAP.head_office_pmo.token;

    // Count audit logs before
    const beforeCount = (await db.select().from(auditLogs)).length;

    // POST /api/projects is [ORG]-scoped and head_office_pmo has PROJECT_CREATE
    // But even if NOT allowed, break-glass bypasses. Use a route where PMO would normally
    // be denied: weather-log on a project-scoped route (PRJ-scope, pmo lacks it without assignment)
    const bgRes = await (supertest(app) as any)
      .post(`/api/projects/${PRJ_A_ID}/weather-logs`)
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .set('X-Break-Glass', 'true')
      .send({ logDate: '2026-11-24', rainHours: 0, weatherCondition: 'Clear', isWorkHalted: false })
      .set('Content-Type', 'application/json');

    // Break-glass should let through (not 403)
    assert.notEqual(bgRes.status, 403,
      `break_glass should bypass 403 for head_office_pmo, got ${bgRes.status}: ${JSON.stringify(bgRes.body)}`);

    // Audit log must be written (CRITICAL_SECURITY_AUDIT)
    const afterLogs = await db.select().from(auditLogs);
    const breakGlassLog = afterLogs.find((l: any) =>
      l.action === 'CRITICAL_SECURITY_AUDIT' && l.entityType === 'system_break_glass'
    );
    assert.ok(breakGlassLog,
      `CRITICAL_SECURITY_AUDIT log entry must be created when break_glass is used. Logs after: ${afterLogs.length}, before: ${beforeCount}`);

    // 2. field_inspector does NOT have system.break_glass → X-Break-Glass header has no effect
    const fiToken = ROLE_USER_MAP.field_inspector.token;
    const fiRes = await (supertest(app) as any)
      .post('/api/projects')
      .set('Cookie', `sitelens_session=${fiToken}`)
      .set('X-Break-Glass', 'true')
      .send({ name: 'BG Test', client: 'C', leadManager: 'M', location: 'L', code: 'BG-99', zones: [] })
      .set('Content-Type', 'application/json');

    assert.equal(fiRes.status, 403,
      `field_inspector without break_glass permission must still get 403 even with X-Break-Glass header, got ${fiRes.status}`);
  });

  // =========================================================================
  // 7.i. Lazy-seed removed & syncUserLegacyAssignments verification
  //      (items 1 & 3 of Tahap 2a continuation)
  // =========================================================================
  await t.test('7.i. Lazy-seed removed & syncUserLegacyAssignments verification', async () => {
    const db = getDb();
    if (!db) throw new Error('DB unavailable');
    const { sessions } = await import('../src/server/db/schema.ts');

    // Create a user with a valid role but NO role_assignments
    const orphanId = 'eeeeeeee-0001-4000-8000-000000000001';
    const orphanRawToken = 'orphan-raw-token-stage2a';
    const orphanSessionId = hashSessionToken(orphanRawToken);

    // Clean prior runs
    await db.delete(roleAssignments).where(eq(roleAssignments.userId, orphanId));
    await db.delete(sessions).where(eq(sessions.id, orphanSessionId));
    await db.delete(users).where(eq(users.id, orphanId));

    // Insert user without any role_assignments
    await db.insert(users).values({
      id: orphanId,
      username: 'orphan_user',
      email: 'orphan@sitelens.local',
      name: 'Orphan User',
      title: 'Engineer',
      role: 'Project / Site Engineer',
      assignedProjects: [PRJ_A_ID],
      passwordHash: 'x',
      isActive: true,
    });

    // Insert session for orphan (no role_assignments — zero rows)
    await db.insert(sessions).values({
      id: orphanSessionId,
      userId: orphanId,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    // 1. With lazy-seed removed, this user MUST get 403 (no assignments = no access)
    const resNoAssignment = await req('GET', `/api/projects/${PRJ_A_ID}/wbs`, orphanRawToken);
    assert.equal(resNoAssignment.status, 403,
      `User with zero role_assignments must get 403 (lazy-seed removed). Got ${resNoAssignment.status}: ${JSON.stringify(resNoAssignment.body)}`);

    // 2. Call syncUserLegacyAssignments → creates role_assignments with source='legacy_sync'
    await syncUserLegacyAssignments(orphanId);

    const initialAssignments = await db.select().from(roleAssignments).where(eq(roleAssignments.userId, orphanId));
    assert.ok(initialAssignments.length > 0, 'Sync must create role assignments');
    assert.equal(initialAssignments[0].source, 'legacy_sync', 'Source must be legacy_sync');
    assert.equal(initialAssignments[0].roleId, 'site_engineer', 'Role must map to site_engineer');

    // User now has access
    const resAfterSync = await req('GET', `/api/projects/${PRJ_A_ID}/wbs`, orphanRawToken);
    assert.equal(resAfterSync.status, 200, 'User must have access after syncUserLegacyAssignments');

    // 3. Idempotency: running sync twice must NOT create duplicate rows
    await syncUserLegacyAssignments(orphanId);
    const assignmentsAfterSecondSync = await db.select().from(roleAssignments).where(eq(roleAssignments.userId, orphanId));
    assert.equal(assignmentsAfterSecondSync.length, initialAssignments.length,
      'Running sync twice must be idempotent and not create duplicate assignments');

    // 4. Manual assignment isolation: create a manual assignment
    const manualAssignId = 'eeeeeeee-0002-4000-8000-000000000002';
    await db.insert(roleAssignments).values({
      id: manualAssignId as any,
      userId: orphanId,
      roleId: 'field_inspector',
      scopeType: 'project',
      projectId: PRJ_B_ID as any,
      isActive: true,
      source: 'manual',
    });

    // 5. Demote / change user: remove PRJ_A from assignedProjects and change role to Client Viewer
    await db.update(users).set({
      role: 'Client / Vendor Viewer',
      assignedProjects: [],
    }).where(eq(users.id, orphanId));

    await syncUserLegacyAssignments(orphanId);

    // PRJ_A legacy_sync assignment must now be deactivated (isActive = false)
    const prjAAssignment = await db.select().from(roleAssignments).where(
      and(
        eq(roleAssignments.userId, orphanId),
        eq(roleAssignments.projectId, PRJ_A_ID as any),
        eq(roleAssignments.source, 'legacy_sync')
      )
    );
    assert.equal(prjAAssignment[0]?.isActive, false, 'Removed project assignment must be deactivated (isActive=false)');

    // Manual assignment must remain active and UNTOUCHED
    const manualAssignment = await db.select().from(roleAssignments).where(eq(roleAssignments.id, manualAssignId as any));
    assert.equal(manualAssignment[0]?.isActive, true, 'Manual assignment must remain active');
    assert.equal(manualAssignment[0]?.source, 'manual', 'Manual assignment source must remain manual');
    assert.equal(manualAssignment[0]?.roleId, 'field_inspector', 'Manual assignment roleId must remain field_inspector');

    // User should now be denied access to PRJ_A
    const resRevoked = await req('GET', `/api/projects/${PRJ_A_ID}/wbs`, orphanRawToken);
    assert.equal(resRevoked.status, 403, 'User with removed project assignment must be denied with 403');

    // Cleanup
    await db.delete(roleAssignments).where(eq(roleAssignments.userId, orphanId));
    await db.delete(sessions).where(eq(sessions.id, orphanSessionId));
    await db.delete(users).where(eq(users.id, orphanId));
  });
});
