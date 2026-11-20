import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canProceedToStage,
  validateFourEyes,
  validateDualTrackSignature,
  getNextAttemptNumber,
  generateDefaultStages,
} from '../src/utils/workflow';
import type { WorkStage, InspectionAttempt } from '../src/types';

test('Workflow Engine: Hold Point strictly blocks progression if unapproved', () => {
  const stages: WorkStage[] = [
    {
      id: 'stg-1',
      workflowId: 'wf-1',
      stageOrder: 1,
      stageType: 'work',
      name: 'Pekerjaan Persiapan & Galian',
      assignedRole: 'Action Owner / Subcontractor',
      approvalRole: 'Project / Site Engineer',
      requiresWetSignature: false,
      status: 'approved',
      createdAt: '2026-01-01',
    },
    {
      id: 'stg-2',
      workflowId: 'wf-1',
      stageOrder: 2,
      stageType: 'hold',
      name: 'Hold Point: Uji Tekan Beton & Rebar Verification',
      assignedRole: 'Field / QC Inspector',
      approvalRole: 'QA/QC Lead / Owner Inspector',
      requiresWetSignature: false,
      status: 'submitted', // Not approved yet!
      createdAt: '2026-01-01',
    },
    {
      id: 'stg-3',
      workflowId: 'wf-1',
      stageOrder: 3,
      stageType: 'review',
      name: 'Final Witness & Handover Sign-off',
      assignedRole: 'QA/QC Lead / Owner Inspector',
      approvalRole: 'Project Director & Tenant Admin',
      requiresWetSignature: true,
      status: 'pending',
      createdAt: '2026-01-01',
    },
  ];

  // Attempting to proceed to Stage 3 while Stage 2 (Hold Point) is only 'submitted'
  const checkStage3 = canProceedToStage(stages, 'stg-3');
  assert.equal(checkStage3.allowed, false);
  assert.match(checkStage3.reason || '', /HOLD POINT wajib/);
  assert.equal(checkStage3.blockingStage?.id, 'stg-2');

  // Once Stage 2 is marked 'approved', Stage 3 is unlocked
  stages[1].status = 'approved';
  const checkStage3AfterApproval = canProceedToStage(stages, 'stg-3');
  assert.equal(checkStage3AfterApproval.allowed, true);
});

test('Workflow Engine: Four-Eyes Principle strictly prevents submitter self-approval', () => {
  const inspectorUserId = 'usr-inspector-uuid-101';
  const qaLeadUserId = 'usr-qalead-uuid-202';

  // Submitter tries to review/approve own work -> BLOCKED
  const selfApprovalAllowed = validateFourEyes(inspectorUserId, inspectorUserId);
  assert.equal(selfApprovalAllowed, false);

  // Different user with QA Lead authority reviews -> ALLOWED
  const segregatedReviewAllowed = validateFourEyes(inspectorUserId, qaLeadUserId);
  assert.equal(segregatedReviewAllowed, true);
});

test('Workflow Engine: Dual-Track Signatures validates digital canvas & physical scan', () => {
  // Case 1: Stage does NOT require wet signature, digital canvas provided -> VALID
  const digitalAttempt = {
    signatureCanvasUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
    wetSignatureDocumentUrl: null,
  };
  const res1 = validateDualTrackSignature(digitalAttempt, false);
  assert.equal(res1.valid, true);
  assert.equal(res1.signatureType, 'digital_canvas');

  // Case 2: Stage requires wet signature, only digital provided -> INVALID
  const res2 = validateDualTrackSignature(digitalAttempt, true);
  assert.equal(res2.valid, false);
  assert.match(res2.message, /mewajibkan lembar tanda tangan basah fisik/);

  // Case 3: Stage requires wet signature, scanned upload provided -> VALID
  const wetScanAttempt = {
    signatureCanvasUrl: null,
    wetSignatureDocumentUrl: '/uploads/scans/signed_inspection_001.pdf',
  };
  const res3 = validateDualTrackSignature(wetScanAttempt, true);
  assert.equal(res3.valid, true);
  assert.equal(res3.signatureType, 'wet_signature_scan');

  // Case 4: No signature at all -> INVALID
  const emptyAttempt = { signatureCanvasUrl: null, wetSignatureDocumentUrl: null };
  const res4 = validateDualTrackSignature(emptyAttempt, false);
  assert.equal(res4.valid, false);
  assert.equal(res4.signatureType, 'none');
});

test('Workflow Engine: getNextAttemptNumber correctly tracks attempt increments', () => {
  const attempts: InspectionAttempt[] = [
    {
      id: 'att-1',
      stageId: 'stg-1',
      attemptNumber: 1,
      submitterId: 'usr-1',
      submittedAt: '2026-01-01',
      status: 'rejected',
      answers: {},
      createdAt: '2026-01-01',
    },
    {
      id: 'att-2',
      stageId: 'stg-1',
      attemptNumber: 2,
      submitterId: 'usr-1',
      submittedAt: '2026-01-02',
      status: 'rejected',
      answers: {},
      createdAt: '2026-01-02',
    },
  ];

  const nextAttemptNum = getNextAttemptNumber(attempts);
  assert.equal(nextAttemptNum, 3);

  // If no attempts exist yet
  assert.equal(getNextAttemptNumber([]), 1);
});

test('Workflow Engine: generates standard 3-stage template with hold point', () => {
  const stages = generateDefaultStages('Substructure Piling');
  assert.equal(stages.length, 3);
  assert.equal(stages[0].stageType, 'work');
  assert.equal(stages[1].stageType, 'hold'); // Mandatory hold point
  assert.equal(stages[2].stageType, 'review');
  assert.equal(stages[2].requiresWetSignature, true); // Final stage requires wet signature
});
