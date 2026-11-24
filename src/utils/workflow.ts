import type { WorkStage, InspectionAttempt, UserRole } from '../types';

export interface StageProgressionCheck {
  allowed: boolean;
  reason?: string;
  blockingStage?: WorkStage;
}

/**
 * Checks if work on a target stage is permitted.
 * Rules:
 * 1. Stages must be executed in sequential stageOrder.
 * 2. If any preceding stage has stageType === 'hold' (Hold Point), it MUST be 'approved' before subsequent stages can be started or submitted.
 * 3. Preceding stages of type 'work' or 'review' must at least be submitted or approved.
 */
export function canProceedToStage(
  stages: WorkStage[],
  targetStageId: string
): StageProgressionCheck {
  const sortedStages = [...stages].sort((a, b) => a.stageOrder - b.stageOrder);
  const targetIndex = sortedStages.findIndex((s) => s.id === targetStageId);

  if (targetIndex === -1) {
    return { allowed: false, reason: 'Target stage not found in workflow.' };
  }

  if (targetIndex === 0) {
    return { allowed: true };
  }

  // Check all preceding stages
  for (let i = 0; i < targetIndex; i++) {
    const prev = sortedStages[i];

    // Hold Point strictly requires 'approved'
    if (prev.stageType === 'hold' && prev.status !== 'approved') {
      return {
        allowed: false,
        reason: `Tahapan "${prev.name}" adalah HOLD POINT wajib. Pekerjaan tidak dapat dilanjutkan sebelum disetujui & ditandatangani.`,
        blockingStage: prev,
      };
    }

    // General work or review stage cannot be completely unaddressed
    if (prev.status === 'pending' || prev.status === 'requested') {
      return {
        allowed: false,
        reason: `Tahapan sebelumnya "${prev.name}" (Urutan #${prev.stageOrder}) belum diserahkan atau diselesaikan.`,
        blockingStage: prev,
      };
    }
  }

  return { allowed: true };
}

export interface FourEyesValidationResult {
  valid: boolean;
  reason?: string;
}

export interface FourEyesOptions {
  requesterId?: string | null;
  executorId?: string | null;
  submitterId?: string | null;
  approverId?: string | null;
  isMergedStep?: boolean;
}

/**
 * Validates the Four-Eyes Principle (Segregation of Duties) under Blueprint Section 1321 & Section 1515:
 * Rule 1: Approver cannot be submitter/executor AND approver cannot be requester.
 * Rule 2: Approve step cannot be merged with request or any other step.
 * Rule 3: Minimum 2 distinct individuals involved across the entire attempt lifecycle.
 */
export function validateFourEyesDetails(
  arg1?: string | null | FourEyesOptions,
  arg2?: string | null,
  arg3?: string | null,
  arg4 = false
): FourEyesValidationResult {
  let requesterId: string | null = null;
  let executorId: string | null = null;
  let approverId: string | null = null;
  let isMergedStep = false;

  if (typeof arg1 === 'object' && arg1 !== null) {
    requesterId = arg1.requesterId ?? null;
    executorId = arg1.executorId ?? arg1.submitterId ?? null;
    approverId = arg1.approverId ?? null;
    isMergedStep = Boolean(arg1.isMergedStep);
  } else if (arg3 === undefined) {
    // 2-argument legacy signature: validateFourEyes(executorId, approverId)
    executorId = arg1 ?? null;
    approverId = arg2 ?? null;
    requesterId = null;
    isMergedStep = false;
  } else {
    // 3 or 4-argument signature: validateFourEyes(requesterId, executorId, approverId, isMergedStep)
    requesterId = arg1 ?? null;
    executorId = arg2 ?? null;
    approverId = arg3 ?? null;
    isMergedStep = Boolean(arg4);
  }

  if (!approverId || !approverId.trim()) {
    return { valid: false, reason: 'Identitas penyetuju (approver) wajib diisi.' };
  }

  if (isMergedStep) {
    return {
      valid: false,
      reason: 'Batas Keras Four-Eyes: Tahapan persetujuan (approve) dilarang digabung dengan langkah manapun.',
    };
  }

  const cleanApprover = approverId.trim().toLowerCase();
  const cleanExecutor = executorId?.trim().toLowerCase();
  const cleanRequester = requesterId?.trim().toLowerCase();

  // Rule 1: Approver cannot be executor
  if (cleanExecutor && cleanApprover === cleanExecutor) {
    return {
      valid: false,
      reason: 'Pelanggaran Prinsip Four-Eyes: Penyetuju tidak boleh sama dengan pelaksana inspeksi (self-approval dilarang).',
    };
  }

  // Rule 1: Approver cannot be requester
  if (cleanRequester && cleanApprover === cleanRequester) {
    return {
      valid: false,
      reason: 'Pelanggaran Prinsip Four-Eyes: Penyetuju tidak boleh sama dengan pemohon RFI.',
    };
  }

  // Rule 3: Minimum 2 distinct individuals involved across the attempt lifecycle
  const participants = [cleanRequester, cleanExecutor, cleanApprover].filter(Boolean) as string[];
  const distinctParticipants = new Set(participants);

  if (distinctParticipants.size < 2) {
    return {
      valid: false,
      reason: 'Pelanggaran Prinsip Four-Eyes: Minimal 2 personil berbeda wajib terlibat dalam satu siklus pengajuan hingga persetujuan.',
    };
  }

  return { valid: true };
}

/**
 * Validates the Four-Eyes Principle (Segregation of Duties).
 * Returns boolean for quick assertion checks.
 */
export function validateFourEyes(
  arg1?: string | null | FourEyesOptions,
  arg2?: string | null,
  arg3?: string | null,
  arg4 = false
): boolean {
  return validateFourEyesDetails(arg1, arg2, arg3, arg4).valid;
}

/**
 * Validates dual-track signature requirements.
 * Either a digital touchscreen canvas signature OR a physical wet-signature scan upload must be present.
 */
export function validateDualTrackSignature(
  attempt: {
    signatureCanvasUrl?: string | null;
    wetSignatureDocumentUrl?: string | null;
  },
  requiresWetSignature = false
): {
  valid: boolean;
  signatureType: 'digital_canvas' | 'wet_signature_scan' | 'none';
  message: string;
} {
  const hasDigital = Boolean(attempt.signatureCanvasUrl && attempt.signatureCanvasUrl.trim());
  const hasWetScan = Boolean(attempt.wetSignatureDocumentUrl && attempt.wetSignatureDocumentUrl.trim());

  if (requiresWetSignature && !hasWetScan) {
    return {
      valid: false,
      signatureType: hasDigital ? 'digital_canvas' : 'none',
      message: 'Tahapan ini mewajibkan lembar tanda tangan basah fisik (Physical Wet Signature Scan). Harap unggah pindaian dokumen fisik bertanda tangan.',
    };
  }

  if (hasWetScan) {
    return {
      valid: true,
      signatureType: 'wet_signature_scan',
      message: 'Pindaian tanda tangan fisik basah terverifikasi.',
    };
  }

  if (hasDigital) {
    return {
      valid: true,
      signatureType: 'digital_canvas',
      message: 'Tanda tangan digital kanvas touchscreen terverifikasi.',
    };
  }

  return {
    valid: false,
    signatureType: 'none',
    message: 'Tanda tangan belum dibubuhkan. Pilih tanda tangan digital kanvas atau unggah scan lembar fisik.',
  };
}

/**
 * Calculates the next sequential attempt number for a stage.
 */
export function getNextAttemptNumber(existingAttempts: InspectionAttempt[]): number {
  if (!existingAttempts || existingAttempts.length === 0) return 1;
  const maxAttempt = Math.max(...existingAttempts.map((a) => a.attemptNumber || 1));
  return maxAttempt + 1;
}

/**
 * Default standard 3-stage workflow template generator for a WBS leaf node:
 * Stage 1: Preparation & Pre-Start Execution (work)
 * Stage 2: Quality Inspection & Hold Point Testing (hold)
 * Stage 3: Witness Acceptance & Final Sign-off (review)
 */
export function generateDefaultStages(nodeName: string): Array<{
  stageOrder: number;
  stageType: 'work' | 'hold' | 'review';
  name: string;
  assignedRole: UserRole;
  approvalRole: UserRole | null;
  requiresWetSignature: boolean;
}> {
  return [
    {
      stageOrder: 1,
      stageType: 'work',
      name: `Persiapan & Pelaksanaan: ${nodeName}`,
      assignedRole: 'Action Owner / Subcontractor',
      approvalRole: 'Project / Site Engineer',
      requiresWetSignature: false,
    },
    {
      stageOrder: 2,
      stageType: 'hold',
      name: `Inspeksi Mutu & Hold Point: ${nodeName}`,
      assignedRole: 'Field / QC Inspector',
      approvalRole: 'QA/QC Lead / Owner Inspector',
      requiresWetSignature: false,
    },
    {
      stageOrder: 3,
      stageType: 'review',
      name: `Witness Acceptance & Sign-off: ${nodeName}`,
      assignedRole: 'QA/QC Lead / Owner Inspector',
      approvalRole: 'Project Director & Tenant Admin',
      requiresWetSignature: true,
    },
  ];
}
