import React from 'react';
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
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>{t.dashboard.welcomeBack}</span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-slate-700">{currentUser.name}</span>
            <span aria-hidden="true">·</span>
            <span>{translateRole(currentUser.role)}</span>
          </div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.dashboard.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            {t.dashboard.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={onOpenAIGenerator}
            className="px-3.5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors flex items-center whitespace-nowrap"
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
            {t.dashboard.aiGenerator}
          </button>
          <button
            onClick={onNewTemplate}
            className="px-3.5 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            {t.dashboard.newChecklist}
          </button>
          <button
            onClick={onNavigateToTemplates}
            className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
            {t.dashboard.performInspection}
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t.dashboard.kpiTotalRecorded}
            </span>
            <FileCheck2 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-mono tabular-nums">
            {totalInspections}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
            <span>
              {t.dashboard.kpiAcrossSites.replace(
                '{count}',
                String(projects.length)
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-600 font-medium">
              {t.dashboard.kpiThisWeek}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t.dashboard.kpiComplianceIndex}
            </span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-extrabold text-emerald-600 font-mono tabular-nums">
            {avgCompliance}%
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
            <span>{t.dashboard.kpiBenchmark}</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-600 font-medium">
              {t.dashboard.kpiNominal}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t.dashboard.kpiVerificationQueue}
            </span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-3xl font-extrabold text-amber-600 font-mono tabular-nums">
            {underReviewCount}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
            <span>{t.dashboard.kpiAwaitingSignoff}</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-700 font-medium">
              {t.dashboard.kpiEngineerAction}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t.dashboard.kpiRemedialItems}
            </span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-3xl font-extrabold text-rose-600 font-mono tabular-nums">
            {openActions.length}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
            <span>
              {t.dashboard.kpiHighPriority.replace(
                '{count}',
                String(criticalActionsCount)
              )}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-rose-700 font-medium">
              {t.dashboard.kpiImmediate}
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: Launchpad & Category Compliance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Launch Checklist Protocols */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  {t.dashboard.protocolsTitle}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t.dashboard.protocolsSubtitle}
                </p>
              </div>
              <button
                onClick={onNavigateToTemplates}
                className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center"
              >
                {t.dashboard.viewAll} ({templates.length})
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </button>
            </div>

            <div className="space-y-3">
              {templates.slice(0, 3).map((tpl) => (
                <div
                  key={tpl.id}
                  className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">
                        {translateCategory(tpl.category)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">v{tpl.version}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        ~{tpl.estimatedMinutes} {t.common.minutes}
                      </span>
                      {tpl.requiresApproval && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-600 font-medium">
                            {t.dashboard.requiresSignoff}
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 leading-snug">
                      {tpl.title}
                    </h3>
                    <p className="text-xs text-slate-500 line-clamp-1">
                      {tpl.description}
                    </p>
                  </div>
                  <button
                    onClick={() => onExecuteTemplate(tpl)}
                    className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center shrink-0 transition-colors whitespace-nowrap"
                  >
                    <Play className="w-3 h-3 mr-1.5 fill-current text-amber-400" />
                    {t.dashboard.performBtn}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{t.dashboard.customProtocolPrompt}</span>
            <button
              onClick={onOpenAIGenerator}
              className="text-amber-600 font-semibold hover:text-amber-700 flex items-center whitespace-nowrap ml-2"
            >
              {t.dashboard.aiGenerator}
              <ArrowRight className="w-3 h-3 ml-1" />
            </button>
          </div>
        </div>

        {/* Category Compliance Matrix */}
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-1">
            {t.dashboard.complianceByDiscipline}
          </h2>
          <p className="text-xs text-slate-500 mb-5">
            {t.dashboard.complianceByDisciplineSub}
          </p>

          <div className="space-y-4">
            {categoryStats.map((item) => (
              <div key={item.category} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-800">
                    {translateCategory(item.category)}
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900">
                    {item.avg}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
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
                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>
                    {t.dashboard.recordedAudits.replace(
                      '{count}',
                      String(item.count)
                    )}
                  </span>
                  <span>{t.dashboard.targetRate}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Two Column Section: Recent Inspections & Urgent Corrective Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Recent Inspections Log */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                {t.dashboard.recentInspections}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {t.dashboard.recentInspectionsSub}
              </p>
            </div>
            <button
              onClick={onNavigateToInspections}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center"
            >
              {t.dashboard.fullLog} ({inspections.length})
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>

          <div className="divide-y divide-slate-100">
            {inspections.slice(0, 4).map((insp) => (
              <div
                key={insp.id}
                className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono text-slate-700">#{insp.id}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{insp.projectName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-700">
                      {insp.inspectorName}
                    </span>
                  </div>
                  <div className="font-semibold text-sm text-slate-900 truncate">
                    {insp.templateTitle}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400">
                    <span className="flex items-center">
                      <MapPin className="w-3 h-3 mr-1" />
                      {insp.siteZone}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{insp.submittedAt || insp.createdAt}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div
                      className={`text-sm font-bold font-mono tabular-nums ${
                        insp.scorePercent >= 90
                          ? 'text-emerald-600'
                          : insp.scorePercent >= 75
                          ? 'text-amber-600'
                          : 'text-rose-600'
                      }`}
                    >
                      {insp.scorePercent}%
                    </div>
                    <div className="text-[10px] uppercase font-semibold text-slate-400">
                      {translateStatus(insp.status)}
                    </div>
                  </div>
                  <button
                    onClick={() => onReviewInspection(insp)}
                    className="p-2 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Priority Corrective Actions */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                  {t.dashboard.activeNonConformances}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t.dashboard.activeNonConformancesSub}
                </p>
              </div>
              <button
                onClick={onNavigateToActions}
                className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center"
              >
                {t.dashboard.trackAll} ({actions.length})
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </button>
            </div>

            <div className="space-y-3">
              {actions.slice(0, 3).map((act) => (
                <div
                  key={act.id}
                  className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-500">#{act.id}</span>
                    <span
                      className={`font-semibold uppercase text-[10px] ${
                        act.severity === 'critical' || act.severity === 'high'
                          ? 'text-rose-600'
                          : 'text-amber-600'
                      }`}
                    >
                      {act.severity} {t.dashboard.severityLabel}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-900">
                    {act.fieldLabel}
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">
                    {act.issueDescription}
                  </p>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      {t.dashboard.assignedLabel} {act.assignedToName}
                    </span>
                    <span className="font-mono">
                      {t.dashboard.dueLabel} {act.dueDate}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{t.dashboard.remediationFooter}</span>
            <button
              onClick={onNavigateToActions}
              className="text-slate-900 font-semibold hover:underline whitespace-nowrap ml-2"
            >
              {t.dashboard.remediationBoardLink}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
