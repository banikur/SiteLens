import crypto from 'crypto';
import { and, desc, eq, inArray, or, ilike, sql } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import {
  auditLogs,
  checklistTemplates,
  correctiveActions,
  inspections,
  projects,
  masterProjects,
  users,
  workNodes,
  workWorkflows,
  workStages,
  inspectionAttempts,
  evidenceAttachments,
  plannedCurveOverrides,
  dailyWeatherLogs,
  roleAssignments,
  roles,
  permissions,
  rolePermissions,
  flowPresets,
  flowPresetSteps,
  wbsProgressLogs,
  companySettings,
  nationalHolidays,
  projectCalendars,
} from '../db/schema.ts';
import { computeWbsCriticalPath } from '../../utils/wbs.ts';
import { hashSecret } from '../auth/crypto.ts';
import {
  requireAuth,
  requireProjectAccess,
  assertProjectAccess,
  getProjectIdByStageId,
} from '../auth/middleware.ts';
import {
  requirePermission,
  PERMISSIONS,
  PERMISSION_DEFINITIONS,
  resolveUserPermissions,
  seedLegacyRoleAssignments,
  syncUserLegacyAssignments,
} from '../auth/rbac.ts';
import { dispatchNotification } from '../services/notifications.ts';
import {
  extractEvidenceFilename,
  getUploadDir,
  verifyStoredEvidence,
} from '../services/evidenceIntegrity.ts';
import {
  canProceedToStage,
  validateFourEyes,
  validateFourEyesDetails,
  validateDualTrackSignature,
  getNextAttemptNumber,
  generateDefaultStages,
} from '../../utils/workflow.ts';
import {
  generateProjectCalendarWeeks,
  calculateSCurveData,
  calculateBottleneckAging,
  calculateWeatherEotImpact,
} from '../../utils/scurve.ts';
import { recalculateAndSaveNodeRollups } from '../wbs.ts';
import { calculateSSOTSCurveData } from '../services/scurveEngine.ts';
import type {
  ApprovalDecision,
  ChecklistTemplate,
  InspectionEvidence,
  InspectionStatus,
  UserRole,
  WorkflowStep,
} from '../../types/index.ts';

export const VALID_ROLES: readonly UserRole[] = [
  'Field / QC Inspector',
  'Action Owner / Subcontractor',
  'Project / Site Engineer',
  'QA/QC Lead / Owner Inspector',
  'Project Director & Tenant Admin',
  'Client / Vendor Viewer',
  'Field Inspector / Petugas K3',
  'Action Owner / Pelaksana Perbaikan',
  'Office / Integrity Engineer',
  'Authorized Inspector (API 510/570) & Verifikator K3',
  'HSE / Quality Manager & Tenant Admin',
];

const MAX_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Offline inspections are legitimately submitted with a field timestamp, but a
 * client must not be able to backdate evidence arbitrarily or stamp the future.
 * Anything outside a sane window is replaced by server time.
 */
export function resolveClientTimestamp(value: unknown, now: Date): Date {
  if (typeof value !== 'string') return now;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return now;
  const skew = now.getTime() - parsed.getTime();
  if (skew < -5 * 60 * 1000 || skew > MAX_BACKDATE_MS) return now;
  return parsed;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function resolveUuid(id: unknown): string {
  return typeof id === 'string' && UUID_REGEX.test(id) ? id : crypto.randomUUID();
}



export async function logAudit(
  actorId: string,
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, any> = {}
) {
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLogs).values({
      actorId,
      actorName,
      action,
      entityType,
      entityId,
      metadata,
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

export function resolveApplicableWorkflowSteps(
  template: typeof checklistTemplates.$inferSelect | undefined,
  failedCount: number,
  scorePercent: number
): WorkflowStep[] {
  if (!template) return [];
  let steps = Array.isArray(template.workflowSteps) ? [...template.workflowSteps] : [];

  if (steps.length === 0 && template.requiresApproval && template.approvalRole) {
    steps = [
      {
        order: 1,
        label: `${template.approvalRole} Sign-off`,
        role: template.approvalRole,
        trigger: 'always',
        requiresSignature: true,
      },
    ];
  }

  const hasFail = failedCount > 0;
  const isCritical = failedCount >= 3 || scorePercent < 60;

  return steps
    .filter((s) => {
      if (s.trigger === 'always') return true;
      if (s.trigger === 'on_fail') return hasFail;
      if (s.trigger === 'on_critical') return isCritical;
      return true;
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * Scores an inspection from the template definition and the submitted answers.
 * The client sends its own score, but that value is never trusted: a failing
 * checklist must not be able to approve itself by claiming 100%.
 */
export function computeInspectionScore(
  template: typeof checklistTemplates.$inferSelect | undefined,
  answers: Record<string, unknown> | null | undefined
): {
  scorePercent: number;
  passedCount: number;
  failedCount: number;
  nonApplicableCount: number;
} {
  let totalPassFail = 0;
  let passed = 0;
  let failed = 0;
  let na = 0;

  const sections = Array.isArray(template?.sections) ? template!.sections : [];
  for (const section of sections) {
    const fields = Array.isArray(section?.fields) ? section.fields : [];
    for (const field of fields) {
      if (field?.type !== 'pass_fail') continue;
      const raw = answers?.[field.id];
      const value = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
      if (value === 'pass') {
        totalPassFail += 1;
        passed += 1;
      } else if (value === 'fail') {
        totalPassFail += 1;
        failed += 1;
      } else if (value === 'na') {
        na += 1;
      }
    }
  }

  return {
    scorePercent: totalPassFail === 0 ? 100 : Math.round((passed / totalPassFail) * 100),
    passedCount: passed,
    failedCount: failed,
    nonApplicableCount: na,
  };
}

interface EvidenceIntegrityResult {
  photos: InspectionEvidence[];
  fatal: string[];
  warnings: string[];
}

/**
 * Rebuilds the evidence list from server-side truth. Client-supplied hashes,
 * GPS and "verified" flags are discarded; only the manifest written at upload
 * time is trusted. A file that is missing or whose bytes no longer match its
 * manifest is fatal, because that is exactly the tampering this feature exists
 * to detect.
 */
export function applyEvidenceIntegrity(rawPhotos: unknown): EvidenceIntegrityResult {
  const photos: InspectionEvidence[] = [];
  const fatal: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(rawPhotos)) return { photos, fatal, warnings };

  const uploadDir = getUploadDir();

  for (const raw of rawPhotos.slice(0, 50)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const url = typeof entry.url === 'string' ? entry.url.trim() : '';
    if (!url) continue;

    const base: InspectionEvidence = {
      fieldId: typeof entry.fieldId === 'string' ? entry.fieldId.slice(0, 200) : '',
      url,
      caption: typeof entry.caption === 'string' ? entry.caption.slice(0, 500) : '',
      timestamp:
        typeof entry.timestamp === 'string' ? entry.timestamp.slice(0, 100) : new Date().toISOString(),
      location: typeof entry.location === 'string' ? entry.location.slice(0, 200) : undefined,
    };

    const filename = extractEvidenceFilename(url);
    if (!filename) {
      // Sample assets / external URLs cannot be integrity-checked, so they are
      // retained but explicitly marked unverified instead of trusted.
      photos.push({ ...base, integrityVerified: false, integrityReason: 'external_url' });
      continue;
    }

    const check = verifyStoredEvidence(uploadDir, filename);
    if (!check.ok) {
      if (check.reason === 'missing_file' || check.reason === 'hash_mismatch') {
        fatal.push(check.reason === 'missing_file' ? `missing_file:${filename}` : `hash_mismatch:${filename}`);
        continue;
      }
      warnings.push(`${check.reason ?? 'unverified'}:${filename}`);
      photos.push({
        ...base,
        integrityVerified: false,
        integrityReason: check.reason ?? 'unverified',
      });
      continue;
    }

    const manifest = check.manifest!;
    photos.push({
      ...base,
      sha256: manifest.sha256,
      sizeBytes: manifest.size,
      integrityVersion: manifest.integrityVersion,
      integrityVerified: true,
      gps: manifest.gps,
      gpsSource: manifest.gpsSource,
      capturedAt: manifest.capturedAt,
      capturedAtSource: manifest.capturedAtSource,
    });
  }

  return { photos, fatal, warnings };
}

