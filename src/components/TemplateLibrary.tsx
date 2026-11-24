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
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Filter templates
  const filteredTemplates = templates.filter((tpl) => {
    const matchesCategory = selectedCategory === 'All' || tpl.category === selectedCategory;
    const matchesSearch =
      tpl.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const selectedTemplate =
    templates.find((t) => t.id === selectedTemplateId) ||
    filteredTemplates[0] ||
    templates[0] ||
    null;

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
    <div className="h-full flex flex-col space-y-2 overflow-hidden">
      {/* =========================================================================
          TOP UNIFIED TOOLBAR: Title, Search, Category Dropdown & Actions (~44px)
          ========================================================================= */}
      <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-[#d4f038] flex items-center justify-center font-bold font-mono text-xs shrink-0">
            TPL
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                {t.library.title}
              </h1>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 font-semibold text-slate-600">
                {templates.length} Protocol
              </span>
            </div>
            <p className="text-[10px] text-slate-400 hidden xl:block">
              {t.library.subtitle}
            </p>
          </div>
        </div>

        {/* Search & Category Filter */}
        <div className="flex items-center space-x-2 flex-wrap">
          <div className="relative w-40 sm:w-52">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={t.library.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 text-xs border border-slate-200 rounded-md bg-white text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as any)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 font-medium focus:outline-hidden focus:ring-1 focus:ring-amber-500"
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {translateCategory(cat)} (
                {cat === 'All'
                  ? templates.length
                  : templates.filter((tpl) => tpl.category === cat).length}
                )
              </option>
            ))}
          </select>

          {/* Action Buttons */}
          <div className="flex items-center space-x-1.5">
            <button
              onClick={onOpenOcr}
              className="p-1 sm:px-2.5 sm:py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors flex items-center shadow-2xs whitespace-nowrap"
              title="Scan kertas checklist fisik (OCR)"
            >
              <ScanText className="w-3.5 h-3.5 sm:mr-1 text-blue-600" />
              <span className="hidden sm:inline">OCR</span>
            </button>
            <button
              onClick={onOpenAIGenerator}
              className="p-1 sm:px-2.5 sm:py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors flex items-center shadow-2xs whitespace-nowrap"
              title={t.library.generateWithAI}
            >
              <Wand2 className="w-3.5 h-3.5 sm:mr-1 text-amber-400" />
              <span className="hidden sm:inline">AI Gen</span>
            </button>
            <button
              onClick={onCreateNew}
              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-2xs whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>+ Template</span>
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          MAIN WORKSPACE: Split Catalog & Inspector Panel (100% Locked Height)
          ========================================================================= */}
      <div className="flex-1 min-h-0 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col lg:flex-row overflow-hidden">
        {/* Left Catalog Pane (40%) */}
        <div className="w-full lg:w-[40%] xl:w-[38%] border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col min-h-0 h-full bg-white">
          <div className="p-2 border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 flex items-center justify-between shrink-0">
            <span>DAFTAR TEMPLATE ({filteredTemplates.length})</span>
            <div className="flex items-center space-x-2 text-[10px]">
              {onImportTemplates && (
                <label className="text-blue-600 hover:underline cursor-pointer flex items-center">
                  <Upload className="w-3 h-3 mr-0.5" />
                  Impor Pack
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={handleImportPackFile}
                  />
                </label>
              )}
              <span>•</span>
              <button
                onClick={handleExportPackJson}
                className="text-slate-600 hover:underline flex items-center"
              >
                <Download className="w-3 h-3 mr-0.5" />
                Ekspor Pack
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 p-1.5 font-sans">
            {filteredTemplates.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                Tidak ada template yang cocok.
              </div>
            ) : (
              filteredTemplates.map((tpl) => {
                const isSelected = selectedTemplate?.id === tpl.id;
                const totalFields = tpl.sections.reduce((acc, s) => acc + s.fields.length, 0);

                return (
                  <div
                    key={tpl.id}
                    onClick={() => setSelectedTemplateId(tpl.id)}
                    className={`p-2.5 rounded-lg cursor-pointer transition-all flex items-start justify-between gap-2 ${isSelected
                      ? 'bg-amber-50/80 border border-amber-300 shadow-2xs'
                      : 'hover:bg-slate-50 border border-transparent'
                      }`}
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center space-x-1.5 text-[10px] text-slate-500">
                        <span className="font-semibold text-slate-800">
                          {translateCategory(tpl.category)}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-slate-400">v{tpl.version}</span>
                        <span>•</span>
                        <span>~{tpl.estimatedMinutes}m</span>
                      </div>
                      <h4
                        className={`text-xs font-bold leading-tight truncate ${isSelected ? 'text-slate-950 font-extrabold' : 'text-slate-800'
                          }`}
                      >
                        {tpl.title}
                      </h4>
                      <p className="text-[11px] text-slate-500 line-clamp-1">
                        {tpl.description}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <span className="font-mono text-[10px] font-semibold text-slate-600 bg-slate-100 px-1 rounded block mb-1">
                        {totalFields} cek
                      </span>
                      {tpl.requiresApproval && (
                        <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1 rounded block">
                          Review
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Inspector & Preview Pane (60%) */}
        <div className="flex-1 min-h-0 flex flex-col h-full bg-slate-50/20 overflow-hidden">
          {selectedTemplate ? (
            <>
              {/* Header Details */}
              <div className="p-3.5 border-b border-slate-200 bg-slate-50/80 shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 text-white">
                        {translateCategory(selectedTemplate.category)}
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        v{selectedTemplate.version}
                      </span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-600 flex items-center">
                        <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
                        ~{selectedTemplate.estimatedMinutes} {t.common.minutes}
                      </span>
                      {selectedTemplate.requiresApproval ? (
                        <span className="text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.2 rounded">
                          Wajib Verifikasi {translateRole(selectedTemplate.approvalRole || 'qaqc_lead')}
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.2 rounded">
                          Direct Sign-off
                        </span>
                      )}
                    </div>

                    <h2 className="text-base font-bold text-slate-900 leading-snug">
                      {selectedTemplate.title}
                    </h2>
                    <p className="text-xs text-slate-600">
                      {selectedTemplate.description}
                    </p>
                  </div>

                  {/* Top Action Buttons */}
                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      onClick={() => onExecute(selectedTemplate)}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-[#d4f038] text-xs font-bold flex items-center shadow-xs transition-colors cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 mr-1 fill-current text-[#d4f038]" />
                      <span>{t.library.performBtn}</span>
                    </button>
                  </div>
                </div>

                {/* Sub Action Strip */}
                <div className="mt-3 pt-2 border-t border-slate-200/80 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-1 text-slate-600">
                    <button
                      onClick={() => onEdit(selectedTemplate)}
                      className="px-2 py-1 rounded hover:bg-slate-200 flex items-center space-x-1 text-slate-700 font-semibold transition-colors"
                      title={t.library.editSchemaTitle}
                    >
                      <Edit3 className="w-3.5 h-3.5 text-amber-600" />
                      <span>Edit Skema</span>
                    </button>
                    <button
                      onClick={() => exportBlankChecklistPdf({ template: selectedTemplate, lang })}
                      className="px-2 py-1 rounded hover:bg-blue-100 text-blue-800 flex items-center space-x-1 font-semibold transition-colors"
                      title="Cetak lembar fisik format PDF untuk inspeksi offline"
                    >
                      <Printer className="w-3.5 h-3.5 text-blue-600" />
                      <span>Cetak Lembar Fisik</span>
                    </button>
                    <button
                      onClick={() => onDuplicate(selectedTemplate.id)}
                      className="px-2 py-1 rounded hover:bg-slate-200 flex items-center space-x-1 text-slate-600 transition-colors"
                      title={t.library.duplicateTitle}
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Duplikasi</span>
                    </button>
                    <button
                      onClick={() => handleExportJson(selectedTemplate)}
                      className="px-2 py-1 rounded hover:bg-slate-200 flex items-center space-x-1 text-slate-600 transition-colors"
                      title={t.library.exportJsonTitle}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>JSON</span>
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      if (confirm(t.library.deleteConfirm.replace('{title}', selectedTemplate.title))) {
                        onDelete(selectedTemplate.id);
                      }
                    }}
                    className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    title={t.common.delete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Sections & Schema Item Breakdown (Scrollable internal) */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 font-sans">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>
                    Struktur Bagian Form ({selectedTemplate.sections.length} Seksi ·{' '}
                    {selectedTemplate.sections.reduce((acc, s) => acc + s.fields.length, 0)} Poin Uji)
                  </span>
                  {selectedTemplate.tags.length > 0 && (
                    <div className="flex items-center space-x-1">
                      {selectedTemplate.tags.map((tag) => (
                        <span key={tag} className="px-1.5 py-0.2 rounded bg-slate-100 text-[10px] text-slate-600 font-mono">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  {selectedTemplate.sections.map((section, sIdx) => (
                    <div
                      key={section.id}
                      className="p-2.5 rounded-lg border border-slate-200 bg-white space-y-1.5 shadow-2xs"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-slate-900">
                          {sIdx + 1}. {section.title}
                        </h4>
                        <span className="text-[10px] font-mono text-slate-400">
                          {section.fields.length} checklist items
                        </span>
                      </div>
                      {section.description && (
                        <p className="text-[11px] text-slate-500">{section.description}</p>
                      )}
                      <div className="divide-y divide-slate-100 pt-1">
                        {section.fields.map((field, fIdx) => (
                          <div key={field.id} className="py-1 flex items-center justify-between text-xs text-slate-700">
                            <span className="truncate pr-2">
                              {sIdx + 1}.{fIdx + 1} {field.label}
                            </span>
                            <span className="text-[10px] font-mono uppercase text-slate-400 shrink-0">
                              {field.type}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400 text-xs">
              Pilih salah satu template di sebelah kiri untuk melihat rincian skema inspeksi.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
