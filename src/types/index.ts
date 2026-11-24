export * from './permissions';

export type UserRole =
  | 'Field / QC Inspector'
  | 'Action Owner / Subcontractor'
  | 'Project / Site Engineer'
  | 'QA/QC Lead / Owner Inspector'
  | 'Project Director & Tenant Admin'
  | 'Client / Vendor Viewer'
  // Legacy aliases for backward compatibility
  | 'Field Inspector / Petugas K3'
  | 'Action Owner / Pelaksana Perbaikan'
  | 'Office / Integrity Engineer'
  | 'Authorized Inspector (API 510/570) & Verifikator K3'
  | 'HSE / Quality Manager & Tenant Admin';

export interface User {
  id: string;
  name: string;
  role: UserRole;
  title: string;
  email: string;
  avatar: string;
  assignedProjects: string[];
  certifications: string[];
  isActive?: boolean;
}

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'pass_fail'
  | 'yes_no'
  | 'status_select'
  | 'dropdown'
  | 'date'
  | 'time'
  | 'photo'
  | 'signature'
  | 'instruction';

export interface FieldCondition {
  dependsOnFieldId: string;
  operator: 'equals' | 'not_equals';
  value: string | boolean;
}

export type StandardBody = 'ISO' | 'ASME' | 'API' | 'SNI' | 'OSHA' | 'Custom';
export type InspectionPointType = 'H' | 'W' | 'R' | 'S';
export type WorkflowTrigger = 'always' | 'on_fail' | 'on_critical';

export interface WorkflowStep {
  order: number;
  label: string;
  role: UserRole;
  trigger: WorkflowTrigger;
  requiresSignature: boolean;
}

export interface ApprovalDecision {
  stepOrder: number;
  stepLabel: string;
  role: UserRole;
  actorId: string;
  actorName: string;
  decision: 'approved' | 'rejected';
  notes?: string;
  decidedAt: string;
}

export interface ChecklistField {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  required: boolean;
  options?: string[]; // For dropdown or custom status tiers
  unit?: string;      // e.g. "psi", "mm", "°C", "kN", "m/s"
  defaultValue?: string | number | boolean;
  condition?: FieldCondition;
  helpStandard?: string; // e.g. "BS EN 12079 / ACI 318"
  inspectionPoint?: InspectionPointType; // ITP Hold / Witness / Review / Surveillance
  acceptanceCriteria?: string;
  minThreshold?: number;
  maxThreshold?: number;
}

export interface ChecklistSection {
  id: string;
  title: string;
  description?: string;
  fields: ChecklistField[];
}

export type ChecklistCategory =
  | 'Safety & HSE'
  | 'Civil & Structural'
  | 'Heavy Equipment'
  | 'Quality Control'
  | 'Environmental'
  | 'Site Logistics';

export interface ChecklistTemplate {
  id: string;
  title: string;
  category: ChecklistCategory;
  description: string;
  version: string;
  standardBody?: StandardBody;
  standardCode?: string;
  documentControlNo?: string;
  isMasterTemplate?: boolean;
  projectId?: string; // Optional target project scope, or general
  targetRole?: UserRole;
  requiresApproval: boolean;
  approvalRole?: UserRole;
  workflowSteps?: WorkflowStep[];
  estimatedMinutes: number;
  sections: ChecklistSection[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  authorName: string;
  authorRole: UserRole;
}

export type InspectionStatus =
  | 'draft'
  | 'in_progress'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected';

export interface EvidenceGpsMetadata {
  latitude: number;
  longitude: number;
  altitudeMeters?: number;
  accuracyMeters?: number;
}

export interface InspectionEvidence {
  fieldId: string;
  url: string;
  caption: string;
  timestamp: string;
  location?: string;
  /** SHA-256 of the stored bytes, as recorded by the server manifest. */
  sha256?: string;
  sizeBytes?: number;
  integrityVersion?: number;
  /** Set by the server on submit; client-supplied values are overwritten. */
  integrityVerified?: boolean;
  integrityReason?: string;
  gps?: EvidenceGpsMetadata;
  gpsSource?: 'exif' | 'client' | 'none';
  capturedAt?: string;
  capturedAtSource?: 'exif' | 'client';
}

export interface InspectionRecord {
  id: string;
  templateId: string;
  templateTitle: string;
  category: ChecklistCategory;
  projectId: string;
  projectName: string;
  siteZone: string;
  inspectorId: string;
  inspectorName: string;
  inspectorRole: UserRole;
  status: InspectionStatus;
  clientMutationId?: string;
  currentStepIndex?: number;
  approvalHistory?: ApprovalDecision[];
  answers: Record<string, any>; // fieldId -> answered value
  evidencePhotos: InspectionEvidence[];
  signatureData?: {
    signedBy: string;
    signedAt: string;
    signatureType: 'digital_stamp' | 'drawn';
    canvasDataUrl?: string;
  };
  scorePercent: number;
  passedCount: number;
  failedCount: number;
  nonApplicableCount: number;
  notes?: string;
  submittedAt?: string;
  reviewedBy?: string;
  reviewedRole?: UserRole;
  reviewedAt?: string;
  reviewNotes?: string;
  createdAt: string;
}

export type ActionSeverity = 'low' | 'medium' | 'high' | 'critical';

export type ActionStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'PENDING_VERIFICATION'
  | 'EFFECTIVENESS_MONITORING'
  | 'CLOSED'
  | 'REJECTED'
  | 'REOPENED'
  | 'CANCELLED';

export interface CorrectiveAction {
  id: string; // UUID
  inspectionId: string; // UUID
  inspectionTitle: string;
  projectId: string; // UUID
  projectName: string;
  siteZone: string;
  fieldLabel: string;
  issueDescription: string;
  severity: ActionSeverity;
  assigneeId?: string | null; // UUID of assigned user (PRD 6.1)
  assignedToName: string;
  assignedToRole: string;
  dueDate: string;
  status: ActionStatus;
  createdAt: string;
  resolvedAt?: string | null;
  resolutionNotes?: string | null;
  evidencePhotoUrl?: string | null;
}

export interface ProjectZone {
  id: string;
  name: string;
  description: string;
  safetyLevel: 'Standard' | 'Restricted' | 'High Risk';
}

export interface ProjectSite {
  id: string;
  name: string;
  code?: string;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  isPrimary?: boolean;
  notes?: string;
}

export interface Project {
  id: string;
  name: string;
  code: string;
  client: string;
  location: string;
  status: 'active' | 'completed' | 'on_hold';
  zones: ProjectZone[];
  sites?: ProjectSite[];
  leadManager: string;
  capaLockoutSeverities?: string[];
  flowPresetId?: string | null;
  activeInspectionsCount: number;
  openIssuesCount: number;
  complianceRate: number;
}

// ---------------- DUAL-COMPLIANCE (SMK3 PP 50/2012 & ISO 45001) & TENANT TYPES ----------------

export type Smk3AuditLevel = 'AWAL_64' | 'TRANSISI_122' | 'LANJUTAN_166';

export type Smk3AwardStatus =
  | 'MEMUASKAN_EMAS'
  | 'BAIK_PERAK'
  | 'KURANG'
  | 'DISQUALIFIED_CRITICAL_FINDING';

export type ChemicalHazardStatus = 'POTENSI_BAHAYA_MENENGAH' | 'POTENSI_BAHAYA_BESAR';

export interface ChemicalInventoryItem {
  id: string;
  name: string;
  casNumber?: string;
  category: 'Toxic' | 'Flammable' | 'Explosive' | 'Oxidizing' | 'Corrosive' | 'Other';
  quantityStoredKg: number;
  thresholdNakKg: number;
  ratio: number; // quantityStoredKg / thresholdNakKg
}

export interface Smk3ElementMapping {
  elementNumber: number;
  elementName: string;
  iso45001Clause: string;
  iso45001Title: string;
  totalCriteriaAwal: number;
  totalCriteriaTransisi: number;
  totalCriteriaLanjutan: number;
  criteriaActive: number;
  passedCriteria: number;
  failedCriteria: number;
  complianceRate: number;
}

export interface TenantProfile {
  id: string;
  companyName: string;
  facilityLocation: string;
  workforceCount: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  targetSmk3Level: Smk3AuditLevel;
  chemicalHazardStatus: ChemicalHazardStatus;
  chemicalCumulativeRatio: number; // Sum of (qty / NAK)
  chemicalInventory: ChemicalInventoryItem[];
  majorHazardDocUploaded: boolean;
  ahliK3KimiaCount: number;
  petugasK3KimiaCount: number;
  lastChemicalInspectionDate?: string;
  nextEmergencyDrillDate?: string;
  expiryAlertDays: number;
  smk3AwardStatus: Smk3AwardStatus;
  smk3OverallScorePercent: number;
  smk3ElementsMap: Smk3ElementMapping[];
  updatedAt: string;
}

// ---------------- PILOTING WBS & CORE RBAC ENTITY TYPES (v1.0-PILOT) ----------------

export type ProjectRole =
  | 'Project Director & Tenant Admin'
  | 'Project / Site Engineer'
  | 'Field / QC Inspector'
  | 'Action Owner / Subcontractor'
  | 'QA/QC Lead / Owner Inspector'
  | 'Client / Vendor Viewer';

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  projectRole: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface WorkNode {
  id: string;
  projectId: string;
  parentId?: string | null;
  wbsCode: string;
  name: string;
  weightPercent: number | string;
  plannedStartDate?: string | Date | null;
  plannedEndDate?: string | Date | null;
  documentReferenceNo?: string | null;
  activeRevision?: string | null;
  claimedProgressPercent: number;
  verifiedProgressPercent: number;
  sortOrder: number;
  volume?: number | string | null;
  unit?: string | null;
  canvasX?: number | null;
  canvasY?: number | null;
  assignedEngineerId?: string | null;
  assignedEngineerName?: string | null;
  assignedQcId?: string | null;
  assignedQcName?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export type StageType = 'work' | 'hold' | 'review';
export type StageStatus = 'pending' | 'requested' | 'in_progress' | 'submitted' | 'approved' | 'rejected';

export interface FlowPreset {
  id: string;
  name: string;
  description?: string | null;
  isOrganizationDefault: boolean;
  createdAt: string | Date;
  steps?: FlowPresetStep[];
}

export interface FlowPresetStep {
  id: string;
  presetId: string;
  stepOrder: number;
  stepType: 'request' | 'execute' | 'approve';
  name: string;
  requiredPermission?: string | null;
  canCombineWithNext: boolean;
  requiresSignature?: boolean;
  createdAt?: string | Date;
}

export interface WorkWorkflow {
  id: string;
  nodeId: string;
  title: string;
  createdAt: string;
}

export interface WorkStage {
  id: string;
  workflowId: string;
  stageOrder: number;
  stageType: StageType;
  name: string;
  assignedRole: UserRole;
  approvalRole?: UserRole | null;
  checklistSchema?: ChecklistSection[];
  requiresWetSignature: boolean;
  status: StageStatus;
  actualCompletedAt?: string | Date | null;
  forecastCompletionDate?: string | Date | null;
  createdAt: string | Date;
}

export interface InspectionAttempt {
  id: string;
  stageId: string;
  attemptNumber: number;
  submitterId: string;
  requesterId?: string | null;
  requestedAt?: string | Date | null;
  submittedAt: string | Date;
  approverId?: string | null;
  decidedAt?: string | Date | null;
  status: 'draft' | 'requested' | 'submitted' | 'approved' | 'rejected';
  answers: Record<string, any>;
  rejectionReason?: string | null;
  signatureCanvasUrl?: string | null;
  wetSignatureDocumentUrl?: string | null;
  offlineSyncId?: string | null;
  createdAt: string | Date;
}

export interface EvidenceAttachment {
  id: string;
  attemptId?: string | null;
  fileUrl: string;
  attachmentType: 'photo' | 'wet_signature_scan' | 'document';
  sha256: string;
  sizeBytes?: number | null;
  capturedAt: string;
  uploaderId: string;
  createdAt: string;
}

export interface PunchlistItem {
  id: string;
  nodeId: string;
  stageId: string;
  attemptId?: string | null;
  issueDescription: string;
  severity: ActionSeverity;
  creatorId: string;
  assigneeId?: string | null;
  status: 'open' | 'in_progress' | 'rectified' | 'verified_closed';
  rectifiedAt?: string | null;
  rectificationPhotoUrl?: string | null;
  verifiedClosedBy?: string | null;
  verifiedClosedAt?: string | null;
  createdAt: string;
}

export interface PlannedCurveOverride {
  id: string;
  projectId: string;
  weekIndex: number;
  overridePlannedCumulative: number | string;
  overriddenBy: string;
  reason?: string | null;
  createdAt: string | Date;
}

export type WeatherCondition = 'cerah' | 'berawan' | 'hujan_ringan' | 'hujan_lebat' | 'badai';
export type WorkImpact = 'tidak_ada' | 'parsial' | 'stop_total';

export interface DailyWeatherLog {
  id: string;
  projectId: string;
  logDate: string | Date;
  weatherCondition: WeatherCondition;
  rainHours: number | string;
  workImpact: WorkImpact;
  notes?: string | null;
  recordedBy: string;
  createdAt: string | Date;
}

export interface SCurveWeekPoint {
  weekIndex: number;
  startDate: string; // YYYY-MM-DD (Monday 00:00)
  endDate: string; // YYYY-MM-DD (Sunday 23:59)
  label: string; // e.g. "Minggu 1 (05 Jan - 11 Jan 2026)"
  targetIncremental: number;
  targetCumulative: number;
  claimedIncremental: number;
  claimedCumulative: number;
  verifiedIncremental: number;
  verifiedCumulative: number;
  variance: number; // verifiedCumulative - targetCumulative
  isOverridden?: boolean;
}

export interface SCurveSummary {
  projectId: string;
  projectName: string;
  totalWeeks: number;
  currentWeekIndex: number;
  currentPlannedPercent: number;
  currentClaimedPercent: number;
  currentVerifiedPercent: number;
  currentVariance: number;
  status: 'ahead' | 'on_track' | 'delayed';
  totalHoldPoints: number;
  activeHoldPoints: number;
  points: SCurveWeekPoint[];
}

export interface BottleneckItem {
  stageId: string;
  stageName: string;
  stageType: 'work' | 'hold' | 'review';
  wbsCode: string;
  nodeName: string;
  attemptNumber: number;
  submitterName: string;
  requestedAt?: string | Date | null;
  submittedAt: string | Date;
  stageStatus?: StageStatus;
  approvalRole: UserRole;
  waitingHours: number;
  status: 'normal' | 'warning' | 'critical';
  scheduleImpactDays: number;
}

