import React, { useState, useRef } from 'react';
import {
  X,
  ScanText,
  Upload,
  Camera,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight,
  Layers,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { ChecklistTemplate, ChecklistCategory, UserRole } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import {
  preprocessImageForOcr,
  recognizeTextFromImage,
  parseOcrIntoTemplate,
  matchOcrTextToTemplateForm,
  OcrFillResult,
  OcrProgressCallback,
} from '../utils/ocrService';

export type OcrModalMode = 'clone_template' | 'fill_inspection';

interface OcrScannerModalProps {
  isOpen: boolean;
  mode: OcrModalMode;
  targetTemplate?: ChecklistTemplate; // Required when mode === 'fill_inspection'
  currentUser: { name: string; role: UserRole };
  onClose: () => void;
  onTemplateCloned?: (template: ChecklistTemplate) => void;
  onFormFilled?: (detectedAnswers: Record<string, any>, generalNotes?: string) => void;
}

export const OcrScannerModal: React.FC<OcrScannerModalProps> = ({
  isOpen,
  mode,
  targetTemplate,
  currentUser,
  onClose,
  onTemplateCloned,
  onFormFilled,
}) => {
  const { lang, t, translateCategory } = useLanguage();
  const isId = lang === 'id';

  const [step, setStep] = useState<'upload' | 'scanning' | 'review'>('upload');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ChecklistCategory>(
    targetTemplate?.category || 'Safety & HSE'
  );
  const [ocrProgress, setOcrProgress] = useState<OcrProgressCallback>({
    status: '',
    progress: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Results
  const [rawOcrText, setRawOcrText] = useState<string>('');
  const [clonedTemplate, setClonedTemplate] = useState<ChecklistTemplate | null>(null);
  const [fillResult, setFillResult] = useState<OcrFillResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage(isId ? 'Harap unggah file foto/gambar dokumen (JPG/PNG).' : 'Please upload an image file (JPG/PNG).');
      return;
    }

    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      setImagePreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleStartScan = async () => {
    if (!imagePreview) {
      setErrorMessage(isId ? 'Pilih atau ambil foto dokumen terlebih dahulu.' : 'Please choose or snap a document photo first.');
      return;
    }

    setErrorMessage(null);
    setStep('scanning');
    setOcrProgress({ status: 'preprocessing image', progress: 5 });

    try {
      // 1. Client-side canvas preprocessing (contrast & grayscale for Tesseract)
      const preprocessed = await preprocessImageForOcr(imagePreview);
      setOcrProgress({ status: 'loading tesseract OCR engine', progress: 20 });

      // 2. Client-side Tesseract.js worker execution
      const ocrResult = await recognizeTextFromImage(preprocessed, (info) => {
        setOcrProgress({
          status: info.status,
          progress: Math.min(95, Math.max(25, info.progress)),
        });
      });

      setRawOcrText(ocrResult.text);

      if (!ocrResult.text || ocrResult.text.trim().length < 15) {
        throw new Error(
          isId
            ? 'Teks tidak terbaca dengan jelas pada gambar. Pastikan dokumen cukup terang dan teks tidak buram.'
            : 'No clear text detected in document. Please ensure adequate lighting and sharpness.'
        );
      }

      // 3. Mode branching: Clone template vs Fill form
      if (mode === 'clone_template') {
        const parsed = parseOcrIntoTemplate(ocrResult.text, {
          category: selectedCategory,
          authorName: currentUser.name,
          lang,
        });
        setClonedTemplate(parsed);
      } else if (mode === 'fill_inspection' && targetTemplate) {
        const match = matchOcrTextToTemplateForm(ocrResult.text, targetTemplate);
        setFillResult(match);
      }

      setStep('review');
    } catch (err: any) {
      console.error('OCR Processing Error:', err);
      setErrorMessage(err?.message || (isId ? 'Gagal memproses OCR pada gambar.' : 'Failed to perform OCR on image.'));
      setStep('upload');
    }
  };

  const handleApplyClonedTemplate = () => {
    if (clonedTemplate && onTemplateCloned) {
      onTemplateCloned(clonedTemplate);
      onClose();
    }
  };

  const handleApplyFilledAnswers = () => {
    if (fillResult && onFormFilled) {
      const notes = fillResult.unmatchedNotes.length > 0 ? fillResult.unmatchedNotes.join('\n') : undefined;
      onFormFilled(fillResult.detectedAnswers, notes);
      onClose();
    }
  };

  const handleReset = () => {
    setStep('upload');
    setImagePreview(null);
    setErrorMessage(null);
    setRawOcrText('');
    setClonedTemplate(null);
    setFillResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
              <ScanText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  {mode === 'clone_template'
                    ? isId
                      ? 'OCR: Kloning Template dari Kertas'
                      : 'OCR: Clone Template from Paper Form'
                    : isId
                    ? 'OCR: Pengisian Otomatis dari Lembar Blanko'
                    : 'OCR: Auto-Fill Form from Printed Sheet'}
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-bold uppercase tracking-wider">
                  Client-side JS OCR
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {mode === 'clone_template'
                  ? isId
                    ? 'Pindai foto dokumen fisik / SOP kertas lama tanpa mengetik ulang'
                    : 'Scan paper form photos or legacy documents into a digital checklist'
                  : isId
                  ? `Membaca coretan / centang pena mandor dari blanko: "${targetTemplate?.title}"`
                  : `Extract hand-marked pen ticks & entries for: "${targetTemplate?.title}"`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {step === 'upload' && (
            <div className="space-y-5">
              {/* Image Picker Area */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
              />

              {imagePreview ? (
                <div className="space-y-3">
                  <div className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-950 flex items-center justify-center max-h-72">
                    <img
                      src={imagePreview}
                      alt="Document Preview"
                      className="max-h-72 w-auto object-contain"
                    />
                    <button
                      onClick={() => setImagePreview(null)}
                      className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-900/80 text-white hover:bg-slate-900 transition-colors"
                      title={isId ? 'Ganti Foto' : 'Change Photo'}
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[11px] text-center text-slate-500">
                    {isId
                      ? '✓ Foto dokumen siap diproses oleh engine Tesseract OCR di browser Anda'
                      : '✓ Document image ready to be processed locally via browser Tesseract OCR'}
                  </p>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-slate-50/60 hover:bg-blue-50/30 flex flex-col items-center justify-center space-y-3"
                >
                  <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-slate-200 flex items-center justify-center text-blue-600">
                    <Camera className="w-7 h-7" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">
                      {isId
                        ? 'Ambil Foto Dokumen atau Unggah File'
                        : 'Snap Document Photo or Upload Image'}
                    </span>
                    <span className="text-[11px] text-slate-500 block mt-1">
                      {isId
                        ? 'Dukung format JPG, PNG, atau jepret langsung dari kamera HP'
                        : 'Supports JPG, PNG, or direct smartphone camera capture'}
                    </span>
                  </div>
                  <span className="px-3.5 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 shadow-xs">
                    {isId ? 'Pilih Gambar Dokumen' : 'Browse Document File'}
                  </span>
                </div>
              )}

              {/* Mode-specific configurations */}
              {mode === 'clone_template' && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <label className="block text-xs font-bold text-slate-700">
                    {isId ? 'Pilih Kategori Sasaran Template:' : 'Select Target Discipline Category:'}
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value as ChecklistCategory)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {[
                      'Safety & HSE',
                      'Civil & Structural',
                      'Heavy Equipment',
                      'Quality Control',
                      'Environmental',
                      'Site Logistics',
                    ].map((cat) => (
                      <option key={cat} value={cat}>
                        {translateCategory(cat as ChecklistCategory)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Guidance Tips */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  {isId ? 'Tips Akurasi OCR Tanpa Cloud:' : 'OCR Accuracy Guidelines:'}
                </span>
                <ul className="text-[11px] text-slate-600 space-y-1 list-disc list-inside">
                  <li>
                    {isId
                      ? 'Pastikan lembar dokumen berada di tempat dengan pencahayaan terang dan rata.'
                      : 'Ensure the document sheet is well-lit and placed on a flat surface.'}
                  </li>
                  <li>
                    {isId
                      ? 'Hindari sudut miring ekstrim agar baris tabel terbaca lurus horizontal.'
                      : 'Avoid extreme angles so table rows and check columns stay horizontal.'}
                  </li>
                  <li>
                    {isId
                      ? 'Pemrosesan berjalan 100% di browser Anda (offline-capable, bebas biaya API).'
                      : 'Processed 100% locally in your browser (offline-capable, zero API cost).'}
                  </li>
                </ul>
              </div>
            </div>
          )}

          {step === 'scanning' && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin flex items-center justify-center" />
                <ScanText className="w-6 h-6 text-blue-600 absolute inset-0 m-auto" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h3 className="text-sm font-bold text-slate-900">
                  {isId ? 'Menganalisis Dokumen via Tesseract.js...' : 'Recognizing Document via Tesseract.js...'}
                </h3>
                <p className="text-xs text-slate-500">
                  {ocrProgress.status} ({ocrProgress.progress}%)
                </p>
                <div className="w-full bg-slate-100 rounded-full h-2 mt-3 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${ocrProgress.progress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-5">
              {/* Result Summary Banner */}
              {mode === 'clone_template' && clonedTemplate && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <h4 className="text-xs font-bold text-emerald-950">
                          {isId ? 'Template Berhasil Diekstrak!' : 'Template Cloned Successfully!'}
                        </h4>
                      </div>
                      <span className="text-[11px] font-bold text-emerald-700">
                        {clonedTemplate.sections.reduce((acc, s) => acc + s.fields.length, 0)}{' '}
                        {isId ? 'Poin Periksa' : 'Checkpoints'}
                      </span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-emerald-100 text-xs text-emerald-900">
                      <strong>{clonedTemplate.title}</strong>
                      <p className="text-[11px] text-emerald-800 mt-0.5">{clonedTemplate.description}</p>
                    </div>
                  </div>

                  {/* Section & Checkpoint Preview */}
                  <div className="space-y-3">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                      {isId ? 'Pratinjau Struktur Checklist Terdeteksi:' : 'Detected Checklist Sections:'}
                    </span>
                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden max-h-60 overflow-y-auto">
                      {clonedTemplate.sections.map((sec, sIdx) => (
                        <div key={sec.id} className="p-3 bg-white">
                          <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                            <span>
                              {sIdx + 1}. {sec.title}
                            </span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              {sec.fields.length} {isId ? 'item' : 'items'}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1">
                            {sec.fields.map((f, fIdx) => (
                              <div
                                key={f.id}
                                className="flex items-center justify-between text-[11px] text-slate-600 bg-slate-50 p-1.5 rounded"
                              >
                                <span className="truncate pr-2">
                                  {fIdx + 1}. {f.label}
                                </span>
                                <span className="text-[9.5px] font-mono px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded uppercase shrink-0">
                                  {f.type} {f.unit ? `[${f.unit}]` : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {mode === 'fill_inspection' && fillResult && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <CheckCircle2 className="w-5 h-5 text-blue-600" />
                        <h4 className="text-xs font-bold text-blue-950">
                          {isId ? 'Data Lembar Terisi Terbaca!' : 'Form Answers Extracted!'}
                        </h4>
                      </div>
                      <span className="text-xs font-bold text-blue-800 font-mono">
                        {fillResult.matchedCount} / {fillResult.totalFieldsCount} {isId ? 'Terisi' : 'Matched'}
                      </span>
                    </div>
                    <p className="text-[11px] text-blue-700 mt-1">
                      {isId
                        ? 'Centang Pass/Fail dan angka tulisan tangan berhasil dicocokkan ke formulir digital.'
                        : 'Pass/Fail marks and hand-written numbers matched against template items.'}
                    </p>
                  </div>

                  {/* Matched Answers Review */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                      {isId ? 'Daftar Hasil Deteksi:' : 'Extracted Values:'}
                    </span>
                    <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden max-h-52 overflow-y-auto">
                      {Object.entries(fillResult.detectedAnswers).map(([fieldId, val], idx) => {
                        let fieldLabel = fieldId;
                        targetTemplate?.sections.forEach((s) => {
                          const f = s.fields.find((field) => field.id === fieldId);
                          if (f) fieldLabel = f.label;
                        });

                        return (
                          <div key={fieldId} className="p-2.5 bg-white flex items-center justify-between text-xs">
                            <span className="text-slate-800 font-medium truncate max-w-xs">
                              {idx + 1}. {fieldLabel}
                            </span>
                            <span
                              className={`font-bold uppercase font-mono px-2 py-0.5 rounded text-[11px] ${
                                val === 'pass' || val === 'yes'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : val === 'fail' || val === 'no'
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-slate-100 text-slate-800'
                              }`}
                            >
                              {String(val)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {fillResult.unmatchedNotes.length > 0 && (
                    <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
                      <span className="font-bold">{isId ? 'Catatan Lapangan Terdeteksi:' : 'Extracted Notes:'}</span>
                      <p className="text-[11px] italic">{fillResult.unmatchedNotes.join(' ')}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Raw OCR Text Expandable */}
              <details className="text-xs text-slate-500 border border-slate-200 rounded-xl p-3 bg-slate-50">
                <summary className="cursor-pointer font-bold text-slate-700">
                  {isId ? 'Lihat Teks Mentah OCR' : 'View Raw OCR Text Dump'}
                </summary>
                <pre className="mt-2 text-[10px] bg-white p-2 rounded border border-slate-200 font-mono overflow-x-auto whitespace-pre-wrap max-h-36">
                  {rawOcrText}
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          {step === 'upload' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleStartScan}
                disabled={!imagePreview}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold transition-colors flex items-center shadow-xs"
              >
                <ScanText className="w-4 h-4 mr-1.5" />
                {isId ? 'Mulai Pemindaian OCR' : 'Start OCR Scan'}
              </button>
            </>
          ) : step === 'scanning' ? (
            <div className="w-full text-center text-xs text-slate-400">
              {isId ? 'Harap tunggu, memproses OCR lokal di perangkat Anda...' : 'Processing local OCR in browser...'}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                {isId ? 'Pindai Ulang' : 'Rescan Image'}
              </button>
              {mode === 'clone_template' ? (
                <button
                  type="button"
                  onClick={handleApplyClonedTemplate}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors flex items-center shadow-xs"
                >
                  <ArrowRight className="w-4 h-4 mr-1.5" />
                  {isId ? 'Gunakan Sebagai Template Baru' : 'Apply as New Template'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleApplyFilledAnswers}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors flex items-center shadow-xs"
                >
                  <ArrowRight className="w-4 h-4 mr-1.5" />
                  {isId ? 'Terapkan Hasil ke Formulir' : 'Fill Into Form'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
