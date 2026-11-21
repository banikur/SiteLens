import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { getDb, closeDb } from '../src/server/db/index.ts';
import {
  users,
  sessions,
  projects,
  workNodes,
  workWorkflows,
  workStages,
  inspectionAttempts,
  evidenceAttachments,
  inspections,
  correctiveActions,
  checklistTemplates,
  dailyWeatherLogs,
} from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { hashSessionToken, hashSecret } from '../src/server/auth/crypto.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { tenantRouter } from '../src/server/routes/tenant.ts';
import { uploadsRouter } from '../src/server/routes/uploads.ts';

// Create Express test app mounting real middleware and routers
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser);
  app.use('/api/auth', authRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/tenant', tenantRouter);
  app.use('/api', apiRouter);
  return app;
}

// IDs for testing
const PRJ_A_ID = '11111111-1111-4111-8111-111111111111';
const PRJ_B_ID = '22222222-2222-4222-8222-222222222222';

const USER_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // assigned ONLY to Project A
const USER_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // assigned ONLY to Project B
const USER_ADMIN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // Global Admin
const USER_VIEWER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // Client Viewer assigned to Project A

const TOKEN_A = 'session-token-user-a-12345678901234567890123456';
const TOKEN_B = 'session-token-user-b-12345678901234567890123456';
const TOKEN_ADMIN = 'session-token-admin-12345678901234567890123456';
const TOKEN_VIEWER = 'session-token-viewer-12345678901234567890123456';

const NODE_B_ID = 'b1111111-1111-4111-8111-111111111111';
const WORKFLOW_B_ID = 'b2222222-2222-4222-8222-222222222222';
const STAGE_B_ID = 'b3333333-3333-4333-8333-333333333333';
const ATTEMPT_B_ID = 'b4444444-4444-4444-8444-444444444444';

const INSP_B_ID = 'b5555555-5555-4555-8555-555555555555';
const ACTION_B_ID = 'b6666666-6666-4666-8666-666666666666';
const TMPL_B_ID = 'b7777777-7777-4777-8777-777777777777';
const TMPL_MASTER_ID = 'b8888888-8888-4888-8888-888888888888';

let server: http.Server;
let baseUrl: string;

async function seedTestData() {
  const db = getDb();
  if (!db) throw new Error('Database not connected');

  // Clean tables
  await db.delete(evidenceAttachments);
  await db.delete(inspectionAttempts);
  await db.delete(workStages);
  await db.delete(workWorkflows);
  await db.delete(workNodes);
  await db.delete(correctiveActions);
  await db.delete(inspections);
  await db.delete(checklistTemplates);
  await db.delete(dailyWeatherLogs);
  await db.delete(sessions);
  await db.delete(users);
  await db.delete(projects);

  // 1. Projects
  await db.insert(projects).values([
    {
      id: PRJ_A_ID,
      code: 'PRJ-AAA',
      name: 'Project Alpha',
      client: 'Client Alpha',
      location: 'Site A',
      status: 'active',
      zones: [{ id: 'z1', name: 'Zone A1', description: 'Zone A desc', safetyLevel: 'Standard' }],
      leadManager: 'Manager A',
    },
    {
      id: PRJ_B_ID,
      code: 'PRJ-BBB',
      name: 'Project Beta',
      client: 'Client Beta',
      location: 'Site B',
      status: 'active',
      zones: [{ id: 'z2', name: 'Zone B1', description: 'Zone B desc', safetyLevel: 'High Risk' }],
      leadManager: 'Manager B',
    },
  ]);

  const pwHash = await hashSecret('password123');

  // 2. Users
  await db.insert(users).values([
    {
      id: USER_A_ID,
      username: 'user_a',
      name: 'Inspector User A',
      email: 'user_a@test.com',
      passwordHash: pwHash,
      role: 'Field / QC Inspector',
      title: 'Site QC Inspector',
      assignedProjects: [PRJ_A_ID],
      isActive: true,
    },
    {
      id: USER_B_ID,
      username: 'user_b',
      name: 'QAQC Lead User B',
      email: 'user_b@test.com',
      passwordHash: pwHash,
      role: 'QA/QC Lead / Owner Inspector',
      title: 'QA Lead',
      assignedProjects: [PRJ_B_ID],
      isActive: true,
    },
    {
      id: USER_ADMIN_ID,
      username: 'admin_user',
      name: 'Global Admin',
      email: 'admin@test.com',
      passwordHash: pwHash,
      role: 'Project Director & Tenant Admin',
      title: 'Director',
      assignedProjects: [],
      isActive: true,
    },
    {
      id: USER_VIEWER_ID,
      username: 'viewer_user',
      name: 'Client Viewer A',
      email: 'viewer@test.com',
      passwordHash: pwHash,
      role: 'Client / Vendor Viewer',
      title: 'Client Rep',
      assignedProjects: [PRJ_A_ID],
      isActive: true,
    },
  ]);

  // 3. Sessions
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(sessions).values([
    { id: hashSessionToken(TOKEN_A), userId: USER_A_ID, expiresAt },
    { id: hashSessionToken(TOKEN_B), userId: USER_B_ID, expiresAt },
    { id: hashSessionToken(TOKEN_ADMIN), userId: USER_ADMIN_ID, expiresAt },
    { id: hashSessionToken(TOKEN_VIEWER), userId: USER_VIEWER_ID, expiresAt },
  ]);

  // 4. Templates
  await db.insert(checklistTemplates).values([
    {
      id: TMPL_MASTER_ID,
      title: 'Master Generic Template',
      category: 'Safety & HSE',
      description: 'Master checklist for all',
      isMasterTemplate: true,
      projectId: null,
      authorName: 'Admin',
      authorRole: 'Project Director & Tenant Admin',
      sections: [],
    },
    {
      id: TMPL_B_ID,
      title: 'Project B Proprietary Template',
      category: 'Civil & Structural',
      description: 'Only for Project B',
      isMasterTemplate: false,
      projectId: PRJ_B_ID,
      authorName: 'User B',
      authorRole: 'QA/QC Lead / Owner Inspector',
      sections: [],
    },
  ]);

  // 5. WBS & Stage in Project B
  await db.insert(workNodes).values({
    id: NODE_B_ID,
    projectId: PRJ_B_ID,
    wbsCode: '1.0',
    name: 'Foundation Beta',
    weightPercent: '100.00',
    sortOrder: 1,
  });

  await db.insert(workWorkflows).values({
    id: WORKFLOW_B_ID,
    nodeId: NODE_B_ID,
    title: 'Foundation Beta Workflow',
  });

  await db.insert(workStages).values({
    id: STAGE_B_ID,
    workflowId: WORKFLOW_B_ID,
    stageOrder: 1,
    stageType: 'hold',
    name: 'Rebar Pre-pour Check',
    assignedRole: 'Field / QC Inspector',
    approvalRole: 'QA/QC Lead / Owner Inspector',
    status: 'in_progress',
  });

  await db.insert(inspectionAttempts).values({
    id: ATTEMPT_B_ID,
    stageId: STAGE_B_ID,
    attemptNumber: 1,
    submitterId: USER_B_ID,
    status: 'submitted',
    answers: { specCompliance: 'PASS' },
  });

  // 6. Inspections in Project B
  await db.insert(inspections).values({
    id: INSP_B_ID,
    templateId: TMPL_B_ID,
    templateTitle: 'Project B Proprietary Template',
    category: 'Civil & Structural',
    projectId: PRJ_B_ID,
    projectName: 'Project Beta',
    siteZone: 'Zone B1',
    inspectorId: USER_B_ID,
    inspectorName: 'User B',
    inspectorRole: 'QA/QC Lead / Owner Inspector',
    status: 'submitted',
    answers: {},
  });

  // 7. Actions in Project B
  await db.insert(correctiveActions).values({
    id: ACTION_B_ID,
    inspectionId: INSP_B_ID,
    inspectionTitle: 'Project B Proprietary Template',
    projectId: PRJ_B_ID,
    projectName: 'Project Beta',
    siteZone: 'Zone B1',
    fieldLabel: 'Defect in Beta',
    issueDescription: 'Concrete honeycomb in Zone B1',
    severity: 'critical',
    assignedToName: 'Subcon Beta',
    assignedToRole: 'Action Owner / Subcontractor',
    dueDate: '2026-12-01',
    status: 'OPEN',
  });
}

// HTTP request helper
async function req(
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Cookie'] = `sitelens_session=${token}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, headers: res.headers };
}

test('HTTP Integration - Tahap 1: IDOR & Project Data Isolation', async (t) => {
  await ensureTestDatabaseSchema();
  await seedTestData();

  const app = createTestApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
  });

  await t.test('1. IDOR on Stages: User A (Project A) cannot access Stage in Project B', async () => {
    // GET /stages/:stageId/attempts
    const getRes = await req('GET', `/api/stages/${STAGE_B_ID}/attempts`, TOKEN_A);
    assert.equal(getRes.status, 403, `Expected 403 for GET attempts across project, got ${getRes.status}`);

    // POST /stages/:stageId/submit
    const submitRes = await req('POST', `/api/stages/${STAGE_B_ID}/submit`, TOKEN_A, {
      answers: { specCompliance: 'PASS' },
      signatureCanvasUrl: 'data:image/png;base64,sig',
    });
    assert.equal(submitRes.status, 403, `Expected 403 for POST submit across project, got ${submitRes.status}`);

    // POST /stages/:stageId/review
    const reviewRes = await req('POST', `/api/stages/${STAGE_B_ID}/review`, TOKEN_A, {
      decision: 'approved',
    });
    assert.equal(reviewRes.status, 403, `Expected 403 for POST review across project, got ${reviewRes.status}`);
  });

  await t.test('2. Data Isolation on Query Endpoints: User A only sees Project A data', async () => {
    // GET /api/projects
    const prjRes = await req('GET', '/api/projects', TOKEN_A);
    assert.equal(prjRes.status, 200);
    const prjList = prjRes.body.projects || [];
    assert.ok(prjList.some((p: any) => p.id === PRJ_A_ID), 'Must contain Project A');
    assert.ok(!prjList.some((p: any) => p.id === PRJ_B_ID), 'Must NOT contain Project B for User A');

    // GET /api/inspections
    const inspRes = await req('GET', '/api/inspections', TOKEN_A);
    assert.equal(inspRes.status, 200);
    const inspList = inspRes.body.inspections || [];
    assert.ok(!inspList.some((i: any) => i.id === INSP_B_ID), 'Must NOT contain inspections from Project B');

    // GET /api/actions
    const actRes = await req('GET', '/api/actions', TOKEN_A);
    assert.equal(actRes.status, 200);
    const actList = actRes.body.actions || [];
    assert.ok(!actList.some((a: any) => a.id === ACTION_B_ID), 'Must NOT contain actions from Project B');

    // GET /api/templates
    const tmplRes = await req('GET', '/api/templates', TOKEN_A);
    assert.equal(tmplRes.status, 200);
    const tmplList = tmplRes.body.templates || [];
    assert.ok(tmplList.some((tm: any) => tm.id === TMPL_MASTER_ID), 'Must contain Master template');
    assert.ok(!tmplList.some((tm: any) => tm.id === TMPL_B_ID), 'Must NOT contain template scoped to Project B');
  });

  await t.test('3. Mutations on project-derived entities: User A cannot mutate entities in Project B', async () => {
    // POST /api/inspections targeting Project B
    const postInspRes = await req('POST', '/api/inspections', TOKEN_A, {
      templateId: TMPL_MASTER_ID,
      templateTitle: 'Master Generic Template',
      category: 'Safety & HSE',
      projectId: PRJ_B_ID, // Project B!
      projectName: 'Project Beta',
      siteZone: 'Zone B1',
      inspectorId: USER_A_ID,
      inspectorName: 'Inspector User A',
      inspectorRole: 'Field / QC Inspector',
      status: 'submitted',
      answers: {},
    });
    assert.equal(postInspRes.status, 403, `Expected 403 for creating inspection in Project B, got ${postInspRes.status}`);

    // POST /api/inspections/:id/review on inspection in Project B
    const reviewInspRes = await req('POST', `/api/inspections/${INSP_B_ID}/review`, TOKEN_A, {
      decision: 'approved',
    });
    assert.equal(reviewInspRes.status, 403, `Expected 403 for reviewing inspection in Project B, got ${reviewInspRes.status}`);

    // POST /api/actions targeting Project B
    const postActRes = await req('POST', '/api/actions', TOKEN_A, {
      projectId: PRJ_B_ID,
      projectName: 'Project Beta',
      siteZone: 'Zone B1',
      fieldLabel: 'Illicit finding',
      issueDescription: 'User A tampering in Project B',
      severity: 'medium',
      assignedToName: 'Subcon Beta',
      assignedToRole: 'Action Owner / Subcontractor',
      dueDate: '2026-12-01',
    });
    assert.equal(postActRes.status, 403, `Expected 403 for creating action in Project B, got ${postActRes.status}`);

    // PATCH /api/actions/:id on action in Project B
    const patchActRes = await req('PATCH', `/api/actions/${ACTION_B_ID}`, TOKEN_A, {
      status: 'IN_PROGRESS',
      resolutionNotes: 'Attempted cross-project patch',
    });
    assert.equal(patchActRes.status, 403, `Expected 403 for patching action in Project B, got ${patchActRes.status}`);
  });

  await t.test('4. Admin maintains global access across projects', async () => {
    const adminPrj = await req('GET', '/api/projects', TOKEN_ADMIN);
    assert.equal(adminPrj.status, 200);
    const prjList = adminPrj.body.projects || [];
    assert.ok(prjList.some((p: any) => p.id === PRJ_A_ID));
    assert.ok(prjList.some((p: any) => p.id === PRJ_B_ID));

    const adminStage = await req('GET', `/api/stages/${STAGE_B_ID}/attempts`, TOKEN_ADMIN);
    assert.equal(adminStage.status, 200);
  });

  await t.test('5. Client Viewer is strictly read-only on assigned project', async () => {
    // Read on Project A is allowed
    const viewRes = await req('GET', `/api/projects/${PRJ_A_ID}/wbs`, TOKEN_VIEWER);
    assert.equal(viewRes.status, 200);

    // Mutation on Project A is rejected with 403
    const mutRes = await req('POST', `/api/projects/${PRJ_A_ID}/wbs/nodes`, TOKEN_VIEWER, {
      wbsCode: '1.99',
      name: 'Illegal Viewer Node',
    });
    assert.equal(mutRes.status, 403);
  });
});
