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
  auditLogs,
} from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { hashSessionToken, hashSecret } from '../src/server/auth/crypto.ts';
import { apiRouter } from '../src/server/routes/api.ts';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser);
  app.use('/api', apiRouter);
  return app;
}

const PRJ_A_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRJ_B_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

const USER_ENG_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_LEAD_A_ID = 'aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const TOKEN_ENG_A = 'token-eng-a-12345678901234567890123456789012';
const TOKEN_LEAD_A = 'token-lead-a-12345678901234567890123456789012';

// Project A WBS Hierarchy:
// Node 1 (Root)
//   └─ Node 1.1 (Child of 1)
//        └─ Node 1.1.1 (Child of 1.1)
// Node 2 (Root)
const NODE_1_ID = '11111111-1111-4111-8111-111111111111';
const NODE_1_1_ID = '11111111-1111-4111-8111-222222222222';
const NODE_1_1_1_ID = '11111111-1111-4111-8111-333333333333';
const NODE_2_ID = '22222222-1111-4111-8111-111111111111';

// Project B Node
const NODE_B_1_ID = 'bbbbbbbb-1111-4111-8111-111111111111';

// Stage and Workflow for Stage Approval Verification
const WORKFLOW_1_ID = '33333333-1111-4111-8111-111111111111';
const STAGE_1_ID = '44444444-1111-4111-8111-111111111111';
const ATTEMPT_1_ID = '55555555-1111-4111-8111-111111111111';

let server: http.Server;
let baseUrl: string;

async function seedData() {
  const db = getDb();
  if (!db) throw new Error('Database not connected');

  await db.delete(auditLogs);
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

  await db.insert(projects).values([
    {
      id: PRJ_A_ID,
      code: 'PRJ-1B-A',
      name: 'Project 1B Alpha',
      client: 'Client Alpha',
      location: 'Jakarta',
      status: 'active',
      zones: [{ id: 'z1', name: 'Zone 1', description: 'Zone 1 desc', safetyLevel: 'Standard' }],
      leadManager: 'Manager Alpha',
    },
    {
      id: PRJ_B_ID,
      code: 'PRJ-1B-B',
      name: 'Project 1B Beta',
      client: 'Client Beta',
      location: 'Surabaya',
      status: 'active',
      zones: [{ id: 'z2', name: 'Zone 2', description: 'Zone 2 desc', safetyLevel: 'Standard' }],
      leadManager: 'Manager Beta',
    },
  ]);

  const pwHash = await hashSecret('password123');

  await db.insert(users).values([
    {
      id: USER_ENG_A_ID,
      username: 'eng_a',
      name: 'Site Engineer A',
      email: 'eng_a@test.com',
      passwordHash: pwHash,
      role: 'Project / Site Engineer',
      title: 'Site Engineer',
      assignedProjects: [PRJ_A_ID],
      isActive: true,
    },
    {
      id: USER_LEAD_A_ID,
      username: 'lead_a',
      name: 'QAQC Lead A',
      email: 'lead_a@test.com',
      passwordHash: pwHash,
      role: 'QA/QC Lead / Owner Inspector',
      title: 'QA/QC Lead',
      assignedProjects: [PRJ_A_ID],
      isActive: true,
    },
  ]);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(sessions).values([
    { id: hashSessionToken(TOKEN_ENG_A), userId: USER_ENG_A_ID, expiresAt },
    { id: hashSessionToken(TOKEN_LEAD_A), userId: USER_LEAD_A_ID, expiresAt },
  ]);

  // Insert WBS Nodes for Project A
  await db.insert(workNodes).values([
    {
      id: NODE_1_ID,
      projectId: PRJ_A_ID,
      parentId: null,
      wbsCode: '1',
      name: 'Structural Works',
      weightPercent: '50.00',
      sortOrder: 1,
    },
    {
      id: NODE_1_1_ID,
      projectId: PRJ_A_ID,
      parentId: NODE_1_ID,
      wbsCode: '1.1',
      name: 'Substructure & Foundation',
      weightPercent: '25.00',
      sortOrder: 1,
    },
    {
      id: NODE_1_1_1_ID,
      projectId: PRJ_A_ID,
      parentId: NODE_1_1_ID,
      wbsCode: '1.1.1',
      name: 'Piling & Pile Cap',
      weightPercent: '25.00',
      sortOrder: 1,
    },
    {
      id: NODE_2_ID,
      projectId: PRJ_A_ID,
      parentId: null,
      wbsCode: '2',
      name: 'Architectural Works',
      weightPercent: '50.00',
      sortOrder: 2,
    },
  ]);

  // Insert WBS Node for Project B
  await db.insert(workNodes).values([
    {
      id: NODE_B_1_ID,
      projectId: PRJ_B_ID,
      parentId: null,
      wbsCode: '1',
      name: 'Beta Project Works',
      weightPercent: '100.00',
      sortOrder: 1,
    },
  ]);

  // Insert Workflow, Stage, and Attempt for Stage Completion Date Verification
  await db.insert(workWorkflows).values({
    id: WORKFLOW_1_ID,
    nodeId: NODE_1_1_1_ID,
    title: 'Piling Verification Workflow',
  });

  await db.insert(workStages).values({
    id: STAGE_1_ID,
    workflowId: WORKFLOW_1_ID,
    stageOrder: 1,
    stageType: 'hold',
    name: 'Reinforcement & Concrete Hold Point',
    assignedRole: 'Project / Site Engineer',
    approvalRole: 'QA/QC Lead / Owner Inspector',
    status: 'submitted',
    actualCompletedAt: null,
  });

  await db.insert(inspectionAttempts).values({
    id: ATTEMPT_1_ID,
    stageId: STAGE_1_ID,
    attemptNumber: 1,
    submitterId: USER_ENG_A_ID,
    status: 'submitted',
    answers: { test: 'passed' },
  });
}

async function req(
  method: string,
  path: string,
  token?: string,
  body?: any
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (token) {
    headers['Cookie'] = `sitelens_session=${token}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

test('Tahap 1b: WBS Node Reparenting & Stage Completion Verification', async (t) => {
  await ensureTestDatabaseSchema();
  await seedData();

  const app = createTestApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as any;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDb();
  });

  await t.test('1. PUT /projects/:projectId/wbs/nodes/:nodeId saves new parentId and sortOrder', async () => {
    const db = getDb()!;

    // Move Node 1.1 to be child of Node 2
    const res = await req(
      'PUT',
      `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_1_1_ID}`,
      TOKEN_ENG_A,
      {
        parentId: NODE_2_ID,
        sortOrder: 10,
      }
    );

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.node.parentId, NODE_2_ID, 'Response node must contain updated parentId');
    assert.equal(res.body.node.sortOrder, 10, 'Response node must contain updated sortOrder');

    // Verify database record directly
    const [dbNode] = await db.select().from(workNodes).where(eq(workNodes.id, NODE_1_1_ID as any));
    assert.equal(dbNode.parentId, NODE_2_ID, 'Database record must have updated parentId');
    assert.equal(dbNode.sortOrder, 10, 'Database record must have updated sortOrder');

    // Verify audit logs
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, NODE_1_1_ID))
      .orderBy(auditLogs.createdAt);
    assert.ok(log, 'Audit log entry should exist for UPDATE_WBS_NODE');
    assert.equal(log.action, 'UPDATE_WBS_NODE');
    assert.equal(log.metadata.parentId, NODE_2_ID);
    assert.equal(log.metadata.sortOrder, 10);
  });

  await t.test('2. PUT /projects/:projectId/wbs/nodes/:nodeId allows moving to root with parentId = null', async () => {
    const db = getDb()!;

    // Move Node 1.1 back to root (parentId = null)
    const res = await req(
      'PUT',
      `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_1_1_ID}`,
      TOKEN_ENG_A,
      {
        parentId: null,
      }
    );

    assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.node.parentId, null, 'Response node parentId should be null');

    const [dbNode] = await db.select().from(workNodes).where(eq(workNodes.id, NODE_1_1_ID as any));
    assert.equal(dbNode.parentId, null, 'Database record parentId should be null');
  });

  await t.test('3. Rejects parentId pointing to self (cycle)', async () => {
    const res = await req(
      'PUT',
      `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_1_ID}`,
      TOKEN_ENG_A,
      {
        parentId: NODE_1_ID,
      }
    );

    assert.equal(res.status, 400, `Expected 400 when parentId is self, got ${res.status}`);
    assert.match(res.body.error || '', /cycle|self/i);
  });

  await t.test('4. Rejects parentId pointing to a descendant node (cycle)', async () => {
    // Reset Node 1.1 under Node 1, and Node 1.1.1 under Node 1.1
    const db = getDb()!;
    await db.update(workNodes).set({ parentId: NODE_1_ID as any }).where(eq(workNodes.id, NODE_1_1_ID as any));
    await db.update(workNodes).set({ parentId: NODE_1_1_ID as any }).where(eq(workNodes.id, NODE_1_1_1_ID as any));

    // Attempt to set Node 1's parent to its child Node 1.1
    const resChild = await req(
      'PUT',
      `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_1_ID}`,
      TOKEN_ENG_A,
      {
        parentId: NODE_1_1_ID,
      }
    );
    assert.equal(resChild.status, 400, `Expected 400 when setting parent to direct child, got ${resChild.status}`);
    assert.match(resChild.body.error || '', /cycle|descendant/i);

    // Attempt to set Node 1's parent to its grandchild Node 1.1.1
    const resGrandchild = await req(
      'PUT',
      `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_1_ID}`,
      TOKEN_ENG_A,
      {
        parentId: NODE_1_1_1_ID,
      }
    );
    assert.equal(resGrandchild.status, 400, `Expected 400 when setting parent to grandchild, got ${resGrandchild.status}`);
    assert.match(resGrandchild.body.error || '', /cycle|descendant/i);
  });

  await t.test('5. Rejects parentId from another project', async () => {
    const res = await req(
      'PUT',
      `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_1_ID}`,
      TOKEN_ENG_A,
      {
        parentId: NODE_B_1_ID,
      }
    );

    assert.equal(res.status, 400, `Expected 400 for cross-project parentId, got ${res.status}`);
    assert.match(res.body.error || '', /project|not found/i);
  });

  await t.test('6. Rejects non-existent parentId', async () => {
    const res = await req(
      'PUT',
      `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_1_ID}`,
      TOKEN_ENG_A,
      {
        parentId: '99999999-9999-4999-8999-999999999999',
      }
    );

    assert.equal(res.status, 400, `Expected 400 for non-existent parentId, got ${res.status}`);
  });

  await t.test('7. Approval stage verification: actual_completed_at is populated when approved, and null when rejected', async () => {
    const db = getDb()!;

    // 7a. Approve stage
    const approveRes = await req(
      'POST',
      `/api/stages/${STAGE_1_ID}/review`,
      TOKEN_LEAD_A,
      {
        decision: 'approved',
        notes: 'Quality inspection passed',
      }
    );

    assert.equal(approveRes.status, 200, `Expected 200 for review approval, got ${approveRes.status}`);

    const [approvedStage] = await db.select().from(workStages).where(eq(workStages.id, STAGE_1_ID as any));
    assert.equal(approvedStage.status, 'approved');
    assert.ok(approvedStage.actualCompletedAt !== null, 'actual_completed_at must be populated when approved');
    assert.ok(approvedStage.actualCompletedAt instanceof Date, 'actual_completed_at must be a valid Date');

    // 7b. Observe behavior when rejected
    const rejectRes = await req(
      'POST',
      `/api/stages/${STAGE_1_ID}/review`,
      TOKEN_LEAD_A,
      {
        decision: 'rejected',
        notes: 'Punchlist item detected on revisit',
      }
    );

    assert.equal(rejectRes.status, 200, `Expected 200 for review rejection, got ${rejectRes.status}`);

    const [rejectedStage] = await db.select().from(workStages).where(eq(workStages.id, STAGE_1_ID as any));
    assert.equal(rejectedStage.status, 'rejected');
    assert.equal(
      rejectedStage.actualCompletedAt,
      null,
      'Behavior confirmation: actual_completed_at is overwritten to null when rejected'
    );
  });
});
