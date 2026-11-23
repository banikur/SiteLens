/**
 * Mutation route catalogue for Stage 2a RBAC matrix tests.
 * Corresponds exactly to Table F.5 of RECONSTRUCTION_BLUEPRINT.md v2.3.
 *
 * DESIGN PRINCIPLE for 7.a parallel matrix:
 *   - DELETE routes use a "ghost" UUID (safe-to-404) so parallel role checks
 *     don't race against each other. Auth check: 403 = forbidden, 404 = auth
 *     passed but entity already gone — both are unambiguous.
 *   - Non-destructive routes use real fixture IDs.
 *   - Bodies are MINIMAL — just enough for a valid JSON payload so the
 *     handler doesn't crash before reaching the permission check.
 *
 * Routes that validate inputs BEFORE the permission check are flagged with
 * `validationBeforePermission: true` — 400 is treated as a FINDING, not a
 * failure.
 */
import { PERMISSIONS } from '../../src/server/auth/rbac.ts';
import {
  PRJ_A_ID, PRJ_PRESET_ID,
  NODE_A_ID, NODE_TO_DELETE_ID, NODE_FOR_INIT_WORKFLOW_ID,
  STAGE_A_ID,
  TEMPLATE_A_ID, TEMPLATE_TO_DELETE_ID,
  INSPECTION_A_ID, INSPECTION_TO_DELETE_ID,
  ACTION_A_ID,
} from './stage2a-matrix-fixtures.ts';

// Ghost UUIDs — safe 404 targets for org-scoped DELETEs.
// Auth check: 403 = forbidden, 404/4xx = auth passed but entity gone — both unambiguous.
const GHOST_CHEMICAL_ID = 'ffffffff-0004-4000-8000-000000000004'; // org-scoped, ghost ok

export interface MutationRouteSpec {
  /** Human-readable name matching F.5 table */
  name: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** All permissions that grant access to this route (OR logic). */
  requiredPermissions: string[];
  /**
   * Minimal body — just enough to reach the permission check.
   * Routes are tested with real HTTP but no actual data mutation is intended.
   */
  body?: Record<string, unknown>;
  /**
   * FINDING: set true if this route validates inputs BEFORE the permission
   * check, meaning a 400 (not 403) may be returned when the role IS allowed.
   * Matrix test for "allowed" roles will accept any non-403 status.
   */
  validationBeforePermission?: true;
}

export const MUTATION_ROUTES: MutationRouteSpec[] = [
  // --- Project ---
  {
    name: 'POST /projects',
    method: 'POST',
    path: '/api/projects',
    requiredPermissions: [PERMISSIONS.PROJECT_CREATE],
    body: {
      name: 'Matrix Test Project',
      client: 'Matrix Corp',
      leadManager: 'PM Lead',
      location: 'Jakarta',
      code: `PRJ-MTX-${Date.now()}`,
      zones: [{ id: 'z1', name: 'Z1', description: 'Zone', safetyLevel: 'Standard' }],
    },
  },

  // --- WBS ---
  {
    name: 'POST /projects/:projectId/wbs/nodes',
    method: 'POST',
    path: `/api/projects/${PRJ_A_ID}/wbs/nodes`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL],
    body: { name: 'Authz Check Node', wbsCode: 'X', weightPercent: 0, sortOrder: 999 },
  },
  {
    name: 'PUT /projects/:projectId/wbs/nodes/:nodeId',
    method: 'PUT',
    path: `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_A_ID}`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL],
    body: { name: 'Authz Check Update' },
  },
  {
    name: 'DELETE /projects/:projectId/wbs/nodes/:nodeId',
    method: 'DELETE',
    path: `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_TO_DELETE_ID}`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE],
  },
  {
    name: 'POST /projects/:projectId/wbs/apply-preset',
    method: 'POST',
    path: `/api/projects/${PRJ_PRESET_ID}/wbs/apply-preset`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE],
    body: { preset: 'civil_foundation' },
  },
  {
    name: 'POST /projects/:projectId/wbs/nodes/:nodeId/workflow/init-default',
    method: 'POST',
    path: `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_FOR_INIT_WORKFLOW_ID}/workflow/init-default`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE],
  },

  // --- Stages ---
  {
    name: 'POST /stages/:stageId/submit',
    method: 'POST',
    path: `/api/stages/${STAGE_A_ID}/submit`,
    requiredPermissions: [PERMISSIONS.STAGE_EXECUTE],
    // Permission check (requirePermission) is middleware arg #2 in chain, BEFORE the handler.
    // Signature validation runs inside the handler AFTER permission passes.
    // Allowed roles get 400 (missing signature) — not 403. This is correct.
    body: { answers: {} },
  },
  {
    name: 'POST /stages/:stageId/review',
    method: 'POST',
    path: `/api/stages/${STAGE_A_ID}/review`,
    requiredPermissions: [PERMISSIONS.STAGE_APPROVE],
    body: { decision: 'approved', notes: 'authz check' },
  },

  // --- Project (edit) --- FINDING: PUT /projects/:projectId not yet implemented in api.ts.
  // This route is listed in F.5 blueprint but returns 404. Removed from matrix;
  // tracked as open item for Tahap 2b when the route is added.
  // {
  //   name: 'PUT /projects/:projectId',
  //   method: 'PUT',
  //   path: `/api/projects/${PRJ_A_ID}`,
  //   requiredPermissions: [PERMISSIONS.PROJECT_EDIT],
  //   body: { name: 'Authz Check Edit' },
  // },

  // --- Weather ---
  {
    name: 'POST /projects/:projectId/weather-logs',
    method: 'POST',
    path: `/api/projects/${PRJ_A_ID}/weather-logs`,
    requiredPermissions: [PERMISSIONS.WEATHER_LOG],
    body: { logDate: '2026-12-01', rainHours: 1, weatherCondition: 'Clear', isWorkHalted: false },
  },

  // --- Templates ---
  {
    name: 'POST /templates',
    method: 'POST',
    path: '/api/templates',
    requiredPermissions: [PERMISSIONS.TEMPLATE_MANAGE],
    body: { title: 'Authz Template', category: 'Safety & HSE', sections: [] },
  },
  {
    name: 'DELETE /templates/:id',
    method: 'DELETE',
    path: `/api/templates/${TEMPLATE_TO_DELETE_ID}`,
    requiredPermissions: [PERMISSIONS.TEMPLATE_DELETE],
  },

  // --- Inspections ---
  {
    name: 'POST /inspections',
    method: 'POST',
    path: '/api/inspections',
    requiredPermissions: [PERMISSIONS.INSPECTION_ROUTINE, PERMISSIONS.INSPECTION_ADHOC],
    body: {
      templateId: TEMPLATE_A_ID,
      category: 'Safety & HSE',
      projectId: PRJ_A_ID,
      siteZone: 'Tower Zone A',
      mode: 'routine',
      answers: {},
    },
  },
  {
    name: 'POST /inspections/:id/review',
    method: 'POST',
    path: `/api/inspections/${INSPECTION_A_ID}/review`,
    requiredPermissions: [PERMISSIONS.INSPECTION_REVIEW],
    body: { notes: 'authz check' },
  },
  {
    name: 'DELETE /inspections/:id',
    method: 'DELETE',
    path: `/api/inspections/${INSPECTION_TO_DELETE_ID}`,
    requiredPermissions: [PERMISSIONS.INSPECTION_DELETE],
  },

  // --- Corrective Actions ---
  {
    name: 'POST /actions',
    method: 'POST',
    path: '/api/actions',
    requiredPermissions: [PERMISSIONS.CAPA_CREATE],
    body: {
      inspectionTitle: 'Authz Check',
      projectId: PRJ_A_ID,
      projectName: 'Alpha Highrise Tower',
      siteZone: 'Tower Zone A',
      fieldLabel: 'Issue',
      issueDescription: 'Authz check issue',
      severity: 'medium',
      dueDate: '2027-01-01',
      assignedToName: 'User',
      assignedToRole: 'Action Owner / Subcontractor',
    },
  },
  {
    name: 'PATCH /actions/:id',
    method: 'PATCH',
    path: `/api/actions/${ACTION_A_ID}`,
    requiredPermissions: [PERMISSIONS.CAPA_UPDATE_PROGRESS, PERMISSIONS.CAPA_CLOSE],
    body: { resolutionNotes: 'authz check' },
  },

  // --- Users ---
  {
    name: 'PATCH /users/:id',
    method: 'PATCH',
    path: `/api/users/10000000-0000-4000-8000-000000000003`,
    requiredPermissions: [PERMISSIONS.ADMIN_USERS],
    body: { name: 'Authz Check Update' },
  },
  {
    name: 'POST /users',
    method: 'POST',
    path: '/api/users',
    requiredPermissions: [PERMISSIONS.ADMIN_USERS],
    body: {
      email: `authz-newuser-${Date.now()}@sitelens.local`,
      name: 'Authz New User',
      role: 'Field / QC Inspector',
      password: 'Str0ngPass!99',
    },
  },

  // --- Tenant ---
  {
    name: 'PUT /tenant/profile',
    method: 'PUT',
    path: '/api/tenant/profile',
    requiredPermissions: [PERMISSIONS.TENANT_COMPLIANCE_MANAGE],
    body: { companyName: 'Authz Corp' },
  },
  {
    name: 'POST /tenant/chemicals',
    method: 'POST',
    path: '/api/tenant/chemicals',
    requiredPermissions: [PERMISSIONS.TENANT_COMPLIANCE_MANAGE],
    body: { name: 'Authz Chemical', category: 'Flammable', quantityStoredKg: 100, thresholdNakKg: 1000 },
  },
  {
    name: 'DELETE /tenant/chemicals/:id',
    method: 'DELETE',
    path: `/api/tenant/chemicals/${GHOST_CHEMICAL_ID}`,
    requiredPermissions: [PERMISSIONS.TENANT_COMPLIANCE_MANAGE],
  },

  // --- Notifications ---
  {
    name: 'PUT /notifications/settings',
    method: 'PUT',
    path: '/api/notifications/settings',
    requiredPermissions: [PERMISSIONS.ADMIN_SETTINGS],
    body: { notifyOnCriticalCapa: false, notifyOnApproval: false, smtpHost: null },
  },

  // --- Uploads / Evidence ---
  // Note: multer runs INSIDE the handler (after requirePermission middleware).
  // Forbidden roles get 403 (permission check first).
  // Allowed roles get 400 (multer: missing file) — this is correct, NOT a finding.
  {
    name: 'POST /uploads',
    method: 'POST',
    path: '/api/uploads',
    requiredPermissions: [PERMISSIONS.EVIDENCE_UPLOAD],
    body: {},
    validationBeforePermission: true, // multer inside handler → allowed roles get 400 (no file)
  },
];
