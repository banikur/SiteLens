import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Camera,
  Calendar,
  Clock,
  Send,
  ScanText,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  ChecklistTemplate,
  InspectionRecord,
  Project,
  User,
  InspectionEvidence,
} from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { OcrScannerModal } from './OcrScannerModal';
import { uploadEvidencePhoto } from '../services/api';
import { queueOfflinePhoto } from '../services/offlineQueue';

interface InspectionExecutionProps {
  template: ChecklistTemplate;
  projects: Project[];
  currentUser: User;
  onComplete: (record: InspectionRecord, createdActionsCount: number) => void;
  onCancel: () => void;
}

export const InspectionExecution: React.FC<InspectionExecutionProps> = ({
  template,
  projects,
  currentUser,
  onComplete,
  onCancel,
}) => {
  const { lang, t, translateCategory, translateRole } = useLanguage();

  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projects[0]?.id || ''
  );
  const activeProject =
    projects.find((p) => p.id === selectedProjectId) || projects[0];

  const [selectedZone, setSelectedZone] = useState<string>(
    activeProject?.zones[0]?.name || 'Primary Site Area'
  );

  const [answers, setAnswers] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    template.sections.forEach((s) => {
      s.fields.forEach((f) => {
        if (f.defaultValue !== undefined) {
          initial[f.id] = f.defaultValue;
        }
      });
    });
    return initial;
  });

  const [evidencePhotos, setEvidencePhotos] = useState<InspectionEvidence[]>([]);
  const [signatureStamped, setSignatureStamped] = useState(false);
  const [generalNotes, setGeneralNotes] = useState('');
  const [ocrModalOpen, setOcrModalOpen] = useState(false);

  const handleAnswerChange = (fieldId: string, val: any) => {
    setAnswers((prev) => ({ ...prev, [fieldId]: val }));
  };

  const sampleEvidenceAssets = [
    {
      url: '/src/assets/images/tower_crane_inspection_1794440488936.jpg',
      label: 'Tower Crane Hoist Drum Check',
    },
    {
      url: '/src/assets/images/excavation_shoring_1794440491379.jpg',
      label: 'Basement Excavation Shoring Waler',
    },
    {
      url: '/src/assets/images/rebar_concrete_check_1794440489983.jpg',
      label: 'Rebar Clear Cover Spacer Calibration',
    },
  ];

  const handleCapturePhoto = (fieldId: string, customUrl?: string) => {
    const chosenUrl =
      customUrl ||
      sampleEvidenceAssets[
        Math.floor(Math.random() * sampleEvidenceAssets.length)
      ].url;

    const newEvidence: InspectionEvidence = {
      fieldId,
      url: chosenUrl,
      caption:
        lang === 'id'
          ? 'Bukti foto lapangan direkam di lokasi pemeriksaan.'
          : 'Field photographic evidence recorded at location.',
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      location: selectedZone,
    };

    setEvidencePhotos((prev) => [
      ...prev.filter((p) => p.fieldId !== fieldId),
      newEvidence,
    ]);
    handleAnswerChange(fieldId, chosenUrl);
  };

  const handlePhotoFileUpload = async (fieldId: string, file: File) => {
    if (navigator.onLine) {
      try {
        const uploadedUrl = await uploadEvidencePhoto(file, file.name);
        handleCapturePhoto(fieldId, uploadedUrl);
        return;
      } catch {
        // Fall through to offline queue
      }
    }
    const offlineRef = await queueOfflinePhoto(file, file.name);
    handleCapturePhoto(fieldId, offlineRef);
  };

  const calculateScore = () => {
    let totalPassFail = 0;
    let passed = 0;
    let failed = 0;
    let na = 0;

    template.sections.forEach((s) => {
      s.fields.forEach((f) => {
        if (f.type === 'pass_fail') {
          const val = answers[f.id];
          if (val === 'pass') {
            totalPassFail++;
            passed++;
          } else if (val === 'fail') {
            totalPassFail++;
            failed++;
          } else if (val === 'na') {
            na++;
          }
        }
      });
    });

    const scorePercent =
      totalPassFail === 0 ? 100 : Math.round((passed / totalPassFail) * 100);

    return { scorePercent, passed, failed, na };
  };

  const { scorePercent, passed, failed, na } = calculateScore();

  const handleSubmit = () => {
    for (const section of template.sections) {
      for (const field of section.fields) {
        if (field.type === 'instruction') continue;

        if (field.condition) {
          const parentVal = answers[field.condition.dependsOnFieldId];
          const visible =
            field.condition.operator === 'equals'
              ? parentVal === field.condition.value
              : parentVal !== field.condition.value;
          if (!visible) continue;
        }

        if (
          field.required &&
          (answers[field.id] === undefined || answers[field.id] === '')
        ) {
          alert(t.execution.mandatoryAlert.replace('{label}', field.label));
          return;
        }
      }
    }

    const inspectionRecord: InspectionRecord = {
      id: `insp-${Math.floor(1000 + Math.random() * 9000)}`,
      templateId: template.id,
      templateTitle: template.title,
      category: template.category,
      projectId: activeProject.id,
      projectName: activeProject.name,
      siteZone: selectedZone,
      inspectorId: currentUser.id,
      inspectorName: currentUser.name,
      inspectorRole: currentUser.role,
      status: template.requiresApproval ? 'under_review' : 'approved',
      answers,
      evidencePhotos,
      signatureData: signatureStamped
        ? {
            signedBy: currentUser.name,
            signedAt: new Date().toLocaleTimeString(),
            signatureType: 'digital_stamp',
          }
        : undefined,
      scorePercent,
      passedCount: passed,
      failedCount: failed,
      nonApplicableCount: na,
      notes: generalNotes,
      submittedAt: new Date().toLocaleString([], {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      createdAt: new Date().toISOString(),
    };

    onComplete(inspectionRecord, failed);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Bar Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onCancel}
          className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          {t.execution.cancelReturn}
        </button>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{translateCategory(template.category)}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">
            {t.execution.protocolVersion.replace('{version}', template.version)}
          </span>
        </div>
      </div>

      {/* Protocol Header Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
              {template.title}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {template.description}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setOcrModalOpen(true)}
              className="px-3 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-xs font-bold transition-colors flex items-center shadow-xs"
              title="Automatically extract pen ticks from scanned paper sheet via browser OCR"
            >
              <ScanText className="w-4 h-4 mr-1.5 text-blue-600" />
              {t.execution.scanFilledSheet}
            </button>

            {/* Live Score Tally */}
            <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg text-right shrink-0">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                {t.execution.liveCompliance}
              </span>
              <div
                className={`text-2xl font-extrabold font-mono tabular-nums leading-tight ${
                  scorePercent >= 90
                    ? 'text-emerald-600'
                    : scorePercent >= 75
                    ? 'text-amber-600'
                    : 'text-rose-600'
                }`}
              >
                {scorePercent}%
              </div>
              <div className="flex items-center justify-end gap-2 text-[10px] text-slate-500 mt-0.5">
                <span>
                  {passed} {t.common.pass}
                </span>
                <span aria-hidden="true">·</span>
                <span className={failed > 0 ? 'text-rose-600 font-bold' : ''}>
                  {failed} {t.common.fail}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Project & Zone Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-100">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-700 tracking-wider mb-1.5">
              {t.execution.targetProject}
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                const proj = projects.find((p) => p.id === e.target.value);
                if (proj && proj.zones[0]) setSelectedZone(proj.zones[0].name);
              }}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-slate-700 tracking-wider mb-1.5">
              {t.execution.siteZoneGrid}
            </label>
            <select
              value={selectedZone}
              onChange={(e) => setSelectedZone(e.target.value)}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              {activeProject?.zones.map((z) => (
                <option key={z.id} value={z.name}>
                  {z.name} ({z.safetyLevel})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Inspector Metadata Strip */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 mt-4 pt-4 border-t border-slate-100">
          <span className="flex items-center">
            <Calendar className="w-3.5 h-3.5 mr-1 text-slate-400" />
            {new Date().toISOString().split('T')[0]}
          </span>
          <span className="flex items-center">
            <Clock className="w-3.5 h-3.5 mr-1 text-slate-400" />
            {t.execution.activeFieldSession}
          </span>
          <span className="font-medium text-slate-700">
            {t.execution.inspectorLabel} {currentUser.name} (
            {translateRole(currentUser.role)})
          </span>
        </div>
      </div>

      {/* Checklist Sections Form */}
      <div className="space-y-6">
        {template.sections.map((section, sIdx) => (
          <div
            key={section.id}
            className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs"
          >
            {/* Section Header */}
            <div className="bg-slate-50 px-6 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  {sIdx + 1}. {section.title}
                </h2>
                {section.description && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {section.description}
                  </p>
                )}
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {t.execution.checkpointsCount.replace(
                  '{count}',
                  String(section.fields.length)
                )}
              </span>
            </div>

            {/* Checkpoints List */}
            <div className="p-6 space-y-6 divide-y divide-slate-100">
              {section.fields.map((field) => {
                if (field.condition) {
                  const parentVal = answers[field.condition.dependsOnFieldId];
                  const match =
                    field.condition.operator === 'equals'
                      ? parentVal === field.condition.value
                      : parentVal !== field.condition.value;
                  if (!match) return null;
                }

                return (
                  <div key={field.id} className="pt-5 first:pt-0">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="max-w-xl">
                        <label className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{field.label}</span>
                          {field.required && (
                            <span className="text-rose-500">*</span>
                          )}
                        </label>
                        {field.description && (
                          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            {field.description}
                          </p>
                        )}
                        {field.acceptanceCriteria && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200/80 rounded px-2 py-1 mt-1.5 inline-block">
                            <strong>{lang === 'id' ? 'Kriteria:' : 'Criteria:'}</strong>{' '}
                            {field.acceptanceCriteria}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {field.inspectionPoint && (
                            <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 text-amber-400 font-mono">
                              ITP:{field.inspectionPoint}
                            </span>
                          )}
                          {field.helpStandard && (
                            <span className="inline-block text-[10px] font-mono text-slate-400">
                              {t.builder.standardLabel} {field.helpStandard}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Field Input Control */}
                      <div className="shrink-0">
                        {field.type === 'pass_fail' && (
                          <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 space-x-1">
                            <button
                              type="button"
                              onClick={() => handleAnswerChange(field.id, 'pass')}
                              className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center transition-all ${
                                answers[field.id] === 'pass'
                                  ? 'bg-emerald-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-emerald-700'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              {t.common.pass}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAnswerChange(field.id, 'fail')}
                              className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center transition-all ${
                                answers[field.id] === 'fail'
                                  ? 'bg-rose-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-rose-700'
                              }`}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1" />
                              {t.common.fail}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAnswerChange(field.id, 'na')}
                              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                                answers[field.id] === 'na'
                                  ? 'bg-slate-800 text-white'
                                  : 'text-slate-500 hover:text-slate-900'
                              }`}
                            >
                              {t.common.na}
                            </button>
                          </div>
                        )}

                        {field.type === 'yes_no' && (
                          <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 space-x-1">
                            <button
                              type="button"
                              onClick={() => handleAnswerChange(field.id, 'yes')}
                              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                                answers[field.id] === 'yes'
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {t.common.yes}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAnswerChange(field.id, 'no')}
                              className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
                                answers[field.id] === 'no'
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {t.common.no}
                            </button>
                          </div>
                        )}

                        {field.type === 'status_select' && (
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              field.options || ['Normal', 'Caution', 'Critical']
                            ).map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => handleAnswerChange(field.id, opt)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                  answers[field.id] === opt
                                    ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}

                        {field.type === 'number' && (
                          <div className="space-y-1">
                            <div className="flex items-center">
                              <input
                                type="number"
                                value={answers[field.id] ?? ''}
                                onChange={(e) =>
                                  handleAnswerChange(
                                    field.id,
                                    e.target.value === '' ? '' : parseFloat(e.target.value)
                                  )
                                }
                                className="border border-slate-300 rounded-l-lg px-3 py-1.5 text-xs w-28 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                                placeholder="0.00"
                              />
                              <span className="bg-slate-100 border border-l-0 border-slate-300 px-3 py-1.5 rounded-r-lg text-xs font-mono text-slate-700 font-semibold">
                                {field.unit || 'val'}
                              </span>
                            </div>
                            {(field.minThreshold !== undefined || field.maxThreshold !== undefined) && (
                              <div className="text-[10px] font-mono">
                                <span className="text-slate-500">
                                  {field.minThreshold ?? '−∞'} .. {field.maxThreshold ?? '+∞'} {field.unit || ''}
                                </span>
                                {typeof answers[field.id] === 'number' && !Number.isNaN(answers[field.id]) && (
                                  <span
                                    className={`ml-2 font-bold ${
                                      (field.minThreshold !== undefined && answers[field.id] < field.minThreshold) ||
                                      (field.maxThreshold !== undefined && answers[field.id] > field.maxThreshold)
                                        ? 'text-red-600'
                                        : 'text-emerald-600'
                                    }`}
                                  >
                                    {(field.minThreshold !== undefined && answers[field.id] < field.minThreshold) ||
                                    (field.maxThreshold !== undefined && answers[field.id] > field.maxThreshold)
                                      ? 'OUT OF SPEC'
                                      : 'IN SPEC'}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {field.type === 'date' && (
                          <input
                            type="date"
                            value={answers[field.id] || ''}
                            onChange={(e) =>
                              handleAnswerChange(field.id, e.target.value)
                            }
                            className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 bg-white"
                          />
                        )}

                        {field.type === 'time' && (
                          <input
                            type="time"
                            value={answers[field.id] || ''}
                            onChange={(e) =>
                              handleAnswerChange(field.id, e.target.value)
                            }
                            className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 bg-white"
                          />
                        )}

                        {field.type === 'dropdown' && (
                          <select
                            value={answers[field.id] || ''}
                            onChange={(e) =>
                              handleAnswerChange(field.id, e.target.value)
                            }
                            className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                          >
                            <option value="">
                              {t.builder.selectOptionPlaceholder}
                            </option>
                            {(field.options || []).map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        )}

                        {field.type === 'photo' && (
                          <div className="space-y-2">
                            {answers[field.id] ? (
                              <div className="flex items-center space-x-3">
                                <img
                                  src={answers[field.id]}
                                  alt="Captured evidence"
                                  referrerPolicy="no-referrer"
                                  className="w-16 h-16 object-cover rounded-lg border border-slate-300 shadow-xs"
                                />
                                <div className="text-xs">
                                  <span className="text-emerald-600 font-semibold block">
                                    {t.execution.evidenceAttached}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCapturePhoto(field.id)}
                                    className="text-amber-600 hover:underline mt-0.5"
                                  >
                                    {t.execution.retakePhoto}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <label className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center cursor-pointer transition-colors">
                                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                                  {lang === 'id' ? 'Unggah / Kamera' : 'Upload / Camera'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) void handlePhotoFileUpload(field.id, file);
                                    }}
                                  />
                                </label>
                                <button
                                  type="button"
                                  onClick={() => handleCapturePhoto(field.id)}
                                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center transition-colors"
                                >
                                  <Camera className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
                                  {t.execution.capturePhoto}
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {field.type === 'signature' && (
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                setSignatureStamped(true);
                                handleAnswerChange(
                                  field.id,
                                  `signed_by_${currentUser.name}`
                                );
                              }}
                              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
                                signatureStamped
                                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                              }`}
                            >
                              {signatureStamped
                                ? t.execution.stampedBy.replace(
                                    '{name}',
                                    currentUser.name
                                  )
                                : t.execution.authenticateSignoff}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {field.type === 'short_text' && (
                      <input
                        type="text"
                        value={answers[field.id] || ''}
                        onChange={(e) =>
                          handleAnswerChange(field.id, e.target.value)
                        }
                        className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        placeholder={t.execution.enterResponse}
                      />
                    )}

                    {field.type === 'long_text' && (
                      <textarea
                        rows={3}
                        value={answers[field.id] || ''}
                        onChange={(e) =>
                          handleAnswerChange(field.id, e.target.value)
                        }
                        className="mt-2 w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        placeholder={t.execution.documentObservations}
                      />
                    )}

                    {field.type === 'instruction' && (
                      <div className="bg-amber-50 border border-amber-200/80 rounded-lg p-3 text-xs text-amber-950 mt-1">
                        <span className="font-semibold">{field.label}</span>
                        {field.description && (
                          <p className="mt-1 text-amber-900 text-[11px]">
                            {field.description}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* General Inspector Notes */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <label className="block text-xs font-bold uppercase text-slate-700 tracking-wider mb-2">
          {t.execution.generalNotesLabel}
        </label>
        <textarea
          rows={3}
          value={generalNotes}
          onChange={(e) => setGeneralNotes(e.target.value)}
          className="w-full border border-slate-300 rounded-lg p-3 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
          placeholder={t.execution.generalNotesPlaceholder}
        />
      </div>

      {/* Submission Footer Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {t.execution.submitCardTitle}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {template.requiresApproval
              ? t.execution.submitRequiresApproval.replace(
                  '{role}',
                  translateRole(template.approvalRole || 'Authorized Inspector (API 510/570) & Verifikator K3')
                )
              : t.execution.submitDirectSignoff}
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 md:flex-initial px-4 py-2.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {t.execution.discardBtn}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="flex-1 md:flex-initial px-6 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center justify-center shadow-xs"
          >
            <Send className="w-4 h-4 mr-1.5" />
            {t.execution.submitRecordBtn}
          </button>
        </div>
      </div>

      {/* OCR SCANNER MODAL FOR AUTO-FILLING INSPECTION FROM PRINTED SHEET */}
      <OcrScannerModal
        isOpen={ocrModalOpen}
        mode="fill_inspection"
        targetTemplate={template}
        currentUser={currentUser}
        onClose={() => setOcrModalOpen(false)}
        onFormFilled={(detectedAnswers, notes) => {
          setAnswers((prev) => ({
            ...prev,
            ...detectedAnswers,
          }));
          if (notes) {
            setGeneralNotes((prev) => (prev ? `${prev}\n\n[OCR Notes]: ${notes}` : `[OCR Notes]: ${notes}`));
          }
        }}
      />
    </div>
  );
};
