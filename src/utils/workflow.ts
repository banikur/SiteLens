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
    if (prev.status === 'pending') {
      return {
        allowed: false,
        reason: `Tahapan sebelumnya "${prev.name}" (Urutan #${prev.stageOrder}) belum dimulai atau diselesaikan.`,
        blockingStage: prev,
      };
    }
  }

  return { allowed: true };
}

/**
 * Validates the Four-Eyes Principle (Segregation of Duties).
 * The user approving/verifying an inspection attempt CANNOT be the same user who submitted it.
 */
export function validateFourEyes(submitterId: string, approverId: string): boolean {
  if (!submitterId || !approverId) return false;
  return submitterId.trim().toLowerCase() !== approverId.trim().toLowerCase();
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
