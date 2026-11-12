import React, { useState } from 'react';
import {
  X,
  CheckCircle,
  AlertOctagon,
  Printer,
  FileDown,
} from 'lucide-react';
import { InspectionRecord, UserRole } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { exportFilledInspectionPdf } from '../utils/pdfGenerator';
import { getStoredTemplates } from '../services/storage';

interface InspectionReviewModalProps {
  inspection: InspectionRecord | null;
  currentUser: { name: string; role: UserRole };
  onClose: () => void;
  onApprove: (id: string, notes: string) => void;
  onReject: (id: string, notes: string) => void;
}

export const InspectionReviewModal: React.FC<InspectionReviewModalProps> = ({
  inspection,
  currentUser,
  onClose,
  onApprove,
  onReject,
}) => {
  const { lang, t, translateCategory, translateRole, translateStatus } = useLanguage();
  const [reviewNotes, setReviewNotes] = useState('');

  if (!inspection) return null;

  const handleExportPdf = () => {
    const templates = getStoredTemplates();
    const matchingTemplate = templates.find((t) => t.id === inspection.templateId);
    exportFilledInspectionPdf({
      inspection,
      template: matchingTemplate,
      lang,
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-mono font-semibold text-slate-700">
                {t.reviewModal.recordPrefix} #{inspection.id}
              </span>
              <span aria-hidden="true">·</span>
              <span>{translateCategory(inspection.category)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold uppercase text-amber-700">
                {translateStatus(inspection.status)}
              </span>
            </div>
            <h2 className="text-base md:text-lg font-bold text-slate-900 mt-0.5">
              {inspection.templateTitle}
            </h2>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportPdf}
              className="px-3 py-1.5 rounded-lg text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-100 transition-colors flex items-center gap-1.5 text-xs font-semibold"
              title={t.reviewModal.exportPdfBtn}
            >
              <Printer className="w-3.5 h-3.5 text-blue-600" />
              <span>{t.reviewModal.exportPdfBtn}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs">
            <div>
              <span className="text-slate-400 block text-[11px]">
                {t.reviewModal.projectSite}
              </span>
              <span className="font-bold text-slate-900 mt-0.5 block truncate">
                {inspection.projectName}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">
                {t.reviewModal.zoneGrid}
              </span>
              <span className="font-bold text-slate-900 mt-0.5 block truncate">
                {inspection.siteZone}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">
                {t.reviewModal.inspector}
              </span>
              <span className="font-bold text-slate-900 mt-0.5 block truncate">
                {inspection.inspectorName}
              </span>
              <span className="text-[10px] text-slate-500">
                {translateRole(inspection.inspectorRole)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">
                {t.reviewModal.complianceScore}
              </span>
              <span
                className={`font-mono font-extrabold text-sm block mt-0.5 ${
                  inspection.scorePercent >= 90
                    ? 'text-emerald-600'
                    : inspection.scorePercent >= 75
                    ? 'text-amber-600'
                    : 'text-rose-600'
                }`}
              >
                {inspection.scorePercent}%
              </span>
              <span className="text-[10px] text-slate-500">
                {inspection.passedCount}P / {inspection.failedCount}F
              </span>
            </div>
          </div>

          {/* Attached Evidence Photography */}
          {inspection.evidencePhotos &&
            inspection.evidencePhotos.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase text-slate-700 tracking-wider mb-2.5">
                  {t.reviewModal.fieldEvidence.replace(
                    '{count}',
                    String(inspection.evidencePhotos.length)
                  )}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {inspection.evidencePhotos.map((photo, pIdx) => (
                    <div
                      key={pIdx}
                      className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50"
                    >
                      <img
                        src={photo.url}
                        alt="Inspection evidence"
                        referrerPolicy="no-referrer"
                        className="w-full h-44 object-cover"
                      />
                      <div className="p-3 text-xs">
                        <p className="text-slate-800 font-medium">
                          {photo.caption}
                        </p>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                          <span>
                            {t.reviewModal.recordedAt} {photo.timestamp}
                          </span>
                          <span>{photo.location}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Recorded Log Values */}
          <div>
            <h3 className="text-xs font-bold uppercase text-slate-700 tracking-wider mb-2.5">
              {t.reviewModal.itemizedResponses}
            </h3>
            <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden text-xs">
              {Object.entries(inspection.answers).map(([key, val]) => (
                <div
                  key={key}
                  className="p-3 flex items-center justify-between bg-white hover:bg-slate-50"
                >
                  <span className="text-slate-600 font-mono text-[11px]">
                    {t.reviewModal.fieldKey}: {key}
                  </span>
                  <span
                    className={`font-semibold text-xs ${
                      val === 'pass'
                        ? 'text-emerald-700'
                        : val === 'fail'
                        ? 'text-rose-700'
                        : 'text-slate-800'
                    }`}
                  >
                    {val === 'pass'
                      ? t.common.pass
                      : val === 'fail'
                      ? t.common.fail
                      : String(val)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* General Notes from Field */}
          {inspection.notes && (
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
              <span className="font-bold text-slate-700 block mb-1">
                {t.reviewModal.inspectorNotes}
              </span>
              <p className="text-slate-600 italic leading-relaxed">
                {inspection.notes}
              </p>
            </div>
          )}

          {/* Prior Verification Notes */}
          {inspection.reviewedBy && (
            <div className="bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-200/80 text-xs">
              <div className="flex items-center justify-between font-bold text-emerald-950 mb-1">
                <span>
                  {t.reviewModal.verificationSignoffBy
                    .replace('{name}', inspection.reviewedBy)
                    .replace(
                      '{role}',
                      translateRole(inspection.reviewedRole || 'HSE Officer')
                    )}
                </span>
                <span className="font-mono text-[10px] text-emerald-800">
                  {inspection.reviewedAt}
                </span>
              </div>
              <p className="text-emerald-900 leading-relaxed">
                {inspection.reviewNotes}
              </p>
            </div>
          )}

          {/* Review Directives Form */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <label className="block text-xs font-bold uppercase text-slate-700 tracking-wider">
              {t.reviewModal.assessmentDirectiveLabel}
            </label>
            <textarea
              rows={3}
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              placeholder={t.reviewModal.assessmentPlaceholder
                .replace('{name}', currentUser.name)
                .replace('{role}', translateRole(currentUser.role))}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {t.reviewModal.reviewerPersona}{' '}
            <span className="font-semibold text-slate-800">
              {currentUser.name}
            </span>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              onClick={() => onReject(inspection.id, reviewNotes)}
              className="px-4 py-2 rounded-lg border border-rose-300 text-rose-700 bg-white hover:bg-rose-50 text-xs font-bold transition-colors flex items-center"
            >
              <AlertOctagon className="w-3.5 h-3.5 mr-1.5" />
              {t.reviewModal.requestRevision}
            </button>
            <button
              onClick={() => onApprove(inspection.id, reviewNotes)}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors flex items-center shadow-xs"
            >
              <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
              {t.reviewModal.approveCertify}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
