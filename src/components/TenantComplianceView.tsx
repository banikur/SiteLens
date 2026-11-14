import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Flame,
  Award,
  Plus,
  Trash2,
  Building2,
  Calendar,
  Users,
  FileText,
  Activity,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type {
  TenantProfile,
  Smk3AuditLevel,
  ChemicalInventoryItem,
  UserRole,
} from '../types';
import {
  fetchTenantProfile,
  updateTenantProfileApi,
  addChemicalApi,
  removeChemicalApi,
  STANDARD_NAK_REFERENCE,
} from '../services/tenantClient.ts';
import { useLanguage } from '../i18n/LanguageContext';

interface TenantComplianceViewProps {
  currentUserRole?: UserRole;
}

export const TenantComplianceView: React.FC<TenantComplianceViewProps> = ({
  currentUserRole,
}) => {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<TenantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal for adding chemical
  const [chemModalOpen, setChemModalOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [chemName, setChemName] = useState('');
  const [chemCas, setChemCas] = useState('');
  const [chemCategory, setChemCategory] = useState<'Toxic' | 'Flammable' | 'Explosive' | 'Oxidizing' | 'Corrosive' | 'Other'>('Flammable');
  const [chemQty, setChemQty] = useState<number>(10000);
  const [chemNak, setChemNak] = useState<number>(50000);

  const isTenantAdmin = currentUserRole === 'HSE / Quality Manager & Tenant Admin';

  const loadData = async () => {
    setLoading(true);
    const data = await fetchTenantProfile();
    setProfile(data.profile);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleLevelChange = async (level: Smk3AuditLevel) => {
    if (!profile || !isTenantAdmin) return;
    setSaving(true);
    const updated = await updateTenantProfileApi({ targetSmk3Level: level });
    setProfile(updated);
    setSaving(false);
    setMessage({ text: `SMK3 audit level target updated to ${level.replace('_', ' ')}`, type: 'success' });
    setTimeout(() => setMessage(null), 3000);
  };

  const handlePresetSelect = (presetName: string) => {
    setSelectedPreset(presetName);
    const found = STANDARD_NAK_REFERENCE.find((p) => p.name === presetName);
    if (found) {
      setChemName(found.name);
      setChemCas(found.casNumber);
      setChemCategory(found.category);
      setChemNak(found.thresholdNakKg);
    }
  };

  const handleAddChemical = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chemName || chemQty <= 0 || chemNak <= 0) return;
    setSaving(true);
    const updated = await addChemicalApi({
      name: chemName,
      casNumber: chemCas || undefined,
      category: chemCategory,
      quantityStoredKg: chemQty,
      thresholdNakKg: chemNak,
    });
    setProfile(updated);
    setSaving(false);
    setChemModalOpen(false);
    setChemName('');
    setChemCas('');
    setSelectedPreset('');
    setMessage({ text: 'Chemical inventory item added and NAK ratio recalculated.', type: 'success' });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleRemoveChemical = async (id: string) => {
    if (!window.confirm('Remove this chemical from regulatory tracking?')) return;
    setSaving(true);
    const updated = await removeChemicalApi(id);
    setProfile(updated);
    setSaving(false);
    setMessage({ text: 'Chemical removed.', type: 'success' });
    setTimeout(() => setMessage(null), 3000);
  };

  if (loading || !profile) {
    return (
      <div className="flex items-center justify-center p-12">
        <Activity className="w-6 h-6 animate-spin text-amber-500 mr-2" />
        <span className="text-slate-600 font-medium text-sm">Loading Dual-Compliance Profile...</span>
      </div>
    );
  }

  const isMajorHazard = profile.chemicalHazardStatus === 'POTENSI_BAHAYA_BESAR';
  const isDisqualified = profile.smk3AwardStatus === 'DISQUALIFIED_CRITICAL_FINDING';

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-emerald-600" />
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
              Dual-Compliance & Tenant Profile
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Mekanisme Kepatuhan Ganda Nasional K3 (SMK3 PP No. 50/2012 & Kepmenaker 187/1999) dan Standar Internasional ISO 45001:2018
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Target Audit SMK3</span>
            <span className="text-sm font-bold text-slate-800">
              {profile.targetSmk3Level === 'AWAL_64'
                ? 'Tingkat Awal (64 Kriteria)'
                : profile.targetSmk3Level === 'TRANSISI_122'
                ? 'Tingkat Transisi (122 Kriteria)'
                : 'Tingkat Lanjutan (166 Kriteria)'}
            </span>
          </div>
          {isTenantAdmin && (
            <select
              value={profile.targetSmk3Level}
              disabled={saving}
              onChange={(e) => void handleLevelChange(e.target.value as Smk3AuditLevel)}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-slate-50 text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
            >
              <option value="AWAL_64">Tingkat Awal (64)</option>
              <option value="TRANSISI_122">Tingkat Transisi (122)</option>
              <option value="LANJUTAN_166">Tingkat Lanjutan (166)</option>
            </select>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              : 'bg-rose-50 text-rose-900 border border-rose-200'
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
      )}

      {/* KPI & Status Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Card 1: SMK3 Award Status */}
        <div className={`p-5 rounded-2xl border shadow-xs relative overflow-hidden bg-white ${
          isDisqualified
            ? 'border-rose-300 ring-2 ring-rose-500/20'
            : profile.smk3AwardStatus === 'MEMUASKAN_EMAS'
            ? 'border-amber-300'
            : 'border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Predikat Audit SMK3 PP 50/2012
            </span>
            <Award className={`w-5 h-5 ${
              isDisqualified
                ? 'text-rose-600'
                : profile.smk3AwardStatus === 'MEMUASKAN_EMAS'
                ? 'text-amber-500'
                : 'text-slate-400'
            }`} />
          </div>

          <div className="my-2">
            {isDisqualified ? (
              <div className="flex items-start gap-2 text-rose-700 bg-rose-50 p-2.5 rounded-xl border border-rose-200">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-xs block">DIBATALKAN TEMUAN KRITIKAL</span>
                  <p className="text-[11px] leading-tight mt-0.5 text-rose-800">
                    Sesuai Lampiran II PP 50/2012, keberadaan temuan K3 status Kritikal menggugurkan kelayakan sertifikasi.
                  </p>
                </div>
              </div>
            ) : profile.smk3AwardStatus === 'MEMUASKAN_EMAS' ? (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-amber-600 font-mono">
                  {profile.smk3OverallScorePercent}%
                </span>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                  Bendera Emas 🥇 (Memuaskan)
                </span>
              </div>
            ) : profile.smk3AwardStatus === 'BAIK_PERAK' ? (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-slate-700 font-mono">
                  {profile.smk3OverallScorePercent}%
                </span>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-200 text-slate-800 border border-slate-300">
                  Bendera Perak 🥈 (Baik)
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-rose-600 font-mono">
                  {profile.smk3OverallScorePercent}%
                </span>
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                  Kurang (&lt;60%)
                </span>
              </div>
            )}
          </div>

          <div className="mt-3 text-xs text-slate-500 space-y-1 border-t border-slate-100 pt-3">
            <div className="flex justify-between">
              <span>Total Kriteria Aktif:</span>
              <span className="font-bold font-mono text-slate-800">
                {profile.targetSmk3Level === 'AWAL_64' ? 64 : profile.targetSmk3Level === 'TRANSISI_122' ? 122 : 166}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Standar PP 50/2012:</span>
              <span className="font-mono text-slate-600">85%-100% Emas, 60%-84% Perak</span>
            </div>
          </div>
        </div>

        {/* Card 2: Chemical Hazard Installation (Kepmenaker 187/1999) */}
        <div className={`p-5 rounded-2xl border shadow-xs relative overflow-hidden bg-white ${
          isMajorHazard ? 'border-rose-300 bg-rose-50/20' : 'border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Klasifikasi BKB (Kepmenaker 187/1999)
            </span>
            <Flame className={`w-5 h-5 ${isMajorHazard ? 'text-rose-600 animate-pulse' : 'text-amber-500'}`} />
          </div>

          <div className="my-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-extrabold px-3 py-1.5 rounded-lg border ${
                isMajorHazard
                  ? 'bg-rose-600 text-white border-rose-700'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-300'
              }`}>
                {isMajorHazard ? 'POTENSI BAHAYA BESAR' : 'POTENSI BAHAYA MENENGAH'}
              </span>
              <span className="font-mono text-xs font-bold text-slate-600">
                Ratio: {profile.chemicalCumulativeRatio}x NAK
              </span>
            </div>
          </div>

          <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
            {isMajorHazard
              ? 'Wajib memiliki min. 2 Ahli K3 Kimia, 5 Petugas K3 Kimia bergilir, dan Dokumen Pengendalian Instalasi Potensi Bahaya Besar.'
              : 'Akumulasi kuantitas bahan kimia di bawah Nilai Ambang Kuantitas (NAK). Wajib min. 1 Petugas K3 Kimia.'}
          </p>

          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Personel K3 Kimia:</span>
            <span className="font-semibold text-slate-800">
              {profile.ahliK3KimiaCount} Ahli / {profile.petugasK3KimiaCount} Petugas
            </span>
          </div>
        </div>

        {/* Card 3: Facility Metadata */}
        <div className="p-5 rounded-2xl border border-slate-200 shadow-xs bg-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Profil Fasilitas & Organisasi
              </span>
              <Building2 className="w-5 h-5 text-slate-400" />
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Nama Entitas</span>
                <span className="font-bold text-slate-900">{profile.companyName}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-semibold">Lokasi Fasilitas</span>
                <span className="font-medium text-slate-700">{profile.facilityLocation}</span>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Tenaga Kerja</span>
                  <span className="font-bold text-slate-900">{profile.workforceCount} Orang</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Tingkat Bahaya</span>
                  <span className="font-bold text-rose-600">{profile.riskLevel} RISK</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Kewajiban SMK3: <strong className="text-slate-800">&ge; 100 Tenaga Kerja atau Risiko Tinggi (Wajib PP 50/2012)</strong>
          </div>
        </div>
      </div>

      {/* Major Chemical Hazard (BKB) Management Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-500" />
              Inventaris Bahan Kimia Berbahaya & Evaluasi NAK (Kepmenaker 187/1999)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Perbandingan kuantitas bahan kimia tersimpan terhadap Nilai Ambang Kuantitas (NAK). Total kumulatif rasio &gt; 1.0 menetapkan instalasi Potensi Bahaya Besar.
            </p>
          </div>
          {isTenantAdmin && (
            <button
              onClick={() => setChemModalOpen(true)}
              className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs self-start sm:self-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Tambah Bahan Kimia
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-bold">Nama Bahan Kimia</th>
                <th className="py-3 px-4 font-bold">CAS No.</th>
                <th className="py-3 px-4 font-bold">Kategori</th>
                <th className="py-3 px-4 font-bold text-right">Kuantitas Tersimpan (kg)</th>
                <th className="py-3 px-4 font-bold text-right">Ambang NAK (kg)</th>
                <th className="py-3 px-4 font-bold text-right">Rasio Beban (q / NAK)</th>
                <th className="py-3 px-4 font-bold text-center">Status</th>
                {isTenantAdmin && <th className="py-3 px-4 font-bold text-center">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {profile.chemicalInventory.length === 0 ? (
                <tr>
                  <td colSpan={isTenantAdmin ? 8 : 7} className="py-8 text-center text-slate-400">
                    Belum ada data inventaris bahan kimia tersimpan. Klik "Tambah Bahan Kimia" untuk memulai.
                  </td>
                </tr>
              ) : (
                profile.chemicalInventory.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-900">{item.name}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-500">{item.casNumber || '-'}</td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-700">
                        {item.category}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {item.quantityStoredKg.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono text-slate-600 tabular-nums">
                      {item.thresholdNakKg.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold tabular-nums">
                      <span className={item.ratio >= 1.0 ? 'text-rose-600' : item.ratio >= 0.5 ? 'text-amber-600' : 'text-slate-700'}>
                        {item.ratio.toFixed(4)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      {item.ratio >= 1.0 ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                          Melebihi NAK
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          Di Bawah NAK
                        </span>
                      )}
                    </td>
                    {isTenantAdmin && (
                      <td className="py-3.5 px-4 text-center">
                        <button
                          onClick={() => void handleRemoveChemical(item.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                          title="Hapus bahan kimia"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
            {profile.chemicalInventory.length > 0 && (
              <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                <tr>
                  <td colSpan={5} className="py-3 px-4 text-right text-slate-800">
                    Total Kumulatif Rasio Bahaya (&sum; q_i / NAK_i):
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-sm tabular-nums">
                    <span className={profile.chemicalCumulativeRatio > 1.0 ? 'text-rose-600' : 'text-emerald-700'}>
                      {profile.chemicalCumulativeRatio.toFixed(4)}
                    </span>
                  </td>
                  <td colSpan={isTenantAdmin ? 2 : 1} className="py-3 px-4 text-center">
                    <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${
                      profile.chemicalCumulativeRatio > 1.0
                        ? 'bg-rose-600 text-white'
                        : 'bg-emerald-600 text-white'
                    }`}>
                      {profile.chemicalHazardStatus.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Dual-Compliance Matrix: 12 Elemen SMK3 PP 50/2012 <-> ISO 45001:2018 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            Matriks Pemetaan Kepatuhan Ganda (12 Elemen SMK3 & Klausul ISO 45001:2018)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Penyelarasan kriteria audit nasional PP 50/2012 terhadap sistem manajemen keselamatan internasional ISO 45001:2018.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-bold">Elemen SMK3 (PP 50/2012)</th>
                <th className="py-3 px-4 font-bold">Klausul ISO 45001:2018</th>
                <th className="py-3 px-4 font-bold text-right">Kriteria Aktif</th>
                <th className="py-3 px-4 font-bold text-right">Memenuhi</th>
                <th className="py-3 px-4 font-bold text-right">Temuan / Cacat</th>
                <th className="py-3 px-4 font-bold text-center">Tingkat Pemenuhan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {profile.smk3ElementsMap.map((elem) => (
                <tr key={elem.elementNumber} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3.5 px-4">
                    <span className="font-bold text-slate-900 block">
                      Elemen {elem.elementNumber}: {elem.elementName}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span className="font-bold text-emerald-700 block font-mono text-[11px]">
                      {elem.iso45001Clause}
                    </span>
                    <span className="text-[11px] text-slate-500">{elem.iso45001Title}</span>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-800 tabular-nums">
                    {elem.criteriaActive}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-emerald-700 font-semibold tabular-nums">
                    {elem.passedCriteria}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                    <span className={elem.failedCriteria > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}>
                      {elem.failedCriteria}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${
                            elem.complianceRate >= 85
                              ? 'bg-emerald-500'
                              : elem.complianceRate >= 60
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${elem.complianceRate}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs font-bold text-slate-800">
                        {elem.complianceRate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Chemical Modal */}
      {chemModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-500" />
                Tambah Bahan Kimia Berbahaya (BKB)
              </h3>
              <button
                onClick={() => setChemModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddChemical} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Pilih dari Nilai Ambang Baku (Kepmenaker 187/1999)
                </label>
                <select
                  value={selectedPreset}
                  onChange={(e) => handlePresetSelect(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">-- Kustom / Input Manual --</option>
                  {STANDARD_NAK_REFERENCE.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} (NAK: {p.thresholdNakKg.toLocaleString()} kg) [{p.category}]
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Bahan Kimia & Lokasi Fasilitas
                </label>
                <input
                  type="text"
                  required
                  value={chemName}
                  onChange={(e) => setChemName(e.target.value)}
                  placeholder="mis. Tangki Ammonia Refrigerant Skid #1"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nomor CAS (Opsional)
                  </label>
                  <input
                    type="text"
                    value={chemCas}
                    onChange={(e) => setChemCas(e.target.value)}
                    placeholder="mis. 7664-41-7"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Kategori Bahaya
                  </label>
                  <select
                    value={chemCategory}
                    onChange={(e) => setChemCategory(e.target.value as any)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    <option value="Toxic">Toxic (Beracun)</option>
                    <option value="Flammable">Flammable (Mudah Terbakar)</option>
                    <option value="Explosive">Explosive (Mudah Meledak)</option>
                    <option value="Oxidizing">Oxidizing (Oksidator)</option>
                    <option value="Corrosive">Corrosive (Korosif)</option>
                    <option value="Other">Lainnya</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Kuantitas Tersimpan (kg)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={chemQty}
                    onChange={(e) => setChemQty(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nilai Ambang Kuantitas NAK (kg)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={chemNak}
                    onChange={(e) => setChemNak(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600">
                Rasio Bahaya: <strong className="font-mono text-slate-900">{(chemQty / chemNak).toFixed(4)}x</strong> dari batas NAK.
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setChemModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-colors"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Bahan Kimia'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

