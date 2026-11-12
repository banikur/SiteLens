import {
  ChecklistTemplate,
  InspectionRecord,
  CorrectiveAction,
  Project,
  User,
} from '../types';
import {
  MOCK_USERS,
  getLocalizedSeedData,
} from '../data/mockData';
import { Language } from '../i18n/translations';

const STORAGE_KEYS = {
  TEMPLATES: 'sitelens_templates_v2',
  INSPECTIONS: 'sitelens_inspections_v2',
  ACTIONS: 'sitelens_actions_v2',
  PROJECTS: 'sitelens_projects_v2',
  USERS: 'sitelens_users_v2',
  ACTIVE_USER_ID: 'sitelens_active_user_v2',
  LANG: 'sitelens_lang_v1',
};

const getCurrentLang = (): Language => {
  const saved = localStorage.getItem(STORAGE_KEYS.LANG);
  return saved === 'id' ? 'id' : 'en';
};

// Templates
export const getStoredTemplates = (): ChecklistTemplate[] => {
  const lang = getCurrentLang();
  const seed = getLocalizedSeedData(lang).templates;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TEMPLATES);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load templates from storage', e);
    return seed;
  }
};

export const saveTemplate = (template: ChecklistTemplate): ChecklistTemplate[] => {
  const current = getStoredTemplates();
  const existingIndex = current.findIndex((t) => t.id === template.id);
  let updated: ChecklistTemplate[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = template;
  } else {
    updated = [template, ...current];
  }
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(updated));
  return updated;
};

export const deleteTemplate = (id: string): ChecklistTemplate[] => {
  const current = getStoredTemplates();
  const updated = current.filter((t) => t.id !== id);
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(updated));
  return updated;
};

export const duplicateTemplate = (id: string): { templates: ChecklistTemplate[]; newTemplate: ChecklistTemplate | null } => {
  const current = getStoredTemplates();
  const target = current.find((t) => t.id === id);
  if (!target) return { templates: current, newTemplate: null };

  const newTemplate: ChecklistTemplate = {
    ...JSON.parse(JSON.stringify(target)),
    id: `tmpl-${Date.now()}`,
    title: `${target.title} (Copy)`,
    version: '1.0',
    createdAt: new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString().split('T')[0],
  };

  const updated = [newTemplate, ...current];
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(updated));
  return { templates: updated, newTemplate };
};

// Inspections
export const getStoredInspections = (): InspectionRecord[] => {
  const lang = getCurrentLang();
  const seed = getLocalizedSeedData(lang).inspections;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INSPECTIONS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.INSPECTIONS, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load inspections from storage', e);
    return seed;
  }
};

export const saveInspection = (inspection: InspectionRecord): InspectionRecord[] => {
  const current = getStoredInspections();
  const existingIndex = current.findIndex((i) => i.id === inspection.id);
  let updated: InspectionRecord[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = inspection;
  } else {
    updated = [inspection, ...current];
  }
  localStorage.setItem(STORAGE_KEYS.INSPECTIONS, JSON.stringify(updated));
  return updated;
};

export const deleteInspection = (id: string): InspectionRecord[] => {
  const current = getStoredInspections();
  const updated = current.filter((i) => i.id !== id);
  localStorage.setItem(STORAGE_KEYS.INSPECTIONS, JSON.stringify(updated));
  return updated;
};

// Corrective Actions
export const getStoredActions = (): CorrectiveAction[] => {
  const lang = getCurrentLang();
  const seed = getLocalizedSeedData(lang).actions;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIONS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.ACTIONS, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load actions from storage', e);
    return seed;
  }
};

export const saveAction = (action: CorrectiveAction): CorrectiveAction[] => {
  const current = getStoredActions();
  const existingIndex = current.findIndex((a) => a.id === action.id);
  let updated: CorrectiveAction[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = action;
  } else {
    updated = [action, ...current];
  }
  localStorage.setItem(STORAGE_KEYS.ACTIONS, JSON.stringify(updated));
  return updated;
};

export const updateActionStatus = (
  id: string,
  status: CorrectiveAction['status'],
  notes?: string
): CorrectiveAction[] => {
  const current = getStoredActions();
  const updated = current.map((a) => {
    if (a.id === id) {
      return {
        ...a,
        status,
        resolutionNotes: notes !== undefined ? notes : a.resolutionNotes,
        resolvedAt: status === 'resolved' || status === 'verified' ? new Date().toLocaleString() : a.resolvedAt,
      };
    }
    return a;
  });
  localStorage.setItem(STORAGE_KEYS.ACTIONS, JSON.stringify(updated));
  return updated;
};

// Projects
export const getStoredProjects = (): Project[] => {
  const lang = getCurrentLang();
  const seed = getLocalizedSeedData(lang).projects;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PROJECTS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load projects from storage', e);
    return seed;
  }
};

export const saveProject = (project: Project): Project[] => {
  const current = getStoredProjects();
  const existingIndex = current.findIndex((p) => p.id === project.id);
  let updated: Project[];
  if (existingIndex >= 0) {
    updated = [...current];
    updated[existingIndex] = project;
  } else {
    updated = [project, ...current];
  }
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(updated));
  return updated;
};

// Users & Active Persona
export const getStoredUsers = (): User[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USERS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(MOCK_USERS));
      return MOCK_USERS;
    }
    return JSON.parse(raw);
  } catch (e) {
    return MOCK_USERS;
  }
};

export const getActiveUser = (): User => {
  const users = getStoredUsers();
  const activeId = localStorage.getItem(STORAGE_KEYS.ACTIVE_USER_ID);
  if (activeId) {
    const match = users.find((u) => u.id === activeId);
    if (match) return match;
  }
  return users[0] || MOCK_USERS[0];
};

export const setActiveUser = (userId: string): User => {
  localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, userId);
  return getActiveUser();
};

// Sync built-in seed records when language changes while preserving custom/AI items
export const syncBuiltInDataLanguage = (lang: Language) => {
  const seed = getLocalizedSeedData(lang);

  // Sync built-in templates (tmpl-001..004)
  const storedTemplates = getStoredTemplates();
  const seedTemplateMap = new Map(seed.templates.map((t) => [t.id, t]));
  const updatedTemplates = storedTemplates.map((t) => seedTemplateMap.get(t.id) || t);
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(updatedTemplates));

  // Sync built-in projects (prj-101..103)
  const storedProjects = getStoredProjects();
  const seedProjectMap = new Map(seed.projects.map((p) => [p.id, p]));
  const updatedProjects = storedProjects.map((p) => seedProjectMap.get(p.id) || p);
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(updatedProjects));

  // Sync built-in inspections (preserve status/review changes)
  const storedInspections = getStoredInspections();
  const seedInspectionMap = new Map(seed.inspections.map((i) => [i.id, i]));
  const updatedInspections = storedInspections.map((i) => {
    const seedInsp = seedInspectionMap.get(i.id);
    if (!seedInsp) return i;
    return {
      ...seedInsp,
      status: i.status,
      reviewedBy: i.reviewedBy || seedInsp.reviewedBy,
      reviewedRole: i.reviewedRole || seedInsp.reviewedRole,
      reviewedAt: i.reviewedAt || seedInsp.reviewedAt,
      reviewNotes: i.reviewNotes || seedInsp.reviewNotes,
    };
  });
  localStorage.setItem(STORAGE_KEYS.INSPECTIONS, JSON.stringify(updatedInspections));

  // Sync built-in corrective actions (preserve status)
  const storedActions = getStoredActions();
  const seedActionMap = new Map(seed.actions.map((a) => [a.id, a]));
  const updatedActions = storedActions.map((a) => {
    const seedAct = seedActionMap.get(a.id);
    if (!seedAct) return a;
    return {
      ...seedAct,
      status: a.status,
      resolutionNotes: a.resolutionNotes || seedAct.resolutionNotes,
      resolvedAt: a.resolvedAt || seedAct.resolvedAt,
    };
  });
  localStorage.setItem(STORAGE_KEYS.ACTIONS, JSON.stringify(updatedActions));
};

// Demo Reset Helper
export const resetDemoData = (lang?: Language) => {
  const activeLang = lang || getCurrentLang();
  const seed = getLocalizedSeedData(activeLang);
  localStorage.setItem(STORAGE_KEYS.TEMPLATES, JSON.stringify(seed.templates));
  localStorage.setItem(STORAGE_KEYS.INSPECTIONS, JSON.stringify(seed.inspections));
  localStorage.setItem(STORAGE_KEYS.ACTIONS, JSON.stringify(seed.actions));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(seed.projects));
  localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(MOCK_USERS));
  localStorage.setItem(STORAGE_KEYS.ACTIVE_USER_ID, MOCK_USERS[0].id);
};
