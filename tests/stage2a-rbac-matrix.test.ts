import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express, { type Request, type Response } from 'express';
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
  inspections,
  correctiveActions,
  checklistTemplates,
  roles,
  permissions,
  rolePermissions,
  roleAssignments,
  tenantProfiles,
  notificationSettings,
} from '../src/server/db/schema.ts';
import { attachSessionUser, requireAuth } from '../src/server/auth/middleware.ts';
import { hashSessionToken, hashSecret } from '../src/server/auth/crypto.ts';
import {
  PERMISSIONS,
  BUILTIN_ROLES,
  PERMISSION_DEFINITIONS,
  syncRbacCatalog,
  seedLegacyRoleAssignments,
  requirePermission,
} from '../src/server/auth/rbac.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { tenantRouter } from '../src/server/routes/tenant.ts';
import { notificationsRouter } from '../src/server/routes/notifications.ts';
import { uploadsRouter } from '../src/server/routes/uploads.ts';
import { authRouter } from '../src/server/routes/auth.ts';

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

  // Template generation endpoint registered as on server.ts
  app.post(
    '/api/templates/generate',
    requireAuth,
    requirePermission(PERMISSIONS.TEMPLATE_MANAGE),
    async (_req: Request, res: Response) => {
      res.json({ success: true, message: 'generated' });
    }
  );

  return app;
}

const PRJ_A_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const PRJ_B_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

const NODE_A_ID = '11111111-aaaa-4aaa-8aaa-111111111111';
const NODE_B_ID = '22222222-bbbb-4bbb-8bbb-222222222222';
const WORKFLOW_A_ID = '33333333-aaaa-4aaa-8aaa-333333333333';
const STAGE_A_ID = '44444444-aaaa-4aaa-8aaa-444444444444';
const ATTEMPT_A_ID = '55555555-aaaa-4aaa-8aaa-555555555555';
const TEMPLATE_A_ID = '66666666-aaaa-4aaa-8aaa-666666666666';
const INSPECTION_A_ID = '77777777-aaaa-4aaa-8aaa-777777777777';
const ACTION_A_ID = '88888888-aaaa-4aaa-8aaa-888888888888';
const CHEMICAL_A_ID = '99999999-aaaa-4aaa-8aaa-999999999999';

const NODE_TO_DELETE_ID = '11111111-dddd-4ddd-8ddd-111111111111';
const TEMPLATE_TO_DELETE_ID = '66666666-dddd-4ddd-8ddd-666666666666';
const INSPECTION_TO_DELETE_ID = '77777777-dddd-4ddd-8ddd-777777777777';
const CHEMICAL_TO_DELETE_ID = '99999999-dddd-4ddd-8ddd-999999999999';

// 7 Built-in roles under test
const ROLE_KEYS = [
  'field_inspector',
  'subcontractor',
  'site_engineer',
  'qaqc_lead',
  'project_manager',
  'head_office_pmo',
  'client_viewer',
] as const;

type BuiltinRoleKey = typeof ROLE_KEYS[number];

const ROLE_USER_MAP: Record<BuiltinRoleKey, { id: string; email: string; token: string }> = {
  field_inspector: {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'inspector@sitelens.local',
    token: 'token-field-inspector-00000000000000000001',
  },
  subcontractor: {
    id: '10000000-0000-4000-8000-000000000002',
    email: 'subcon@sitelens.local',
    token: 'token-subcontractor-00000000000000000002',
  },
  site_engineer: {
    id: '10000000-0000-4000-8000-000000000003',
    email: 'engineer@sitelens.local',
    token: 'token-site-engineer-00000000000000000003',
  },
  qaqc_lead: {
    id: '10000000-0000-4000-8000-000000000004',
    email: 'qaqc@sitelens.local',
    token: 'token-qaqc-lead-00000000000000000004',
  },
  project_manager: {
    id: '10000000-0000-4000-8000-000000000005',
    email: 'pm@sitelens.local',
    token: 'token-project-manager-00000000000000000005',
  },
  head_office_pmo: {
    id: '10000000-0000-4000-8000-000000000006',
    email: 'pmo@sitelens.local',
    token: 'token-head-office-pmo-00000000000000000006',
  },
  client_viewer: {
    id: '10000000-0000-4000-8000-000000000007',
    email: 'viewer@sitelens.local',
    token: 'token-client-viewer-00000000000000000007',
  },
};

let server: http.Server;
let baseUrl = '';

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

async function seedMatrixDatabase() {
  const db = getDb();
  if (!db) throw new Error('Database not connected');

  // Clear tables in reverse dependency order
  await db.delete(roleAssignments);
  await db.delete(sessions);
  await db.delete(correctiveActions);
  await db.delete(inspections);
  await db.delete(inspectionAttempts);
  await db.delete(workStages);
  await db.delete(workWorkflows);
  await db.delete(workNodes);
  await db.delete(checklistTemplates);
  await db.delete(projects);
  await db.delete(tenantProfiles);
  await db.delete(users);

  // Sync RBAC catalog (permissions, roles, role_permissions)
  await syncRbacCatalog();

  // Create Projects
  await db.insert(projects).values([
    {
      id: PRJ_A_ID,
      name: 'Alpha Highrise Tower',
      client: 'Alpha Corp',
      leadManager: 'Marcus Chen',
      location: 'Jakarta',
      code: 'PRJ-ALPHA',
      zones: [{ id: 'z1', name: 'Tower Zone A', description: 'Tower zone', safetyLevel: 'standard' }],
      status: 'active',
      capaLockoutSeverities: ['critical', 'high'],
    },
    {
      id: PRJ_B_ID,
      name: 'Beta Industrial Terminal',
      client: 'Beta Corp',
      leadManager: 'Alex Rivers',
      location: 'Balikpapan',
      code: 'PRJ-BETA',
      zones: [{ id: 'z1', name: 'Skid Bay 1', description: 'Skid bay', safetyLevel: 'standard' }],
      status: 'active',
      capaLockoutSeverities: ['critical', 'high'],
    },
  ]);

  // Insert Users & Sessions for each role
  for (const roleKey of ROLE_KEYS) {
    const userMeta = ROLE_USER_MAP[roleKey];
    await db.insert(users).values({
      id: userMeta.id,
      username: `user_${roleKey}`,
      email: userMeta.email,
      name: `User ${roleKey}`,
      title: 'Staff Member',
      role: 'Project / Site Engineer', // Legacy column kept for compatibility
      assignedProjects: [PRJ_A_ID],
      passwordHash: hashSecret('secret123'),
      isActive: true,
    });

    await db.insert(sessions).values({
      id: hashSessionToken(userMeta.token),
      userId: userMeta.id,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });

    // Assign roles in role_assignments:
    // head_office_pmo gets organization scope (null projectId)
    // All other 6 roles get project scope on PRJ_A_ID
    if (roleKey === 'head_office_pmo') {
      await db.insert(roleAssignments).values({
        userId: userMeta.id,
        roleId: 'head_office_pmo',
        scopeType: 'organization',
        projectId: null,
        isActive: true,
      });
    } else {
      await db.insert(roleAssignments).values({
        userId: userMeta.id,
        roleId: roleKey,
        scopeType: 'project',
        projectId: PRJ_A_ID as any,
        isActive: true,
      });
    }
  }

  // WBS Node for PRJ_A
  await db.insert(workNodes).values([
    {
      id: NODE_A_ID,
      projectId: PRJ_A_ID,
      parentId: null,
      wbsCode: '1',
      name: 'Structural Work A',
      weightPercent: '100.00',
      sortOrder: 1,
    },
    {
      id: NODE_TO_DELETE_ID,
      projectId: PRJ_A_ID,
      parentId: null,
      wbsCode: '99',
      name: 'Temporary Work Node to Delete',
      weightPercent: '0.00',
      sortOrder: 99,
    },
    {
      id: NODE_B_ID,
      projectId: PRJ_B_ID,
      parentId: null,
      wbsCode: '1',
      name: 'Structural Work B',
      weightPercent: '100.00',
      sortOrder: 1,
    },
  ]);

  // Workflow & Stage on PRJ_A
  await db.insert(workWorkflows).values({
    id: WORKFLOW_A_ID,
    nodeId: NODE_A_ID,
    title: 'Alpha Foundation Workflow',
  });

  await db.insert(workStages).values({
    id: STAGE_A_ID,
    workflowId: WORKFLOW_A_ID,
    stageOrder: 1,
    stageType: 'work',
    name: 'Foundation Stage',
    assignedRole: 'Field / QC Inspector',
    approvalRole: 'QA/QC Lead / Owner Inspector',
    status: 'submitted',
  });

  await db.insert(inspectionAttempts).values({
    id: ATTEMPT_A_ID,
    stageId: STAGE_A_ID,
    attemptNumber: 1,
    submitterId: ROLE_USER_MAP.field_inspector.id,
    status: 'submitted',
    answers: { test: 'ok' },
  });

  // Checklist Template
  await db.insert(checklistTemplates).values([
    {
      id: TEMPLATE_A_ID,
      title: 'Pre-Pour Concrete Checklist',
      category: 'Safety & HSE',
      description: 'Checklist for foundation concrete',
      sections: [],
      authorName: 'Marcus Chen',
      authorRole: 'QC Inspector',
    },
    {
      id: TEMPLATE_TO_DELETE_ID,
      title: 'Disposable Checklist Template',
      category: 'Safety & HSE',
      description: 'Template meant to be deleted in tests',
      sections: [],
      authorName: 'Marcus Chen',
      authorRole: 'QC Inspector',
    },
  ]);

  // Inspection
  await db.insert(inspections).values([
    {
      id: INSPECTION_A_ID,
      templateId: TEMPLATE_A_ID,
      templateTitle: 'Pre-Pour Concrete Checklist',
      category: 'Safety & HSE',
      projectId: PRJ_A_ID,
      projectName: 'Alpha Highrise Tower',
      siteZone: 'Tower Zone A',
      inspectorId: ROLE_USER_MAP.field_inspector.id,
      inspectorName: 'Field Inspector User',
      inspectorRole: 'Field / QC Inspector',
      status: 'draft',
      currentStepIndex: 0,
      answers: {},
    },
    {
      id: INSPECTION_TO_DELETE_ID,
      templateId: TEMPLATE_A_ID,
      templateTitle: 'Pre-Pour Concrete Checklist',
      category: 'Safety & HSE',
      projectId: PRJ_A_ID,
      projectName: 'Alpha Highrise Tower',
      siteZone: 'Tower Zone A',
      inspectorId: ROLE_USER_MAP.field_inspector.id,
      inspectorName: 'Field Inspector User',
      inspectorRole: 'Field / QC Inspector',
      status: 'draft',
      currentStepIndex: 0,
      answers: {},
    },
  ]);

  // Corrective Action (assigned to subcontractor)
  await db.insert(correctiveActions).values({
    id: ACTION_A_ID,
    inspectionId: INSPECTION_A_ID,
    inspectionTitle: 'Weekly Scaffolding Audit',
    projectId: PRJ_A_ID,
    projectName: 'Alpha Highrise Tower',
    siteZone: 'Tower Zone A',
    fieldLabel: 'Guardrail missing',
    issueDescription: 'Perimeter guardrail missing on Level 3',
    severity: 'high',
    assigneeId: ROLE_USER_MAP.subcontractor.id,
    assignedToName: 'Subcontractor User',
    assignedToRole: 'Action Owner / Subcontractor',
    dueDate: '2026-12-15',
    status: 'OPEN',
  });

  // Tenant Profile & Chemical Item
  await db.insert(tenantProfiles).values({
    companyName: 'SiteLens Test Tenant',
    facilityLocation: 'Balikpapan Terminal',
    workforceCount: 100,
    riskLevel: 'HIGH',
    targetSmk3Level: 'LANJUTAN_166',
    chemicalHazardStatus: 'MENENGAH',
    chemicalInventory: [
      {
        id: CHEMICAL_A_ID,
        name: 'Diesel Fuel Depot Skid #2',
        casNumber: '68334-30-5',
        category: 'Flammable',
        quantityStoredKg: 45000,
        thresholdNakKg: 200000,
        ratio: 0.225,
      },
      {
        id: CHEMICAL_TO_DELETE_ID,
        name: 'Chemical to delete',
        casNumber: '12345-67-8',
        category: 'Toxic',
        quantityStoredKg: 100,
        thresholdNakKg: 1000,
        ratio: 0.1,
      },
    ],
  });

  // Notification Settings: disable remote dispatches during test
  await db
    .insert(notificationSettings)
    .values({
      id: 'default',
      notifyOnCriticalCapa: false,
      notifyOnApproval: false,
      smtpHost: null,
      webhookUrl: null,
    })
    .onConflictDoUpdate({
      target: notificationSettings.id,
      set: {
        notifyOnCriticalCapa: false,
        notifyOnApproval: false,
        smtpHost: null,
        webhookUrl: null,
      },
    });
}

async function restoreDeletables() {
  const db = getDb();
  if (!db) return;

  await db
    .insert(workNodes)
    .values({
      id: NODE_TO_DELETE_ID,
      projectId: PRJ_A_ID,
      parentId: null,
      wbsCode: '99',
      name: 'Temporary Work Node to Delete',
      weightPercent: '0.00',
      sortOrder: 99,
    })
    .onConflictDoNothing();

  await db
    .insert(checklistTemplates)
    .values({
      id: TEMPLATE_TO_DELETE_ID,
      title: 'Disposable Checklist Template',
      category: 'Safety & HSE',
      description: 'Template meant to be deleted in tests',
      sections: [],
      authorName: 'Marcus Chen',
      authorRole: 'QC Inspector',
    })
    .onConflictDoNothing();

  await db
    .insert(inspections)
    .values({
      id: INSPECTION_TO_DELETE_ID,
      templateId: TEMPLATE_A_ID,
      templateTitle: 'Pre-Pour Concrete Checklist',
      category: 'Safety & HSE',
      projectId: PRJ_A_ID,
      projectName: 'Alpha Highrise Tower',
      siteZone: 'Tower Zone A',
      inspectorId: ROLE_USER_MAP.field_inspector.id,
      inspectorName: 'Field Inspector User',
      inspectorRole: 'Field / QC Inspector',
      status: 'draft',
      currentStepIndex: 0,
      answers: {},
    })
    .onConflictDoNothing();
}

// -----------------------------------------------------------------------------
// Mutation Route Definitions from Table F.5
// -----------------------------------------------------------------------------
interface MutationRouteSpec {
  name: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  requiredPermissions: string[];
  payload?: any;
}

const MUTATION_ROUTES: MutationRouteSpec[] = [
  {
    name: 'POST /projects',
    method: 'POST',
    path: '/api/projects',
    requiredPermissions: [PERMISSIONS.PROJECT_CREATE],
    payload: {
      name: 'Dynamic Created Project',
      client: 'Omega Corp',
      leadManager: 'PM Lead',
      location: 'Surabaya',
      code: 'PRJ-OMEGA',
      zones: [{ id: 'z1', name: 'Z1', description: 'Zone 1', safetyLevel: 'standard' }],
    },
  },
  {
    name: 'POST /projects/:projectId/wbs/nodes',
    method: 'POST',
    path: `/api/projects/${PRJ_A_ID}/wbs/nodes`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL],
    payload: {
      name: 'New Activity Node',
      wbsCode: '2',
      weightPercent: 10,
      sortOrder: 2,
    },
  },
  {
    name: 'PUT /projects/:projectId/wbs/nodes/:nodeId',
    method: 'PUT',
    path: `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_A_ID}`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE, PERMISSIONS.WBS_EDIT_DETAIL],
    payload: {
      name: 'Updated Structural Node',
    },
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
    path: `/api/projects/${PRJ_A_ID}/wbs/apply-preset`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE],
    payload: {
      preset: 'civil_foundation',
    },
  },
  {
    name: 'POST /projects/:projectId/wbs/nodes/:nodeId/workflow/init-default',
    method: 'POST',
    path: `/api/projects/${PRJ_A_ID}/wbs/nodes/${NODE_A_ID}/workflow/init-default`,
    requiredPermissions: [PERMISSIONS.WBS_EDIT_STRUCTURE],
  },
  {
    name: 'POST /stages/:stageId/submit',
    method: 'POST',
    path: `/api/stages/${STAGE_A_ID}/submit`,
    requiredPermissions: [PERMISSIONS.STAGE_EXECUTE],
    payload: {
      answers: { step1: 'passed' },
      signatureCanvasUrl: 'data:image/png;base64,mockValidSignature123',
    },
  },
  {
    name: 'POST /stages/:stageId/review',
    method: 'POST',
    path: `/api/stages/${STAGE_A_ID}/review`,
    requiredPermissions: [PERMISSIONS.STAGE_APPROVE],
    payload: {
      decision: 'approved',
      reviewNotes: 'Verified OK',
    },
  },
  {
    name: 'POST /projects/:projectId/scurve/override',
    method: 'POST',
    path: `/api/projects/${PRJ_A_ID}/scurve/override`,
    requiredPermissions: [PERMISSIONS.SCURVE_OVERRIDE],
    payload: {
      weekIndex: 2,
      plannedCumulativePercent: 20.0,
      justification: 'Accelerated foundation schedule',
    },
  },
  {
    name: 'POST /projects/:projectId/weather-logs',
    method: 'POST',
    path: `/api/projects/${PRJ_A_ID}/weather-logs`,
    requiredPermissions: [PERMISSIONS.WEATHER_LOG],
    payload: {
      logDate: '2026-11-23',
      rainHours: 3.5,
      weatherCondition: 'Heavy Rain',
      isWorkHalted: true,
    },
  },
  {
    name: 'POST /templates',
    method: 'POST',
    path: '/api/templates',
    requiredPermissions: [PERMISSIONS.TEMPLATE_MANAGE],
    payload: {
      title: 'New Site Inspection Protocol',
      category: 'Safety & HSE',
      sections: [],
    },
  },
  {
    name: 'DELETE /templates/:id',
    method: 'DELETE',
    path: `/api/templates/${TEMPLATE_TO_DELETE_ID}`,
    requiredPermissions: [PERMISSIONS.TEMPLATE_DELETE],
  },
  {
    name: 'POST /inspections',
    method: 'POST',
    path: '/api/inspections',
    requiredPermissions: [PERMISSIONS.INSPECTION_ROUTINE, PERMISSIONS.INSPECTION_ADHOC],
    payload: {
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
    payload: {
      notes: 'Signed off by QA/QC Lead',
    },
  },
  {
    name: 'DELETE /inspections/:id',
    method: 'DELETE',
    path: `/api/inspections/${INSPECTION_TO_DELETE_ID}`,
    requiredPermissions: [PERMISSIONS.INSPECTION_DELETE],
  },
  {
    name: 'POST /actions',
    method: 'POST',
    path: '/api/actions',
    requiredPermissions: [PERMISSIONS.CAPA_CREATE],
    payload: {
      inspectionTitle: 'Scaffolding Check',
      projectId: PRJ_A_ID,
      projectName: 'Alpha Highrise Tower',
      siteZone: 'Tower Zone A',
      fieldLabel: 'Plank issue',
      issueDescription: 'Missing toe board on scaffolding',
      severity: 'medium',
      dueDate: '2026-12-20',
      assignedToName: 'Subcontractor User',
      assignedToRole: 'Action Owner / Subcontractor',
    },
  },
  {
    name: 'PATCH /actions/:id',
    method: 'PATCH',
    path: `/api/actions/${ACTION_A_ID}`,
    requiredPermissions: [PERMISSIONS.CAPA_UPDATE_PROGRESS, PERMISSIONS.CAPA_CLOSE],
    payload: {
      resolutionNotes: 'Toe board installed',
    },
  },
  {
    name: 'PATCH /users/:id',
    method: 'PATCH',
    path: `/api/users/${ROLE_USER_MAP.field_inspector.id}`,
    requiredPermissions: [PERMISSIONS.ADMIN_USERS],
    payload: {
      name: 'Renamed Field Inspector',
    },
  },
  {
    name: 'POST /users',
    method: 'POST',
    path: '/api/users',
    requiredPermissions: [PERMISSIONS.ADMIN_USERS],
    payload: {
      email: 'brandnewuser@sitelens.local',
      name: 'Brand New User',
      role: 'Field / QC Inspector',
      password: 'StrongPassword123!',
    },
  },
  {
    name: 'PUT /tenant/profile',
    method: 'PUT',
    path: '/api/tenant/profile',
    requiredPermissions: [PERMISSIONS.TENANT_COMPLIANCE_MANAGE],
    payload: {
      companyName: 'SiteLens Updated Enterprise',
    },
  },
  {
    name: 'POST /tenant/chemicals',
    method: 'POST',
    path: '/api/tenant/chemicals',
    requiredPermissions: [PERMISSIONS.TENANT_COMPLIANCE_MANAGE],
    payload: {
      name: 'Acetylene Cylinder Bank',
      category: 'Flammable',
      quantityStoredKg: 500,
      thresholdNakKg: 5000,
    },
  },
  {
    name: 'DELETE /tenant/chemicals/:id',
    method: 'DELETE',
    path: `/api/tenant/chemicals/${CHEMICAL_TO_DELETE_ID}`,
    requiredPermissions: [PERMISSIONS.TENANT_COMPLIANCE_MANAGE],
  },
  {
    name: 'PUT /notifications/settings',
    method: 'PUT',
    path: '/api/notifications/settings',
    requiredPermissions: [PERMISSIONS.ADMIN_SETTINGS],
    payload: {
      notifyOnCriticalCapa: false,
      notifyOnApproval: false,
      smtpHost: null,
    },
  },
];

// Helper to determine whether a role is expected to have permission for a route
function isRoleAllowed(roleKey: BuiltinRoleKey, route: MutationRouteSpec): boolean {
  const roleDef = BUILTIN_ROLES.find((r) => r.id === roleKey);
  if (!roleDef) return false;

  const rolePermSet = new Set(roleDef.permissions);

  for (const permKey of route.requiredPermissions) {
    if (!rolePermSet.has(permKey as any)) continue;

    const permDef = PERMISSION_DEFINITIONS.find((p) => p.id === permKey);
    const scopeLevel = permDef?.scopeLevel || 'project';

    if (roleKey === 'head_office_pmo') {
      // head_office_pmo has scope 'organization' with null projectId (Opsi 2)
      // Allowed if permission is [ORG] or [ORG/PRJ]
      // Forbidden if permission strictly requires [PRJ] assignment
      if (scopeLevel === 'organization' || scopeLevel === 'organization_or_project') {
        return true;
      }
    } else {
      // The other 6 roles have explicit project assignment on PRJ_A_ID
      // Allowed if permission is [PRJ] or [ORG/PRJ]
      // Forbidden if permission strictly requires [ORG] scope
      if (scopeLevel === 'project' || scopeLevel === 'organization_or_project') {
        return true;
      }
    }
  }

  return false;
}

// -----------------------------------------------------------------------------
// Test Suite: Stage 2a RBAC Matrix & Catch-All Reflection
// -----------------------------------------------------------------------------
test('Tahap 2a: RBAC Matrix, Route Registry Reflection & Isolation Verification', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();

  const app = createTestApp();
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await closeDb();
  });

  // ===========================================================================
  // 7.a. Matriks: 7 role x SELURUH rute mutasi dari tabel F.5
  // ===========================================================================
  await t.test('7.a. Matrix-Driven HTTP Test: 7 roles x all mutation routes match F.4 matrix', async () => {
    let checkedCount = 0;

    for (const roleKey of ROLE_KEYS) {
      await restoreDeletables();
      const userMeta = ROLE_USER_MAP[roleKey];

      for (const route of MUTATION_ROUTES) {
        const expectedAllowed = isRoleAllowed(roleKey, route);

        const res = await req(route.method, route.path, userMeta.token, route.payload);

        if (expectedAllowed) {
          assert.notEqual(
            res.status,
            403,
            `Role '${roleKey}' SHOULD HAVE ACCESS to ${route.name}, but received 403 Forbidden: ${JSON.stringify(
              res.body
            )}`
          );
        } else {
          assert.equal(
            res.status,
            403,
            `Role '${roleKey}' MUST BE FORBIDDEN from ${route.name}, but received status ${res.status}: ${JSON.stringify(
              res.body
            )}`
          );
        }

        checkedCount++;
      }
    }

    assert.equal(checkedCount, ROLE_KEYS.length * MUTATION_ROUTES.length);
  });

  // ===========================================================================
  // 7.b. Registri rute: gagal bila ada rute mutasi tanpa permission terdaftar
  // ===========================================================================
  await t.test('7.b. Route Registry Catch-All: Every mutation route must declare requirePermission', async () => {
    const publicWhitelist = new Set([
      'POST /api/auth/login',
      'POST /api/auth/pin-login',
      'POST /api/auth/logout',
      'POST /api/auth/webauthn/login-options',
      'POST /api/auth/webauthn/login-verify',
      'POST /api/auth/pin-setup',
      'POST /api/auth/webauthn/register-options',
      'POST /api/auth/webauthn/register-verify',
      'POST /api/uploads',
    ]);

    interface DiscoveredRoute {
      method: string;
      fullPath: string;
      hasPermission: boolean;
      requiredPermission?: any;
    }

    const discoveredMutationRoutes: DiscoveredRoute[] = [];

    function scanRouter(router: any, prefix = '') {
      if (!router || !router.stack) return;

      for (const layer of router.stack) {
        if (layer.route) {
          const route = layer.route;
          const routePath = prefix + (route.path === '/' ? '' : route.path);
          const methods = Object.keys(route.methods).map((m) => m.toUpperCase());

          for (const m of methods) {
            if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) {
              let hasPermission = false;
              let requiredPerm: any = null;

              // Check if any handler in route stack has _requiredPermission
              for (const h of route.stack) {
                if (h.handle && h.handle._requiredPermission) {
                  hasPermission = true;
                  requiredPerm = h.handle._requiredPermission;
                  break;
                }
              }

              // Check if router itself has _requiredPermission (e.g. notificationsRouter)
              if (!hasPermission && router._requiredPermission) {
                hasPermission = true;
                requiredPerm = router._requiredPermission;
              }

              discoveredMutationRoutes.push({
                method: m,
                fullPath: routePath,
                hasPermission,
                requiredPermission: requiredPerm,
              });
            }
          }
        } else if (layer.name === 'router' && layer.handle) {
          // Sub-router mounted at layer.regexp
          let mountPrefix = prefix;
          if (layer.regexp) {
            // Extract mount path from regexp if available
            const match = layer.regexp.source
              .replace('^\\', '')
              .replace('\\/?(?=\\/|$)', '')
              .replace(/\\\//g, '/')
              .replace(/\\/g, '');
            if (match && match !== '/') {
              mountPrefix = prefix + (match.startsWith('/') ? match : '/' + match);
            }
          }

          // Check if router has router-level middleware with _requiredPermission
          let routerLevelPerm: any = null;
          if (layer.handle.stack) {
            for (const h of layer.handle.stack) {
              if (h.handle && h.handle._requiredPermission) {
                routerLevelPerm = h.handle._requiredPermission;
                break;
              }
            }
          }
          if (routerLevelPerm) {
            layer.handle._requiredPermission = routerLevelPerm;
          }

          scanRouter(layer.handle, mountPrefix);
        }
      }
    }

    scanRouter((app as any)._router, '');

    const unmappedRoutes: DiscoveredRoute[] = [];

    for (const r of discoveredMutationRoutes) {
      const key = `${r.method} ${r.fullPath}`;
      if (publicWhitelist.has(key)) {
        continue;
      }
      if (!r.hasPermission) {
        unmappedRoutes.push(r);
      }
    }

    assert.equal(
      unmappedRoutes.length,
      0,
      `Fail-Closed Security Violation! The following mutation routes lack requirePermission:\n${unmappedRoutes
        .map((r) => `${r.method} ${r.fullPath}`)
        .join('\n')}`
    );
  });

  // ===========================================================================
  // 7.c. Regresi isolasi Tahap 1 + Org-Scope + Seed Migration
  // ===========================================================================
  await t.test('7.c. Isolation regression, Org-Scope behavior & Legacy Seeding', async () => {
    const engineerToken = ROLE_USER_MAP.site_engineer.token;
    const pmoToken = ROLE_USER_MAP.head_office_pmo.token;

    // 1. Site Engineer assigned to Project A is denied access to Project B
    const bWbsRes = await req('GET', `/api/projects/${PRJ_B_ID}/wbs`, engineerToken);
    assert.equal(bWbsRes.status, 403, 'Site Engineer must be denied reading Project B WBS');

    const bPutNodeRes = await req(
      'PUT',
      `/api/projects/${PRJ_B_ID}/wbs/nodes/${NODE_B_ID}`,
      engineerToken,
      { name: 'Illicit Project B edit' }
    );
    assert.equal(bPutNodeRes.status, 403, 'Site Engineer must be denied editing Project B node');

    // 2. Org-Scope (Head Office / PMO): Universal read across all projects
    const pmoReadARes = await req('GET', `/api/projects/${PRJ_A_ID}/wbs`, pmoToken);
    assert.equal(pmoReadARes.status, 200, 'PMO (org scope) must have universal read on Project A');

    const pmoReadBRes = await req('GET', `/api/projects/${PRJ_B_ID}/wbs`, pmoToken);
    assert.equal(pmoReadBRes.status, 200, 'PMO (org scope) must have universal read on Project B');

    // 3. Org-Scope without project assignment is denied [PRJ] mutations
    const pmoWeatherRes = await req(
      'POST',
      `/api/projects/${PRJ_A_ID}/weather-logs`,
      pmoToken,
      { logDate: '2026-11-24', rainHours: 1, weatherCondition: 'Clear', isWorkHalted: false }
    );
    assert.equal(
      pmoWeatherRes.status,
      403,
      'PMO without explicit project assignment must be denied project-scoped mutations'
    );

    // 4. Org-Scope is allowed [ORG] mutations
    const pmoCreatePrjRes = await req(
      'POST',
      '/api/projects',
      pmoToken,
      {
        name: 'PMO Created Project',
        client: 'Gamma Client',
        leadManager: 'PMO Lead',
        location: 'Medan',
        code: 'PRJ-GAMMA',
        zones: [{ id: 'z1', name: 'Z1', description: 'Zone', safetyLevel: 'standard' }],
      }
    );
    assert.equal(pmoCreatePrjRes.status, 201, 'PMO must be allowed [ORG] project creation');

    // 5. Atomic Auto-Assignment of project creator (F.1.D)
    const newPrjId = pmoCreatePrjRes.body.project?.id;
    assert.ok(newPrjId, 'New project ID should be returned');

    const db = getDb();
    if (!db) throw new Error('DB unavailable');
    const autoAssignments = await db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.projectId, newPrjId));
    assert.equal(autoAssignments.length, 1, 'Project creator must be auto-assigned to new project');
    assert.equal(autoAssignments[0].userId, ROLE_USER_MAP.head_office_pmo.id);
    assert.equal(autoAssignments[0].roleId, 'project_manager');

    // 6. Test Seed Legacy Role Assignments (G.1.C)
    const legacyAdminId = '90000000-0000-4000-8000-000000000001';
    const legacyEngId = '90000000-0000-4000-8000-000000000002';

    await db.insert(users).values([
      {
        id: legacyAdminId,
        username: 'legacy_admin',
        email: 'legacy.admin@sitelens.local',
        name: 'Legacy Admin Director',
        title: 'Project Director',
        role: 'Project Director & Tenant Admin',
        assignedProjects: [],
        passwordHash: hashSecret('pass123'),
        isActive: true,
      },
      {
        id: legacyEngId,
        username: 'legacy_eng',
        email: 'legacy.engineer@sitelens.local',
        name: 'Legacy Site Engineer',
        title: 'Site Engineer',
        role: 'Project / Site Engineer',
        assignedProjects: [PRJ_A_ID],
        passwordHash: hashSecret('pass123'),
        isActive: true,
      },
    ]);

    await seedLegacyRoleAssignments();

    // Verify Legacy Admin has head_office_pmo (organization) AND project_manager on active projects
    const adminAssignments = await db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, legacyAdminId));

    const hasOrg = adminAssignments.some(
      (a) => a.scopeType === 'organization' && a.roleId === 'head_office_pmo'
    );
    const hasPrjA = adminAssignments.some(
      (a) => a.scopeType === 'project' && a.projectId === PRJ_A_ID && a.roleId === 'project_manager'
    );
    assert.ok(hasOrg, 'Legacy admin must be seeded with organization scope head_office_pmo');
    assert.ok(hasPrjA, 'Legacy admin must be seeded with project_manager on active projects');

    // Verify Legacy Engineer has site_engineer on PRJ_A
    const engAssignments = await db
      .select()
      .from(roleAssignments)
      .where(eq(roleAssignments.userId, legacyEngId));
    const hasEngA = engAssignments.some(
      (a) => a.scopeType === 'project' && a.projectId === PRJ_A_ID && a.roleId === 'site_engineer'
    );
    assert.ok(hasEngA, 'Legacy engineer must be seeded with site_engineer on PRJ_A');
  });

  // ===========================================================================
  // 7.d. Client Viewer: seluruh mutasi ditolak karena ketiadaan permission
  // ===========================================================================
  await t.test('7.d. Client Viewer: all mutations rejected due to lack of permission', async () => {
    await restoreDeletables();
    const viewerToken = ROLE_USER_MAP.client_viewer.token;

    for (const route of MUTATION_ROUTES) {
      const res = await req(route.method, route.path, viewerToken, route.payload);
      assert.equal(
        res.status,
        403,
        `Client Viewer MUST be rejected with 403 on ${route.name}, received: ${res.status}`
      );
      assert.match(
        res.body.error || '',
        /Forbidden: Insufficient permissions/,
        `Error response must indicate permission-based rejection, received: ${JSON.stringify(res.body)}`
      );
    }
  });
});
