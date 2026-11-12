import React, { useState } from 'react';
import {
  Plus,
  Search,
  X,
} from 'lucide-react';
import { CorrectiveAction, ActionSeverity, ActionStatus, Project } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface CorrectiveActionsProps {
  actions: CorrectiveAction[];
  projects: Project[];
  onUpdateStatus: (id: string, status: ActionStatus, notes?: string) => void;
  onAddAction: (action: CorrectiveAction) => void;
}

export const CorrectiveActions: React.FC<CorrectiveActionsProps> = ({
  actions,
  projects,
  onUpdateStatus,
  onAddAction,
}) => {
  const { t, translateStatus } = useLanguage();
  const [severityFilter, setSeverityFilter] = useState<'all' | ActionSeverity>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal for new corrective action
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newIssue, setNewIssue] = useState('');
  const [newSeverity, setNewSeverity] = useState<ActionSeverity>('high');
  const [newProjectId, setNewProjectId] = useState<string>(projects[0]?.id || '');
  const [newZone] = useState<string>('Perimeter Berm & Hoarding');
  const [newAssignee, setNewAssignee] = useState('Mechanic Crew Lead');
  const [newDueDate, setNewDueDate] = useState(
    new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]
  );

  // Filtered actions
  const filtered = actions.filter((a) => {
    const matchSeverity = severityFilter === 'all' || a.severity === severityFilter;
    const matchSearch =
      a.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.fieldLabel.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.issueDescription.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.assignedToName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.projectName.toLowerCase().includes(searchQuery.toLowerCase());
    return matchSeverity && matchSearch;
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newIssue.trim()) {
      return;
    }
    const proj = projects.find((p) => p.id === newProjectId) || projects[0];

    const action: CorrectiveAction = {
      id: `act-${Math.floor(100 + Math.random() * 900)}`,
      inspectionId: 'manual-log',
      inspectionTitle: 'Ad-hoc Site Hazard Notification',
      projectId: proj.id,
      projectName: proj.name,
      siteZone: newZone,
      fieldLabel: newTitle,
      issueDescription: newIssue,
      severity: newSeverity,
      assignedToName: newAssignee,
      assignedToRole: 'Lead Contractor',
      dueDate: newDueDate,
      status: 'open',
      createdAt: new Date().toLocaleDateString(),
    };

    onAddAction(action);
    setNewModalOpen(false);
    setNewTitle('');
    setNewIssue('');
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.actions.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t.actions.subtitle}</p>
        </div>
        <button
          onClick={() => setNewModalOpen(true)}
          className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          {t.actions.logActionBtn}
        </button>
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">
            {t.actions.totalIssues}
          </span>
          <span className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1 block">
            {actions.length}
          </span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">
            {t.actions.openPending}
          </span>
          <span className="text-2xl font-bold text-rose-600 font-mono tabular-nums mt-1 block">
            {actions.filter((a) => a.status === 'open').length}
          </span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">
            {t.actions.inRemediation}
          </span>
          <span className="text-2xl font-bold text-amber-600 font-mono tabular-nums mt-1 block">
            {actions.filter((a) => a.status === 'in_remediation').length}
          </span>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">
            {t.actions.verifiedClosed}
          </span>
          <span className="text-2xl font-bold text-emerald-600 font-mono tabular-nums mt-1 block">
            {actions.filter((a) => a.status === 'verified').length}
          </span>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t.actions.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-slate-400 mr-1">
              {t.actions.severityLabel}
            </span>
            {(['all', 'critical', 'high', 'medium', 'low'] as const).map(
              (sev) => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    severityFilter === sev
                      ? 'bg-slate-900 text-white font-semibold'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {sev === 'all' ? t.common.all : sev.toUpperCase()}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Actions Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((act) => (
          <div
            key={act.id}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between hover:border-slate-300 transition-all"
          >
            <div>
              {/* Header */}
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-mono text-slate-400 font-bold">
                  #{act.id}
                </span>
                <span
                  className={`font-mono text-[10px] font-bold uppercase ${
                    act.severity === 'critical' || act.severity === 'high'
                      ? 'text-rose-700'
                      : act.severity === 'medium'
                      ? 'text-amber-700'
                      : 'text-slate-600'
                  }`}
                >
                  {act.severity} {t.dashboard.severityLabel}
                </span>
              </div>

              <h3 className="text-sm font-bold text-slate-900 leading-snug">
                {act.fieldLabel}
              </h3>

              <p className="text-xs text-slate-600 mt-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100 leading-relaxed">
                {act.issueDescription}
              </p>

              {/* Attached evidence photo thumbnail */}
              {act.evidencePhotoUrl && (
                <div className="mt-3">
                  <img
                    src={act.evidencePhotoUrl}
                    alt="Deficiency proof"
                    referrerPolicy="no-referrer"
                    className="w-full h-32 object-cover rounded-lg border border-slate-200"
                  />
                </div>
              )}

              {/* Metadata */}
              <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 space-y-1">
                <div className="flex items-center justify-between">
                  <span>{t.actions.projectSite}</span>
                  <span className="font-semibold text-slate-800 truncate max-w-[150px]">
                    {act.projectName}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t.actions.assignedTo}</span>
                  <span className="font-medium text-slate-800">
                    {act.assignedToName}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t.actions.targetDueDate}</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {act.dueDate}
                  </span>
                </div>
              </div>

              {act.resolutionNotes && (
                <div className="mt-3 p-2 bg-emerald-50 rounded text-[11px] text-emerald-900 border border-emerald-100">
                  <span className="font-bold block">
                    {t.actions.resolutionNotes}
                  </span>
                  {act.resolutionNotes}
                </div>
              )}
            </div>

            {/* Status Selector Footer */}
            <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                {t.actions.statusLabel}
              </span>
              <select
                value={act.status}
                onChange={(e) =>
                  onUpdateStatus(act.id, e.target.value as ActionStatus)
                }
                className="text-xs font-bold border border-slate-300 rounded px-2.5 py-1 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
              >
                <option value="open">{translateStatus('open')}</option>
                <option value="in_remediation">
                  {translateStatus('in_remediation')}
                </option>
                <option value="resolved">{translateStatus('resolved')}</option>
                <option value="verified">{translateStatus('verified')}</option>
              </select>
            </div>
          </div>
        ))}
      </div>

      {/* Manual Add Action Modal */}
      {newModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-base font-bold text-slate-900">
                {t.actions.modalTitle}
              </h3>
              <button
                onClick={() => setNewModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  {t.actions.deficiencyTitleLabel}
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t.actions.deficiencyTitlePlaceholder}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  {t.actions.defectDescLabel}
                </label>
                <textarea
                  rows={3}
                  required
                  value={newIssue}
                  onChange={(e) => setNewIssue(e.target.value)}
                  placeholder={t.actions.defectDescPlaceholder}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {t.actions.severityTierLabel}
                  </label>
                  <select
                    value={newSeverity}
                    onChange={(e) =>
                      setNewSeverity(e.target.value as ActionSeverity)
                    }
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white text-slate-900"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {t.actions.dueDateLabel}
                  </label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {t.actions.projectLabel}
                  </label>
                  <select
                    value={newProjectId}
                    onChange={(e) => setNewProjectId(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white text-slate-900"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} - {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    {t.actions.assignedLeadLabel}
                  </label>
                  <input
                    type="text"
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2.5">
                <button
                  type="button"
                  onClick={() => setNewModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  {t.actions.saveActionBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
