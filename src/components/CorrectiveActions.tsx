import React, { useState } from 'react';
import {
  Plus,
  Search,
  X,
} from 'lucide-react';
import { CorrectiveAction, ActionSeverity, ActionStatus, Project, WorkNode } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface CorrectiveActionsProps {
  actions: CorrectiveAction[];
  projects: Project[];
  workNodes?: WorkNode[];
  onUpdateStatus: (id: string, status: ActionStatus, notes?: string) => void;
  onAddAction: (action: CorrectiveAction) => void;
}

export const CorrectiveActions: React.FC<CorrectiveActionsProps> = ({
  actions,
  projects,
  workNodes = [],
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
  const [newNodeId, setNewNodeId] = useState<string>('');
  const [newZone] = useState<string>('Perimeter Berm & Hoarding');
  const [newAssignee, setNewAssignee] = useState('Mechanic Crew Lead');
  const [newDueDate, setNewDueDate] = useState(
    new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0]
  );

  const [selectedActionId, setSelectedActionId] = useState<string>('');

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

  // Keep active selection in sync
  const activeAction = filtered.find((a) => a.id === selectedActionId) || filtered[0] || null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newIssue.trim()) {
      return;
    }
    const proj = projects.find((p) => p.id === newProjectId) || projects[0];
    const targetNode = workNodes.find((n) => n.id === newNodeId);

    const action: CorrectiveAction = {
      id: crypto.randomUUID(),
      nodeId: newNodeId || null,
      inspectionId: null,
      inspectionTitle: targetNode ? `WBS: ${targetNode.wbsCode} ${targetNode.name}` : 'Ad-hoc Site Hazard Notification',
      projectId: proj.id,
      projectName: proj.name,
      siteZone: targetNode?.name || newZone,
      fieldLabel: newTitle,
      issueDescription: newIssue,
      severity: newSeverity,
      assignedToName: newAssignee,
      assignedToRole: 'Lead Contractor',
      dueDate: newDueDate,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
    };

    onAddAction(action);
    setSelectedActionId(action.id);
    setNewModalOpen(false);
    setNewTitle('');
    setNewIssue('');
    setNewNodeId('');
  };

  const openCount = actions.filter((a) => a.status === 'OPEN').length;
  const inProgCount = actions.filter(
    (a) => a.status === 'IN_PROGRESS' || a.status === 'PENDING_VERIFICATION'
  ).length;
  const closedCount = actions.filter((a) => a.status === 'CLOSED').length;

  return (
    <div className="h-full flex flex-col space-y-2 overflow-hidden">
      {/* Consolidated Executive Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2.5 shrink-0 shadow-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-none">
              {t.actions.title}
            </h1>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {actions.length} {t.actions.totalIssues.toLowerCase()}
            </p>
          </div>

          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          {/* Quick KPI Inline Strip */}
          <div className="hidden lg:flex items-center gap-1.5 text-[11px]">
            <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold border border-rose-200/60">
              {t.actions.openPending}: <strong className="font-mono">{openCount}</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold border border-amber-200/60">
              {t.actions.inRemediation}: <strong className="font-mono">{inProgCount}</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200/60">
              {t.actions.verifiedClosed}: <strong className="font-mono">{closedCount}</strong>
            </span>
          </div>

          <div className="h-4 w-px bg-slate-200 hidden lg:block" />

          {/* Search Input */}
          <div className="relative w-40 sm:w-52">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder={t.actions.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1 text-xs border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-slate-50/50"
            />
          </div>

          {/* Severity Filters */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
            {(['all', 'critical', 'high', 'medium', 'low'] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  severityFilter === sev
                    ? 'bg-white text-slate-900 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sev === 'all' ? t.common.all : sev.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={() => setNewModalOpen(true)}
          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          {t.actions.logActionBtn}
        </button>
      </div>

      {/* Main Single Container: Split Workspace (Left List 42% | Right Inspector 58%) */}
      <div className="bg-white rounded-xl border border-slate-200 flex-1 min-h-0 overflow-hidden flex shadow-xs divide-x divide-slate-200">
        {/* Left List Pane */}
        <div className="w-full sm:w-[42%] flex flex-col min-w-0 h-full bg-slate-50/40">
          <div className="px-3.5 py-2 border-b border-slate-200 bg-white flex items-center justify-between text-xs font-semibold text-slate-700 shrink-0">
            <span>Daftar Defisiensi ({filtered.length})</span>
            <span className="text-[10px] text-slate-400">Pilih untuk detail & audit</span>
          </div>

          {filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <span className="text-xs">Tidak ada tindakan perbaikan yang cocok.</span>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto divide-y divide-slate-100">
              {filtered.map((act) => {
                const isSelected = activeAction?.id === act.id;
                return (
                  <div
                    key={act.id}
                    onClick={() => setSelectedActionId(act.id)}
                    className={`p-3 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-white border-l-4 border-l-amber-500 shadow-xs'
                        : 'hover:bg-slate-100/70 border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-[11px] font-bold text-slate-500">
                          #{act.id.slice(0, 8)}
                        </span>
                        {act.nodeId && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            WBS Gated (99%)
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                          act.severity === 'critical' || act.severity === 'high'
                            ? 'bg-rose-100 text-rose-700'
                            : act.severity === 'medium'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {act.severity}
                      </span>
                    </div>

                    <div className="font-bold text-xs text-slate-900 truncate">
                      {act.fieldLabel}
                    </div>

                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                      {act.issueDescription}
                    </p>

                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                      <span className="truncate max-w-[140px] text-slate-600 font-medium">
                        {act.projectName}
                      </span>
                      <span
                        className={`font-semibold uppercase ${
                          act.status === 'CLOSED'
                            ? 'text-emerald-600'
                            : act.status === 'OPEN'
                            ? 'text-rose-600'
                            : 'text-amber-600'
                        }`}
                      >
                        {translateStatus(act.status)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Detail & Resolution Inspector */}
        <div className="hidden sm:flex sm:w-[58%] flex-col min-w-0 h-full bg-white">
          {activeAction ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Inspector Header */}
              <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-slate-400">
                      #{activeAction.id}
                    </span>
                    {activeAction.nodeId && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                        WBS Gated (99% Lockout)
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        activeAction.severity === 'critical' || activeAction.severity === 'high'
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : activeAction.severity === 'medium'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {activeAction.severity} {t.dashboard.severityLabel}
                    </span>
                  </div>
                  <h2 className="text-sm font-bold text-slate-900 truncate mt-0.5">
                    {activeAction.fieldLabel}
                  </h2>
                </div>

                {/* Status Transition Control directly in header */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[11px] text-slate-400 font-medium">
                    {t.actions.statusLabel}:
                  </span>
                  <select
                    value={activeAction.status}
                    onChange={(e) =>
                      onUpdateStatus(activeAction.id, e.target.value as ActionStatus)
                    }
                    className="text-xs font-bold border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-xs"
                  >
                    <option value="OPEN">{translateStatus('OPEN')}</option>
                    <option value="IN_PROGRESS">{translateStatus('IN_PROGRESS')}</option>
                    <option value="PENDING_VERIFICATION">
                      {translateStatus('PENDING_VERIFICATION')}
                    </option>
                    <option value="EFFECTIVENESS_MONITORING">
                      {translateStatus('EFFECTIVENESS_MONITORING')}
                    </option>
                    <option value="CLOSED">{translateStatus('CLOSED')}</option>
                    <option value="REJECTED">{translateStatus('REJECTED')}</option>
                  </select>
                </div>
              </div>

              {/* Inspector Content Body (Scrollable Internally) */}
              <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3.5">
                {/* Issue Description */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">
                    Deskripsi Defisiensi / Temuan
                  </label>
                  <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed font-sans">
                    {activeAction.issueDescription}
                  </p>
                </div>

                {/* Photo Evidence if any */}
                {activeAction.evidencePhotoUrl && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">
                      Bukti Foto Lapangan
                    </label>
                    <img
                      src={activeAction.evidencePhotoUrl}
                      alt="Deficiency proof"
                      referrerPolicy="no-referrer"
                      className="w-full max-h-48 object-cover rounded-lg border border-slate-200"
                    />
                  </div>
                )}

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-2.5 bg-slate-50/60 p-3 rounded-lg border border-slate-200 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                      {t.actions.projectSite}
                    </span>
                    <span className="font-semibold text-slate-900 truncate block">
                      {activeAction.projectName}
                    </span>
                    <span className="text-[10px] text-slate-500">{activeAction.siteZone}</span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                      {t.actions.assignedTo}
                    </span>
                    <span className="font-semibold text-slate-900 block">
                      {activeAction.assignedToName}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {activeAction.assignedToRole}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                      {t.actions.targetDueDate}
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {activeAction.dueDate}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">
                      Tanggal Dilaporkan
                    </span>
                    <span className="font-mono text-slate-700">
                      {activeAction.createdAt}
                    </span>
                  </div>
                </div>

                {/* Resolution Notes Box */}
                {activeAction.resolutionNotes ? (
                  <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-xs text-emerald-900">
                    <span className="font-bold block mb-1">
                      {t.actions.resolutionNotes}
                    </span>
                    <p className="leading-relaxed">{activeAction.resolutionNotes}</p>
                  </div>
                ) : (
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-500 flex items-center justify-between">
                    <span>Belum ada catatan penyelesaian resmi.</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <span className="text-xs">Pilih tindakan perbaikan untuk melihat inspeksi detail.</span>
            </div>
          )}
        </div>
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
                <label className="block font-bold text-slate-700 mb-1">
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
                <label className="block font-bold text-slate-700 mb-1">
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

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Tautkan ke Simpul WBS (99% Progress Lockout Gate)
                </label>
                <select
                  value={newNodeId}
                  onChange={(e) => setNewNodeId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">Bukan Simpul WBS (Temuan Operasional Proyek Umum)</option>
                  {workNodes
                    .filter((n) => !newProjectId || n.projectId === newProjectId)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        [{n.wbsCode}] {n.name}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Temuan Critical/High yang ditautkan ke simpul WBS akan mengunci progres fisik simpul tersebut maksimal di 99% sampai temuan diselesaikan.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
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
                  <label className="block font-bold text-slate-700 mb-1">
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
                  <label className="block font-bold text-slate-700 mb-1">
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
                  <label className="block font-bold text-slate-700 mb-1">
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
