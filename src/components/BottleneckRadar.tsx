import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Clock,
  ShieldAlert,
  CheckCircle,
  RefreshCw,
  Bell,
  ArrowRight,
} from 'lucide-react';
import type { BottleneckItem, Project, User } from '../types';
import { apiGetBottleneckRadar } from '../services/api';

interface BottleneckRadarProps {
  project: Project;
  currentUser: User;
  onOpenStageWorkflow?: (wbsCode: string) => void;
}

export const BottleneckRadar: React.FC<BottleneckRadarProps> = ({
  project,
  currentUser,
  onOpenStageWorkflow,
}) => {
  const [loading, setLoading] = useState(true);
  const [bottlenecks, setBottlenecks] = useState<BottleneckItem[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [normalCount, setNormalCount] = useState(0);
  const [notifiedId, setNotifiedId] = useState<string | null>(null);

  const loadRadar = async () => {
    try {
      setLoading(true);
      const res = await apiGetBottleneckRadar(project.id);
      setBottlenecks(res.bottlenecks || []);
      setCriticalCount(res.criticalCount || 0);
      setWarningCount(res.warningCount || 0);
      setNormalCount(res.normalCount || 0);
    } catch (err: any) {
      console.error('Failed to load bottleneck radar:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRadar();
  }, [project.id]);

  const handleSendReminder = (item: BottleneckItem) => {
    setNotifiedId(item.stageId);
    setTimeout(() => setNotifiedId(null), 3000);
  };

  return (
    <div className="space-y-5">
      {/* KPI Status Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-xl bg-white border border-rose-300 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-rose-700 block">
              Antrean kritis (&gt;48 jam)
            </span>
            <span className="text-2xl font-mono tabular-nums font-bold text-rose-700 mt-1 block">
              {criticalCount}
            </span>
            <span className="text-[10px] text-rose-600 mt-0.5 block">
              Potensi penggeseran jadwal kritis
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center font-bold">
            <ShieldAlert className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-amber-300 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-amber-800 block">
              Peringatan SLA (24 – 48 jam)
            </span>
            <span className="text-2xl font-mono tabular-nums font-bold text-amber-700 mt-1 block">
              {warningCount}
            </span>
            <span className="text-[10px] text-amber-600 mt-0.5 block">
              Perlu tindak lanjut reviewer
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center font-bold">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">
              Antrean normal (&lt;24 jam)
            </span>
            <span className="text-2xl font-mono tabular-nums font-bold text-slate-800 mt-1 block">
              {normalCount}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Dalam batas toleransi standar
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 flex items-center justify-center font-bold">
            <CheckCircle className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Bottlenecks List Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-900 flex items-center space-x-2">
              <Clock className="w-4 h-4 text-slate-800" />
              <span>Bottleneck Radar: Antrean inspeksi & umur waktu tunggu (SLA)</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Menghitung waktu tunggu persetujuan inspeksi sejak diajukan pelaksana di lapangan.
            </p>
          </div>

          <button
            type="button"
            onClick={loadRadar}
            aria-label="Refresh Bottleneck Radar"
            className="min-w-[36px] min-h-[36px] p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors flex items-center justify-center"
            title="Refresh Radar"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 text-xs">
          {loading ? (
            <div className="p-8 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-300" />
              Memindai antrean inspeksi proyek...
            </div>
          ) : bottlenecks.length === 0 ? (
            <div className="p-8 text-center text-slate-400 space-y-1">
              <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="font-semibold text-slate-700">Radar Bersih: Tidak ada antrean inspeksi tertunda.</p>
              <p className="text-[11px] text-slate-400">Semua tahapan inspeksi telah ditinjau atau belum ada pengajuan baru.</p>
            </div>
          ) : (
            bottlenecks.map((item) => (
              <div
                key={item.stageId}
                className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 transition-colors ${
                  item.status === 'critical' ? 'bg-rose-50/30' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 mt-0.5 ${
                      item.status === 'critical'
                        ? 'bg-rose-100 text-rose-700'
                        : item.status === 'warning'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#d4f038] bg-[#0b0e14] border border-slate-800 px-2 py-0.5 rounded">
                        {item.wbsCode}
                      </span>
                      <h4 className="font-bold text-slate-900 text-xs">{item.stageName}</h4>

                      {item.isCriticalPath && (
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300 text-[10px] font-mono font-bold">
                          CRITICAL PATH
                        </span>
                      )}

                      {item.isPaused && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300 text-[10px] font-mono font-bold">
                          SLA PAUSED
                        </span>
                      )}

                      {item.dayType && item.dayType !== 'workday' && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-mono font-bold">
                          {item.dayType === 'holiday' ? 'HOLIDAY WORK' : 'WEEKEND WORK'}
                        </span>
                      )}

                      {item.stageType === 'hold' && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-mono font-bold">
                          HOLD POINT
                        </span>
                      )}

                      {item.stageStatus && (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                            item.stageStatus === 'requested'
                              ? 'bg-blue-100 text-blue-900 border border-blue-200'
                              : 'bg-slate-100 text-slate-800 border border-slate-300'
                          }`}
                        >
                          {item.stageStatus.toUpperCase()}
                        </span>
                      )}

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono tabular-nums font-bold ${
                          item.status === 'critical'
                            ? 'bg-rose-100 text-rose-900 border border-rose-300'
                            : item.status === 'warning'
                            ? 'bg-amber-100 text-amber-900 border border-amber-300'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {item.status === 'critical'
                          ? `CRITICAL (${item.waitingHours}h)`
                          : item.status === 'warning'
                          ? `WARNING (${item.waitingHours}h)`
                          : `NORMAL (${item.waitingHours}h)`}
                      </span>
                    </div>

                    <p className="text-slate-500 text-[11px] mt-0.5">
                      Paket Kerja: <b className="text-slate-700">{item.nodeName}</b> &bull; Diajukan oleh: {item.submitterName} (Percobaan #{item.attemptNumber})
                    </p>

                    <div className="flex items-center space-x-3 text-[10px] text-slate-400 mt-1">
                      <span>Wajib Di-approve Oleh: <b className="text-slate-600">{item.approvalRole}</b></span>
                      {item.scheduleImpactDays > 0 && (
                        <>
                          <span>&bull;</span>
                          <span className="text-rose-600 font-semibold">
                            Estimasi Geser Jadwal: ~{item.scheduleImpactDays} Hari
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSendReminder(item)}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center space-x-1 transition-colors"
                  >
                    <Bell className="w-3 h-3 text-slate-600" />
                    <span>{notifiedId === item.stageId ? 'Terkirim ✓' : 'Kirim reminder'}</span>
                  </button>

                  {onOpenStageWorkflow && (
                    <button
                      type="button"
                      onClick={() => onOpenStageWorkflow(item.wbsCode)}
                      className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold flex items-center space-x-1 shadow-xs transition-colors"
                    >
                      <span>Tinjau</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
