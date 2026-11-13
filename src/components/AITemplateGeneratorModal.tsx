import React, { useState, useEffect } from 'react';
import {
  X,
  Wand2,
  ArrowLeft,
  Save,
  Edit3,
  Layers,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Sliders,
  Loader2,
} from 'lucide-react';
import { ChecklistTemplate, ChecklistCategory, UserRole } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { Language } from '../i18n/translations';

interface AITemplateGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: { name: string; role: UserRole };
  onSaveToLibrary: (template: ChecklistTemplate) => void;
  onOpenInBuilder: (template: ChecklistTemplate) => void;
}

const CATEGORIES: ChecklistCategory[] = [
  'Safety & HSE',
  'Civil & Structural',
  'Heavy Equipment',
  'Quality Control',
  'Environmental',
  'Site Logistics',
];

export const AITemplateGeneratorModal: React.FC<AITemplateGeneratorModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSaveToLibrary,
  onOpenInBuilder,
}) => {
  const { lang, t, translateCategory } = useLanguage();

  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [prompt, setPrompt] = useState('');
  const [category, setCategory] = useState<ChecklistCategory>('Safety & HSE');
  const [outputLanguage, setOutputLanguage] = useState<Language>(lang);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [generatedTemplate, setGeneratedTemplate] = useState<ChecklistTemplate | null>(null);

  useEffect(() => {
    setOutputLanguage(lang);
  }, [lang, isOpen]);

  if (!isOpen) return null;

  const samplePrompts = [
    {
      title: t.aiGenerator.sample1Title,
      category: 'Heavy Equipment' as ChecklistCategory,
      prompt: t.aiGenerator.sample1Prompt,
    },
    {
      title: t.aiGenerator.sample2Title,
      category: 'Safety & HSE' as ChecklistCategory,
      prompt: t.aiGenerator.sample2Prompt,
    },
    {
      title: t.aiGenerator.sample3Title,
      category: 'Quality Control' as ChecklistCategory,
      prompt: t.aiGenerator.sample3Prompt,
    },
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setErrorMessage(t.aiGenerator.errorEmptyPrompt);
      return;
    }

    setErrorMessage(null);
    setIsGenerating(true);

    try {
      const response = await fetch('/api/templates/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          category,
          language: outputLanguage,
          requiresApproval,
          authorName: currentUser.name,
          authorRole: currentUser.role,
          targetRole: currentUser.role,
          approvalRole: 'Authorized Inspector (API 510/570) & Verifikator K3',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.template) {
        throw new Error(data.error || 'Failed to generate checklist template.');
      }

      setGeneratedTemplate(data.template);
      setStep('preview');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error connecting to AI generator service.');
    } finally {
      setIsGenerating(false);
    }
  };

  const totalGeneratedFields = generatedTemplate
    ? generatedTemplate.sections.reduce((acc, s) => acc + s.fields.length, 0)
    : 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500 flex items-center justify-center text-slate-950 font-bold shrink-0">
              <Wand2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">
                {t.aiGenerator.modalTitle}
              </h2>
              <p className="text-xs text-slate-400 line-clamp-1">
                {t.aiGenerator.modalSubtitle}
              </p>
            </div>
          </div>

          {/* Step Indicator & Close */}
          <div className="flex items-center space-x-4 shrink-0">
            <div className="hidden sm:flex items-center space-x-2 text-xs font-medium">
              <span
                className={
                  step === 'input' ? 'text-amber-400 font-bold' : 'text-slate-400'
                }
              >
                {t.aiGenerator.stepInput}
              </span>
              <span className="text-slate-600">/</span>
              <span
                className={
                  step === 'preview' ? 'text-amber-400 font-bold' : 'text-slate-400'
                }
              >
                {t.aiGenerator.stepPreview}
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {step === 'input' ? (
            <>
              {/* Quick-Fill Sample Engineering Specifications */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block mb-2">
                  {t.aiGenerator.samplePromptsLabel}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {samplePrompts.map((sample, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setPrompt(sample.prompt);
                        setCategory(sample.category);
                        setErrorMessage(null);
                      }}
                      className="text-left p-3 rounded-lg border border-slate-200 hover:border-amber-500 hover:bg-amber-50/30 transition-all group"
                    >
                      <div className="text-xs font-bold text-slate-900 group-hover:text-amber-700 flex items-center justify-between">
                        <span className="truncate">{sample.title}</span>
                        <FileText className="w-3.5 h-3.5 text-slate-400 group-hover:text-amber-600 shrink-0 ml-1" />
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mt-1 leading-relaxed">
                        {sample.prompt}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Long Textarea Input for SOP / Work Method Statement */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    {t.aiGenerator.textareaLabel}
                  </label>
                  <span className="text-[11px] font-mono text-slate-400">
                    {t.aiGenerator.charCount.replace('{count}', String(prompt.length))}
                  </span>
                </div>
                <textarea
                  rows={8}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  disabled={isGenerating}
                  placeholder={t.aiGenerator.textareaPlaceholder}
                  className="w-full border border-slate-300 rounded-xl p-4 text-xs md:text-sm text-slate-900 leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-slate-50/40 font-sans resize-y min-h-[180px]"
                />
              </div>

              {/* Configuration Controls Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    {t.aiGenerator.targetCategoryLabel}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ChecklistCategory)}
                    disabled={isGenerating}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {translateCategory(cat)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                    {t.aiGenerator.outputLanguageLabel}
                  </label>
                  <div className="flex border border-slate-300 rounded-lg p-0.5 bg-slate-100">
                    <button
                      type="button"
                      disabled={isGenerating}
                      onClick={() => setOutputLanguage('en')}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        outputLanguage === 'en'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      English (EN)
                    </button>
                    <button
                      type="button"
                      disabled={isGenerating}
                      onClick={() => setOutputLanguage('id')}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                        outputLanguage === 'id'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Indonesia (ID)
                    </button>
                  </div>
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center space-x-2.5 p-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requiresApproval}
                      onChange={(e) => setRequiresApproval(e.target.checked)}
                      disabled={isGenerating}
                      className="rounded border-slate-300 text-amber-500 focus:ring-amber-500 h-4 w-4"
                    />
                    <span className="text-xs font-semibold text-slate-800 leading-tight">
                      {t.aiGenerator.requireApprovalLabel}
                    </span>
                  </label>
                </div>
              </div>

              {/* Error Banner */}
              {errorMessage && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start space-x-2.5 text-xs text-rose-800">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Loading Synthesis Indicator */}
              {isGenerating && (
                <div className="p-6 rounded-xl bg-slate-900 text-white flex items-center space-x-4">
                  <Loader2 className="w-6 h-6 text-amber-400 animate-spin shrink-0" />
                  <div>
                    <div className="text-sm font-bold">{t.aiGenerator.generatingTitle}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {t.aiGenerator.generatingSub}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* STEP 2: INTERACTIVE PREVIEW BEFORE SAVING OR EDITING */
            generatedTemplate && (
              <div className="space-y-5">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                      {t.aiGenerator.previewBannerTitle}
                    </div>
                    <p className="text-xs text-amber-900 mt-0.5">
                      {t.aiGenerator.previewBannerSub}
                    </p>
                  </div>
                  <div className="text-xs font-mono font-semibold text-amber-900 shrink-0">
                    {t.aiGenerator.summaryMetrics
                      .replace('{sections}', String(generatedTemplate.sections.length))
                      .replace('{fields}', String(totalGeneratedFields))
                      .replace('{minutes}', String(generatedTemplate.estimatedMinutes))}
                  </div>
                </div>

                {/* Editable Header Metadata */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                        {t.aiGenerator.editableTitleLabel}
                      </label>
                      <input
                        type="text"
                        value={generatedTemplate.title}
                        onChange={(e) =>
                          setGeneratedTemplate({ ...generatedTemplate, title: e.target.value })
                        }
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">
                        {t.aiGenerator.targetCategoryLabel}
                      </label>
                      <select
                        value={generatedTemplate.category}
                        onChange={(e) =>
                          setGeneratedTemplate({
                            ...generatedTemplate,
                            category: e.target.value as ChecklistCategory,
                          })
                        }
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800"
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {translateCategory(cat)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">{generatedTemplate.description}</p>
                </div>

                {/* Sections & Checkpoints Preview */}
                <div className="space-y-4">
                  {generatedTemplate.sections.map((section, sIdx) => (
                    <div
                      key={section.id}
                      className="border border-slate-200 rounded-xl overflow-hidden bg-white"
                    >
                      <div className="bg-slate-100/80 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                        <div>
                          <h3 className="text-xs font-bold text-slate-900">
                            {sIdx + 1}. {section.title}
                          </h3>
                          {section.description && (
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {section.description}
                            </p>
                          )}
                        </div>
                        <span className="text-[11px] font-mono text-slate-500">
                          {section.fields.length} {t.common.checks}
                        </span>
                      </div>

                      <div className="divide-y divide-slate-100 p-4 space-y-3">
                        {section.fields.map((field, fIdx) => (
                          <div key={field.id} className="pt-3 first:pt-0 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-[11px] text-slate-400 font-semibold">
                                  #{fIdx + 1}
                                </span>
                                <span className="font-bold text-slate-900">{field.label}</span>
                                {field.required && (
                                  <span className="text-rose-500 font-bold">*</span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                                <span className="uppercase font-semibold text-slate-700">
                                  {field.type.replace('_', ' ')}
                                </span>
                                {field.unit && (
                                  <>
                                    <span>·</span>
                                    <span>
                                      {t.aiGenerator.unitBadge.replace('{unit}', field.unit)}
                                    </span>
                                  </>
                                )}
                                {field.condition && (
                                  <>
                                    <span>·</span>
                                    <span className="text-amber-700 font-sans font-medium">
                                      {t.aiGenerator.conditionalBadge}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            {field.description && (
                              <p className="text-[11px] text-slate-500 mt-1 pl-6">
                                {field.description}
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-3 pl-6 mt-1 text-[10px] text-slate-400 font-mono">
                              {field.helpStandard && (
                                <span>
                                  {t.builder.standardLabel} {field.helpStandard}
                                </span>
                              )}
                              {field.options && field.options.length > 0 && (
                                <span>
                                  {t.aiGenerator.optionsBadge.replace(
                                    '{options}',
                                    field.options.join(', ')
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          {step === 'input' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={isGenerating}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating || !prompt.trim()}
                className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t.aiGenerator.generatingTitle}
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4 mr-2" />
                    {t.aiGenerator.generateBtn}
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setStep('input')}
                className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors flex items-center"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                {t.aiGenerator.backToPromptBtn}
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    if (generatedTemplate) {
                      onOpenInBuilder(generatedTemplate);
                      onClose();
                    }
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors flex items-center"
                >
                  <Edit3 className="w-3.5 h-3.5 mr-1.5" />
                  {t.aiGenerator.openInBuilderBtn}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (generatedTemplate) {
                      onSaveToLibrary(generatedTemplate);
                      onClose();
                    }
                  }}
                  className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs"
                >
                  <Save className="w-3.5 h-3.5 mr-1.5" />
                  {t.aiGenerator.saveToLibraryBtn}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
