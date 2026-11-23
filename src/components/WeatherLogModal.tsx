import React, { useState, useEffect } from 'react';
import {
  CloudRain,
  Sun,
  CloudLightning,
  Cloud,
  AlertTriangle,
  Plus,
  X,
  CheckCircle,
  Calendar,
  FileText,
} from 'lucide-react';
import type { DailyWeatherLog, Project, User } from '../types';
import { apiGetWeatherLogs, apiCreateWeatherLog } from '../services/api';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';

interface WeatherLogModalProps {
  project: Project;
  currentUser: User;
  isOpen: boolean;
  onClose: () => void;
}

export const WeatherLogModal: React.FC<WeatherLogModalProps> = ({
  project,
  currentUser,
  isOpen,
  onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<DailyWeatherLog[]>([]);
  const [impact, setImpact] = useState({
    totalRainDays: 0,
    totalRainHours: 0,
    stopTotalDays: 0,
    partialDays: 0,
    recommendedEotDays: 0,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form states
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formCondition, setFormCondition] = useState<string>('hujan_lebat');
  const [formRainHours, setFormRainHours] = useState<string>('3.5');
  const [formImpact, setFormImpact] = useState<string>('stop_total');
  const [formNotes, setFormNotes] = useState<string>('');

  const loadLogs = async () => {
    try {
      setLoading(true);
      const res = await apiGetWeatherLogs(project.id);
      setLogs(res.logs || []);
      if (res.impact) setImpact(res.impact);
    } catch (err: any) {
      console.error('Failed to load weather logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLogs();
    }
  }, [isOpen, project.id]);

  if (!isOpen) return null;

  const handleSaveLog = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await apiCreateWeatherLog(project.id, {
        logDate: formDate,
        weatherCondition: formCondition,
        rainHours: parseFloat(formRainHours) || 0,
        workImpact: formImpact,
        notes: formNotes,
      });

      setFormOpen(false);
      setFormNotes('');
      await loadLogs();
    } catch (err: any) {
      alert(err?.message || 'Gagal menyimpan catatan cuaca.');
    } finally {
      setSubmitting(false);
    }
  };

  const { can, isLoading: isLoadingPerms } = usePermission();
  const isViewer = isLoadingPerms || !can(PERMISSIONS.WEATHER_LOG, project.id);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <CloudRain className="w-5 h-5 text-slate-700" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Buku Harian Cuaca, Curah Hujan & Klaim EOT
              </h3>
              <p className="text-[11px] text-slate-500">
                {project.name} &bull; Dasar hukum pencatatan force majeure & kompensasi perpanjangan waktu
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
          {/* EOT Impact Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-medium text-slate-500 block">Total jam hujan</span>
              <span className="text-lg font-mono tabular-nums font-bold text-slate-800 mt-1 block">
                {impact.totalRainHours} Jam
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[11px] font-medium text-slate-500 block">Hari hujan</span>
              <span className="text-lg font-mono tabular-nums font-bold text-slate-800 mt-1 block">
                {impact.totalRainDays} Hari
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900">
              <span className="text-[11px] font-medium text-rose-700 block">Stop total kerja</span>
              <span className="text-lg font-mono tabular-nums font-bold text-rose-800 mt-1 block">
                {impact.stopTotalDays} Hari
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#0b0e14] border border-slate-800 text-white">
              <span className="text-[11px] font-medium text-[#d4f038] block">Klaim EOT layak</span>
              <span className="text-lg font-mono tabular-nums font-bold text-[#d4f038] mt-1 block">
                +{impact.recommendedEotDays} Hari
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-slate-700 text-xs">
              Daftar buku harian cuaca lapangan:
            </h4>

            {!isViewer && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold flex items-center space-x-1 shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Catat cuaca hari ini</span>
              </button>
            )}
          </div>

          {/* New Weather Log Form */}
          {formOpen && (
            <form onSubmit={handleSaveLog} className="p-4 rounded-xl border border-slate-300 bg-slate-50/60 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2 font-bold text-slate-900">
                <span>Formulir pencatatan cuaca harian</span>
                <button type="button" onClick={() => setFormOpen(false)} className="text-slate-400 hover:text-slate-700">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Tanggal *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-900 bg-white focus:outline-none focus:border-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Kondisi cuaca dominan *
                  </label>
                  <select
                    value={formCondition}
                    onChange={(e) => setFormCondition(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-900 bg-white focus:outline-none focus:border-slate-800"
                  >
                    <option value="cerah">Cerah (Sunny)</option>
                    <option value="berawan">Berawan (Cloudy)</option>
                    <option value="hujan_ringan">Hujan Ringan (Light Rain)</option>
                    <option value="hujan_lebat">Hujan Lebat (Heavy Rain)</option>
                    <option value="badai">Badai & Angin Kencang (Storm)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Durasi curah hujan (jam) *
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="24"
                    required
                    value={formRainHours}
                    onChange={(e) => setFormRainHours(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono tabular-nums text-slate-900 bg-white focus:outline-none focus:border-slate-800"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Dampak terhadap operasional fisik *
                  </label>
                  <select
                    value={formImpact}
                    onChange={(e) => setFormImpact(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-900 bg-white focus:outline-none focus:border-slate-800"
                  >
                    <option value="tidak_ada">Tidak Ada Dampak (Normal)</option>
                    <option value="parsial">Dampak Parsial (Kompensasi 0.5 Hari EOT)</option>
                    <option value="stop_total">Pekerjaan Stop Total (Kompensasi 1.0 Hari EOT)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 text-xs mb-1">
                  Catatan lapangan & justifikasi
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Contoh: Hujan lebat disertai petir menghentikan pekerjaan erection baja dan operasi tower crane pukul 13:00 - 16:30."
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-900 bg-white focus:outline-none focus:border-slate-800"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-3.5 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors"
                >
                  Simpan catatan
                </button>
              </div>
            </form>
          )}

          {/* Weather Logs Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-bold text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Tanggal</th>
                  <th className="py-2.5 px-3">Kondisi Cuaca</th>
                  <th className="py-2.5 px-3">Durasi Hujan</th>
                  <th className="py-2.5 px-3">Dampak Lapangan</th>
                  <th className="py-2.5 px-3">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      Memuat buku harian cuaca...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400">
                      Belum ada pencatatan cuaca harian.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-2 px-3 font-mono font-medium text-slate-800">
                        {String(log.logDate).slice(0, 10)}
                      </td>
                      <td className="py-2 px-3">
                        <span className="capitalize font-medium text-slate-700 flex items-center space-x-1.5">
                          {log.weatherCondition === 'cerah' ? (
                            <Sun className="w-3.5 h-3.5 text-amber-500" />
                          ) : log.weatherCondition === 'badai' ? (
                            <CloudLightning className="w-3.5 h-3.5 text-rose-500" />
                          ) : (
                            <CloudRain className="w-3.5 h-3.5 text-indigo-500" />
                          )}
                          <span>{log.weatherCondition.replace('_', ' ')}</span>
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-800">
                        {Number(log.rainHours).toFixed(1)} Jam
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            log.workImpact === 'stop_total'
                              ? 'bg-rose-100 text-rose-800'
                              : log.workImpact === 'parsial'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {log.workImpact.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-slate-500 truncate max-w-xs text-[11px]">
                        {log.notes || '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
          <span className="text-slate-500">
            Perhitungan klaim mengacu pada standar FIDIC Red Book & PP Konstruksi Nasional.
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
    </div>
  );
};
