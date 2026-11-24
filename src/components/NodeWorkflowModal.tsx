import React, { useState, useEffect } from 'react';
import {
  X,
  Sparkles,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Clock,
  Send,
  Eye,
  Lock,
  PenTool,
  Printer,
  FileCheck2,
  RefreshCw,
  CheckSquare,
} from 'lucide-react';
import type { WorkNode, WorkWorkflow, WorkStage, InspectionAttempt, Project, User } from '../types';
import {
  apiGetNodeWorkflow,
  apiInitDefaultWorkflow,
  apiRequestStageRfi,
  apiSubmitStageAttempt,
  apiReviewStageAttempt,
} from '../services/api';
import { canProceedToStage, validateFourEyes, validateFourEyesDetails } from '../utils/workflow';
import { SignatureCanvasModal } from './SignatureCanvasModal';
import { PhysicalSheetModal } from './PhysicalSheetModal';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';

interface NodeWorkflowModalProps {
  isOpen: boolean;
  project: Project;
  node: WorkNode;
  currentUser: User;
  onClose: () => void;
  onWorkflowUpdated: () => void;
}

export const NodeWorkflowModal: React.FC<NodeWorkflowModalProps> = ({
  isOpen,
  project,
  node,
  currentUser,
  onClose,
  onWorkflowUpdated,
}) => {
  const [loading, setLoading] = useState(true);
  const [workflow, setWorkflow] = useState<WorkWorkflow | null>(null);
  const [stages, setStages] = useState<WorkStage[]>([]);
  const [attempts, setAttempts] = useState<InspectionAttempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active action states
  const [submittingStage, setSubmittingStage] = useState<WorkStage | null>(null);
  const [reviewingStage, setReviewingStage] = useState<WorkStage | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected'>('approved');
  const [reviewNotes, setReviewNotes] = useState('');

  // Dual-track signature modals
  const [sigCanvasOpen, setSigCanvasOpen] = useState(false);
  const [physicalModalOpen, setPhysicalModalOpen] = useState(false);
  const [targetSigStage, setTargetSigStage] = useState<WorkStage | null>(null);
  const [capturedDigitalSig, setCapturedDigitalSig] = useState<string | null>(null);
  const [capturedWetScanUrl, setCapturedWetScanUrl] = useState<string | null>(null);

  // Submission answers state
  const [checkpoint1, setCheckpoint1] = useState(true);
  const [checkpoint2, setCheckpoint2] = useState(true);
  const [checkpoint3, setCheckpoint3] = useState(true);
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadWorkflowData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiGetNodeWorkflow(project.id, node.id);
      setWorkflow(res.workflow);
      setStages(res.stages || []);
      setAttempts(res.attempts || []);
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat tahapan workflow.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadWorkflowData();
    }
  }, [isOpen, project.id, node.id]);

  if (!isOpen) return null;

  const handleInitDefault = async () => {
    try {
      setActionLoading(true);
      const res = await apiInitDefaultWorkflow(project.id, node.id);
      setWorkflow(res.workflow);
      setStages(res.stages);
      setSuccessMsg('Template 3-tahap inspeksi standar (Preparation, Hold Point, Sign-off) berhasil dibuat.');
      onWorkflowUpdated();
    } catch (err: any) {
      alert(err?.message || 'Gagal membuat workflow standar.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenSubmit = (stage: WorkStage) => {
    const check = canProceedToStage(stages, stage.id);
    if (!check.allowed) {
      alert(`Peringatan Hold Point:\n${check.reason}`);
      return;
    }

    setSubmittingStage(stage);
    setCapturedDigitalSig(null);
    setCapturedWetScanUrl(null);
    setCheckpoint1(true);
    setCheckpoint2(true);
    setCheckpoint3(true);
    setSubmissionNotes('');
  };

  const handleRequestRfi = async (stage: WorkStage) => {
    const check = canProceedToStage(stages, stage.id);
    if (!check.allowed) {
      alert(`Peringatan Hold Point:\n${check.reason}`);
      return;
    }

    try {
      setActionLoading(true);
      const res = await apiRequestStageRfi(stage.id);
      setSuccessMsg(res.message);
      await loadWorkflowData();
      onWorkflowUpdated();
    } catch (err: any) {
      alert(err?.message || 'Gagal mengajukan RFI.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submittingStage) return;

    if (!capturedDigitalSig && !capturedWetScanUrl) {
      alert('Pilih salah satu metode tanda tangan: Tanda Tangan Digital Kanvas ATAU Unggah Scan Lembar Fisik.');
      return;
    }

    try {
      setActionLoading(true);
      const payload = {
        answers: {
          specCompliance: checkpoint1 ? 'PASS' : 'FAIL',
          qualityTolerance: checkpoint2 ? 'PASS' : 'FAIL',
          safetyConditions: checkpoint3 ? 'PASS' : 'FAIL',
          notes: submissionNotes,
        },
        signatureCanvasUrl: capturedDigitalSig,
        wetSignatureDocumentUrl: capturedWetScanUrl,
      };

      const res = await apiSubmitStageAttempt(submittingStage.id, payload);
      setSuccessMsg(res.message);
      setSubmittingStage(null);
      await loadWorkflowData();
      onWorkflowUpdated();
    } catch (err: any) {
      alert(err?.message || 'Gagal mengajukan inspeksi.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenReview = (stage: WorkStage) => {
    const stageAttempts = attempts.filter((a) => a.stageId === stage.id);
    const latest = stageAttempts[0];

    if (!latest) {
      alert('Belum ada pengajuan inspeksi pada tahapan ini untuk ditinjau.');
      return;
    }

    // Four-Eyes Principle check on client
    const fourEyesCheck = validateFourEyesDetails(
      latest.requesterId,
      latest.submitterId,
      currentUser.id
    );

    if (!fourEyesCheck.valid) {
      alert(fourEyesCheck.reason || 'Pelanggaran Prinsip Four-Eyes: Anda tidak diizinkan menyetujui tahapan ini.');
      return;
    }

    setReviewingStage(stage);
    setReviewDecision('approved');
    setReviewNotes('');
  };

  const handleReviewAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingStage) return;

    try {
      setActionLoading(true);
      const res = await apiReviewStageAttempt(reviewingStage.id, {
        decision: reviewDecision,
        notes: reviewNotes,
      });

      setSuccessMsg(res.message);
      setReviewingStage(null);
      await loadWorkflowData();
      onWorkflowUpdated();
    } catch (err: any) {
      alert(err?.message || 'Gagal meninjau inspeksi.');
    } finally {
      setActionLoading(false);
    }
  };

  const { can, isLoading: isLoadingPerms } = usePermission();
  const isViewer = isLoadingPerms || !can(PERMISSIONS.STAGE_EXECUTE, project.id);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-3xl w-full shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2.5">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#0b0e14] text-[#d4f038] border border-slate-800">
              {node.wbsCode}
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900 leading-tight">
                Multi-Stage Workflow: {node.name}
              </h3>
              <p className="text-[11px] text-slate-500">
                Alur tahapan, titik kritis (Hold Point), dan otorisasi tanda tangan ganda
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Workflow Status Banner & Personnel Assignment */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-medium text-slate-500">
                  Target acuan gambar:
                </span>
                <span className="font-bold text-slate-800">
                  {node.documentReferenceNo || 'DWG-STD-001'} {node.activeRevision ? `(${node.activeRevision})` : '(Rev B)'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-800 font-mono">
                  Bobot: <b>{Number(node.weightPercent).toFixed(2)}%</b>
                </span>
                <span className="px-2 py-0.5 rounded bg-[#d4f038]/20 border border-[#d4f038]/40 text-slate-900 font-mono font-bold">
                  Terverifikasi: {node.verifiedProgressPercent}%
                </span>
                <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-mono">
                  SE: {node.assignedEngineerName || 'Dave Kowalski (Site Engineer)'}
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-mono">
                  QC: {node.assignedQcName || 'Elena Rostova (QA/QC Lead)'}
                </span>
              </div>
            </div>

            {stages.length === 0 && !loading && (
              <button
                type="button"
                onClick={handleInitDefault}
                disabled={actionLoading || isViewer}
                className="px-3.5 py-2 rounded-lg bg-[#0b0e14] hover:bg-[#161c28] text-[#d4f038] border border-slate-800 font-bold flex items-center space-x-1.5 shadow-xs shrink-0 disabled:opacity-50 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#d4f038]" />
                <span>Buat 3-tahap workflow standar</span>
              </button>
            )}
          </div>

          {/* Stages List */}
          {loading ? (
            <div className="py-12 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-300" />
              Memuat data tahapan inspeksi...
            </div>
          ) : stages.length === 0 ? (
            <div className="py-12 text-center border-2 border-dashed border-slate-200 rounded-xl">
              <ShieldAlert className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">Belum ada tahapan inspeksi untuk item ini.</p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
                Gunakan tombol "Buat 3-Tahap Workflow Standar" di atas untuk menambahkan alur Persiapan, Hold Point Uji Kualitas, dan Witness Sign-Off.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <h4 className="font-semibold text-slate-700 text-xs">
                Urutan tahapan inspeksi (sequential pipeline):
              </h4>

              {stages.map((stage) => {
                const stageAttempts = attempts.filter((a) => a.stageId === stage.id);
                const latestAttempt = stageAttempts[0];
                const progression = canProceedToStage(stages, stage.id);
                const isBlocked = !progression.allowed && stage.status !== 'approved';

                return (
                  <div
                    key={stage.id}
                    className={`rounded-xl border p-4 transition-all ${stage.status === 'approved'
                        ? 'border-emerald-200 bg-emerald-50/20 text-slate-900'
                        : stage.status === 'rejected'
                          ? 'border-rose-200 bg-rose-50/30 text-slate-900'
                          : stage.status === 'requested'
                            ? 'border-blue-200 bg-blue-50/20 text-slate-900'
                            : isBlocked
                              ? 'border-slate-200 bg-slate-50/60 opacity-80 text-slate-700'
                              : 'border-slate-300 bg-white shadow-2xs text-slate-900'
                      }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-start space-x-3">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold font-mono text-xs shrink-0 mt-0.5 ${stage.status === 'approved'
                              ? 'bg-[#d4f038] text-[#0b0e14]'
                              : stage.status === 'rejected'
                                ? 'bg-rose-600 text-white'
                                : stage.status === 'requested'
                                  ? 'bg-blue-600 text-white'
                                  : isBlocked
                                    ? 'bg-slate-200 text-slate-500'
                                    : 'bg-[#0b0e14] text-white'
                            }`}
                        >
                          {stage.stageOrder}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-900 text-xs">
                              {stage.name}
                            </span>

                            {/* Stage Type Badge */}
                            {stage.stageType === 'hold' ? (
                              <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-300 font-bold font-mono text-[9px] border border-rose-800 flex items-center space-x-1">
                                <Lock className="w-2.5 h-2.5" />
                                <span>HOLD POINT</span>
                              </span>
                            ) : stage.stageType === 'review' ? (
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold font-mono text-[9px] border border-slate-200">
                                WITNESS / REVIEW
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold font-mono text-[9px] border border-slate-200">
                                WORK EXECUTION
                              </span>
                            )}

                            {/* Status Pill */}
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${stage.status === 'approved'
                                  ? 'bg-slate-900 text-[#d4f038] border border-slate-800'
                                  : stage.status === 'rejected'
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                    : stage.status === 'submitted'
                                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                      : stage.status === 'requested'
                                        ? 'bg-blue-100 text-blue-900 border border-blue-300'
                                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                                }`}
                            >
                              {stage.status.toUpperCase()}
                            </span>
                          </div>

                          <div className="flex items-center space-x-3 text-[11px] text-slate-500 mt-1">
                            <span>Pelaksana: <b>{stage.assignedRole}</b></span>
                            <span>•</span>
                            <span>Otorisasi: <b>{stage.approvalRole || 'QA/QC Lead'}</b></span>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons for this Stage */}
                      {!isViewer && (
                        <div className="flex items-center space-x-2 shrink-0">
                          {/* If stage is pending */}
                          {stage.status === 'pending' && (
                            <>
                              {can(PERMISSIONS.STAGE_REQUEST, project.id) && (
                                <button
                                  type="button"
                                  onClick={() => handleRequestRfi(stage)}
                                  disabled={actionLoading}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center space-x-1 shadow-xs transition-colors"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>Ajukan RFI</span>
                                </button>
                              )}
                              {can(PERMISSIONS.STAGE_EXECUTE, project.id) && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenSubmit(stage)}
                                  className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs flex items-center space-x-1 shadow-xs transition-colors"
                                >
                                  <CheckSquare className="w-3 h-3" />
                                  <span>Isi Checklist</span>
                                </button>
                              )}
                            </>
                          )}

                          {/* If stage is requested (RFI Submitted, ready for field inspection) */}
                          {stage.status === 'requested' && can(PERMISSIONS.STAGE_EXECUTE, project.id) && (
                            <button
                              type="button"
                              onClick={() => handleOpenSubmit(stage)}
                              className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs flex items-center space-x-1 shadow-xs transition-colors"
                            >
                              <Send className="w-3 h-3" />
                              <span>Eksekusi & Submit</span>
                            </button>
                          )}

                          {/* If stage was rejected */}
                          {stage.status === 'rejected' && (
                            <>
                              {can(PERMISSIONS.STAGE_REQUEST, project.id) && (
                                <button
                                  type="button"
                                  onClick={() => handleRequestRfi(stage)}
                                  disabled={actionLoading}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center space-x-1 shadow-xs transition-colors"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>Ajukan Ulang RFI</span>
                                </button>
                              )}
                              {can(PERMISSIONS.STAGE_EXECUTE, project.id) && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenSubmit(stage)}
                                  className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs flex items-center space-x-1 shadow-xs transition-colors"
                                >
                                  <Send className="w-3 h-3" />
                                  <span>Submit Ulang</span>
                                </button>
                              )}
                            </>
                          )}

                          {/* If stage is submitted, show Review button */}
                          {stage.status === 'submitted' && can(PERMISSIONS.STAGE_APPROVE, project.id) && (
                            <button
                              type="button"
                              onClick={() => handleOpenReview(stage)}
                              className="px-3 py-1.5 rounded-lg bg-[#0b0e14] hover:bg-[#161c28] text-white font-bold text-xs flex items-center space-x-1 shadow-xs transition-colors"
                            >
                              <FileCheck2 className="w-3 h-3 text-[#d4f038]" />
                              <span>Review & Sign-Off</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Lockout Warning if blocked */}
                    {isBlocked && (
                      <div className="mt-2.5 p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-center space-x-1.5">
                        <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        <span>{progression.reason}</span>
                      </div>
                    )}

                    {/* Attempt History Details */}
                    {latestAttempt && (
                      <div className="mt-3 pt-3 border-t border-slate-200/80 text-[11px] space-y-1.5">
                        <div className="flex items-center justify-between text-slate-600">
                          <span>
                            Percobaan Terakhir: <b>#{latestAttempt.attemptNumber}</b> &bull; Diajukan {String(latestAttempt.submittedAt).slice(0, 16)}
                          </span>
                          {latestAttempt.decidedAt && (
                            <span className="font-semibold">
                              Ditinjau {String(latestAttempt.decidedAt).slice(0, 16)}
                            </span>
                          )}
                        </div>

                        {latestAttempt.rejectionReason && (
                          <div className="p-2 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[11px]">
                            <b>Catatan Penolakan / Perbaikan:</b> {latestAttempt.rejectionReason}
                          </div>
                        )}

                        <div className="flex items-center space-x-3 text-slate-500 text-[10px]">
                          {latestAttempt.signatureCanvasUrl && (
                            <span className="flex items-center text-indigo-700 font-medium">
                              <PenTool className="w-3 h-3 mr-1" />
                              Tanda Tangan Digital Terlampir
                            </span>
                          )}
                          {latestAttempt.wetSignatureDocumentUrl && (
                            <span className="flex items-center text-emerald-700 font-medium">
                              <Printer className="w-3 h-3 mr-1" />
                              Scan Lembar Fisik Terlampir
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
          <span className="text-slate-500">
            Enforcement: Four-Eyes Principle & Anti-Tamper Checksum Aktif
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
          >
            Tutup
          </button>
        </div>
      </div>

      {/* Submission Form Modal Dialog */}
      {submittingStage && (
        <div className="fixed inset-0 z-60 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">
                Pengajuan inspeksi: {submittingStage.name}
              </h3>
              <button onClick={() => setSubmittingStage(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitAttempt} className="p-6 space-y-4 text-xs">
              {/* Checkpoints */}
              <div className="space-y-2.5">
                <label className="font-medium text-slate-700 text-xs block">
                  Kriteria verifikasi lapangan:
                </label>
                <label className="flex items-center space-x-2 p-2 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkpoint1}
                    onChange={(e) => setCheckpoint1(e.target.checked)}
                    className="rounded text-slate-900 focus:ring-slate-800 w-4 h-4"
                  />
                  <span className="text-slate-800">
                    Kesesuaian gambar & spesifikasi aktif ({node.documentReferenceNo || 'Terkini'})
                  </span>
                </label>
                <label className="flex items-center space-x-2 p-2 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkpoint2}
                    onChange={(e) => setCheckpoint2(e.target.checked)}
                    className="rounded text-slate-900 focus:ring-slate-800 w-4 h-4"
                  />
                  <span className="text-slate-800">
                    Mutu material dan dimensi toleransi fisik memenuhi syarat
                  </span>
                </label>
                <label className="flex items-center space-x-2 p-2 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkpoint3}
                    onChange={(e) => setCheckpoint3(e.target.checked)}
                    className="rounded text-slate-900 focus:ring-slate-800 w-4 h-4"
                  />
                  <span className="text-slate-800">
                    Penerapan K3 (APD lengkap, zonasi aman) terpenuhi
                  </span>
                </label>
              </div>

              {/* Notes */}
              <div>
                <label className="block font-medium text-slate-700 text-xs mb-1">
                  Catatan pelaksana atau hasil uji
                </label>
                <textarea
                  rows={2}
                  value={submissionNotes}
                  onChange={(e) => setSubmissionNotes(e.target.value)}
                  placeholder="Masukkan pengamatan lapangan atau hasil uji tekan..."
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-slate-800"
                />
              </div>

              {/* Dual-Track Signature Selection */}
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <label className="font-medium text-slate-700 text-xs block">
                  Otorisasi tanda tangan (pilih salah satu):
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTargetSigStage(submittingStage);
                      setSigCanvasOpen(true);
                    }}
                    className={`p-3 rounded-lg border text-left flex flex-col justify-between transition-colors ${capturedDigitalSig
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 hover:border-slate-400 bg-white'
                      }`}
                  >
                    <div className="flex items-center space-x-1.5 font-semibold text-xs">
                      <PenTool className={`w-3.5 h-3.5 ${capturedDigitalSig ? 'text-[#d4f038]' : 'text-slate-700'}`} />
                      <span>Digital kanvas</span>
                    </div>
                    <span className={`text-[10px] mt-1 ${capturedDigitalSig ? 'text-[#d4f038]' : 'text-slate-500'}`}>
                      {capturedDigitalSig ? '✓ Tanda tangan tersimpan' : 'Goreskan di layar sentuh'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTargetSigStage(submittingStage);
                      setPhysicalModalOpen(true);
                    }}
                    className={`p-3 rounded-lg border text-left flex flex-col justify-between transition-colors ${capturedWetScanUrl
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 hover:border-slate-400 bg-white'
                      }`}
                  >
                    <div className="flex items-center space-x-1.5 font-semibold text-xs">
                      <Printer className={`w-3.5 h-3.5 ${capturedWetScanUrl ? 'text-[#d4f038]' : 'text-slate-700'}`} />
                      <span>Cetak & scan fisik</span>
                    </div>
                    <span className={`text-[10px] mt-1 ${capturedWetScanUrl ? 'text-[#d4f038]' : 'text-slate-500'}`}>
                      {capturedWetScanUrl ? '✓ Dokumen scan terunggah' : 'Cetak sheet & upload scan'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setSubmittingStage(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold flex items-center space-x-1 shadow-xs transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Kirimkan pengajuan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review & Sign-Off Modal Dialog */}
      {reviewingStage && (
        <div className="fixed inset-0 z-60 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">
                Review & verifikasi mutu: {reviewingStage.name}
              </h3>
              <button onClick={() => setReviewingStage(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleReviewAttempt} className="p-6 space-y-4 text-xs">
              <div className="p-3.5 rounded-lg bg-[#0b0e14] border border-slate-800 text-slate-200 space-y-1">
                <span className="font-bold block text-white">Pemeriksa independen (QA/QC Lead):</span>
                <span className="text-[#d4f038] font-mono">{currentUser.name} ({currentUser.role})</span>
                <span className="block text-[10px] text-slate-400 mt-1">
                  Enforcement: Anda bertindak sebagai pihak verifikator kedua independen sesuai prinsip Four-Eyes.
                </span>
              </div>

              <div>
                <label className="block font-medium text-slate-700 text-xs mb-1.5">
                  Keputusan verifikasi mutu:
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-300 cursor-pointer hover:bg-slate-50 transition-colors">
                    <input
                      type="radio"
                      name="decision"
                      value="approved"
                      checked={reviewDecision === 'approved'}
                      onChange={() => setReviewDecision('approved')}
                      className="text-slate-900 focus:ring-slate-800"
                    />
                    <span className="font-bold text-emerald-800">Setujui (Approve)</span>
                  </label>
                  <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-300 cursor-pointer hover:bg-slate-50 transition-colors">
                    <input
                      type="radio"
                      name="decision"
                      value="rejected"
                      checked={reviewDecision === 'rejected'}
                      onChange={() => setReviewDecision('rejected')}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <span className="font-bold text-rose-800">Tolak & perbaikan</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 text-xs mb-1">
                  Catatan direktif verifikator
                </label>
                <textarea
                  rows={3}
                  required={reviewDecision === 'rejected'}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder={
                    reviewDecision === 'approved'
                      ? 'Catatan verifikasi atau instruksi lanjutan (opsional)...'
                      : 'Wajib: Jelaskan ketidaksesuaian yang ditemukan dan instruksi perbaikan...'
                  }
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setReviewingStage(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className={`px-4 py-2 rounded-lg font-bold flex items-center space-x-1 shadow-xs transition-colors ${reviewDecision === 'approved'
                      ? 'bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14]'
                      : 'bg-rose-600 hover:bg-rose-500 text-white'
                    }`}
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  <span>Kirimkan keputusan</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Signature Canvas Modal */}
      <SignatureCanvasModal
        isOpen={sigCanvasOpen}
        currentUser={currentUser}
        onClose={() => setSigCanvasOpen(false)}
        onSaveSignature={(dataUrl) => {
          setCapturedDigitalSig(dataUrl);
          setSigCanvasOpen(false);
        }}
      />

      {/* Physical Sheet Print & Scan Modal */}
      {targetSigStage && (
        <PhysicalSheetModal
          isOpen={physicalModalOpen}
          project={project}
          node={node}
          stage={targetSigStage}
          currentUser={currentUser}
          onClose={() => setPhysicalModalOpen(false)}
          onScanUploaded={(fileUrl) => {
            setCapturedWetScanUrl(fileUrl);
            setPhysicalModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
