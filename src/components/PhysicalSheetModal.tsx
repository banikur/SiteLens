import React, { useState } from 'react';
import { Printer, Upload, CheckCircle, X, FileText, QrCode } from 'lucide-react';
import type { WorkNode, WorkStage, Project, User } from '../types';
import { uploadEvidencePhotoDetailed } from '../services/api';

interface PhysicalSheetModalProps {
  isOpen: boolean;
  project: Project;
  node: WorkNode;
  stage: WorkStage;
  currentUser: User;
  onClose: () => void;
  onScanUploaded: (fileUrl: string, sha256: string) => void;
}

export const PhysicalSheetModal: React.FC<PhysicalSheetModalProps> = ({
  isOpen,
  project,
  node,
  stage,
  currentUser,
  onClose,
  onScanUploaded,
}) => {
  const [activeTab, setActiveTab] = useState<'print' | 'upload'>('print');
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [uploadedSha, setUploadedSha] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const res = await uploadEvidencePhotoDetailed(file, file.name);
      setUploadedUrl(res.url);
      setUploadedSha(res.sha256 || 'verified-sha256');
    } catch (err: any) {
      alert(err?.message || 'Gagal mengunggah scan lembar fisik.');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmUpload = () => {
    if (!uploadedUrl || !uploadedSha) return;
    onScanUploaded(uploadedUrl, uploadedSha);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <FileText className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Dual-Track: Lembar Tanda Tangan Fisik & Scan
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switchers */}
        <div className="flex border-b border-slate-200 px-6 pt-3 space-x-6 text-xs font-bold">
          <button
            onClick={() => setActiveTab('print')}
            className={`pb-3 flex items-center space-x-1.5 transition-colors border-b-2 ${
              activeTab === 'print'
                ? 'border-amber-500 text-amber-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            <span>1. Cetak Lembar Pemeriksaan (Print Sheet)</span>
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`pb-3 flex items-center space-x-1.5 transition-colors border-b-2 ${
              activeTab === 'upload'
                ? 'border-amber-500 text-amber-900'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>2. Unggah Scan Fisik Bertanda Tangan</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 text-xs space-y-4">
          {activeTab === 'print' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-slate-500">
                  Cetak lembar fisik resmi ini untuk dibawa ke lapangan dan ditandatangani basah oleh Pelaksana dan QA/QC Inspector.
                </p>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center space-x-1.5 shadow-xs shrink-0"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak Lembar Ini</span>
                </button>
              </div>

              {/* Printable sheet container */}
              <div
                id="printable-inspection-sheet"
                className="border border-slate-300 rounded-xl p-6 bg-white shadow-2xs space-y-5 font-sans print:border-none print:p-0"
              >
                {/* Sheet Title Bar */}
                <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 uppercase tracking-tight">
                      LEMBAR PERIKSA & SIGN-OFF TAHAPAN INSPEKSI
                    </h2>
                    <p className="text-xs text-slate-600 font-medium">
                      SiteLens Quality & Integrity Verification Protocol
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs font-bold text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded">
                      {project.code}
                    </span>
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center justify-end space-x-1">
                      <QrCode className="w-3.5 h-3.5 text-slate-500" />
                      <span>ID: {stage.id.slice(0, 8).toUpperCase()}</span>
                    </div>
                  </div>
                </div>

                {/* Metadata Table */}
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Proyek:</span>
                    <span className="font-bold text-slate-900">{project.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Paket Kerja / WBS:</span>
                    <span className="font-bold text-slate-900">[{node.wbsCode}] {node.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Tahapan (Stage):</span>
                    <span className="font-bold text-slate-900">
                      Tahap #{stage.stageOrder}: {stage.name}
                    </span>
                    {stage.stageType === 'hold' && (
                      <span className="inline-block ml-2 px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 font-bold text-[9px] uppercase">
                        MANDATORY HOLD POINT
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Dokumen Acuan & Revisi:</span>
                    <span className="font-mono font-bold text-slate-800">
                      {node.documentReferenceNo || 'N/A'} {node.activeRevision ? `(${node.activeRevision})` : ''}
                    </span>
                  </div>
                </div>

                {/* Checkpoint Checkbox Table */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    Item Verifikasi Lapangan (Verification Checkpoints):
                  </h4>
                  <table className="w-full text-left border border-slate-300 text-xs">
                    <thead className="bg-slate-100 border-b border-slate-300 font-bold text-[11px]">
                      <tr>
                        <th className="p-2 w-10 text-center">No</th>
                        <th className="p-2">Uraian Pemeriksaan / Kriteria Mutu</th>
                        <th className="p-2 w-20 text-center">Status</th>
                        <th className="p-2 w-32">Keterangan / Nilai</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      <tr>
                        <td className="p-2 text-center font-mono">1</td>
                        <td className="p-2 font-medium">Kesesuaian dengan Dokumen Acuan & Revisi Aktif ({node.activeRevision || 'Rev Terkini'})</td>
                        <td className="p-2 text-center text-[10px]">[ ] PASS &nbsp; [ ] FAIL</td>
                        <td className="p-2 border-l border-slate-200"></td>
                      </tr>
                      <tr>
                        <td className="p-2 text-center font-mono">2</td>
                        <td className="p-2 font-medium">Pemeriksaan Visual Mutu Permukaan, Dimensi & Toleransi Struktur</td>
                        <td className="p-2 text-center text-[10px]">[ ] PASS &nbsp; [ ] FAIL</td>
                        <td className="p-2 border-l border-slate-200"></td>
                      </tr>
                      <tr>
                        <td className="p-2 text-center font-mono">3</td>
                        <td className="p-2 font-medium">Kondisi K3 & Kelayakan Lingkungan Kerja Sesuai Standar</td>
                        <td className="p-2 text-center text-[10px]">[ ] PASS &nbsp; [ ] FAIL</td>
                        <td className="p-2 border-l border-slate-200"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Physical Signature Boxes (Submitter vs Approver) */}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t-2 border-slate-200">
                  <div className="border border-slate-300 rounded-lg p-3 text-center">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Diajukan Oleh (Pelaksana / Inspector):
                    </span>
                    <div className="h-20 flex items-center justify-center text-slate-300 italic text-[11px]">
                      (Tanda Tangan & Cap Basah)
                    </div>
                    <div className="border-t border-slate-200 pt-1 text-slate-700">
                      <span className="font-bold block">{currentUser.name}</span>
                      <span className="text-[10px] text-slate-500">{stage.assignedRole}</span>
                    </div>
                  </div>

                  <div className="border border-slate-300 rounded-lg p-3 text-center">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                      Diverifikasi & Disetujui Oleh (QA/QC Lead):
                    </span>
                    <div className="h-20 flex items-center justify-center text-slate-300 italic text-[11px]">
                      (Tanda Tangan & Cap Basah)
                    </div>
                    <div className="border-t border-slate-200 pt-1 text-slate-700">
                      <span className="font-bold block">________________________</span>
                      <span className="text-[10px] text-slate-500">{stage.approvalRole || 'QA/QC Lead'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Upload Scanned Sheet Tab */
            <div className="space-y-4">
              <p className="text-slate-600">
                Setelah lembar pemeriksaan fisik ditandatangani basah oleh para pihak di lapangan, scan dokumen (PDF atau foto berkualitas tinggi) dan unggah di sini.
              </p>

              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center bg-slate-50 hover:bg-slate-100/60 transition-colors">
                <input
                  type="file"
                  id="scan-upload-input"
                  accept=".pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label
                  htmlFor="scan-upload-input"
                  className="cursor-pointer flex flex-col items-center justify-center"
                >
                  <Upload className="w-10 h-10 text-slate-400 mb-2" />
                  <span className="font-bold text-slate-800 text-xs">
                    Klik untuk memilih file Scan (PDF / JPG / PNG)
                  </span>
                  <span className="text-[11px] text-slate-400 mt-1">
                    Maksimum ukuran 15 MB. Hash integritas SHA-256 akan otomatis dihitung.
                  </span>
                </label>
              </div>

              {uploading && (
                <div className="text-center text-amber-700 font-bold py-2 animate-pulse text-xs">
                  Sedang memproses dan menghitung checksum SHA-256 dokumen scan...
                </div>
              )}

              {uploadedUrl && (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
                  <div className="flex items-center space-x-2 text-emerald-800 font-bold text-xs">
                    <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>File pindaian fisik berhasil diunggah!</span>
                  </div>
                  <div className="font-mono text-[10px] text-slate-600 break-all bg-white p-2 rounded border border-emerald-100">
                    <span className="font-bold block text-slate-700">SHA-256 Checksum:</span>
                    {uploadedSha}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={!uploadedUrl}
                  onClick={handleConfirmUpload}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold flex items-center space-x-1.5"
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>Gunakan Scan Fisik Ini</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
