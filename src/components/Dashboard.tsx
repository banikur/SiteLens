import React, { useState } from 'react';
import {
  FileCheck2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Play,
  Eye,
  ArrowRight,
  MapPin,
  Plus,
  Wand2,
  BarChart3,
} from 'lucide-react';
import {
  InspectionRecord,
  ChecklistTemplate,
  CorrectiveAction,
  Project,
  User,
} from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface DashboardProps {
  templates: ChecklistTemplate[];
  inspections: InspectionRecord[];
  actions: CorrectiveAction[];
  projects: Project[];
  currentUser: User;
  onExecuteTemplate: (template: ChecklistTemplate) => void;
  onReviewInspection: (inspection: InspectionRecord) => void;
  onNavigateToTemplates: () => void;
  onNavigateToInspections: () => void;
  onNavigateToActions: () => void;
  onNewTemplate: () => void;
  onOpenAIGenerator: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  templates,
  inspections,
  actions,
  projects,
  currentUser,
  onExecuteTemplate,
  onReviewInspection,
  onNavigateToTemplates,
  onNavigateToInspections,
  onNavigateToActions,
  onNewTemplate,
  onOpenAIGenerator,
}) => {
  const { t, translateCategory, translateRole, translateStatus } = useLanguage();
  const [leftTab, setLeftTab] = useState<'inspections' | 'compliance'>('inspections');
  const [rightTab, setRightTab] = useState<'actions' | 'protocols'>('actions');

  // Aggregate Metrics
  const totalInspections = inspections.length;
  const underReviewCount = inspections.filter((i) => i.status === 'under_review').length;
  const openActions = actions.filter(
    (a) => a.status === 'OPEN' || a.status === 'IN_PROGRESS' || a.status === 'PENDING_VERIFICATION'
  );
  const criticalActionsCount = openActions.filter(
    (a) => a.severity === 'critical' || a.severity === 'high'
  ).length;

  const totalScores = inspections.reduce((acc, curr) => acc + curr.scorePercent, 0);
  const avgCompliance =
    totalInspections > 0 ? Math.round(totalScores / totalInspections) : 100;

  // Group inspections by category for compliance breakdown
  const categoryStats = [
    'Safety & HSE',
    'Civil & Structural',
    'Heavy Equipment',
    'Quality Control',
    'Environmental',
  ].map((cat) => {
    const matching = inspections.filter((i) => i.category === cat);
    const count = matching.length;
    const catAvg =
      count > 0
        ? Math.round(matching.reduce((acc, c) => acc + c.scorePercent, 0) / count)
        : 95;
    return { category: cat, count, avg: catAvg };
  });

  return (
    <div className="h-full flex flex-col space-y-2 overflow-hidden">
      {/* =========================================================================
          TOP EXECUTIVE TOOLBAR: Title, Compact KPI Strip, & Quick Actions (~44px)
          ========================================================================= */}
      <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        {/* Left: Title & Context */}
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-[#d4f038] flex items-center justify-center font-bold font-mono text-xs shrink-0">
            SL
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                {t.dashboard.title}
              </h1>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 font-semibold text-slate-600">
                {currentUser.name} ({translateRole(currentUser.role)})
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden xl:block">
              {t.dashboard.subtitle}
            </p>
          </div>
        </div>

        {/* Middle: Compact KPI Pill Strip */}
        <div className="flex items-center space-x-2 flex-wrap text-xs">
          <div className="px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200 flex items-center space-x-1.5">
            <FileCheck2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="font-mono font-bold text-slate-900">{totalInspections}</span>
            <span className="text-[11px] text-slate-500 hidden sm:inline">Inspeksi</span>
          </div>

          <div className="px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 flex items-center space-x-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-mono font-bold text-emerald-700">{avgCompliance}%</span>
            <span className="text-[11px] text-emerald-600 hidden sm:inline">Kepatuhan</span>
          </div>

          <div className="px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 flex items-center space-x-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span className="font-mono font-bold text-amber-700">{underReviewCount}</span>
            <span className="text-[11px] text-amber-700 hidden sm:inline">Verifikasi</span>
          </div>

          <div className="px-2.5 py-1 rounded-md bg-rose-50 border border-rose-200 flex items-center space-x-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            <span className="font-mono font-bold text-rose-700">{openActions.length}</span>
            <span className="text-[11px] text-rose-700 hidden sm:inline">Remedial</span>
          </div>
        </div>

        {/* Right: Quick Action Buttons */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={onOpenAIGenerator}
            className="p-1 sm:px-2.5 sm:py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors flex items-center whitespace-nowrap shadow-2xs"
            title={t.dashboard.aiGenerator}
          >
            <Wand2 className="w-3.5 h-3.5 sm:mr-1 text-amber-400" />
            <span className="hidden sm:inline">AI Gen</span>
          </button>
          <button
            onClick={onNewTemplate}
            className="p-1 sm:px-2.5 sm:py-1 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center whitespace-nowrap shadow-2xs"
            title={t.dashboard.newChecklist}
          >
            <Plus className="w-3.5 h-3.5 sm:mr-1" />
            <span className="hidden sm:inline">+ Template</span>
          </button>
          <button
            onClick={onNavigateToTemplates}
            className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-2xs whitespace-nowrap"
            title={t.dashboard.performInspection}
          >
            <Play className="w-3 h-3 mr-1 fill-current" />
            <span>Mulai</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          MAIN WORKSPACE: Split Feed & Operations Panel (100% Locked Height)
          ========================================================================= */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col lg:flex-row overflow-hidden">
        {/* Left Pane (62%): Inspections & Compliance Sub-Views */}
        <div className="w-full lg:w-[62%] border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col min-h-0 h-full bg-white">
          {/* Sub-tab Bar */}
          <div className="px-3.5 py-2 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => setLeftTab('inspections')}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-colors flex items-center space-x-1.5 ${
                  leftTab === 'inspections'
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>{t.dashboard.recentInspections} ({inspections.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setLeftTab('compliance')}
                className={`px-3 py-1 rounded-md text-xs font-bold transition-colors flex items-center space-x-1.5 ${
                  leftTab === 'compliance'
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>{t.dashboard.complianceByDiscipline}</span>
              </button>
            </div>

            <button
              onClick={onNavigateToInspections}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center"
            >
              <span>{t.dashboard.viewAll}</span>
              <ArrowRight className="w-3 h-3 ml-0.5" />
            </button>
          </div>

          {/* Sub-view Content: Inspections Log Table */}
          {leftTab === 'inspections' ? (
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 p-2 font-sans">
              {inspections.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs">
                  Belum ada rekaman inspeksi lapangan.
                </div>
              ) : (
                inspections.map((insp) => (
                  <div
                    key={insp.id}
                    className="p-2.5 rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 group"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center space-x-2 text-[10px] text-slate-500 flex-wrap">
                        <span className="font-mono font-bold text-slate-800">#{insp.id}</span>
                        <span>•</span>
                        <span className="font-semibold text-slate-700 truncate max-w-[150px]">{insp.projectName}</span>
                        <span>•</span>
                        <span className="truncate">{insp.inspectorName} ({translateRole(insp.inspectorRole)})</span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-900 truncate">
                        {insp.templateTitle}
                      </h4>
                      <div className="flex items-center space-x-2 text-[10px] text-slate-400">
                        <span className="flex items-center">
                          <MapPin className="w-3 h-3 mr-0.5 text-slate-400" />
                          {insp.siteZone}
                        </span>
                        <span>•</span>
                        <span>{insp.submittedAt || insp.createdAt}</span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      <div className="text-right">
                        <span
                          className={`font-mono text-xs font-bold block tabular-nums ${
                            insp.scorePercent >= 90
                              ? 'text-emerald-600'
                              : insp.scorePercent >= 75
                              ? 'text-amber-600'
                              : 'text-rose-600'
                          }`}
                        >
                          {insp.scorePercent}%
                        </span>
                        <span className="text-[9px] uppercase font-semibold text-slate-400">
                          {translateStatus(insp.status)}
                        </span>
                      </div>

                      <button
                        onClick={() => onReviewInspection(insp)}
                        className="p-1.5 rounded-md border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 transition-colors"
                        title="Tinjau detail verifikasi"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* Sub-view Content: Compliance Matrix */
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 font-sans">
              {categoryStats.map((item) => (
                <div key={item.category} className="p-2.5 rounded-lg bg-slate-50/70 border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800">
                      {translateCategory(item.category)}
                    </span>
                    <span className="font-mono font-bold tabular-nums text-slate-900">
                      {item.avg}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        item.avg >= 95
                          ? 'bg-emerald-500'
                          : item.avg >= 85
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${item.avg}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400 flex items-center justify-between">
                    <span>{item.count} total audit tercatat</span>
                    <span>Target standar: &ge;85%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Pane (38%): Critical Actions & Quick Launch Protocols */}
        <div className="w-full lg:w-[38%] flex flex-col min-h-0 h-full bg-slate-50/30">
          {/* Sub-tab Bar */}
          <div className="px-3.5 py-2 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => setRightTab('actions')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors flex items-center space-x-1 ${
                  rightTab === 'actions'
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                <span>CAPA ({openActions.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setRightTab('protocols')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors flex items-center space-x-1 ${
                  rightTab === 'protocols'
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Play className="w-3 h-3 text-amber-500 fill-current" />
                <span>Protokol ({templates.length})</span>
              </button>
            </div>

            <button
              onClick={rightTab === 'actions' ? onNavigateToActions : onNavigateToTemplates}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center"
            >
              <span>{t.dashboard.viewAll}</span>
              <ArrowRight className="w-3 h-3 ml-0.5" />
            </button>
          </div>

          {/* Right Pane Content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
            {rightTab === 'actions' ? (
              openActions.length === 0 ? (
                <div className="py-16 text-center text-slate-400 text-xs">
                  Tidak ada temuan non-conformance aktif.
                </div>
              ) : (
                openActions.map((act) => (
                  <div
                    key={act.id}
                    className="p-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-all space-y-1 shadow-2xs"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-mono text-slate-400">#{act.id}</span>
                      <span
                        className={`font-bold uppercase px-1.5 py-0.2 rounded ${
                          act.severity === 'critical' || act.severity === 'high'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {act.severity}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {act.fieldLabel}
                    </div>
                    <p className="text-[11px] text-slate-500 line-clamp-1">
                      {act.issueDescription}
                    </p>
                    <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                      <span className="truncate max-w-[130px]">PIC: {act.assignedToName}</span>
                      <span className="font-mono">Jatuh Tempo: {act.dueDate}</span>
                    </div>
                  </div>
                ))
              )
            ) : (
              templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="p-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-all flex items-center justify-between gap-2 shadow-2xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="text-[10px] text-slate-400">
                      {translateCategory(tpl.category)} • ~{tpl.estimatedMinutes}m
                    </div>
                    <h4 className="text-xs font-bold text-slate-900 truncate">
                      {tpl.title}
                    </h4>
                  </div>
                  <button
                    onClick={() => onExecuteTemplate(tpl)}
                    className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center space-x-1 shrink-0 transition-colors"
                  >
                    <Play className="w-3 h-3 fill-current text-amber-400" />
                    <span>Mulai</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
