export type UserRole =
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

export interface InspectionEvidence {
  fieldId: string;
  url: string;
  caption: string;
  timestamp: string;
  location?: string;
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
  assigneeId?: string; // UUID of assigned user (PRD 6.1)
  assignedToName: string;
  assignedToRole: string;
  dueDate: string;
  status: ActionStatus;
  createdAt: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  evidencePhotoUrl?: string;
}

export interface ProjectZone {
  id: string;
  name: string;
  description: string;
  safetyLevel: 'Standard' | 'Restricted' | 'High Risk';
}

export interface Project {
  id: string;
  name: string;
  code: string;
  client: string;
  location: string;
  status: 'active' | 'completed' | 'on_hold';
  zones: ProjectZone[];
  leadManager: string;
  activeInspectionsCount: number;
  openIssuesCount: number;
  complianceRate: number;
}
