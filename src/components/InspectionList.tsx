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
    <div className="space-y-6">
      {/* Page Title & Quick Action */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.inspections.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t.inspections.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" />
            {t.inspections.exportCsv}
          </button>
          <button
            onClick={onLaunchInspection}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs"
          >
            {t.inspections.newInspection}
          </button>
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          {/* Search */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t.inspections.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Project dropdown filter */}
          <div className="w-full md:w-auto flex items-center gap-2">
            <span className="text-xs text-slate-500 shrink-0">
              {t.inspections.projectSiteLabel}
            </span>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-full md:w-56 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="all">
                {t.inspections.allProjects.replace(
                  '{count}',
                  String(projects.length)
                )}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status segmented filters */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          {(['all', 'under_review', 'approved', 'rejected'] as const).map(
            (st) => {
              const count =
                st === 'all'
                  ? inspections.length
                  : inspections.filter((i) => i.status === st).length;
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    statusFilter === st
                      ? 'bg-slate-900 text-white font-semibold shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                  }`}
                >
                  {st === 'all'
                    ? t.inspections.allStatuses
                    : translateStatus(st)}{' '}
                  ({count})
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Table Container */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-800">
              {t.inspections.noMatchTitle}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {t.inspections.noMatchSub}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">{t.inspections.colId}</th>
                  <th className="py-3.5 px-4">{t.inspections.colProtocol}</th>
                  <th className="py-3.5 px-4">{t.inspections.colProject}</th>
                  <th className="py-3.5 px-4">{t.inspections.colInspector}</th>
                  <th className="py-3.5 px-4">{t.inspections.colScore}</th>
                  <th className="py-3.5 px-4">{t.inspections.colStatus}</th>
                  <th className="py-3.5 px-4 text-right">
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
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      #{insp.id}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 max-w-xs truncate">
                        {insp.templateTitle}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {translateCategory(insp.category)}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-slate-700">
                      <div className="font-medium text-slate-900 truncate max-w-xs">
                        {insp.projectName}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center">
                        <MapPin className="w-3 h-3 mr-1" />
                        {insp.siteZone}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">
                        {insp.inspectorName}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {translateRole(insp.inspectorRole)}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div
                        className={`font-mono font-bold text-sm tabular-nums ${
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

                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex text-[11px] font-bold uppercase tracking-wider ${
                          insp.status === 'approved'
                            ? 'text-emerald-700'
                            : insp.status === 'under_review'
                            ? 'text-amber-700'
                            : insp.status === 'rejected'
                            ? 'text-rose-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {translateStatus(insp.status)}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center space-x-1">
                        <button
                          onClick={() => onReviewInspection(insp)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" />
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
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center transition-colors whitespace-nowrap"
                          title={t.inspections.exportPdfBtn}
                        >
                          <Printer className="w-3.5 h-3.5 mr-1 text-blue-600" />
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
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
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
