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

// ---------------- WBS & WORKFLOW CLIENT APIS (FASE 2) ----------------

export async function apiGetProjectWbs(projectId: string): Promise<{
  project: { id: string; name: string; code: string };
  nodes: WorkNode[];
  workflows: WorkWorkflow[];
  stages: WorkStage[];
}> {
  return apiJson(`/api/projects/${encodeURIComponent(projectId)}/wbs`);
}

export async function apiCreateWbsNode(
  projectId: string,
  nodeData: Partial<WorkNode>
): Promise<WorkNode> {
  const res = await apiJson<{ node: WorkNode }>(
    `/api/projects/${encodeURIComponent(projectId)}/wbs/nodes`,
    {
      method: 'POST',
      body: JSON.stringify(nodeData),
    }
  );
  return res.node;
}

export async function apiUpdateWbsNode(
  projectId: string,
  nodeId: string,
  nodeData: Partial<WorkNode>
): Promise<WorkNode> {
  const res = await apiJson<{ node: WorkNode }>(
    `/api/projects/${encodeURIComponent(projectId)}/wbs/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(nodeData),
    }
  );
  return res.node;
}

export async function apiDeleteWbsNode(
  projectId: string,
  nodeId: string
): Promise<void> {
  await apiJson(
    `/api/projects/${encodeURIComponent(projectId)}/wbs/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: 'DELETE',
    }
  );
}

export async function apiApplyWbsPreset(
  projectId: string,
  preset: 'general_epc' | 'civil_building' | 'blank'
): Promise<{ message: string; nodes: WorkNode[] }> {
  return apiJson<{ message: string; nodes: WorkNode[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/wbs/apply-preset`,
    {
      method: 'POST',
      body: JSON.stringify({ preset }),
    }
  );
}


