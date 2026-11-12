import React, { useState, useEffect } from 'react';
import {
  Save,
  Eye,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Layers,
  Smartphone,
  Monitor,
  Download,
  Wand2,
  Printer,
} from 'lucide-react';
import {
  ChecklistTemplate,
  ChecklistSection,
  ChecklistField,
  FieldType,
  ChecklistCategory,
  UserRole,
} from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { exportBlankChecklistPdf } from '../utils/pdfGenerator';

interface ChecklistBuilderProps {
  initialTemplate?: ChecklistTemplate | null;
  onSave: (template: ChecklistTemplate) => void;
  onCancel: () => void;
  onOpenAIGenerator: () => void;
  currentUser: { name: string; role: UserRole };
}

interface PaletteItem {
  type: FieldType;
  labelEn: string;
  labelId: string;
  iconText: string;
  categoryEn: 'Compliance' | 'Inputs' | 'Evidence & Sign-off' | 'Information';
  categoryId: 'Kepatuhan' | 'Input Data' | 'Bukti & Pengesahan' | 'Informasi';
  descEn: string;
  descId: string;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: 'pass_fail',
    labelEn: 'Pass / Fail / N/A',
    labelId: 'Lulus / Gagal / N/A',
    iconText: 'P/F',
    categoryEn: 'Compliance',
    categoryId: 'Kepatuhan',
    descEn: 'Core compliance verification with color toggles',
    descId: 'Verifikasi kepatuhan utama dengan tombol status',
  },
  {
    type: 'yes_no',
    labelEn: 'Yes / No Binary',
    labelId: 'Ya / Tidak Biner',
    iconText: 'Y/N',
    categoryEn: 'Compliance',
    categoryId: 'Kepatuhan',
    descEn: 'Binary affirmative/negative checkpoint',
    descId: 'Poin pemeriksaan biner ya atau tidak',
  },
  {
    type: 'status_select',
    labelEn: 'Multi-Status Tier',
    labelId: 'Tingkat Status',
    iconText: 'Tier',
    categoryEn: 'Compliance',
    categoryId: 'Kepatuhan',
    descEn: 'Normal / Caution / Critical or custom state',
    descId: 'Normal / Perhatian / Kritis atau opsi kustom',
  },
  {
    type: 'number',
    labelEn: 'Numeric Reading',
    labelId: 'Angka & Satuan Ukur',
    iconText: '123',
    categoryEn: 'Inputs',
    categoryId: 'Input Data',
    descEn: 'Measured values with unit (psi, mm, °C, kN)',
    descId: 'Nilai terukur dengan satuan (psi, mm, °C, kN)',
  },
  {
    type: 'short_text',
    labelEn: 'Single-line Text',
    labelId: 'Teks Singkat',
    iconText: 'Aa',
    categoryEn: 'Inputs',
    categoryId: 'Input Data',
    descEn: 'Serial numbers, tags, brief identifiers',
    descId: 'Nomor seri, kode tag, identifikasi singkat',
  },
  {
    type: 'long_text',
    labelEn: 'Multi-line Notes',
    labelId: 'Catatan Detail',
    iconText: '¶',
    categoryEn: 'Inputs',
    categoryId: 'Input Data',
    descEn: 'Observations, deficiency memos, findings',
    descId: 'Catatan observasi, memo temuan, arahan teknis',
  },
  {
    type: 'dropdown',
    labelEn: 'Dropdown Select',
    labelId: 'Pilihan Dropdown',
    iconText: '▼',
    categoryEn: 'Inputs',
    categoryId: 'Input Data',
    descEn: 'Select single choice from custom list',
    descId: 'Pilih satu opsi dari daftar kustom',
  },
  {
    type: 'date',
    labelEn: 'Calendar Date',
    labelId: 'Tanggal Kalender',
    iconText: 'Cal',
    categoryEn: 'Inputs',
    categoryId: 'Input Data',
    descEn: 'Calibration expiry, pour date, permit validity',
    descId: 'Masa berlaku kalibrasi, tanggal cor, izin kerja',
  },
  {
    type: 'time',
    labelEn: 'Clock Time',
    labelId: 'Waktu / Jam',
    iconText: 'Hr',
    categoryEn: 'Inputs',
    categoryId: 'Input Data',
    descEn: 'Shift start, pour duration, inspection timestamp',
    descId: 'Mulai shift, durasi pengecoran, jam inspeksi',
  },
  {
    type: 'photo',
    labelEn: 'Photo Evidence',
    labelId: 'Foto Bukti Lapangan',
    iconText: 'Pic',
    categoryEn: 'Evidence & Sign-off',
    categoryId: 'Bukti & Pengesahan',
    descEn: 'On-site camera upload with caption stamp',
    descId: 'Unggah foto kamera lapangan dengan keterangan',
  },
  {
    type: 'signature',
    labelEn: 'Digital Signature',
    labelId: 'Tanda Tangan Digital',
    iconText: 'Sig',
    categoryEn: 'Evidence & Sign-off',
    categoryId: 'Bukti & Pengesahan',
    descEn: 'Inspector digital authentication sign-off',
    descId: 'Otentikasi tanda tangan digital inspektur',
  },
  {
    type: 'instruction',
    labelEn: 'Guidance Standard',
    labelId: 'Panduan & Instruksi SOP',
    iconText: 'Ref',
    categoryEn: 'Information',
    categoryId: 'Informasi',
    descEn: 'Safety notice, SOP instructions, code citation',
    descId: 'Peringatan K3, instruksi SOP, referensi standar',
  },
];

export const ChecklistBuilder: React.FC<ChecklistBuilderProps> = ({
  initialTemplate,
  onSave,
  onCancel,
  onOpenAIGenerator,
  currentUser,
}) => {
  const { lang, t, translateCategory, translateRole } = useLanguage();

  const buildDefaultTemplate = (): ChecklistTemplate => ({
    id: `tmpl-${Date.now()}`,
    title:
      lang === 'id'
        ? 'Protokol Verifikasi Lapangan Kustom'
        : 'Custom Site Verification Protocol',
    category: 'Civil & Structural',
    description:
      lang === 'id'
        ? 'Tentukan tahapan inspeksi kustom, kriteria penerimaan, dan titik pengumpulan bukti.'
        : 'Define customized inspection steps, acceptance criteria, and evidence checkpoints.',
    version: '1.0',
    estimatedMinutes: 20,
    requiresApproval: true,
    approvalRole: 'Site Engineer',
    targetRole: 'QC Inspector',
    tags: ['Civil', 'Inspection', 'Standard'],
    createdAt: new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString().split('T')[0],
    authorName: currentUser.name,
    authorRole: currentUser.role,
    sections: [
      {
        id: `sec-${Date.now()}`,
        title:
          lang === 'id'
            ? 'Bagian 1: Inspeksi Struktural Utama'
            : 'Section 1: Primary Structural Inspection',
        description:
          lang === 'id'
            ? 'Verifikasi fisik komponen awal & batas area kerja.'
            : 'Initial physical component & boundary verification.',
        fields: [
          {
            id: `fld-${Date.now()}-1`,
            type: 'instruction',
            label:
              lang === 'id'
                ? 'Pastikan tangga akses aman dan sistem penahan jatuh telah diperiksa sebelum naik.'
                : 'Verify that safe access ladders and fall arrest systems are inspected before climbing.',
            required: false,
            helpStandard: 'OSHA 1926.1053',
          },
          {
            id: `fld-${Date.now()}-2`,
            type: 'pass_fail',
            label:
              lang === 'id'
                ? 'Kelurusan Bekisting & Shoring Perimeter'
                : 'Perimeter Shoring & Formwork Alignment',
            description:
              lang === 'id'
                ? 'Periksa ketegaklurusan (plumb line) dan tie rod lateral terhadap titik survei.'
                : 'Check plumb line and lateral tie rods against survey datum.',
            required: true,
            helpStandard: 'ACI 347R-14',
          },
          {
            id: `fld-${Date.now()}-3`,
            type: 'photo',
            label:
              lang === 'id'
                ? 'Foto Bukti Ketidaksesuaian'
                : 'Deficiency Evidence Photo',
            description:
              lang === 'id'
                ? 'Ambil bukti foto jika kelurusan atau lendutan melebihi batas.'
                : 'Capture photographic evidence if alignment or deflection fails.',
            required: false,
            condition: {
              dependsOnFieldId: `fld-${Date.now()}-2`,
              operator: 'equals',
              value: 'fail',
            },
          },
        ],
      },
    ],
  });

  const [template, setTemplate] = useState<ChecklistTemplate>(() => {
    if (initialTemplate) return JSON.parse(JSON.stringify(initialTemplate));
    return buildDefaultTemplate();
  });

  const [previewMode, setPreviewMode] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [activeSectionId, setActiveSectionId] = useState<string>(
    template.sections[0]?.id || ''
  );
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  // Sync if initialTemplate changes (e.g., when AI Generator opens generated template into Builder)
  useEffect(() => {
    if (initialTemplate) {
      const cloned: ChecklistTemplate = JSON.parse(JSON.stringify(initialTemplate));
      setTemplate(cloned);
      setActiveSectionId(cloned.sections[0]?.id || '');
      setSelectedFieldId(null);
      setPreviewMode(false);
    }
  }, [initialTemplate]);

  // Simulation test state for preview mode
  const [simAnswers, setSimAnswers] = useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = useState<'content' | 'settings'>('content');

  // Add Section
  const handleAddSection = () => {
    const newSection: ChecklistSection = {
      id: `sec-${Date.now()}`,
      title:
        lang === 'id'
          ? `Bagian ${template.sections.length + 1}: Verifikasi Umum`
          : `Section ${template.sections.length + 1}: General Verifications`,
      description:
        lang === 'id'
          ? 'Tambahkan instruksi dan persyaratan untuk bagian ini.'
          : 'Add instructions and requirements for this section.',
      fields: [],
    };
    setTemplate({
      ...template,
      sections: [...template.sections, newSection],
    });
    setActiveSectionId(newSection.id);
  };

  // Delete Section
  const handleDeleteSection = (secId: string) => {
    if (template.sections.length <= 1) {
      alert(t.builder.minOneSectionAlert);
      return;
    }
    const filtered = template.sections.filter((s) => s.id !== secId);
    setTemplate({ ...template, sections: filtered });
    setActiveSectionId(filtered[0].id);
  };

  // Add Field to Active Section
  const handleAddField = (secId: string, type: FieldType) => {
    const newField: ChecklistField = {
      id: `fld-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type,
      label:
        type === 'instruction'
          ? lang === 'id'
            ? 'Protokol keselamatan wajib atau instruksi standar operasional...'
            : 'Mandatory safety protocol or standard operating instruction...'
          : lang === 'id'
          ? `Poin Verifikasi ${type.replace('_', ' ').toUpperCase()} Baru`
          : `New ${type.replace('_', ' ').toUpperCase()} Verification Point`,
      description: '',
      required: type !== 'instruction',
      options:
        type === 'dropdown'
          ? lang === 'id'
            ? ['Opsi A', 'Opsi B', 'Opsi C']
            : ['Option A', 'Option B', 'Option C']
          : type === 'status_select'
          ? lang === 'id'
            ? ['Normal', 'Perhatian', 'Kritis']
            : ['Normal', 'Caution', 'Critical']
          : undefined,
      unit: type === 'number' ? 'psi' : undefined,
    };

    const updatedSections = template.sections.map((sec) => {
      if (sec.id === secId) {
        return { ...sec, fields: [...sec.fields, newField] };
      }
      return sec;
    });

    setTemplate({ ...template, sections: updatedSections });
    setSelectedFieldId(newField.id);
  };

  // Move Field Up/Down
  const handleMoveField = (
    secId: string,
    fieldIndex: number,
    direction: 'up' | 'down'
  ) => {
    const updatedSections = template.sections.map((sec) => {
      if (sec.id !== secId) return sec;
      const targetIndex = direction === 'up' ? fieldIndex - 1 : fieldIndex + 1;
      if (targetIndex < 0 || targetIndex >= sec.fields.length) return sec;
      const newFields = [...sec.fields];
      const temp = newFields[fieldIndex];
      newFields[fieldIndex] = newFields[targetIndex];
      newFields[targetIndex] = temp;
      return { ...sec, fields: newFields };
    });
    setTemplate({ ...template, sections: updatedSections });
  };

  // Duplicate Field
  const handleDuplicateField = (secId: string, fieldId: string) => {
    const updatedSections = template.sections.map((sec) => {
      if (sec.id !== secId) return sec;
      const index = sec.fields.findIndex((f) => f.id === fieldId);
      if (index === -1) return sec;
      const original = sec.fields[index];
      const copy: ChecklistField = {
        ...JSON.parse(JSON.stringify(original)),
        id: `fld-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        label: `${original.label} (Copy)`,
      };
      const newFields = [...sec.fields];
      newFields.splice(index + 1, 0, copy);
      return { ...sec, fields: newFields };
    });
    setTemplate({ ...template, sections: updatedSections });
  };

  // Delete Field
  const handleDeleteField = (secId: string, fieldId: string) => {
    const updatedSections = template.sections.map((sec) => {
      if (sec.id !== secId) return sec;
      return { ...sec, fields: sec.fields.filter((f) => f.id !== fieldId) };
    });
    setTemplate({ ...template, sections: updatedSections });
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  };

  // Update Field
  const handleUpdateField = (
    secId: string,
    fieldId: string,
    updates: Partial<ChecklistField>
  ) => {
    const updatedSections = template.sections.map((sec) => {
      if (sec.id !== secId) return sec;
      return {
        ...sec,
        fields: sec.fields.map((f) =>
          f.id === fieldId ? { ...f, ...updates } : f
        ),
      };
    });
    setTemplate({ ...template, sections: updatedSections });
  };

  // Save Validation
  const handleSave = () => {
    if (!template.title.trim()) {
      alert(t.builder.enterTitleAlert);
      return;
    }
    const totalFields = template.sections.reduce(
      (acc, s) => acc + s.fields.length,
      0
    );
    if (totalFields === 0) {
      alert(t.builder.minOneFieldAlert);
      return;
    }
    onSave({
      ...template,
      updatedAt: new Date().toISOString().split('T')[0],
    });
  };

  // Export JSON schema
  const handleExportJson = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(template, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `${template.title.toLowerCase().replace(/\s+/g, '_')}_schema.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const currentSection =
    template.sections.find((s) => s.id === activeSectionId) ||
    template.sections[0];

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col min-h-[750px]">
      {/* Top Builder Control Header */}
      <div className="border-b border-slate-200 px-6 py-4 bg-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <span>{t.builder.headerKicker}</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-slate-700">
              {translateCategory(template.category)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">v{template.version}</span>
          </div>
          <input
            type="text"
            value={template.title}
            onChange={(e) =>
              setTemplate({ ...template, title: e.target.value })
            }
            className="text-lg md:text-xl font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-amber-500 focus:outline-none transition-colors w-full"
            placeholder={t.builder.titlePlaceholder}
          />
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenAIGenerator}
            className="px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white transition-colors flex items-center whitespace-nowrap"
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
            {t.builder.generateWithAI}
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode(!previewMode)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center transition-colors border whitespace-nowrap ${
              previewMode
                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Eye className="w-3.5 h-3.5 mr-1.5" />
            {previewMode
              ? t.builder.exitPreview
              : t.builder.interactivePreview}
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="p-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
            title={t.builder.exportJsonTitle}
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => exportBlankChecklistPdf({ template, lang })}
            className="p-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 hover:text-blue-700 transition-colors"
            title={lang === 'id' ? 'Cetak Blanko Kosong (PDF)' : 'Export Blank Sheet (PDF)'}
          >
            <Printer className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {t.builder.saveTemplate}
          </button>
        </div>
      </div>

      {previewMode ? (
        /* INTERACTIVE SIMULATION PREVIEW */
        <div className="p-6 md:p-8 bg-slate-100 flex-1 overflow-y-auto">
          {/* Viewport switch toolbar */}
          <div className="max-w-3xl mx-auto mb-6 flex items-center justify-between">
            <div className="text-xs text-slate-600 flex items-center gap-2">
              <span className="font-semibold text-slate-900">
                {t.builder.simModeTitle}
              </span>
              <span aria-hidden="true">·</span>
              <span>{t.builder.simModeSub}</span>
            </div>
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
              <button
                onClick={() => setPreviewViewport('desktop')}
                className={`p-1.5 rounded text-xs font-medium flex items-center transition-colors ${
                  previewViewport === 'desktop'
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Monitor className="w-4 h-4 mr-1" />
                {t.builder.desktop}
              </button>
              <button
                onClick={() => setPreviewViewport('mobile')}
                className={`p-1.5 rounded text-xs font-medium flex items-center transition-colors ${
                  previewViewport === 'mobile'
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Smartphone className="w-4 h-4 mr-1" />
                {t.builder.mobile}
              </button>
            </div>
          </div>

          {/* Canvas Box */}
          <div
            className={`mx-auto bg-white rounded-xl border border-slate-300 shadow-sm transition-all duration-300 ${
              previewViewport === 'mobile'
                ? 'max-w-sm p-4'
                : 'max-w-3xl p-6 md:p-8'
            }`}
          >
            {/* Header info */}
            <div className="border-b border-slate-200 pb-4 mb-6">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{translateCategory(template.category)}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">v{template.version}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {t.builder.targetLabel}{' '}
                  {template.targetRole
                    ? translateRole(template.targetRole)
                    : t.builder.anyInspector}
                </span>
              </div>
              <h2 className="text-lg md:text-xl font-bold text-slate-900 mt-1">
                {template.title}
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {template.description}
              </p>
            </div>

            {/* Sections */}
            <div className="space-y-6">
              {template.sections.map((section, sIdx) => (
                <div
                  key={section.id}
                  className="border border-slate-200 rounded-lg overflow-hidden"
                >
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                    <h3 className="text-sm font-bold text-slate-900">
                      {sIdx + 1}. {section.title}
                    </h3>
                    {section.description && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        {section.description}
                      </p>
                    )}
                  </div>

                  <div className="p-4 space-y-4 divide-y divide-slate-100">
                    {section.fields.map((field) => {
                      if (field.condition) {
                        const parentVal =
                          simAnswers[field.condition.dependsOnFieldId];
                        const match =
                          field.condition.operator === 'equals'
                            ? parentVal === field.condition.value
                            : parentVal !== field.condition.value;
                        if (!match) return null;
                      }

                      return (
                        <div key={field.id} className="pt-4 first:pt-0">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-2">
                            <div>
                              <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                                <span>{field.label}</span>
                                {field.required && (
                                  <span className="text-rose-500">*</span>
                                )}
                              </div>
                              {field.description && (
                                <p className="text-xs text-slate-500 mt-0.5">
                                  {field.description}
                                </p>
                              )}
                              {field.helpStandard && (
                                <span className="inline-block text-[10px] font-mono text-slate-400 mt-0.5">
                                  {t.builder.standardLabel} {field.helpStandard}
                                </span>
                              )}
                            </div>

                            {field.condition && (
                              <span className="text-[10px] text-amber-700 font-medium shrink-0">
                                {t.builder.conditionalTriggerActive}
                              </span>
                            )}
                          </div>

                          {field.type === 'pass_fail' && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() =>
                                  setSimAnswers({
                                    ...simAnswers,
                                    [field.id]: 'pass',
                                  })
                                }
                                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                                  simAnswers[field.id] === 'pass'
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {t.common.pass}
                              </button>
                              <button
                                onClick={() =>
                                  setSimAnswers({
                                    ...simAnswers,
                                    [field.id]: 'fail',
                                  })
                                }
                                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                                  simAnswers[field.id] === 'fail'
                                    ? 'bg-rose-600 text-white border-rose-600'
                                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {t.common.fail}
                              </button>
                              <button
                                onClick={() =>
                                  setSimAnswers({
                                    ...simAnswers,
                                    [field.id]: 'na',
                                  })
                                }
                                className={`px-3 py-1.5 rounded text-xs font-semibold border transition-colors ${
                                  simAnswers[field.id] === 'na'
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {t.common.na}
                              </button>
                            </div>
                          )}

                          {field.type === 'yes_no' && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() =>
                                  setSimAnswers({
                                    ...simAnswers,
                                    [field.id]: 'yes',
                                  })
                                }
                                className={`px-4 py-1.5 rounded text-xs font-semibold border transition-colors ${
                                  simAnswers[field.id] === 'yes'
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {t.common.yes}
                              </button>
                              <button
                                onClick={() =>
                                  setSimAnswers({
                                    ...simAnswers,
                                    [field.id]: 'no',
                                  })
                                }
                                className={`px-4 py-1.5 rounded text-xs font-semibold border transition-colors ${
                                  simAnswers[field.id] === 'no'
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {t.common.no}
                              </button>
                            </div>
                          )}

                          {field.type === 'status_select' && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {(
                                field.options || ['Normal', 'Caution', 'Critical']
                              ).map((opt) => (
                                <button
                                  key={opt}
                                  onClick={() =>
                                    setSimAnswers({
                                      ...simAnswers,
                                      [field.id]: opt,
                                    })
                                  }
                                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                                    simAnswers[field.id] === opt
                                      ? 'bg-amber-500 text-slate-950 font-semibold border-amber-500'
                                      : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}

                          {field.type === 'number' && (
                            <div className="flex items-center max-w-xs mt-2">
                              <input
                                type="number"
                                placeholder="0.00"
                                value={simAnswers[field.id] || ''}
                                onChange={(e) =>
                                  setSimAnswers({
                                    ...simAnswers,
                                    [field.id]: e.target.value,
                                  })
                                }
                                className="border border-slate-300 rounded-l-lg px-3 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                              />
                              <span className="bg-slate-100 border border-l-0 border-slate-300 text-slate-700 px-3 py-1.5 rounded-r-lg text-xs font-mono">
                                {field.unit || 'unit'}
                              </span>
                            </div>
                          )}

                          {field.type === 'short_text' && (
                            <input
                              type="text"
                              placeholder={t.builder.typeResponsePlaceholder}
                              value={simAnswers[field.id] || ''}
                              onChange={(e) =>
                                setSimAnswers({
                                  ...simAnswers,
                                  [field.id]: e.target.value,
                                })
                              }
                              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs w-full mt-2 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          )}

                          {field.type === 'long_text' && (
                            <textarea
                              rows={2}
                              placeholder={t.builder.detailedObsPlaceholder}
                              value={simAnswers[field.id] || ''}
                              onChange={(e) =>
                                setSimAnswers({
                                  ...simAnswers,
                                  [field.id]: e.target.value,
                                })
                              }
                              className="border border-slate-300 rounded-lg p-2.5 text-xs w-full mt-2 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          )}

                          {field.type === 'dropdown' && (
                            <select
                              value={simAnswers[field.id] || ''}
                              onChange={(e) =>
                                setSimAnswers({
                                  ...simAnswers,
                                  [field.id]: e.target.value,
                                })
                              }
                              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs w-full mt-2 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                            >
                              <option value="">
                                {t.builder.selectOptionPlaceholder}
                              </option>
                              {(field.options || []).map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          )}

                          {field.type === 'date' && (
                            <input
                              type="date"
                              value={simAnswers[field.id] || ''}
                              onChange={(e) =>
                                setSimAnswers({
                                  ...simAnswers,
                                  [field.id]: e.target.value,
                                })
                              }
                              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs mt-2 bg-white"
                            />
                          )}

                          {field.type === 'time' && (
                            <input
                              type="time"
                              value={simAnswers[field.id] || ''}
                              onChange={(e) =>
                                setSimAnswers({
                                  ...simAnswers,
                                  [field.id]: e.target.value,
                                })
                              }
                              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs mt-2 bg-white"
                            />
                          )}

                          {field.type === 'photo' && (
                            <div className="border border-dashed border-slate-300 rounded-lg p-4 text-center mt-2 bg-slate-50 text-xs text-slate-500">
                              {t.builder.simPhotoSlot}
                            </div>
                          )}

                          {field.type === 'signature' && (
                            <div className="border border-slate-300 rounded-lg p-3 bg-slate-50 mt-2 flex items-center justify-between">
                              <span className="text-xs text-slate-500 italic">
                                {t.builder.digitalSigPad}
                              </span>
                              <button
                                onClick={() =>
                                  setSimAnswers({
                                    ...simAnswers,
                                    [field.id]: 'Signed',
                                  })
                                }
                                className="px-3 py-1 rounded bg-slate-900 text-white text-xs font-semibold"
                              >
                                {simAnswers[field.id]
                                  ? t.builder.stamped
                                  : t.builder.clickToSign}
                              </button>
                            </div>
                          )}

                          {field.type === 'instruction' && (
                            <div className="bg-amber-50/70 border border-amber-200/80 rounded-lg p-3 text-xs text-amber-900">
                              {field.label}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* VISUAL BUILDER WORKBENCH (3-Column Layout) */
        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
          {/* Left Column: Sections & Settings Navigator (3 cols) */}
          <div className="lg:col-span-3 p-5 bg-slate-50/70 space-y-6 overflow-y-auto">
            {/* View Switch */}
            <div className="flex border border-slate-200 rounded-lg p-1 bg-white">
              <button
                onClick={() => setActiveTab('content')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  activeTab === 'content'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.builder.checklistFlowTab}
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  activeTab === 'settings'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.builder.governanceTab}
              </button>
            </div>

            {activeTab === 'content' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    {t.builder.sectionsCount.replace(
                      '{count}',
                      String(template.sections.length)
                    )}
                  </span>
                  <button
                    onClick={handleAddSection}
                    className="text-xs text-amber-600 hover:text-amber-700 font-semibold flex items-center"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {t.builder.addSection}
                  </button>
                </div>

                <div className="space-y-1.5">
                  {template.sections.map((sec, idx) => (
                    <button
                      key={sec.id}
                      onClick={() => {
                        setActiveSectionId(sec.id);
                        setSelectedFieldId(null);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors border ${
                        activeSectionId === sec.id
                          ? 'bg-white border-amber-500 shadow-xs text-slate-900 font-bold'
                          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="truncate">
                        {idx + 1}. {sec.title}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded ml-2">
                        {sec.fields.length}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    {t.builder.categoryClassification}
                  </label>
                  <select
                    value={template.category}
                    onChange={(e) =>
                      setTemplate({
                        ...template,
                        category: e.target.value as ChecklistCategory,
                      })
                    }
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {(
                      [
                        'Safety & HSE',
                        'Civil & Structural',
                        'Heavy Equipment',
                        'Quality Control',
                        'Environmental',
                        'Site Logistics',
                      ] as ChecklistCategory[]
                    ).map((cat) => (
                      <option key={cat} value={cat}>
                        {translateCategory(cat)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">
                    {t.builder.descriptionObjective}
                  </label>
                  <textarea
                    rows={3}
                    value={template.description}
                    onChange={(e) =>
                      setTemplate({ ...template, description: e.target.value })
                    }
                    className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                    placeholder={t.builder.descriptionPlaceholder}
                  />
                </div>
              </div>
            ) : (
              /* Governance & Approval Rules */
              <div className="space-y-4">
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  {t.builder.verificationSignoff}
                </div>
                <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-3">
                  <label className="flex items-start space-x-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={template.requiresApproval}
                      onChange={(e) =>
                        setTemplate({
                          ...template,
                          requiresApproval: e.target.checked,
                        })
                      }
                      className="mt-0.5 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-900 block">
                        {t.builder.requireVerification}
                      </span>
                      <span className="text-[11px] text-slate-500 block leading-tight mt-0.5">
                        {t.builder.requireVerificationSub}
                      </span>
                    </div>
                  </label>

                  {template.requiresApproval && (
                    <div className="pt-2 border-t border-slate-100">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        {t.builder.signoffRoleAuth}
                      </label>
                      <select
                        value={template.approvalRole || 'Site Engineer'}
                        onChange={(e) =>
                          setTemplate({
                            ...template,
                            approvalRole: e.target.value as UserRole,
                          })
                        }
                        className="w-full bg-white border border-slate-300 rounded text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      >
                        {(
                          [
                            'Site Engineer',
                            'HSE Officer',
                            'Site Manager',
                            'QC Inspector',
                          ] as UserRole[]
                        ).map((r) => (
                          <option key={r} value={r}>
                            {translateRole(r)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-2">
                  <label className="block text-xs font-semibold text-slate-900">
                    {t.builder.targetUserPersona}
                  </label>
                  <select
                    value={template.targetRole || 'QC Inspector'}
                    onChange={(e) =>
                      setTemplate({
                        ...template,
                        targetRole: e.target.value as UserRole,
                      })
                    }
                    className="w-full bg-white border border-slate-300 rounded text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {(
                      [
                        'Site Supervisor',
                        'Site Engineer',
                        'Equipment Operator',
                        'HSE Officer',
                        'QC Inspector',
                        'Environmental Officer',
                        'Site Manager',
                      ] as UserRole[]
                    ).map((r) => (
                      <option key={r} value={r}>
                        {translateRole(r)}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500">
                    {t.builder.targetUserPersonaSub}
                  </p>
                </div>

                <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-2">
                  <label className="block text-xs font-semibold text-slate-900">
                    {t.builder.estimatedDuration}
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      value={template.estimatedMinutes || 20}
                      onChange={(e) =>
                        setTemplate({
                          ...template,
                          estimatedMinutes: parseInt(e.target.value) || 15,
                        })
                      }
                      className="border border-slate-300 rounded px-2.5 py-1 text-xs w-20 font-mono"
                    />
                    <span className="text-xs text-slate-500">
                      {t.builder.minutesLabel}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Center Column: Section Canvas & Fields List (6 cols) */}
          <div className="lg:col-span-6 p-6 space-y-5 overflow-y-auto">
            {currentSection && (
              <div className="space-y-4">
                {/* Active Section Info Card */}
                <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {t.builder.sectionHeaderLabel}
                    </span>
                    <button
                      onClick={() => handleDeleteSection(currentSection.id)}
                      className="text-xs text-rose-600 hover:text-rose-700 font-semibold flex items-center"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      {t.builder.deleteSection}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={currentSection.title}
                    onChange={(e) => {
                      const updated = template.sections.map((s) =>
                        s.id === currentSection.id
                          ? { ...s, title: e.target.value }
                          : s
                      );
                      setTemplate({ ...template, sections: updated });
                    }}
                    className="w-full text-base font-bold text-slate-900 border border-slate-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
                    placeholder={t.builder.sectionTitlePlaceholder}
                  />
                  <input
                    type="text"
                    value={currentSection.description || ''}
                    onChange={(e) => {
                      const updated = template.sections.map((s) =>
                        s.id === currentSection.id
                          ? { ...s, description: e.target.value }
                          : s
                      );
                      setTemplate({ ...template, sections: updated });
                    }}
                    className="w-full text-xs text-slate-600 border border-slate-300 rounded-md px-3 py-1.5 mt-2 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
                    placeholder={t.builder.sectionDescPlaceholder}
                  />
                </div>

                {/* Field Items Container */}
                <div className="space-y-3">
                  {currentSection.fields.length === 0 ? (
                    <div className="border border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50/50">
                      <Layers className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-800">
                        {t.builder.noCheckpointsTitle}
                      </p>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        {t.builder.noCheckpointsSub}
                      </p>
                    </div>
                  ) : (
                    currentSection.fields.map((field, fIdx) => (
                      <div
                        key={field.id}
                        className={`bg-white border rounded-lg p-4 transition-all ${
                          selectedFieldId === field.id
                            ? 'border-amber-500 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                        onClick={() => setSelectedFieldId(field.id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-mono text-slate-700 font-semibold">
                              #{fIdx + 1}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="uppercase font-bold text-amber-700">
                              {field.type.replace('_', ' ')}
                            </span>
                            {field.required && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[11px] text-rose-500 font-medium">
                                  {t.common.required}
                                </span>
                              </>
                            )}
                            {field.condition && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[11px] text-amber-800 font-medium">
                                  {t.common.conditional}
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex items-center space-x-1">
                            <button
                              disabled={fIdx === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveField(currentSection.id, fIdx, 'up');
                              }}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              disabled={fIdx === currentSection.fields.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveField(
                                  currentSection.id,
                                  fIdx,
                                  'down'
                                );
                              }}
                              className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateField(
                                  currentSection.id,
                                  field.id
                                );
                              }}
                              className="p-1 text-slate-400 hover:text-slate-700"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteField(currentSection.id, field.id);
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Field Label & Description Input */}
                        <div className="mt-3 space-y-2">
                          <input
                            type="text"
                            value={field.label}
                            onChange={(e) =>
                              handleUpdateField(currentSection.id, field.id, {
                                label: e.target.value,
                              })
                            }
                            className="w-full text-sm font-semibold text-slate-900 border border-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            placeholder={t.builder.promptPlaceholder}
                          />
                          <input
                            type="text"
                            value={field.description || ''}
                            onChange={(e) =>
                              handleUpdateField(currentSection.id, field.id, {
                                description: e.target.value,
                              })
                            }
                            className="w-full text-xs text-slate-500 border border-slate-200 rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500"
                            placeholder={t.builder.helperPlaceholder}
                          />
                        </div>

                        {/* Inline Field Properties Bar */}
                        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs">
                          {field.type !== 'instruction' && (
                            <label className="flex items-center space-x-1.5 cursor-pointer text-slate-700">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) =>
                                  handleUpdateField(
                                    currentSection.id,
                                    field.id,
                                    { required: e.target.checked }
                                  )
                                }
                                className="rounded border-slate-300 text-amber-500 focus:ring-amber-400 h-3.5 w-3.5"
                              />
                              <span className="font-medium">
                                {t.builder.mandatory}
                              </span>
                            </label>
                          )}

                          {field.type === 'number' && (
                            <div className="flex items-center space-x-1">
                              <span className="text-slate-500">
                                {t.builder.unitLabel}
                              </span>
                              <input
                                type="text"
                                value={field.unit || ''}
                                onChange={(e) =>
                                  handleUpdateField(
                                    currentSection.id,
                                    field.id,
                                    { unit: e.target.value }
                                  )
                                }
                                className="w-14 border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center font-mono"
                                placeholder="psi"
                              />
                            </div>
                          )}

                          {/* Industry Code Reference */}
                          <div className="flex items-center space-x-1">
                            <span className="text-slate-500">
                              {t.builder.standardLabel}
                            </span>
                            <input
                              type="text"
                              value={field.helpStandard || ''}
                              onChange={(e) =>
                                handleUpdateField(currentSection.id, field.id, {
                                  helpStandard: e.target.value,
                                })
                              }
                              className="w-28 border border-slate-300 rounded px-1.5 py-0.5 text-[11px] font-mono"
                              placeholder="ACI 318 / SNI"
                            />
                          </div>

                          {/* Dynamic Condition Trigger */}
                          <div className="flex items-center space-x-1.5 text-slate-600">
                            <span className="text-[11px]">
                              {t.builder.conditionLabel}
                            </span>
                            <select
                              value={field.condition?.dependsOnFieldId || ''}
                              onChange={(e) => {
                                const depId = e.target.value;
                                if (!depId) {
                                  handleUpdateField(
                                    currentSection.id,
                                    field.id,
                                    { condition: undefined }
                                  );
                                } else {
                                  handleUpdateField(
                                    currentSection.id,
                                    field.id,
                                    {
                                      condition: {
                                        dependsOnFieldId: depId,
                                        operator: 'equals',
                                        value: 'fail',
                                      },
                                    }
                                  );
                                }
                              }}
                              className="border border-slate-300 rounded text-[11px] px-1 py-0.5 bg-white max-w-[150px]"
                            >
                              <option value="">{t.builder.alwaysVisible}</option>
                              {currentSection.fields
                                .filter(
                                  (f) =>
                                    f.id !== field.id &&
                                    (f.type === 'pass_fail' ||
                                      f.type === 'yes_no')
                                )
                                .map((cand) => (
                                  <option key={cand.id} value={cand.id}>
                                    {t.builder.showIfFails.replace(
                                      '{label}',
                                      cand.label.substring(0, 16)
                                    )}
                                  </option>
                                ))}
                            </select>
                          </div>
                        </div>

                        {/* Options Editor for Dropdown and Status */}
                        {(field.type === 'dropdown' ||
                          field.type === 'status_select') && (
                          <div className="mt-3 pt-2 border-t border-slate-100">
                            <span className="text-[11px] font-bold text-slate-600 block mb-1">
                              {t.builder.optionsListLabel}
                            </span>
                            <input
                              type="text"
                              value={(field.options || []).join(', ')}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const parsed = raw
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean);
                                handleUpdateField(currentSection.id, field.id, {
                                  options: parsed,
                                });
                              }}
                              className="w-full text-xs border border-slate-300 rounded px-2 py-1 font-mono"
                              placeholder="Option 1, Option 2, Option 3"
                            />
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Visual Palette Tooling (3 cols) */}
          <div className="lg:col-span-3 p-5 bg-slate-50/50 space-y-4 overflow-y-auto">
            <div>
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                {t.builder.componentPalette}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {t.builder.componentPaletteSub}
              </p>
            </div>

            <div className="space-y-4">
              {(
                [
                  'Compliance',
                  'Inputs',
                  'Evidence & Sign-off',
                  'Information',
                ] as const
              ).map((cat) => {
                const items = PALETTE_ITEMS.filter((p) => p.categoryEn === cat);
                const catLabel =
                  lang === 'id' ? items[0]?.categoryId || cat : cat;
                return (
                  <div key={cat} className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block px-1">
                      {catLabel}
                    </span>
                    <div className="space-y-1.5">
                      {items.map((item) => (
                        <button
                          key={item.type}
                          onClick={() =>
                            handleAddField(activeSectionId, item.type)
                          }
                          className="w-full text-left p-2 rounded-lg border border-slate-200 bg-white hover:border-amber-500 hover:shadow-xs transition-all flex items-start space-x-2.5 group"
                        >
                          <span className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center font-mono text-xs font-bold text-slate-700 group-hover:bg-amber-100 group-hover:text-amber-800 shrink-0">
                            {item.iconText}
                          </span>
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-900 block group-hover:text-amber-700 truncate">
                              {lang === 'id' ? item.labelId : item.labelEn}
                            </span>
                            <span className="text-[10px] text-slate-500 block truncate">
                              {lang === 'id' ? item.descId : item.descEn}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
