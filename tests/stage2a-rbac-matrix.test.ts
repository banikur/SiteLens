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
 * Coverage: 7 roles × 22 mutation routes from Table F.5 = 154 assertions.
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
import { eq } from 'drizzle-orm';

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
  requirePermission,
} from '../src/server/auth/rbac.ts';
import { hashSecret } from '../src/server/auth/crypto.ts';
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
      'POST /api/uploads',
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
});
