import React, { useState } from 'react';
import {
  Search,
  Eye,
  Download,
  MapPin,
  Trash2,
  FileSpreadsheet,
  Printer,
} from 'lucide-react';
import { InspectionRecord, Project, InspectionStatus } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { exportFilledInspectionPdf } from '../utils/pdfGenerator';
import { getStoredTemplates } from '../services/storage';

interface InspectionListProps {
  inspections: InspectionRecord[];
  projects: Project[];
  onReviewInspection: (inspection: InspectionRecord) => void;
  onDeleteInspection: (id: string) => void;
  onLaunchInspection: () => void;
}

export const InspectionList: React.FC<InspectionListProps> = ({
  inspections,
  projects,
  onReviewInspection,
  onDeleteInspection,
  onLaunchInspection,
}) => {
  const { lang, t, translateCategory, translateRole, translateStatus } = useLanguage();
  const [statusFilter, setStatusFilter] = useState<'all' | InspectionStatus>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filtering
  const filtered = inspections.filter((i) => {
    const matchesStatus = statusFilter === 'all' || i.status === statusFilter;
    const matchesProject = projectFilter === 'all' || i.projectId === projectFilter;
    const matchesSearch =
      i.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.templateTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.inspectorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.siteZone.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesProject && matchesSearch;
  });

  const handleExportCSV = () => {
    const headers = [
      'Inspection ID',
      'Protocol Title',
      'Category',
      'Project',
      'Zone',
      'Inspector',
      'Role',
      'Score',
      'Status',
      'Submitted At',
    ];

    const rows = filtered.map((i) => [
      i.id,
      `"${i.templateTitle.replace(/"/g, '""')}"`,
      i.category,
      `"${i.projectName.replace(/"/g, '""')}"`,
      `"${i.siteZone.replace(/"/g, '""')}"`,
      `"${i.inspectorName}"`,
      i.inspectorRole,
      `${i.scorePercent}%`,
      i.status,
      i.submittedAt || i.createdAt,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `sitelens_inspections_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="h-full flex flex-col space-y-2 overflow-hidden">
      {/* Top Consolidated Executive Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2.5 shrink-0 shadow-xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-none">
              {t.inspections.title}
            </h1>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {filtered.length} {t.inspections.colProtocol.toLowerCase()}
            </p>
          </div>

          <div className="h-4 w-px bg-slate-200 hidden sm:block" />

          {/* Search Input */}
          <div className="relative w-48 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder={t.inspections.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1 text-xs border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-slate-50/50"
            />
          </div>

          {/* Project dropdown filter */}
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="bg-slate-50/50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500 max-w-[180px]"
          >
            <option value="all">
              {t.inspections.allProjects.replace('{count}', String(projects.length))}
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} - {p.name}
              </option>
            ))}
          </select>

          {/* Status segmented filters */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
            {(['all', 'under_review', 'approved', 'rejected'] as const).map((st) => {
              const count =
                st === 'all'
                  ? inspections.length
                  : inspections.filter((i) => i.status === st).length;
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    statusFilter === st
                      ? 'bg-white text-slate-900 font-bold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'all' ? t.inspections.allStatuses : translateStatus(st)}{' '}
                  <span className="font-mono text-[10px] opacity-70">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center"
            title={t.inspections.exportCsv}
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            <span className="hidden sm:inline">{t.inspections.exportCsv}</span>
          </button>
          <button
            onClick={onLaunchInspection}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs"
          >
            {t.inspections.newInspection}
          </button>
        </div>
      </div>

      {/* Main Single Data Container (Viewport-locked & Internally Scrollable) */}
      <div className="bg-white rounded-xl border border-slate-200 flex-1 min-h-0 overflow-hidden flex flex-col shadow-xs">
        {filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <FileSpreadsheet className="w-8 h-8 text-slate-300 mb-2" />
            <h3 className="text-xs font-bold text-slate-700">
              {t.inspections.noMatchTitle}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {t.inspections.noMatchSub}
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider sticky top-0 z-10 shadow-xs">
                <tr>
                  <th className="py-2.5 px-3">{t.inspections.colId}</th>
                  <th className="py-2.5 px-3">{t.inspections.colProtocol}</th>
                  <th className="py-2.5 px-3">{t.inspections.colProject}</th>
                  <th className="py-2.5 px-3">{t.inspections.colInspector}</th>
                  <th className="py-2.5 px-3">{t.inspections.colScore}</th>
                  <th className="py-2.5 px-3">{t.inspections.colStatus}</th>
                  <th className="py-2.5 px-3 text-right">
                    {t.inspections.colActions}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((insp) => (
                  <tr
                    key={insp.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                      #{insp.id}
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900 max-w-xs truncate">
                        {insp.templateTitle}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {translateCategory(insp.category)}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-slate-700">
                      <div className="font-medium text-slate-900 truncate max-w-xs">
                        {insp.projectName}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center">
                        <MapPin className="w-2.5 h-2.5 mr-1" />
                        {insp.siteZone}
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">
                        {insp.inspectorName}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {translateRole(insp.inspectorRole)}
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <div
                        className={`font-mono font-bold text-xs tabular-nums ${
                          insp.scorePercent >= 90
                            ? 'text-emerald-600'
                            : insp.scorePercent >= 75
                            ? 'text-amber-600'
                            : 'text-rose-600'
                        }`}
                      >
                        {insp.scorePercent}%
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {insp.passedCount}P / {insp.failedCount}F
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          insp.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : insp.status === 'under_review'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : insp.status === 'rejected'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-slate-50 text-slate-600 border border-slate-200'
                        }`}
                      >
                        {translateStatus(insp.status)}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center space-x-1">
                        <button
                          onClick={() => onReviewInspection(insp)}
                          className="px-2 py-1 rounded-md border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center transition-colors"
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          {t.inspections.reviewBtn}
                        </button>
                        <button
                          onClick={() => {
                            const templates = getStoredTemplates();
                            const matching = templates.find((tpl) => tpl.id === insp.templateId);
                            exportFilledInspectionPdf({
                              inspection: insp,
                              template: matching,
                              lang,
                            });
                          }}
                          className="px-2 py-1 rounded-md border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center transition-colors whitespace-nowrap"
                          title={t.inspections.exportPdfBtn}
                        >
                          <Printer className="w-3 h-3 mr-1 text-blue-600" />
                          {t.inspections.exportPdfBtn}
                        </button>
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                t.inspections.deleteConfirm.replace(
                                  '{id}',
                                  insp.id
                                )
                              )
                            ) {
                              onDeleteInspection(insp.id);
                            }
                          }}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title={t.common.delete}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
