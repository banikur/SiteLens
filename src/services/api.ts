import type {
  ActionStatus,
  ChecklistTemplate,
  CorrectiveAction,
  InspectionRecord,
  Project,
  User,
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

export async function uploadEvidencePhoto(file: Blob, filename = 'evidence.jpg'): Promise<string> {
  const form = new FormData();
  form.append('file', file, filename);
  const res = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Photo upload failed.');
  }
  return data.url;
}
