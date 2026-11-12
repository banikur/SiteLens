import React, { useState, useEffect } from 'react';
import {
  ChecklistTemplate,
  InspectionRecord,
  CorrectiveAction,
  Project,
  User,
  ActionStatus,
} from './types';
import {
  getStoredTemplates,
  saveTemplate,
  deleteTemplate,
  duplicateTemplate,
  getStoredInspections,
  saveInspection,
  deleteInspection,
  getStoredActions,
  saveAction,
  updateActionStatus,
  getStoredProjects,
  saveProject,
  getStoredUsers,
  getActiveUser,
  setActiveUser,
  resetDemoData,
  syncBuiltInDataLanguage,
} from './services/storage';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
import { Language } from './i18n/translations';

import { Navigation, ActiveTab } from './components/Navigation';
import { Dashboard } from './components/Dashboard';
import { ChecklistBuilder } from './components/ChecklistBuilder';
import { TemplateLibrary } from './components/TemplateLibrary';
import { InspectionExecution } from './components/InspectionExecution';
import { InspectionList } from './components/InspectionList';
import { InspectionReviewModal } from './components/InspectionReviewModal';
import { CorrectiveActions } from './components/CorrectiveActions';
import { ProjectsManager } from './components/ProjectsManager';
import { AnalyticsReports } from './components/AnalyticsReports';
import { TeamManagement } from './components/TeamManagement';
import { AITemplateGeneratorModal } from './components/AITemplateGeneratorModal';
import { OcrScannerModal } from './components/OcrScannerModal';

function SiteLensWorkspace() {
  const { lang, t } = useLanguage();
  const [currentTab, setCurrentTab] = useState<ActiveTab>('dashboard');

  // Core Data States
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User>(getActiveUser());

  // Interactive Sub-views & Modals
  const [editingTemplate, setEditingTemplate] = useState<ChecklistTemplate | null>(null);
  const [executingTemplate, setExecutingTemplate] = useState<ChecklistTemplate | null>(null);
  const [selectedInspectionForReview, setSelectedInspectionForReview] =
    useState<InspectionRecord | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [ocrCloneModalOpen, setOcrCloneModalOpen] = useState(false);

  const refreshAllData = () => {
    setTemplates(getStoredTemplates());
    setInspections(getStoredInspections());
    setActions(getStoredActions());
    setProjects(getStoredProjects());
    setUsers(getStoredUsers());
    setCurrentUser(getActiveUser());
  };

  // Load from Storage on mount and when language changes
  useEffect(() => {
    syncBuiltInDataLanguage(lang);
    refreshAllData();
  }, [lang]);

  // User Switcher Handler
  const handleSwitchUser = (userId: string) => {
    const updated = setActiveUser(userId);
    setCurrentUser(updated);
  };

  // Reset Demo Data
  const handleResetDemoData = () => {
    if (confirm(t.nav.resetConfirm)) {
      resetDemoData(lang);
      refreshAllData();
      setEditingTemplate(null);
      setExecutingTemplate(null);
      setSelectedInspectionForReview(null);
      setCurrentTab('dashboard');
    }
  };

  // Template Handlers
  const handleSaveTemplate = (template: ChecklistTemplate) => {
    const updated = saveTemplate(template);
    setTemplates(updated);
    setEditingTemplate(null);
    setCurrentTab('templates');
  };

  const handleDuplicateTemplate = (id: string) => {
    const { templates: updated, newTemplate } = duplicateTemplate(id);
    setTemplates(updated);
    if (newTemplate) {
      setEditingTemplate(newTemplate);
      setCurrentTab('builder');
    }
  };

  const handleDeleteTemplate = (id: string) => {
    const updated = deleteTemplate(id);
    setTemplates(updated);
  };

  const handleStartInspection = (template: ChecklistTemplate) => {
    setExecutingTemplate(template);
  };

  // Inspection Handlers
  const handleCompleteInspection = (
    record: InspectionRecord,
    failedItemsCount: number
  ) => {
    const updated = saveInspection(record);
    setInspections(updated);

    if (failedItemsCount > 0) {
      const newAction: CorrectiveAction = {
        id: `act-${Math.floor(100 + Math.random() * 900)}`,
        inspectionId: record.id,
        inspectionTitle: record.templateTitle,
        projectId: record.projectId,
        projectName: record.projectName,
        siteZone: record.siteZone,
        fieldLabel:
          lang === 'id'
            ? `Temuan ketidaksesuaian pada ${record.templateTitle}`
            : `Non-conformance flagged in ${record.templateTitle}`,
        issueDescription:
          record.notes ||
          (lang === 'id'
            ? `${failedItemsCount} poin pemeriksaan ditandai GAGAL saat inspeksi lapangan. Diperlukan tindakan perbaikan sebelum verifikasi ulang engineer.`
            : `${failedItemsCount} checkpoint(s) marked as FAIL during field inspection. Remedial rectification required before engineer re-inspection.`),
        severity: 'high',
        assignedToName:
          lang === 'id' ? 'Mandor Pelaksana Terkait' : 'Assigned Site Trade Lead',
        assignedToRole: 'Subcontractor Foreman',
        dueDate: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0],
        status: 'open',
        createdAt: new Date().toLocaleDateString(),
        evidencePhotoUrl: record.evidencePhotos[0]?.url,
      };
      const updatedActions = saveAction(newAction);
      setActions(updatedActions);
    }

    setExecutingTemplate(null);
    setCurrentTab('inspections');
  };

  const handleDeleteInspection = (id: string) => {
    const updated = deleteInspection(id);
    setInspections(updated);
  };

  // Verification & Sign-off Handlers
  const handleApproveInspection = (id: string, notes: string) => {
    const target = inspections.find((i) => i.id === id);
    if (!target) return;

    const updated = saveInspection({
      ...target,
      status: 'approved',
      reviewedBy: currentUser.name,
      reviewedRole: currentUser.role,
      reviewedAt: new Date().toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      reviewNotes:
        notes ||
        (lang === 'id'
          ? `Diverifikasi & disertifikasi sesuai standar oleh ${currentUser.name} (${currentUser.role}).`
          : `Verified & certified in compliance by ${currentUser.name} (${currentUser.role}).`),
    });

    setInspections(updated);
    setSelectedInspectionForReview(null);
  };

  const handleRejectInspection = (id: string, notes: string) => {
    const target = inspections.find((i) => i.id === id);
    if (!target) return;

    const updated = saveInspection({
      ...target,
      status: 'rejected',
      reviewedBy: currentUser.name,
      reviewedRole: currentUser.role,
      reviewedAt: new Date().toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      reviewNotes:
        notes ||
        (lang === 'id'
          ? `Ditolak dengan instruksi perbaikan oleh ${currentUser.name}.`
          : `Rejected with rectification directives issued by ${currentUser.name}.`),
    });

    setInspections(updated);
    setSelectedInspectionForReview(null);
  };

  // Action Items Handlers
  const handleUpdateActionStatus = (
    id: string,
    status: ActionStatus,
    notes?: string
  ) => {
    const updated = updateActionStatus(id, status, notes);
    setActions(updated);
  };

  const handleAddAction = (action: CorrectiveAction) => {
    const updated = saveAction(action);
    setActions(updated);
  };

  // Project Handlers
  const handleAddProject = (project: Project) => {
    const updated = saveProject(project);
    setProjects(updated);
  };

  const pendingReviewsCount = inspections.filter(
    (i) => i.status === 'under_review'
  ).length;
  const openActionsCount = actions.filter(
    (a) => a.status === 'open' || a.status === 'in_remediation'
  ).length;

  const currentTabLabel = () => {
    if (executingTemplate) return t.nav.fieldExecution;
    if (editingTemplate || currentTab === 'builder')
      return t.nav.checklistDesigner;
    return (t.nav as Record<string, string>)[currentTab] || currentTab;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row text-slate-800 font-sans antialiased">
      {/* SIDEBAR NAVIGATION */}
      <Navigation
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setEditingTemplate(null);
          setExecutingTemplate(null);
          setCurrentTab(tab);
        }}
        activeUser={currentUser}
        allUsers={users}
        onSwitchUser={handleSwitchUser}
        onResetData={handleResetDemoData}
        onNewTemplate={() => {
          setEditingTemplate(null);
          setExecutingTemplate(null);
          setCurrentTab('builder');
        }}
        onOpenAIGenerator={() => setAiModalOpen(true)}
        pendingReviewsCount={pendingReviewsCount}
        openActionsCount={openActionsCount}
        totalTemplatesCount={templates.length}
      />

      {/* MAIN VIEW CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen overflow-x-hidden">
        {/* Top Bar Contract */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 lg:px-8 flex items-center justify-between gap-8 shrink-0">
          {/* Zone 1: Contextual Breadcrumb */}
          <div className="flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap shrink-0">
            <span className="font-bold text-slate-900">SiteLens</span>
            <span aria-hidden="true">/</span>
            <span className="text-slate-700 font-semibold">
              {currentTabLabel()}
            </span>
            {executingTemplate && (
              <>
                <span aria-hidden="true">/</span>
                <span className="font-mono text-slate-500 truncate max-w-xs">
                  {executingTemplate.title}
                </span>
              </>
            )}
          </div>

          {/* Zone 2: Contextual Status */}
          <nav className="hidden xl:flex items-center gap-6 text-xs text-slate-500 whitespace-nowrap shrink-0">
            <span>{t.nav.activeProjectHeader}</span>
            <span aria-hidden="true">·</span>
            <span>{t.nav.activeShiftsHeader}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-emerald-600 font-semibold">
              {t.nav.siteSyncNominal}
            </span>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            {executingTemplate ? (
              <button
                onClick={() => setExecutingTemplate(null)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                {t.nav.exitInspection}
              </button>
            ) : editingTemplate || currentTab === 'builder' ? (
              <button
                onClick={() => {
                  setEditingTemplate(null);
                  setCurrentTab('templates');
                }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                {t.nav.closeBuilder}
              </button>
            ) : (
              <button
                onClick={() => {
                  if (templates.length > 0) {
                    setExecutingTemplate(templates[0]);
                  }
                }}
                className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                {t.nav.quickPerform}
              </button>
            )}
          </div>
        </header>

        {/* Dynamic Main Body Content */}
        <main className="p-4 sm:p-6 lg:p-8 flex-1">
          {executingTemplate ? (
            <InspectionExecution
              template={executingTemplate}
              projects={projects}
              currentUser={currentUser}
              onComplete={handleCompleteInspection}
              onCancel={() => setExecutingTemplate(null)}
            />
          ) : currentTab === 'builder' || editingTemplate ? (
            <ChecklistBuilder
              initialTemplate={editingTemplate}
              currentUser={currentUser}
              onSave={handleSaveTemplate}
              onOpenAIGenerator={() => setAiModalOpen(true)}
              onCancel={() => {
                setEditingTemplate(null);
                setCurrentTab('templates');
              }}
            />
          ) : currentTab === 'dashboard' ? (
            <Dashboard
              templates={templates}
              inspections={inspections}
              actions={actions}
              projects={projects}
              currentUser={currentUser}
              onExecuteTemplate={handleStartInspection}
              onReviewInspection={(insp) => setSelectedInspectionForReview(insp)}
              onNavigateToTemplates={() => setCurrentTab('templates')}
              onNavigateToInspections={() => setCurrentTab('inspections')}
              onNavigateToActions={() => setCurrentTab('actions')}
              onNewTemplate={() => {
                setEditingTemplate(null);
                setCurrentTab('builder');
              }}
              onOpenAIGenerator={() => setAiModalOpen(true)}
            />
          ) : currentTab === 'templates' ? (
            <TemplateLibrary
              templates={templates}
              onExecute={handleStartInspection}
              onEdit={(tpl) => {
                setEditingTemplate(tpl);
                setCurrentTab('builder');
              }}
              onDuplicate={handleDuplicateTemplate}
              onDelete={handleDeleteTemplate}
              onCreateNew={() => {
                setEditingTemplate(null);
                setCurrentTab('builder');
              }}
              onOpenAIGenerator={() => setAiModalOpen(true)}
              onOpenOcr={() => setOcrCloneModalOpen(true)}
            />
          ) : currentTab === 'inspections' ? (
            <InspectionList
              inspections={inspections}
              projects={projects}
              onReviewInspection={(insp) => setSelectedInspectionForReview(insp)}
              onDeleteInspection={handleDeleteInspection}
              onLaunchInspection={() => setCurrentTab('templates')}
            />
          ) : currentTab === 'actions' ? (
            <CorrectiveActions
              actions={actions}
              projects={projects}
              onUpdateStatus={handleUpdateActionStatus}
              onAddAction={handleAddAction}
            />
          ) : currentTab === 'projects' ? (
            <ProjectsManager
              projects={projects}
              onAddProject={handleAddProject}
            />
          ) : currentTab === 'analytics' ? (
            <AnalyticsReports
              inspections={inspections}
              actions={actions}
              projects={projects}
            />
          ) : (
            <TeamManagement
              users={users}
              activeUser={currentUser}
              onSwitchUser={handleSwitchUser}
            />
          )}
        </main>
      </div>

      {/* INSPECTION REVIEW MODAL DIALOG */}
      <InspectionReviewModal
        inspection={selectedInspectionForReview}
        currentUser={currentUser}
        onClose={() => setSelectedInspectionForReview(null)}
        onApprove={handleApproveInspection}
        onReject={handleRejectInspection}
      />

      {/* AI CHECKLIST TEMPLATE GENERATOR MODAL */}
      <AITemplateGeneratorModal
        isOpen={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        currentUser={currentUser}
        onSaveToLibrary={(tpl) => {
          handleSaveTemplate(tpl);
        }}
        onOpenInBuilder={(tpl) => {
          setEditingTemplate(tpl);
          setExecutingTemplate(null);
          setCurrentTab('builder');
        }}
      />

      {/* OCR PAPER FORM CLONE MODAL (CLIENT-SIDE JS OCR) */}
      <OcrScannerModal
        isOpen={ocrCloneModalOpen}
        mode="clone_template"
        currentUser={currentUser}
        onClose={() => setOcrCloneModalOpen(false)}
        onTemplateCloned={(clonedTpl) => {
          setEditingTemplate(clonedTpl);
          setExecutingTemplate(null);
          setCurrentTab('builder');
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <SiteLensWorkspace />
    </LanguageProvider>
  );
}
