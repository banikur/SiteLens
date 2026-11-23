import {
  pgTable,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  uuid,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  UserRole,
  ChecklistCategory,
  ChecklistSection,
  InspectionStatus,
  InspectionEvidence,
  ActionSeverity,
  ActionStatus,
  ProjectZone,
  StandardBody,
  InspectionPointType,
  WorkflowTrigger,
  WorkflowStep,
  ApprovalDecision,
  Smk3AuditLevel,
  ChemicalHazardStatus,
  ChemicalInventoryItem,
  Smk3ElementMapping,
} from '../../types/index.ts';

export type {
  StandardBody,
  InspectionPointType,
  WorkflowTrigger,
  WorkflowStep,
  ApprovalDecision,
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  pinHash: text('pin_hash'),
  role: text('role').$type<UserRole>().notNull(),
  title: text('title').notNull(),
  avatar: text('avatar').notNull().default(''),
  assignedProjects: jsonb('assigned_projects').$type<string[]>().notNull().default([]),
  certifications: jsonb('certifications').$type<string[]>().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webauthnCredentials = pgTable('webauthn_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull().default(0),
  transports: jsonb('transports').$type<string[]>().notNull().default([]),
  deviceName: text('device_name').notNull().default('Registered Device'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // SHA-256 hash of opaque session token
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  client: text('client').notNull(),
  location: text('location').notNull(),
  status: text('status').$type<'active' | 'completed' | 'on_hold'>().notNull().default('active'),
  zones: jsonb('zones').$type<ProjectZone[]>().notNull().default([]),
  leadManager: text('lead_manager').notNull(),
  capaLockoutSeverities: text('capa_lockout_severities')
    .array()
    .notNull()
    .default(sql`ARRAY['critical', 'high']::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const checklistTemplates = pgTable('checklist_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  category: text('category').$type<ChecklistCategory>().notNull(),
  description: text('description').notNull(),
  version: text('version').notNull().default('1.0'),
  standardBody: text('standard_body').$type<StandardBody>().notNull().default('Custom'),
  standardCode: text('standard_code'),
  documentControlNo: text('document_control_no'),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  targetRole: text('target_role').$type<UserRole>(),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  approvalRole: text('approval_role').$type<UserRole>(),
  workflowSteps: jsonb('workflow_steps').$type<WorkflowStep[]>().notNull().default([]),
  estimatedMinutes: integer('estimated_minutes').notNull().default(20),
  sections: jsonb('sections').$type<ChecklistSection[]>().notNull().default([]),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  isMasterTemplate: boolean('is_master_template').notNull().default(false),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  authorName: text('author_name').notNull(),
  authorRole: text('author_role').$type<UserRole>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inspections = pgTable('inspections', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientMutationId: text('client_mutation_id').unique(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => checklistTemplates.id, { onDelete: 'restrict' }),
  templateTitle: text('template_title').notNull(),
  category: text('category').$type<ChecklistCategory>().notNull(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'restrict' }),
  projectName: text('project_name').notNull(),
  siteZone: text('site_zone').notNull(),
  inspectorId: uuid('inspector_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  inspectorName: text('inspector_name').notNull(),
  inspectorRole: text('inspector_role').$type<UserRole>().notNull(),
  status: text('status').$type<InspectionStatus>().notNull().default('draft'),
  currentStepIndex: integer('current_step_index').notNull().default(0),
  approvalHistory: jsonb('approval_history').$type<ApprovalDecision[]>().notNull().default([]),
  answers: jsonb('answers').$type<Record<string, any>>().notNull().default({}),
  evidencePhotos: jsonb('evidence_photos').$type<InspectionEvidence[]>().notNull().default([]),
  signatureData: jsonb('signature_data').$type<{
    signedBy: string;
    signedAt: string;
    signatureType: 'digital_stamp' | 'drawn';
    canvasDataUrl?: string;
  }>(),
  scorePercent: integer('score_percent').notNull().default(0),
  passedCount: integer('passed_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  nonApplicableCount: integer('non_applicable_count').notNull().default(0),
  notes: text('notes'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by'),
  reviewedRole: text('reviewed_role').$type<UserRole>(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNotes: text('review_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const correctiveActions = pgTable('corrective_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  inspectionId: uuid('inspection_id')
    .notNull()
    .references(() => inspections.id, { onDelete: 'cascade' }),
  inspectionTitle: text('inspection_title').notNull(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'restrict' }),
  projectName: text('project_name').notNull(),
  siteZone: text('site_zone').notNull(),
  fieldLabel: text('field_label').notNull(),
  issueDescription: text('issue_description').notNull(),
  severity: text('severity').$type<ActionSeverity>().notNull().default('medium'),
  assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  assignedToName: text('assigned_to_name').notNull(),
  assignedToRole: text('assigned_to_role').notNull(),
  dueDate: text('due_date').notNull(),
  status: text('status').$type<ActionStatus>().notNull().default('OPEN'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNotes: text('resolution_notes'),
  evidencePhotoUrl: text('evidence_photo_url'),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actorName: text('actor_name').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  metadata: jsonb('metadata').$type<Record<string, any>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notificationSettings = pgTable('notification_settings', {
  id: text('id').primaryKey(),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port').default(587),
  smtpUser: text('smtp_user'),
  smtpPass: text('smtp_pass'),
  smtpFrom: text('smtp_from'),
  webhookUrl: text('webhook_url'),
  webhookType: text('webhook_type').$type<'slack' | 'telegram' | 'generic'>().default('generic'),
  notifyOnCriticalCapa: boolean('notify_on_critical_capa').notNull().default(true),
  notifyOnApproval: boolean('notify_on_approval').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantProfiles = pgTable('tenant_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: text('company_name').notNull().default('SiteLens Enterprise Facilities'),
  facilityLocation: text('facility_location').notNull().default('Balikpapan Process Terminal Sector 4'),
  workforceCount: integer('workforce_count').notNull().default(150),
  riskLevel: text('risk_level').$type<'LOW' | 'MEDIUM' | 'HIGH'>().notNull().default('HIGH'),
  targetSmk3Level: text('target_smk3_level').$type<Smk3AuditLevel>().notNull().default('LANJUTAN_166'),
  chemicalHazardStatus: text('chemical_hazard_status').$type<ChemicalHazardStatus>().notNull().default('POTENSI_BAHAYA_MENENGAH'),
  chemicalInventory: jsonb('chemical_inventory').$type<ChemicalInventoryItem[]>().notNull().default([]),
  majorHazardDocUploaded: boolean('major_hazard_doc_uploaded').notNull().default(false),
  ahliK3KimiaCount: integer('ahli_k3_kimia_count').notNull().default(0),
  petugasK3KimiaCount: integer('petugas_k3_kimia_count').notNull().default(0),
  lastChemicalInspectionDate: timestamp('last_chemical_inspection_date', { withTimezone: true }),
  nextEmergencyDrillDate: timestamp('next_emergency_drill_date', { withTimezone: true }),
  expiryAlertDays: integer('expiry_alert_days').notNull().default(60),
  smk3ElementsMap: jsonb('smk3_elements_map').$type<Smk3ElementMapping[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------- PILOTING WBS & CORE RBAC SCHEMAS (v1.0-PILOT) ----------------

export const projectMembers = pgTable('project_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectRole: text('project_role').$type<UserRole>().notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workNodes = pgTable('work_nodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  wbsCode: text('wbs_code').notNull(),
  name: text('name').notNull(),
  weightPercent: numeric('weight_percent', { precision: 5, scale: 2 }).notNull().default('0.00'),
  plannedStartDate: timestamp('planned_start_date', { withTimezone: true }),
  plannedEndDate: timestamp('planned_end_date', { withTimezone: true }),
  documentReferenceNo: text('document_reference_no'),
  activeRevision: text('active_revision'),
  claimedProgressPercent: integer('claimed_progress_percent').notNull().default(0),
  verifiedProgressPercent: integer('verified_progress_percent').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workWorkflows = pgTable('work_workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => workNodes.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workStages = pgTable('work_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workWorkflows.id, { onDelete: 'cascade' }),
  stageOrder: integer('stage_order').notNull().default(1),
  stageType: text('stage_type').$type<'work' | 'hold' | 'review'>().notNull().default('work'),
  name: text('name').notNull(),
  assignedRole: text('assigned_role').$type<UserRole>().notNull(),
  approvalRole: text('approval_role').$type<UserRole>(),
  checklistSchema: jsonb('checklist_schema').$type<ChecklistSection[]>().notNull().default([]),
  requiresWetSignature: boolean('requires_wet_signature').notNull().default(false),
  status: text('status').$type<'pending' | 'in_progress' | 'submitted' | 'approved' | 'rejected'>().notNull().default('pending'),
  actualCompletedAt: timestamp('actual_completed_at', { withTimezone: true }),
  forecastCompletionDate: timestamp('forecast_completion_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const inspectionAttempts = pgTable('inspection_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  stageId: uuid('stage_id')
    .notNull()
    .references(() => workStages.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull().default(1),
  submitterId: uuid('submitter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  approverId: uuid('approver_id')
    .references(() => users.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  status: text('status').$type<'draft' | 'submitted' | 'approved' | 'rejected'>().notNull().default('submitted'),
  answers: jsonb('answers').$type<Record<string, any>>().notNull().default({}),
  rejectionReason: text('rejection_reason'),
  signatureCanvasUrl: text('signature_canvas_url'),
  wetSignatureDocumentUrl: text('wet_signature_document_url'),
  offlineSyncId: text('offline_sync_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceAttachments = pgTable('evidence_attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  attemptId: uuid('attempt_id')
    .references(() => inspectionAttempts.id, { onDelete: 'cascade' }),
  fileUrl: text('file_url').notNull(),
  attachmentType: text('attachment_type').$type<'photo' | 'wet_signature_scan' | 'document'>().notNull().default('photo'),
  sha256: text('sha256').notNull(),
  sizeBytes: integer('size_bytes'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  uploaderId: uuid('uploader_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const punchlistItems = pgTable('punchlist_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  nodeId: uuid('node_id')
    .notNull()
    .references(() => workNodes.id, { onDelete: 'cascade' }),
  stageId: uuid('stage_id')
    .notNull()
    .references(() => workStages.id, { onDelete: 'cascade' }),
  attemptId: uuid('attempt_id')
    .references(() => inspectionAttempts.id, { onDelete: 'set null' }),
  issueDescription: text('issue_description').notNull(),
  severity: text('severity').$type<ActionSeverity>().notNull().default('medium'),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  assigneeId: uuid('assignee_id')
    .references(() => users.id, { onDelete: 'set null' }),
  status: text('status').$type<'open' | 'in_progress' | 'rectified' | 'verified_closed'>().notNull().default('open'),
  rectifiedAt: timestamp('rectified_at', { withTimezone: true }),
  rectificationPhotoUrl: text('rectification_photo_url'),
  verifiedClosedBy: uuid('verified_closed_by')
    .references(() => users.id, { onDelete: 'set null' }),
  verifiedClosedAt: timestamp('verified_closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plannedCurveOverrides = pgTable('planned_curve_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  weekIndex: integer('week_index').notNull(),
  overridePlannedCumulative: numeric('override_planned_cumulative', { precision: 5, scale: 2 }).notNull(),
  overriddenBy: uuid('overridden_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dailyWeatherLogs = pgTable('daily_weather_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  logDate: timestamp('log_date', { withTimezone: true }).notNull(),
  weatherCondition: text('weather_condition')
    .$type<'cerah' | 'berawan' | 'hujan_ringan' | 'hujan_lebat' | 'badai'>()
    .notNull()
    .default('cerah'),
  rainHours: numeric('rain_hours', { precision: 4, scale: 2 }).notNull().default('0.00'),
  workImpact: text('work_impact')
    .$type<'tidak_ada' | 'parsial' | 'stop_total'>()
    .notNull()
    .default('tidak_ada'),
  notes: text('notes'),
  recordedBy: uuid('recorded_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
  scopeLevel: text('scope_level').$type<'organization' | 'project' | 'organization_or_project'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
  ]
);

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    scopeType: text('scope_type').$type<'organization' | 'project'>().notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    source: text('source').$type<'legacy_sync' | 'manual'>().notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('role_assignments_project_uniq')
      .on(table.userId, table.projectId)
      .where(sql`scope_type = 'project'`),
    uniqueIndex('role_assignments_org_uniq')
      .on(table.userId)
      .where(sql`scope_type = 'organization'`),
  ]
);



