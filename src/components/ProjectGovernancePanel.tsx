import React, { useEffect, useState } from 'react';
import { Calendar, RefreshCw, FilePlus2, Check, X, Clock } from 'lucide-react';
import type { NationalHoliday, Project, ProjectCalendar, User, VariationOrder, WeekendWorkMode, WorkNode } from '../types';
import {
  apiCreateVariationOrder,
  apiDecideVariationOrder,
  apiGetHolidays,
  apiGetProjectCalendar,
  apiGetVariationOrders,
  apiSyncHolidays,
  apiUpdateProjectCalendar,
} from '../services/api';

interface ProjectGovernancePanelProps {
  project: Project;
  nodes: WorkNode[];
  currentUser: User;
  onRefresh: () => void;
}

export const ProjectGovernancePanel: React.FC<ProjectGovernancePanelProps> = ({
  project,
  nodes,
  currentUser,
  onRefresh,
}) => {
  const currentYear = new Date().getFullYear();
  const [calendar, setCalendar] = useState<ProjectCalendar>({
    projectId: project.id,
    workStartHour: '08:00',
    workEndHour: '17:00',
    saturdayMode: 'non_working',
    sundayMode: 'non_working',
    holidayOverrides: {},
  });
  const [holidays, setHolidays] = useState<NationalHoliday[]>([]);
  const [vos, setVos] = useState<VariationOrder[]>([]);
  const [savingCal, setSavingCal] = useState(false);
  const [syncingHolidays, setSyncingHolidays] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // VO Form State
  const [voTitle, setVoTitle] = useState('');
  const [voDesc, setVoDesc] = useState('');
  const [voType, setVoType] = useState<VariationOrder['voType']>('scope_addition');
  const [targetNodeId, setTargetNodeId] = useState('');
  const [allowWorkBeforeApproval, setAllowWorkBeforeApproval] = useState(true);
  const [newWeightPercent, setNewWeightPercent] = useState('');
  const [submittingVo, setSubmittingVo] = useState(false);

  const loadAll = async () => {
    const [calRes, holRes, voRes] = await Promise.all([
      apiGetProjectCalendar(project.id),
      apiGetHolidays(currentYear),
      apiGetVariationOrders(project.id),
    ]);
    setCalendar(calRes.calendar);
    setHolidays(holRes.holidays || []);
    setVos(voRes.variationOrders || []);
  };

  useEffect(() => {
    void loadAll();
  }, [project.id]);

  const handleSaveCalendar = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingCal(true);
      const res = await apiUpdateProjectCalendar(project.id, calendar);
      setCalendar(res.calendar);
      setStatusMsg('Kalender kerja proyek berhasil disimpan.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Gagal menyimpan kalender kerja.');
    } finally {
      setSavingCal(false);
    }
  };

  const handleSyncHolidays = async () => {
    try {
      setSyncingHolidays(true);
      const res = await apiSyncHolidays(currentYear);
      setHolidays(res.holidays || []);
      setStatusMsg(`Berhasil sinkronisasi ${res.count} hari libur nasional ${currentYear} dari tanggalans.com.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Gagal sinkronisasi hari libur nasional.');
    } finally {
      setSyncingHolidays(false);
    }
  };

  const toggleHolidayOverride = (dateStr: string) => {
    setCalendar((prev) => {
      const current = prev.holidayOverrides?.[dateStr];
      const next = { ...(prev.holidayOverrides || {}) };
      if (current === 'working') {
        delete next[dateStr];
      } else {
        next[dateStr] = 'working';
      }
      return { ...prev, holidayOverrides: next };
    });
  };

  const handleCreateVo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voTitle.trim() || !voDesc.trim()) return;
    try {
      setSubmittingVo(true);
      await apiCreateVariationOrder(project.id, {
        title: voTitle.trim(),
        description: voDesc.trim(),
        voType,
        allowWorkBeforeApproval,
        targetNodeId: targetNodeId || null,
        proposedChanges: newWeightPercent ? { newWeightPercent: Number(newWeightPercent) } : {},
      });
      setVoTitle('');
      setVoDesc('');
      setTargetNodeId('');
      setNewWeightPercent('');
      await loadAll();
      onRefresh();
      setStatusMsg('Variation Order berhasil diajukan.');
    } catch (err: any) {
      setStatusMsg(err?.message || 'Gagal mengajukan Variation Order.');
    } finally {
      setSubmittingVo(false);
    }
  };

  const handleDecideVo = async (voId: string, decision: 'approved' | 'rejected') => {
    try {
      await apiDecideVariationOrder(project.id, voId, decision);
      await loadAll();
      onRefresh();
      setStatusMsg(`Variation Order ${decision === 'approved' ? 'disetujui' : 'ditolak'}.`);
    } catch (err: any) {
      setStatusMsg(err?.message || 'Gagal memproses keputusan VO.');
    }
  };

  return (
    <div className="space-y-6 text-xs">
      {statusMsg && (
        <div className="px-3 py-2 rounded-lg bg-slate-900 text-[#d4f038] font-medium flex items-center justify-between">
          <span>{statusMsg}</span>
          <button type="button" onClick={() => setStatusMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Section 1: Working Calendar & National Holidays */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <form onSubmit={handleSaveCalendar} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 flex items-center space-x-1.5">
              <Clock className="w-4 h-4 text-slate-700" />
              <span>Kalender Kerja & Aturan Akhir Pekan</span>
            </h3>
            <button
              type="submit"
              disabled={savingCal}
              className="px-3 py-1 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-50"
            >
              {savingCal ? 'Menyimpan...' : 'Simpan Kalender'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-slate-600 font-semibold block mb-1">Jam Mulai (Senin–Jumat)</span>
              <input
                type="time"
                value={calendar.workStartHour}
                onChange={(e) => setCalendar({ ...calendar, workStartHour: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-600 font-semibold block mb-1">Jam Selesai</span>
              <input
                type="time"
                value={calendar.workEndHour}
                onChange={(e) => setCalendar({ ...calendar, workEndHour: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-600 font-semibold block mb-1">Aturan Hari Sabtu</span>
              <select
                value={calendar.saturdayMode}
                onChange={(e) => setCalendar({ ...calendar, saturdayMode: e.target.value as WeekendWorkMode })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              >
                <option value="non_working">Libur (Non-Working)</option>
                <option value="half_day">Setengah Hari (Half Day)</option>
                <option value="full_working">Kerja Penuh (Full Working)</option>
              </select>
            </label>
            <label className="block">
              <span className="text-slate-600 font-semibold block mb-1">Aturan Hari Minggu</span>
              <select
                value={calendar.sundayMode}
                onChange={(e) => setCalendar({ ...calendar, sundayMode: e.target.value as WeekendWorkMode })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
              >
                <option value="non_working">Libur (Non-Working)</option>
                <option value="half_day">Setengah Hari (Half Day)</option>
                <option value="full_working">Kerja Penuh (Full Working)</option>
              </select>
            </label>
          </div>
          <p className="text-[11px] text-slate-500">
            * Sabtu/Minggu/tanggal merah tidak mengubah bobot progres Kurva-S, hanya memengaruhi SLA Radar & penandaan kerja lembur/libur.
          </p>
        </form>

        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 flex items-center space-x-1.5">
              <Calendar className="w-4 h-4 text-slate-700" />
              <span>Hari Libur Nasional ({currentYear})</span>
            </h3>
            <button
              type="button"
              onClick={handleSyncHolidays}
              disabled={syncingHolidays}
              className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-800 font-semibold hover:bg-slate-100 flex items-center space-x-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingHolidays ? 'animate-spin' : ''}`} />
              <span>Sync tanggalans.com</span>
            </button>
          </div>

          {holidays.length === 0 ? (
            <p className="text-slate-500 py-4 text-center">
              Belum ada cache libur nasional {currentYear}. Klik &quot;Sync tanggalans.com&quot; untuk mengambil data.
            </p>
          ) : (
            <div className="max-h-40 overflow-y-auto divide-y divide-slate-200 bg-white rounded-lg border border-slate-200">
              {holidays.map((h) => {
                const isWorkingOverride = calendar.holidayOverrides?.[h.holidayDate] === 'working';
                return (
                  <div key={h.holidayDate} className="px-3 py-1.5 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-slate-800 mr-2">{h.holidayDate}</span>
                      <span className="text-slate-700">{h.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleHolidayOverride(h.holidayDate)}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        isWorkingOverride
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {isWorkingOverride ? 'Masuk / Lembur' : 'Libur'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Variation Orders (Non-blocking field execution) */}
      <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4">
        <h3 className="font-bold text-slate-900 flex items-center space-x-1.5">
          <FilePlus2 className="w-4 h-4 text-slate-700" />
          <span>Variation Order (VO) — Pekerjaan Tambah & Revisi</span>
        </h3>

        <form onSubmit={handleCreateVo} className="grid grid-cols-1 md:grid-cols-6 gap-2.5 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <input
            type="text"
            placeholder="Judul VO (misal: Tambah Pondasi Borepile)"
            value={voTitle}
            onChange={(e) => setVoTitle(e.target.value)}
            required
            className="md:col-span-2 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
          />
          <select
            value={voType}
            onChange={(e) => setVoType(e.target.value as VariationOrder['voType'])}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
          >
            <option value="scope_addition">Tambah Lingkup</option>
            <option value="schedule_revision">Revisi Jadwal</option>
            <option value="weight_rebalance">Rebalance Bobot</option>
            <option value="scope_reduction">Kurang Lingkup</option>
          </select>
          <select
            value={targetNodeId}
            onChange={(e) => setTargetNodeId(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
          >
            <option value="">-- Target Node WBS (Opsional) --</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.wbsCode} - {n.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            placeholder="Bobot Baru (%)"
            value={newWeightPercent}
            onChange={(e) => setNewWeightPercent(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
          />
          <button
            type="submit"
            disabled={submittingVo}
            className="px-3 py-1.5 rounded-lg bg-[#d4f038] text-[#0b0e14] font-bold hover:bg-[#c4e820] disabled:opacity-50"
          >
            {submittingVo ? 'Mengajukan...' : '+ Ajukan VO'}
          </button>
          <input
            type="text"
            placeholder="Deskripsi teknis & alasan perubahan..."
            value={voDesc}
            onChange={(e) => setVoDesc(e.target.value)}
            required
            className="md:col-span-4 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
          />
          <label className="md:col-span-2 flex items-center space-x-2 text-slate-700 font-medium">
            <input
              type="checkbox"
              checked={allowWorkBeforeApproval}
              onChange={(e) => setAllowWorkBeforeApproval(e.target.checked)}
            />
            <span>Pekerjaan tetap berjalan sebelum VO di-approve</span>
          </label>
        </form>

        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          {vos.length === 0 ? (
            <div className="p-6 text-center text-slate-400">Belum ada pengajuan Variation Order pada site ini.</div>
          ) : (
            vos.map((vo) => {
              const isSelf = vo.requestedBy === currentUser.id;
              return (
                <div key={vo.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-slate-900 text-[#d4f038]">
                        {vo.voNumber}
                      </span>
                      <span className="font-bold text-slate-900">{vo.title}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          vo.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : vo.status === 'rejected'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {vo.status.replace('_', ' ')}
                      </span>
                      {vo.allowWorkBeforeApproval && vo.status === 'pending_approval' && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-100 text-sky-800">
                          PROVISIONAL (AKTIF DI LAPANGAN)
                        </span>
                      )}
                    </div>
                    <p className="text-slate-600 mt-0.5">{vo.description}</p>
                  </div>

                  {vo.status === 'pending_approval' && (
                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => handleDecideVo(vo.id, 'approved')}
                        title={isSelf ? 'Four-eyes: pengaju tidak boleh menyetujui sendiri' : 'Setujui VO'}
                        className="px-2.5 py-1 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-40 flex items-center space-x-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                      <button
                        type="button"
                        disabled={isSelf}
                        onClick={() => handleDecideVo(vo.id, 'rejected')}
                        className="px-2.5 py-1 rounded bg-rose-600 text-white font-semibold hover:bg-rose-700 disabled:opacity-40 flex items-center space-x-1"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
