/**
 * Tahap 2c: RFI Flow Presets, Status 'requested', and Four-Eyes Enforcement Tests
 * Corresponds to RECONSTRUCTION_BLUEPRINT.md v2.3 Section 1320-1335 and Bagian 8 & 9.
 *
 * Verifies:
 * 1. Unit testing Four-Eyes Invariants (Rules 1, 2, 3) and canProceedToStage with 'requested'.
 * 2. Stage RFI lifecycle HTTP: pending -> requested -> submitted -> approved.
 * 3. Invariant four-eyes enforcement: approver cannot be submitter/executor, approver cannot be requester.
 * 4. Flow presets CRUD and 3-step validation (must have approve, cannot merge approve).
 * 5. Referenced flow preset deletion protection (409 Conflict).
 * 6. Bottleneck Radar SLA aging calculation measured from inspection_attempts.requested_at.
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
import {
  users,
  projects,
  workNodes,
  workWorkflows,
  workStages,
  inspectionAttempts,
  flowPresets,
  flowPresetSteps,
} from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { PERMISSIONS } from '../src/types/permissions.ts';
import {
  validateFourEyes,
  validateFourEyesDetails,
  canProceedToStage,
} from '../src/utils/workflow.ts';
import { calculateBottleneckAging } from '../src/utils/scurve.ts';
import type { WorkStage, InspectionAttempt } from '../src/types/index.ts';

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

test('Tahap 2c: RFI Flow Presets, Status requested, and Four-Eyes Enforcement', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();

  const app = createTestApp();
  const agent = supertest(app);

  const pmoToken = ROLE_USER_MAP.head_office_pmo.token;
  const pmoUser = ROLE_USER_MAP.head_office_pmo;
  const engineerToken = ROLE_USER_MAP.site_engineer.token;
  const engineerUser = ROLE_USER_MAP.site_engineer;
  const inspectorToken = ROLE_USER_MAP.field_inspector.token;
  const inspectorUser = ROLE_USER_MAP.field_inspector;
  const qaqcToken = ROLE_USER_MAP.qaqc_lead.token;
  const qaqcUser = ROLE_USER_MAP.qaqc_lead;
  const viewerToken = ROLE_USER_MAP.client_viewer.token;

  t.after(async () => {
    await closeDb();
  });

  // =========================================================================
  // 1. Four-Eyes Principle Invariant Unit Tests (Rules 1, 2, 3)
  // =========================================================================
  await t.test('1. Four-Eyes Principle Invariants (Rules 1, 2, 3)', () => {
    const userA = 'user-requester-1';
    const userB = 'user-executor-2';
    const userC = 'user-approver-3';

    // Rule 1: Approver cannot be executor
    const failSelfApproval = validateFourEyesDetails(userA, userB, userB);
    assert.equal(failSelfApproval.valid, false);
    assert.match(failSelfApproval.reason || '', /pelaksana inspeksi/);

    // Rule 1: Approver cannot be requester
    const failRequesterApproval = validateFourEyesDetails(userA, userB, userA);
    assert.equal(failRequesterApproval.valid, false);
    assert.match(failRequesterApproval.reason || '', /pemohon RFI/);

    // Rule 2: Approve step cannot be merged
    const failMergedApprove = validateFourEyesDetails(userA, userB, userC, true);
    assert.equal(failMergedApprove.valid, false);
    assert.match(failMergedApprove.reason || '', /dilarang digabung/);

    // Rule 3: Minimum 2 distinct individuals involved
    const failSinglePerson = validateFourEyesDetails(userA, userA, userA);
    assert.equal(failSinglePerson.valid, false);

    // Valid Pragmatic Field Separation: Requester is same as executor (self-initiated request), Approver is distinct (2 people)
    const validTwoPeople = validateFourEyesDetails(userA, userA, userC, false);
    assert.equal(validTwoPeople.valid, true);

    // Valid Tripartite: Requester, Executor, Approver are 3 distinct individuals
    const validThreePeople = validateFourEyesDetails(userA, userB, userC, false);
    assert.equal(validThreePeople.valid, true);

    // Legacy 2-argument signature: validateFourEyes(executorId, approverId)
    assert.equal(validateFourEyes(userB, userB), false, 'Legacy identical IDs must fail');
    assert.equal(validateFourEyes(userB, userC), true, 'Legacy distinct IDs must pass');
  });

  // =========================================================================
  // 2. Workflow Engine: canProceedToStage with 'requested' status
  // =========================================================================
  await t.test('2. canProceedToStage blocks progression if previous stage is requested or pending', () => {
    const dummyStages: WorkStage[] = [
      {
        id: 's1',
        workflowId: 'wf1',
        stageOrder: 1,
        stageType: 'work',
        name: 'Galian Tanah',
        assignedRole: 'Action Owner / Subcontractor',
        approvalRole: 'Project / Site Engineer',
        requiresWetSignature: false,
        status: 'requested', // Only requested, not yet submitted/approved
        createdAt: new Date(),
      },
      {
        id: 's2',
        workflowId: 'wf1',
        stageOrder: 2,
        stageType: 'work',
        name: 'Pengecoran Fondasi',
        assignedRole: 'Field / QC Inspector',
        approvalRole: 'QA/QC Lead / Owner Inspector',
        requiresWetSignature: false,
        status: 'pending',
        createdAt: new Date(),
      },
    ];

    const check = canProceedToStage(dummyStages, 's2');
    assert.equal(check.allowed, false);
    assert.match(check.reason || '', /belum diserahkan atau diselesaikan/);

    // Once stage 1 is submitted, work on stage 2 can proceed
    dummyStages[0].status = 'submitted';
    const checkAfterSubmit = canProceedToStage(dummyStages, 's2');
    assert.equal(checkAfterSubmit.allowed, true);
  });

  // =========================================================================
  // 3. HTTP Lifecycle: pending -> requested -> submitted -> approved
  // =========================================================================
  const testNodeId = '77777777-1111-4111-8111-777777777777';
  const testWorkflowId = '77777777-2222-4222-8222-777777777777';
  const testStageId = '77777777-3333-4333-8333-777777777777';

  await t.test('3. Setup dedicated test node & workflow for Tahap 2c', async () => {
    const db = getDb();
    if (!db) throw new Error('DB unavailable');

    await db.insert(workNodes).values({
      id: testNodeId as any,
      projectId: PRJ_A_ID as any,
      wbsCode: '2C.01',
      name: 'Pekerjaan RFI Test Node',
      weightPercent: '10.00',
    });

    await db.insert(workWorkflows).values({
      id: testWorkflowId as any,
      nodeId: testNodeId as any,
      title: 'Alur RFI Test Node',
    });

    await db.insert(workStages).values({
      id: testStageId as any,
      workflowId: testWorkflowId as any,
      stageOrder: 1,
      stageType: 'work',
      name: 'Tahapan Inspeksi RFI',
      assignedRole: 'Field / QC Inspector',
      approvalRole: 'QA/QC Lead / Owner Inspector',
      status: 'pending',
    });
  });

  await t.test('3.a. Client Viewer is forbidden from requesting RFI', async () => {
    const res = await agent
      .post(`/api/stages/${testStageId}/request`)
      .set('Cookie', `sitelens_session=${viewerToken}`);

    assert.equal(res.status, 403, 'Client Viewer must not have stage.request permission');
  });

  await t.test('3.b. Site Engineer requests RFI (pending -> requested)', async () => {
    const res = await agent
      .post(`/api/stages/${testStageId}/request`)
      .set('Cookie', `sitelens_session=${engineerToken}`);

    assert.equal(res.status, 201, `Failed to request RFI: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.stage.status, 'requested');
    assert.equal(res.body.attempt.status, 'requested');
    assert.equal(res.body.attempt.requesterId, engineerUser.id);
    assert.ok(res.body.attempt.requestedAt, 'requestedAt timestamp must be set');

    // Attempting to request again when already 'requested' must return 400
    const resDuplicate = await agent
      .post(`/api/stages/${testStageId}/request`)
      .set('Cookie', `sitelens_session=${engineerToken}`);

    assert.equal(resDuplicate.status, 400, 'Duplicate request must be rejected');
  });

  await t.test('3.c. Field Inspector executes inspection checklist (requested -> submitted)', async () => {
    const res = await agent
      .post(`/api/stages/${testStageId}/submit`)
      .set('Cookie', `sitelens_session=${inspectorToken}`)
      .send({
        answers: { check_1: 'PASS', rebar_spacing: 150 },
        signatureCanvasUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      });

    assert.equal(res.status, 201, `Failed to submit inspection: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.stage.status, 'submitted');
    assert.equal(res.body.attempt.status, 'submitted');
    assert.equal(res.body.attempt.submitterId, inspectorUser.id);
    // Preserves original requester
    assert.equal(res.body.attempt.requesterId, engineerUser.id);
    assert.ok(res.body.attempt.requestedAt);
  });

  await t.test('3.d. Four-Eyes violation: Field Inspector (Executor) cannot approve', async () => {
    const res = await agent
      .post(`/api/stages/${testStageId}/review`)
      .set('Cookie', `sitelens_session=${inspectorToken}`)
      .send({ decision: 'approved' });

    assert.equal(res.status, 403, 'Executor must be rejected from approving attempt');
  });

  await t.test('3.e. Four-Eyes violation: Site Engineer (Requester) cannot approve', async () => {
    const res = await agent
      .post(`/api/stages/${testStageId}/review`)
      .set('Cookie', `sitelens_session=${engineerToken}`)
      .send({ decision: 'approved' });

    assert.equal(res.status, 403, 'Requester must be rejected from approving attempt');
  });

  await t.test('3.f. QA/QC Lead (independent 3rd party) approves inspection (submitted -> approved)', async () => {
    const res = await agent
      .post(`/api/stages/${testStageId}/review`)
      .set('Cookie', `sitelens_session=${qaqcToken}`)
      .send({ decision: 'approved', notes: 'Kesesuaian lapangan terverifikasi.' });

    assert.equal(res.status, 200, `Failed to approve stage: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.stage.status, 'approved');
    assert.equal(res.body.attempt.status, 'approved');
    assert.equal(res.body.attempt.approverId, qaqcUser.id);
    assert.ok(res.body.attempt.decidedAt);
  });

  // =========================================================================
  // 4. Flow Presets Management & 3-Step Validation
  // =========================================================================
  let createdPresetId = '';

  await t.test('4.a. Flow Presets authorization: only flow_preset.manage can create', async () => {
    const resForbidden = await agent
      .post('/api/flow-presets')
      .set('Cookie', `sitelens_session=${engineerToken}`)
      .send({ name: 'Unauthorized Preset' });

    assert.equal(resForbidden.status, 403, 'Site Engineer must be forbidden from managing presets');
  });

  await t.test('4.b. Flow Presets validation: rejects missing name, < 2 steps, or missing approve', async () => {
    // Missing name
    const resNoName = await agent
      .post('/api/flow-presets')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({ name: '', steps: [{ name: 'A', stepType: 'request' }] });
    assert.equal(resNoName.status, 400);

    // Less than 2 steps
    const resFewSteps = await agent
      .post('/api/flow-presets')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({ name: 'Short Preset', steps: [{ name: 'Step 1', stepType: 'request' }] });
    assert.equal(resFewSteps.status, 400);

    // Missing approve step
    const resNoApprove = await agent
      .post('/api/flow-presets')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        name: 'No Approve Preset',
        steps: [
          { name: 'Pengajuan', stepType: 'request' },
          { name: 'Pengerjaan', stepType: 'execute' },
        ],
      });
    assert.equal(resNoApprove.status, 400);

    // Hard Four-Eyes Rule: Approve step CANNOT have canCombineWithNext = true
    const resMergeApprove = await agent
      .post('/api/flow-presets')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        name: 'Merged Approve Preset',
        steps: [
          { name: 'Pengajuan', stepType: 'request' },
          { name: 'Persetujuan Terlarang', stepType: 'approve', canCombineWithNext: true },
        ],
      });
    assert.equal(resMergeApprove.status, 400, 'Approve step cannot have canCombineWithNext=true');
  });

  await t.test('4.c. PMO creates valid 3-step Flow Preset', async () => {
    const res = await agent
      .post('/api/flow-presets')
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        name: 'Alur Baku EPC 3-Pihak',
        description: 'Standar pengajuan RFI kontraktor, uji lapangan QC, dan sign-off Konsultan Pengawas.',
        isOrganizationDefault: false,
        steps: [
          { stepOrder: 1, stepType: 'request', name: 'Pengajuan Kesiapan Kerja (RFI)', requiredPermission: PERMISSIONS.STAGE_REQUEST },
          { stepOrder: 2, stepType: 'execute', name: 'Inspeksi & Pembuktian Lapangan', requiredPermission: PERMISSIONS.STAGE_EXECUTE },
          { stepOrder: 3, stepType: 'approve', name: 'Persetujuan Konsultan Pengawas', requiredPermission: PERMISSIONS.STAGE_APPROVE, canCombineWithNext: false },
        ],
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.preset?.id);
    assert.equal(res.body.preset.name, 'Alur Baku EPC 3-Pihak');
    assert.equal(res.body.preset.steps.length, 3);
    createdPresetId = res.body.preset.id;
  });

  await t.test('4.d. GET /api/flow-presets lists presets with steps', async () => {
    const res = await agent
      .get('/api/flow-presets')
      .set('Cookie', `sitelens_session=${engineerToken}`);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.presets));
    const found = res.body.presets.find((p: any) => p.id === createdPresetId);
    assert.ok(found, 'Created preset must appear in list');
    assert.equal(found.steps.length, 3);
  });

  await t.test('4.e. PUT /api/flow-presets/:id updates preset metadata and steps', async () => {
    const res = await agent
      .put(`/api/flow-presets/${createdPresetId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`)
      .send({
        name: 'Alur Baku EPC 3-Pihak (Revisi 1)',
        description: 'Deskripsi diperbarui.',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.preset.name, 'Alur Baku EPC 3-Pihak (Revisi 1)');
  });

  await t.test('4.f. Referenced Flow Preset deletion is protected (409 Conflict)', async () => {
    const db = getDb();
    if (!db) throw new Error('DB unavailable');

    // Assign preset to PRJ_A
    await db.update(projects).set({ flowPresetId: createdPresetId as any }).where(eq(projects.id, PRJ_A_ID as any));

    const resDeleteConflict = await agent
      .delete(`/api/flow-presets/${createdPresetId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`);

    assert.equal(resDeleteConflict.status, 409, 'Referenced preset must return 409 Conflict');

    // Unassign preset and delete cleanly
    await db.update(projects).set({ flowPresetId: null }).where(eq(projects.id, PRJ_A_ID as any));

    const resDeleteOk = await agent
      .delete(`/api/flow-presets/${createdPresetId}`)
      .set('Cookie', `sitelens_session=${pmoToken}`);

    assert.equal(resDeleteOk.status, 200);
  });

  // =========================================================================
  // 5. Bottleneck Radar SLA Aging from requested_at
  // =========================================================================
  await t.test('5. Bottleneck Radar measures SLA aging from requested_at', () => {
    const requestedAt = new Date('2026-05-01T08:00:00Z');
    const submittedAt = new Date('2026-05-02T10:00:00Z');
    const now = new Date('2026-05-03T12:00:00Z'); // 52 hours since requested, 26 hours since submitted

    const dummyStage: WorkStage = {
      id: 'stg-radar',
      workflowId: 'wf-radar',
      stageOrder: 1,
      stageType: 'work',
      name: 'Hydrotest Piping Sector 4',
      assignedRole: 'Field / QC Inspector',
      approvalRole: 'QA/QC Lead / Owner Inspector',
      requiresWetSignature: false,
      status: 'submitted',
      createdAt: new Date(),
    };

    const dummyAttempt: InspectionAttempt = {
      id: 'att-radar',
      stageId: 'stg-radar',
      attemptNumber: 1,
      submitterId: inspectorUser.id,
      requesterId: engineerUser.id,
      requestedAt,
      submittedAt,
      status: 'submitted',
      answers: {},
      createdAt: new Date(),
    };

    const radar = calculateBottleneckAging(
      [
        {
          stage: dummyStage,
          wbsCode: '04.01',
          nodeName: 'Piping Unit 1',
          attempt: dummyAttempt,
          submitterName: 'Inspector Field',
        },
      ],
      now
    );

    assert.equal(radar.length, 1);
    // Measured from requestedAt (52h) -> status must be 'critical' (>48h)
    // If it were measured from submittedAt (26h) -> status would be 'warning' (<48h)
    assert.equal(radar[0].status, 'critical', 'SLA aging must measure from requestedAt and flag critical (>48h)');
    assert.ok(radar[0].waitingHours >= 52);
    assert.equal(radar[0].requestedAt, requestedAt);
  });
});
