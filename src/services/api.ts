import type {
  ActionStatus,
  ChecklistTemplate,
  CorrectiveAction,
  InspectionRecord,
  Project,
  User,
  WorkNode,
  WorkWorkflow,
  WorkStage,
  InspectionAttempt,
  EvidenceAttachment,
  SCurveSummary,
  BottleneckItem,
  DailyWeatherLog,
  PlannedCurveOverride,
  FlowPreset,
  FlowPresetStep,
} from '../types';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function fetchAllAppData(): Promise<{
  projects: Project[];
  templates: ChecklistTemplate[];
  inspections: InspectionRecord[];
  actions: CorrectiveAction[];
  users: User[];
}> {
  const [pRes, tRes, iRes, aRes, uRes] = await Promise.all([
    apiJson<{ projects: Project[] }>('/api/projects'),
    apiJson<{ templates: ChecklistTemplate[] }>('/api/templates'),
    apiJson<{ inspections: InspectionRecord[] }>('/api/inspections'),
    apiJson<{ actions: CorrectiveAction[] }>('/api/actions'),
    apiJson<{ users: User[] }>('/api/users'),
  ]);

  return {
    projects: pRes.projects,
    templates: tRes.templates,
    inspections: iRes.inspections,
    actions: aRes.actions,
    users: uRes.users,
  };
}

export async function apiSaveTemplate(template: ChecklistTemplate): Promise<ChecklistTemplate> {
  const res = await apiJson<{ template: ChecklistTemplate }>('/api/templates', {
    method: 'POST',
    body: JSON.stringify(template),
  });
  return res.template;
}

export async function apiImportTemplates(templates: ChecklistTemplate[]): Promise<number> {
  const res = await apiJson<{ importedCount: number }>('/api/templates/import', {
    method: 'POST',
    body: JSON.stringify({ templates }),
  });
  return res.importedCount;
}

export async function apiDeleteTemplate(id: string): Promise<void> {
  await apiJson(`/api/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiSubmitInspection(record: InspectionRecord): Promise<InspectionRecord> {
  const res = await apiJson<{ inspection: InspectionRecord }>('/api/inspections', {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return res.inspection;
}

export async function apiReviewInspection(
  id: string,
  decision: 'approved' | 'rejected',
  notes?: string
): Promise<InspectionRecord> {
  const res = await apiJson<{ inspection: InspectionRecord }>(
    `/api/inspections/${encodeURIComponent(id)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ decision, notes }),
    }
  );
  return res.inspection;
}

export async function apiDeleteInspection(id: string): Promise<void> {
  await apiJson(`/api/inspections/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function apiSaveAction(action: CorrectiveAction): Promise<CorrectiveAction> {
  const res = await apiJson<{ action: CorrectiveAction }>('/api/actions', {
    method: 'POST',
    body: JSON.stringify(action),
  });
  return res.action;
}

export async function apiUpdateActionStatus(
  id: string,
  status: ActionStatus,
  resolutionNotes?: string
): Promise<CorrectiveAction> {
  const res = await apiJson<{ action: CorrectiveAction }>(
    `/api/actions/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status, resolutionNotes }),
    }
  );
  return res.action;
}

export async function apiSaveProject(project: Project): Promise<Project> {
  const res = await apiJson<{ project: Project }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(project),
  });
  return res.project;
}

export async function apiGetMyProjectPermissions(projectId: string): Promise<string[]> {
  const res = await apiJson<{ projectId: string; effectivePermissions: string[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/my-permissions`
  );
  return res.effectivePermissions || [];
}

export interface EvidenceGps {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  altitudeMeters?: number;
}

export interface UploadedEvidence {
  filename: string;
  url: string;
  size: number;
  sha256: string;
  integrityVersion: number;
  manifestUrl?: string;
  integrity: {
    verified: boolean;
    sha256: string;
    size: number;
    mimeType: string;
    gps?: EvidenceGps;
    gpsSource?: 'exif' | 'client' | 'none';
    capturedAt?: string;
    capturedAtSource?: 'exif' | 'client';
    exif?: { make?: string; model?: string };
    uploadedAt: string;
  };
}

/**
 * Computes SHA-256 of the exact bytes being uploaded so the server can reject a
 * body that does not match the declared hash. WebCrypto needs a secure context;
 * when it is unavailable we simply omit the claim and let the server hash it.
 */
async function sha256Hex(blob: Blob): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const buffer = await blob.arrayBuffer();
    const digest = await subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/**
 * Best-effort GPS capture. The server treats EXIF GPS as authoritative and only
 * uses this as a labelled fallback, so a denial or timeout is not an error.
 */
function readClientPosition(): Promise<EvidenceGps | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    let settled = false;
    const finish = (value: EvidenceGps | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          finish({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
          }),
        () => finish(null),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
      );
    } catch {
      finish(null);
    }
  });
}

export async function uploadEvidencePhotoDetailed(
  file: Blob,
  filename = 'evidence.jpg'
): Promise<UploadedEvidence> {
  const [sha256, position] = await Promise.all([sha256Hex(file), readClientPosition()]);

  const form = new FormData();
  form.append('file', file, filename);
  form.append('originalName', filename);
  form.append('capturedAt', new Date().toISOString());
  if (sha256) form.append('sha256', sha256);
  if (position) {
    form.append('lat', String(position.latitude));
    form.append('lng', String(position.longitude));
    if (position.accuracyMeters !== undefined) {
      form.append('accuracy', String(position.accuracyMeters));
    }
  }

  const res = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Photo upload failed.');
  }
  return data as UploadedEvidence;
}

export async function uploadEvidencePhoto(file: Blob, filename = 'evidence.jpg'): Promise<string> {
  const uploaded = await uploadEvidencePhotoDetailed(file, filename);
  return uploaded.url;
}

import { getActiveUser } from './storage';
import {
  getDemoWbs,
  createDemoWbsNode,
  updateDemoWbsNode,
  deleteDemoWbsNode,
  applyDemoWbsPreset,
  getDemoNodeWorkflow,
  initDemoDefaultWorkflow,
  submitDemoStageAttempt,
  reviewDemoStageAttempt,
  getDemoSCurve,
  getDemoBottleneckRadar,
} from './wbsDemoStore';

// ---------------- WBS & WORKFLOW CLIENT APIS (FASE 2) ----------------

export async function apiGetProjectWbs(projectId: string): Promise<{
  project: { id: string; name: string; code: string };
  nodes: WorkNode[];
  workflows: WorkWorkflow[];
  stages: WorkStage[];
}> {
  try {
    return await apiJson(`/api/projects/${encodeURIComponent(projectId)}/wbs`);
  } catch {
    return getDemoWbs(projectId);
  }
}

export async function apiCreateWbsNode(
  projectId: string,
  nodeData: Partial<WorkNode>
): Promise<WorkNode> {
  try {
    const res = await apiJson<{ node: WorkNode }>(
      `/api/projects/${encodeURIComponent(projectId)}/wbs/nodes`,
      {
        method: 'POST',
        body: JSON.stringify(nodeData),
      }
    );
    return res.node;
  } catch {
    return createDemoWbsNode(projectId, nodeData);
  }
}

export async function apiUpdateWbsNode(
  projectId: string,
  nodeId: string,
  nodeData: Partial<WorkNode>
): Promise<WorkNode> {
  try {
    const res = await apiJson<{ node: WorkNode }>(
      `/api/projects/${encodeURIComponent(projectId)}/wbs/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(nodeData),
      }
    );
    return res.node;
  } catch {
    return updateDemoWbsNode(projectId, nodeId, nodeData);
  }
}

export async function apiDeleteWbsNode(
  projectId: string,
  nodeId: string
): Promise<void> {
  try {
    await apiJson(
      `/api/projects/${encodeURIComponent(projectId)}/wbs/nodes/${encodeURIComponent(nodeId)}`,
      {
        method: 'DELETE',
      }
    );
  } catch {
    deleteDemoWbsNode(projectId, nodeId);
  }
}

export async function apiApplyWbsPreset(
  projectId: string,
  preset: 'general_epc' | 'civil_building' | 'blank'
): Promise<{ message: string; nodes: WorkNode[] }> {
  try {
    return await apiJson<{ message: string; nodes: WorkNode[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/wbs/apply-preset`,
      {
        method: 'POST',
        body: JSON.stringify({ preset }),
      }
    );
  } catch {
    return applyDemoWbsPreset(projectId, preset);
  }
}

// ---------------- STAGE WORKFLOW & DUAL-TRACK SIGNATURES (FASE 3) ----------------

export async function apiGetNodeWorkflow(
  projectId: string,
  nodeId: string
): Promise<{
  node: WorkNode;
  workflow: WorkWorkflow | null;
  stages: WorkStage[];
  attempts: InspectionAttempt[];
}> {
  try {
    return await apiJson(
      `/api/projects/${encodeURIComponent(projectId)}/wbs/nodes/${encodeURIComponent(nodeId)}/workflow`
    );
  } catch {
    return getDemoNodeWorkflow(projectId, nodeId);
  }
}

export async function apiInitDefaultWorkflow(
  projectId: string,
  nodeId: string
): Promise<{
  workflow: WorkWorkflow;
  stages: WorkStage[];
}> {
  try {
    return await apiJson(
      `/api/projects/${encodeURIComponent(projectId)}/wbs/nodes/${encodeURIComponent(nodeId)}/workflow/init-default`,
      {
        method: 'POST',
      }
    );
  } catch {
    return initDemoDefaultWorkflow(projectId, nodeId);
  }
}

export async function apiGetStageAttempts(stageId: string): Promise<{
  stage: WorkStage;
  attempts: InspectionAttempt[];
  attachments: EvidenceAttachment[];
}> {
  try {
    return await apiJson(`/api/stages/${encodeURIComponent(stageId)}/attempts`);
  } catch {
    return {
      stage: {
        id: stageId,
        workflowId: 'wf-demo',
        stageOrder: 1,
        stageType: 'work',
        name: 'Field Inspection Stage',
        assignedRole: 'Project / Site Engineer',
        requiresWetSignature: false,
        status: 'submitted',
        createdAt: new Date().toISOString(),
      },
      attempts: [],
      attachments: [],
    };
  }
}

export async function apiRequestStageRfi(stageId: string): Promise<{
  attempt: InspectionAttempt;
  stage: WorkStage;
  message: string;
}> {
  return await apiJson(`/api/stages/${encodeURIComponent(stageId)}/request`, {
    method: 'POST',
  });
}

export async function apiSubmitStageAttempt(
  stageId: string,
  data: {
    answers?: Record<string, any>;
    signatureCanvasUrl?: string | null;
    wetSignatureDocumentUrl?: string | null;
    offlineSyncId?: string | null;
  }
): Promise<{
  attempt: InspectionAttempt;
  stage: WorkStage;
  message: string;
}> {
  try {
    return await apiJson(`/api/stages/${encodeURIComponent(stageId)}/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  } catch {
    const user = getActiveUser();
    return submitDemoStageAttempt(stageId, data, user);
  }
}

export async function apiReviewStageAttempt(
  stageId: string,
  data: {
    decision: 'approved' | 'rejected';
    notes?: string;
  }
): Promise<{
  stage: WorkStage;
  attempt: InspectionAttempt;
  message: string;
}> {
  try {
    return await apiJson(`/api/stages/${encodeURIComponent(stageId)}/review`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  } catch {
    const user = getActiveUser();
    return reviewDemoStageAttempt(stageId, data, user);
  }
}

// ---------------- S-CURVE, BOTTLENECK RADAR & WEATHER LOGS (FASE 4) ----------------

export async function apiGetProjectSCurve(projectId: string): Promise<{ scurve: SCurveSummary }> {
  try {
    return await apiJson(`/api/projects/${encodeURIComponent(projectId)}/scurve`);
  } catch {
    return { scurve: getDemoSCurve(projectId) };
  }
}

export async function apiOverrideSCurve(
  projectId: string,
  weekIndex: number,
  overridePlannedCumulative: number,
  reason?: string
): Promise<{ override: PlannedCurveOverride; message: string }> {
  return apiJson<{ override: PlannedCurveOverride; message: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/scurve/override`,
    {
      method: 'POST',
      body: JSON.stringify({ weekIndex, overridePlannedCumulative, reason }),
    }
  ).catch(() => ({
    override: {
      id: `ovr-${Date.now()}`,
      projectId,
      weekIndex,
      overridePlannedCumulative,
      reason: reason || 'Manual PM demo override',
      overriddenBy: 'Arthur Sterling',
      createdAt: new Date().toISOString(),
    },
    message: 'Manual curve override berhasil disimpan (demo mode).',
  }));
}

export async function apiGetBottleneckRadar(projectId: string): Promise<{
  bottlenecks: BottleneckItem[];
  criticalCount: number;
  warningCount: number;
  normalCount: number;
}> {
  try {
    return await apiJson(`/api/projects/${encodeURIComponent(projectId)}/bottleneck-radar`);
  } catch {
    return getDemoBottleneckRadar(projectId);
  }
}

export async function apiGetWeatherLogs(projectId: string): Promise<{
  logs: DailyWeatherLog[];
  impact: {
    totalRainDays: number;
    totalRainHours: number;
    stopTotalDays: number;
    partialDays: number;
    recommendedEotDays: number;
  };
}> {
  return apiJson(`/api/projects/${encodeURIComponent(projectId)}/weather-logs`);
}

export async function apiCreateWeatherLog(
  projectId: string,
  data: {
    logDate?: string | Date;
    weatherCondition: string;
    rainHours: number | string;
    workImpact: string;
    notes?: string;
  }
): Promise<{ log: DailyWeatherLog; message: string }> {
  return apiJson(`/api/projects/${encodeURIComponent(projectId)}/weather-logs`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ---------------- TAHAP 2B: ROLES, PERMISSIONS & PROJECT MEMBERS ----------------

export interface RoleWithPermissions {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PermissionItem {
  id: string;
  module: string;
  description: string;
  scopeLevel: string;
  createdAt?: string;
}

export interface ProjectMemberItem {
  id: string;
  userId: string;
  username: string;
  name: string;
  email: string;
  title: string;
  avatar: string;
  roleId: string;
  roleName: string;
  isSystem: boolean;
  source: string;
  isActive: boolean;
  createdAt: string;
}

export async function apiGetRoles(): Promise<{ roles: RoleWithPermissions[] }> {
  return apiJson('/api/admin/roles');
}

export async function apiCreateRole(data: {
  name: string;
  id?: string;
  permissions?: string[];
}): Promise<{ role: RoleWithPermissions }> {
  return apiJson('/api/admin/roles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function apiUpdateRole(
  id: string,
  data: {
    name?: string;
    permissions?: string[];
  }
): Promise<{ role: RoleWithPermissions }> {
  return apiJson(`/api/admin/roles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function apiDeleteRole(id: string): Promise<void> {
  const res = await fetch(`/api/admin/roles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete role');
  }
}

export async function apiGetPermissionsCatalog(): Promise<{ permissions: PermissionItem[] }> {
  return apiJson('/api/admin/permissions');
}

export async function apiGetProjectMembers(projectId: string): Promise<{ members: ProjectMemberItem[] }> {
  return apiJson(`/api/projects/${encodeURIComponent(projectId)}/members`);
}

export async function apiAddProjectMember(
  projectId: string,
  data: { userId: string; roleId: string }
): Promise<{ assignment: any }> {
  return apiJson(`/api/projects/${encodeURIComponent(projectId)}/members`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function apiRemoveProjectMember(projectId: string, userId: string): Promise<void> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      credentials: 'include',
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to remove project member');
  }
}

export async function apiAssignRole(data: {
  userId: string;
  roleId: string;
  scopeType: 'organization' | 'project';
  projectId?: string;
}): Promise<{ assignment: any }> {
  return apiJson('/api/admin/assignments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function apiDeleteAssignment(assignmentId: string): Promise<void> {
  const res = await fetch(`/api/admin/assignments/${encodeURIComponent(assignmentId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete role assignment');
  }
}

export async function apiUpdateProject(
  projectId: string,
  data: Partial<Project>
): Promise<{ project: Project }> {
  return apiJson(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ---------------- FLOW PRESETS (TAHAP 2c) ----------------

export async function apiGetFlowPresets(): Promise<{ presets: FlowPreset[] }> {
  return apiJson('/api/flow-presets');
}

export async function apiGetFlowPreset(id: string): Promise<{ preset: FlowPreset }> {
  return apiJson(`/api/flow-presets/${encodeURIComponent(id)}`);
}

export async function apiCreateFlowPreset(
  data: Partial<FlowPreset> & { steps?: any[] }
): Promise<{ preset: FlowPreset }> {
  return apiJson('/api/flow-presets', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function apiUpdateFlowPreset(
  id: string,
  data: Partial<FlowPreset> & { steps?: any[] }
): Promise<{ preset: FlowPreset }> {
  return apiJson(`/api/flow-presets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function apiDeleteFlowPreset(
  id: string
): Promise<{ success: boolean; message: string }> {
  return apiJson(`/api/flow-presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}




