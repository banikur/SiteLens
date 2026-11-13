import React from 'react';
import {
  TrendingUp,
  ShieldCheck,
  Printer,
  AlertTriangle,
} from 'lucide-react';
import { InspectionRecord, CorrectiveAction, Project } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface AnalyticsReportsProps {
  inspections: InspectionRecord[];
  actions: CorrectiveAction[];
  projects: Project[];
}

export const AnalyticsReports: React.FC<AnalyticsReportsProps> = ({
  inspections,
  actions,
  projects,
}) => {
  const { t } = useLanguage();
  const total = inspections.length;
  const approved = inspections.filter((i) => i.status === 'approved').length;
  const underReview = inspections.filter(
    (i) => i.status === 'under_review'
  ).length;

  const totalScores = inspections.reduce(
    (acc, curr) => acc + curr.scorePercent,
    0
  );
  const avgCompliance = total > 0 ? Math.round(totalScores / total) : 100;

  const resolvedActions = actions.filter(
    (a) => a.status === 'CLOSED' || a.status === 'EFFECTIVENESS_MONITORING'
  ).length;
  const openActions = actions.filter(
    (a) => a.status === 'OPEN' || a.status === 'IN_PROGRESS' || a.status === 'PENDING_VERIFICATION'
  ).length;
  const actionResolutionRate =
    actions.length > 0
      ? Math.round((resolvedActions / actions.length) * 100)
      : 100;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.analytics.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t.analytics.subtitle}</p>
        </div>
        <button
          onClick={handlePrint}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center"
        >
          <Printer className="w-3.5 h-3.5 mr-1.5" />
          {t.analytics.printReport}
        </button>
      </div>

      {/* Top 3 Analytical Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">
              {t.analytics.overallCompliance}
            </span>
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-mono tabular-nums">
            {avgCompliance}%
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {t.analytics.overallComplianceSub}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">
              {t.analytics.verificationPipeline}
            </span>
            <TrendingUp className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-mono tabular-nums">
            {approved} / {total}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {t.analytics.verificationPipelineSub.replace(
              '{count}',
              String(underReview)
            )}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">
              {t.analytics.remediationRate}
            </span>
            <AlertTriangle className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-3xl font-extrabold text-slate-900 font-mono tabular-nums">
            {actionResolutionRate}%
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {t.analytics.remediationRateSub
              .replace('{resolved}', String(resolvedActions))
              .replace('{open}', String(openActions))}
          </p>
        </div>
      </div>

      {/* Project Comparison Matrix */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">
          {t.analytics.benchmarkMatrix}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">{t.analytics.colProject}</th>
                <th className="py-3 px-4">{t.analytics.colLocation}</th>
                <th className="py-3 px-4">{t.analytics.colCompleted}</th>
                <th className="py-3 px-4">{t.analytics.colOpenRemedial}</th>
                <th className="py-3 px-4">{t.analytics.colCompliance}</th>
                <th className="py-3 px-4 text-right">
                  {t.analytics.colStatus}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((p) => {
                const projInspections = inspections.filter(
                  (i) => i.projectId === p.id
                );
                const projActions = actions.filter(
                  (a) => a.projectId === p.id && a.status !== 'CLOSED'
                );
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      {p.name}
                      <span className="text-[10px] font-mono text-slate-400 block font-normal">
                        Code: {p.code}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">{p.location}</td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 tabular-nums">
                      {projInspections.length}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold tabular-nums">
                      <span
                        className={
                          projActions.length > 0
                            ? 'text-rose-600'
                            : 'text-slate-500'
                        }
                      >
                        {projActions.length}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-emerald-600 tabular-nums">
                      {p.complianceRate}%
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <span className="font-semibold text-emerald-700 uppercase text-[10px]">
                        {t.analytics.activeOps}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
