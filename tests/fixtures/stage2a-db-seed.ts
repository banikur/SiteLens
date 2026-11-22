/**
 * Database seeding for Stage 2a RBAC matrix tests.
 * Called once per suite in before(). No Argon2 per-test.
 */
import { getDb } from '../../src/server/db/index.ts';
import {
  users, sessions, projects, workNodes, workWorkflows, workStages,
  inspectionAttempts, inspections, correctiveActions, checklistTemplates,
  roleAssignments, tenantProfiles, notificationSettings,
} from '../../src/server/db/schema.ts';
import { syncRbacCatalog } from '../../src/server/auth/rbac.ts';
import {
  PRJ_A_ID, PRJ_B_ID, PRJ_PRESET_ID,
  NODE_A_ID, NODE_B_ID, NODE_TO_DELETE_ID, NODE_FOR_INIT_WORKFLOW_ID,
  WORKFLOW_A_ID, STAGE_A_ID, ATTEMPT_A_ID,
  TEMPLATE_A_ID, TEMPLATE_TO_DELETE_ID,
  INSPECTION_A_ID, INSPECTION_TO_DELETE_ID,
  ACTION_A_ID, CHEMICAL_A_ID, CHEMICAL_TO_DELETE_ID,
  ROLE_KEYS, ROLE_USER_MAP, SHARED_PASSWORD_HASH,
} from './stage2a-matrix-fixtures.ts';

export async function seedMatrixDatabase() {
  const db = getDb();
  if (!db) throw new Error('Database not connected');

  // Clear in reverse-dependency order
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

  // Sync RBAC catalog (permissions, roles, role_permissions) — idempotent
  await syncRbacCatalog();

  // Projects
  await db.insert(projects).values([
    {
      id: PRJ_A_ID, name: 'Alpha Highrise Tower', client: 'Alpha Corp',
      leadManager: 'Marcus Chen', location: 'Jakarta', code: 'PRJ-ALPHA',
      zones: [{ id: 'z1', name: 'Tower Zone A', description: 'Tower zone', safetyLevel: 'Standard' }],
      status: 'active', capaLockoutSeverities: ['critical', 'high'],
    },
    {
      id: PRJ_B_ID, name: 'Beta Industrial Terminal', client: 'Beta Corp',
      leadManager: 'Alex Rivers', location: 'Balikpapan', code: 'PRJ-BETA',
      zones: [{ id: 'z1', name: 'Skid Bay 1', description: 'Skid bay', safetyLevel: 'Standard' }],
      status: 'active', capaLockoutSeverities: ['critical', 'high'],
    },
    {
      id: PRJ_PRESET_ID, name: 'Preset Test Project', client: 'Preset Client',
      leadManager: 'Preset Lead', location: 'Bandung', code: 'PRJ-PRESET',
      zones: [{ id: 'z1', name: 'Z1', description: 'Zone', safetyLevel: 'Standard' }],
      status: 'active', capaLockoutSeverities: ['critical', 'high'],
    },
  ]);

  // Users (passwordHash pre-computed once — SHARED_PASSWORD_HASH)
  for (const roleKey of ROLE_KEYS) {
    const m = ROLE_USER_MAP[roleKey];
    await db.insert(users).values({
      id: m.id, username: m.username, email: m.email,
      name: `User ${roleKey}`, title: 'Staff Member',
      role: 'Project / Site Engineer',  // legacy column, ignored by authz
      assignedProjects: [PRJ_A_ID, PRJ_PRESET_ID],
      passwordHash: SHARED_PASSWORD_HASH,
      isActive: true,
    });
    // Session: insert pre-hashed ID directly — zero Argon2 calls
    await db.insert(sessions).values({
      id: m.sessionId,
      userId: m.id,
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
  }

  // Role assignments
  for (const roleKey of ROLE_KEYS) {
    const m = ROLE_USER_MAP[roleKey];
    if (roleKey === 'head_office_pmo') {
      await db.insert(roleAssignments).values({
        userId: m.id, roleId: 'head_office_pmo',
        scopeType: 'organization', projectId: null, isActive: true,
      });
    } else {
      // PRJ_A + PRJ_PRESET explicit project assignments
      await db.insert(roleAssignments).values([
        { userId: m.id, roleId: roleKey, scopeType: 'project', projectId: PRJ_A_ID as any, isActive: true },
        { userId: m.id, roleId: roleKey, scopeType: 'project', projectId: PRJ_PRESET_ID as any, isActive: true },
      ]);
    }
  }

  // WBS Nodes
  await db.insert(workNodes).values([
    { id: NODE_A_ID,               projectId: PRJ_A_ID,     parentId: null, wbsCode: '1',  name: 'Structural Work A',           weightPercent: '100.00', sortOrder: 1  },
    { id: NODE_FOR_INIT_WORKFLOW_ID, projectId: PRJ_A_ID,   parentId: null, wbsCode: '50', name: 'Node for Workflow Init',       weightPercent: '0.00',   sortOrder: 50 },
    { id: NODE_TO_DELETE_ID,       projectId: PRJ_A_ID,     parentId: null, wbsCode: '99', name: 'Temporary Node to Delete',    weightPercent: '0.00',   sortOrder: 99 },
    { id: NODE_B_ID,               projectId: PRJ_B_ID,     parentId: null, wbsCode: '1',  name: 'Structural Work B',           weightPercent: '100.00', sortOrder: 1  },
  ]);

  // Workflow & Stage
  await db.insert(workWorkflows).values({ id: WORKFLOW_A_ID, nodeId: NODE_A_ID, title: 'Alpha Foundation Workflow' });
  await db.insert(workStages).values({
    id: STAGE_A_ID, workflowId: WORKFLOW_A_ID,
    stageOrder: 1, stageType: 'work', name: 'Foundation Stage',
    assignedRole: 'Field / QC Inspector', approvalRole: 'QA/QC Lead / Owner Inspector',
    status: 'submitted',
  });
  await db.insert(inspectionAttempts).values({
    id: ATTEMPT_A_ID, stageId: STAGE_A_ID, attemptNumber: 1,
    submitterId: ROLE_USER_MAP.field_inspector.id, status: 'submitted', answers: { test: 'ok' },
  });

  // Templates
  await db.insert(checklistTemplates).values([
    { id: TEMPLATE_A_ID, title: 'Pre-Pour Concrete Checklist', category: 'Safety & HSE', description: 'Foundation checklist', sections: [], authorName: 'Marcus Chen', authorRole: 'Field / QC Inspector' },
    { id: TEMPLATE_TO_DELETE_ID, title: 'Disposable Checklist Template', category: 'Safety & HSE', description: 'Template to delete', sections: [], authorName: 'Marcus Chen', authorRole: 'Field / QC Inspector' },
  ]);

  // Inspections
  await db.insert(inspections).values([
    { id: INSPECTION_A_ID,         templateId: TEMPLATE_A_ID, templateTitle: 'Pre-Pour Concrete Checklist', category: 'Safety & HSE', projectId: PRJ_A_ID, projectName: 'Alpha Highrise Tower', siteZone: 'Tower Zone A', inspectorId: ROLE_USER_MAP.field_inspector.id, inspectorName: 'Field Inspector', inspectorRole: 'Field / QC Inspector', status: 'draft', currentStepIndex: 0, answers: {} },
    { id: INSPECTION_TO_DELETE_ID, templateId: TEMPLATE_A_ID, templateTitle: 'Pre-Pour Concrete Checklist', category: 'Safety & HSE', projectId: PRJ_A_ID, projectName: 'Alpha Highrise Tower', siteZone: 'Tower Zone A', inspectorId: ROLE_USER_MAP.field_inspector.id, inspectorName: 'Field Inspector', inspectorRole: 'Field / QC Inspector', status: 'draft', currentStepIndex: 0, answers: {} },
  ]);

  // Corrective Action
  await db.insert(correctiveActions).values({
    id: ACTION_A_ID,
    inspectionId: INSPECTION_A_ID, inspectionTitle: 'Weekly Scaffolding Audit',
    projectId: PRJ_A_ID, projectName: 'Alpha Highrise Tower', siteZone: 'Tower Zone A',
    fieldLabel: 'Guardrail missing', issueDescription: 'Perimeter guardrail missing on Level 3',
    severity: 'high', assigneeId: ROLE_USER_MAP.subcontractor.id,
    assignedToName: 'Subcontractor User', assignedToRole: 'Action Owner / Subcontractor',
    dueDate: '2026-12-15', status: 'OPEN',
  });

  // Tenant Profile
  await db.insert(tenantProfiles).values({
    companyName: 'SiteLens Test Tenant', facilityLocation: 'Balikpapan Terminal',
    workforceCount: 100, riskLevel: 'HIGH', targetSmk3Level: 'LANJUTAN_166',
    chemicalHazardStatus: 'POTENSI_BAHAYA_MENENGAH',
    chemicalInventory: [
      { id: CHEMICAL_A_ID,         name: 'Diesel Fuel',       casNumber: '68334-30-5', category: 'Flammable', quantityStoredKg: 45000, thresholdNakKg: 200000, ratio: 0.225 },
      { id: CHEMICAL_TO_DELETE_ID, name: 'Chemical To Delete', casNumber: '12345-67-8', category: 'Toxic',     quantityStoredKg: 100,   thresholdNakKg: 1000,   ratio: 0.1   },
    ],
  });

  // Notification settings — disable remote dispatch during tests
  await db.insert(notificationSettings).values({
    id: 'default', notifyOnCriticalCapa: false, notifyOnApproval: false, smtpHost: null, webhookUrl: null,
  }).onConflictDoUpdate({
    target: notificationSettings.id,
    set: { notifyOnCriticalCapa: false, notifyOnApproval: false, smtpHost: null, webhookUrl: null },
  });
}

/** Restore deletable fixtures between subtests (only needed for 7.d). */
export async function restoreDeletables() {
  const db = getDb();
  if (!db) return;
  await db.insert(workNodes).values({ id: NODE_TO_DELETE_ID, projectId: PRJ_A_ID, parentId: null, wbsCode: '99', name: 'Temporary Node to Delete', weightPercent: '0.00', sortOrder: 99 }).onConflictDoNothing();
  await db.insert(checklistTemplates).values({ id: TEMPLATE_TO_DELETE_ID, title: 'Disposable Checklist Template', category: 'Safety & HSE', description: 'Template to delete', sections: [], authorName: 'Marcus Chen', authorRole: 'Field / QC Inspector' }).onConflictDoNothing();
  await db.insert(inspections).values({ id: INSPECTION_TO_DELETE_ID, templateId: TEMPLATE_A_ID, templateTitle: 'Pre-Pour Concrete Checklist', category: 'Safety & HSE', projectId: PRJ_A_ID, projectName: 'Alpha Highrise Tower', siteZone: 'Tower Zone A', inspectorId: ROLE_USER_MAP.field_inspector.id, inspectorName: 'Field Inspector', inspectorRole: 'Field / QC Inspector', status: 'draft', currentStepIndex: 0, answers: {} }).onConflictDoNothing();
}
