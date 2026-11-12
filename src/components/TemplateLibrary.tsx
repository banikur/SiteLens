import React, { useState } from 'react';
import {
  Plus,
  Search,
  Filter,
  Play,
  Copy,
  Edit3,
  Trash2,
  Download,
  Clock,
  Wand2,
  Printer,
  ScanText,
  Upload,
} from 'lucide-react';
import { ChecklistTemplate, ChecklistCategory } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { exportBlankChecklistPdf } from '../utils/pdfGenerator';

interface TemplateLibraryProps {
  templates: ChecklistTemplate[];
  onExecute: (template: ChecklistTemplate) => void;
  onEdit: (template: ChecklistTemplate) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  onOpenAIGenerator: () => void;
  onOpenOcr: () => void;
  onImportTemplates?: (templates: ChecklistTemplate[]) => Promise<void> | void;
}

const CATEGORIES: ('All' | ChecklistCategory)[] = [
  'All',
  'Safety & HSE',
  'Civil & Structural',
  'Heavy Equipment',
  'Quality Control',
  'Environmental',
  'Site Logistics',
];

export const TemplateLibrary: React.FC<TemplateLibraryProps> = ({
  templates,
  onExecute,
  onEdit,
  onDuplicate,
  onDelete,
  onCreateNew,
  onOpenAIGenerator,
  onOpenOcr,
  onImportTemplates,
}) => {
  const { lang, t, translateCategory, translateRole } = useLanguage();
  const [selectedCategory, setSelectedCategory] = useState<'All' | ChecklistCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter templates
  const filteredTemplates = templates.filter((tpl) => {
    const matchesCategory = selectedCategory === 'All' || tpl.category === selectedCategory;
    const matchesSearch =
      tpl.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const handleExportJson = (tpl: ChecklistTemplate) => {
    const dataStr =
      'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(tpl, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `${tpl.title.toLowerCase().replace(/\s+/g, '_')}_schema.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleExportPackJson = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify({ templates }, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'sitelens_template_pack.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportPackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onImportTemplates) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list: ChecklistTemplate[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.templates)
        ? parsed.templates
        : parsed?.title
        ? [parsed]
        : [];
      if (list.length > 0) {
        await onImportTemplates(list);
      }
    } catch {
      alert(lang === 'id' ? 'File JSON template pack tidak valid.' : 'Invalid template pack JSON file.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
            {t.library.title}
          </h1>
          <p className="text-xs text-slate-500 mt-1">{t.library.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onImportTemplates && (
            <label className="px-3 py-2.5 rounded-lg bg-white border border-slate-300 hover:border-slate-400 text-slate-700 text-xs font-semibold transition-colors flex items-center cursor-pointer shadow-xs whitespace-nowrap">
              <Upload className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
              {lang === 'id' ? 'Impor Pack' : 'Import Pack'}
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportPackFile}
              />
            </label>
          )}
          <button
            onClick={handleExportPackJson}
            className="px-3 py-2.5 rounded-lg bg-white border border-slate-300 hover:border-slate-400 text-slate-700 text-xs font-semibold transition-colors flex items-center shadow-xs whitespace-nowrap"
            title="Export all templates as JSON pack"
          >
            <Download className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
            {lang === 'id' ? 'Ekspor Pack' : 'Export Pack'}
          </button>
          <button
            onClick={onOpenOcr}
            className="px-3.5 py-2.5 rounded-lg bg-white border border-slate-300 hover:border-slate-400 text-slate-800 text-xs font-bold transition-colors flex items-center shadow-xs whitespace-nowrap"
            title="Scan paper checklist via local browser OCR"
          >
            <ScanText className="w-3.5 h-3.5 mr-1.5 text-blue-600" />
            {t.library.scanOcrBtn}
          </button>
          <button
            onClick={onOpenAIGenerator}
            className="px-3.5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors flex items-center shadow-xs whitespace-nowrap"
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
            {t.library.generateWithAI}
          </button>
          <button
            onClick={onCreateNew}
            className="px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs whitespace-nowrap"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {t.library.createTemplate}
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
          {/* Search box */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t.library.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div className="text-xs text-slate-500">
            {t.library.showingCount
              .replace('{filtered}', String(filteredTemplates.length))
              .replace('{total}', String(templates.length))}
          </div>
        </div>

        {/* Segmented Category Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
          {CATEGORIES.map((cat) => {
            const count =
              cat === 'All'
                ? templates.length
                : templates.filter((tpl) => tpl.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white font-semibold shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {translateCategory(cat)} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Template Cards Grid */}
      {filteredTemplates.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Filter className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-800">{t.library.noTemplatesTitle}</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {t.library.noTemplatesSub}
          </p>
          <button
            onClick={() => {
              setSelectedCategory('All');
              setSearchQuery('');
            }}
            className="mt-4 px-3.5 py-2 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
          >
            {t.library.resetFilters}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredTemplates.map((tpl) => {
            const totalFields = tpl.sections.reduce((acc, s) => acc + s.fields.length, 0);

            return (
              <div
                key={tpl.id}
                className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between hover:border-slate-300 transition-all shadow-xs"
              >
                <div>
                  {/* Category & Version Metadata */}
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                    <span className="font-semibold text-slate-800">
                      {translateCategory(tpl.category)}
                    </span>
                    <span className="font-mono text-slate-400">v{tpl.version}</span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 leading-snug">
                    {tpl.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-2 line-clamp-3 leading-relaxed">
                    {tpl.description}
                  </p>

                  {/* Template Meta Metrics */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        ~{tpl.estimatedMinutes} {t.common.minutes}
                      </span>
                    </div>
                    <div>
                      <span className="font-mono text-slate-800 font-semibold">
                        {tpl.sections.length}
                      </span>{' '}
                      {t.common.sections} ·{' '}
                      <span className="font-mono text-slate-800 font-semibold">
                        {totalFields}
                      </span>{' '}
                      {t.common.checks}
                    </div>
                  </div>

                  {/* Governance requirements */}
                  <div className="mt-2 text-[11px] text-slate-500">
                    {tpl.requiresApproval ? (
                      <span className="text-amber-700 font-medium">
                        {t.library.verificationRequiredBy.replace(
                          '{role}',
                          translateRole(tpl.approvalRole || 'Site Engineer')
                        )}
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-medium">
                        {t.library.directSignoff}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom Action Footer */}
                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => onEdit(tpl)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                      title={t.library.editSchemaTitle}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDuplicate(tpl.id)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                      title={t.library.duplicateTitle}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleExportJson(tpl)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                      title={t.library.exportJsonTitle}
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => exportBlankChecklistPdf({ template: tpl, lang })}
                      className="p-1.5 rounded-lg text-slate-600 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                      title={t.library.exportBlankPdfTitle}
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (
                          confirm(
                            t.library.deleteConfirm.replace('{title}', tpl.title)
                          )
                        ) {
                          onDelete(tpl.id);
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      title={t.common.delete}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => exportBlankChecklistPdf({ template: tpl, lang })}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center transition-colors whitespace-nowrap"
                      title={t.library.exportBlankPdfTitle}
                    >
                      <Printer className="w-3.5 h-3.5 mr-1 text-blue-600" />
                      {t.library.exportPdfBtn}
                    </button>
                    <button
                      onClick={() => onExecute(tpl)}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center transition-colors whitespace-nowrap"
                    >
                      <Play className="w-3 h-3 mr-1 fill-current text-amber-400" />
                      {t.library.performBtn}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
