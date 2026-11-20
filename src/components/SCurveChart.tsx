import React, { useState, useId } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Edit3,
  X,
  Info,
} from 'lucide-react';
import type { SCurveSummary, User } from '../types';
import { apiOverrideSCurve } from '../services/api';

interface SCurveChartProps {
  scurve: SCurveSummary;
  currentUser: User;
  onRefresh: () => void;
}

export const SCurveChart: React.FC<SCurveChartProps> = ({
  scurve,
  currentUser,
  onRefresh,
}) => {
  const chartId = useId();
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [selectedWeekForOverride, setSelectedWeekForOverride] = useState<number>(1);
  const [overrideValue, setOverrideValue] = useState<string>('50.00');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const canOverride =
    currentUser.role === 'Project Director & Tenant Admin' ||
    currentUser.role === 'Project / Site Engineer';

  const points = scurve.points || [];
  const svgWidth = 720;
  const svgHeight = 260;
  const paddingX = 45;
  const paddingY = 30;

  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  const count = Math.max(1, points.length);

  const getX = (idx: number) => {
    if (count === 1) return paddingX + chartWidth / 2;
    return paddingX + (idx / (count - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    const clamped = Math.max(0, Math.min(100, val));
    return paddingY + chartHeight - (clamped / 100) * chartHeight;
  };

  const targetPath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.targetCumulative)}`)
    .join(' ');

  const claimedPath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.claimedCumulative)}`)
    .join(' ');

  const verifiedPath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(idx)} ${getY(p.verifiedCumulative)}`)
    .join(' ');

  const handleOpenOverride = (weekIdx: number, currentTarget: number) => {
    if (!canOverride) return;
    setSelectedWeekForOverride(weekIdx);
    setOverrideValue(currentTarget.toFixed(2));
    setOverrideReason('');
    setOverrideModalOpen(true);
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(overrideValue);
    if (isNaN(val) || val < 0 || val > 100) {
      alert('Masukkan persentase rencana yang valid antara 0 - 100%.');
      return;
    }

    try {
      setSubmitting(true);
      await apiOverrideSCurve(scurve.projectId, selectedWeekForOverride, val, overrideReason);
      setOverrideModalOpen(false);
      onRefresh();
    } catch (err: any) {
      alert(err?.message || 'Gagal menyimpan override kurva rencana.');
    } finally {
      setSubmitting(false);
    }
  };

  const activePoint =
    hoveredPointIndex !== null ? points[hoveredPointIndex] : points[scurve.currentWeekIndex - 1] || points[0];

  return (
    <div className="space-y-5">
      {/* KPI Headline Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">
            Target Rencana (Planned)
          </span>
          <div className="flex items-baseline space-x-1.5 mt-1">
            <span className="text-xl font-mono font-bold text-slate-800">
              {scurve.currentPlannedPercent.toFixed(2)}%
            </span>
            <span className="text-[11px] text-slate-500 font-mono">Minggu #{scurve.currentWeekIndex}</span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Jadwal Kalender Baku</span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-amber-700 block">
            Klaim Lapangan (Claimed)
          </span>
          <div className="flex items-baseline space-x-1.5 mt-1">
            <span className="text-xl font-mono font-bold text-amber-600">
              {scurve.currentClaimedPercent.toFixed(2)}%
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Laporan Progres Kontraktor</span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-emerald-200 bg-emerald-50/20 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-emerald-800 block">
            Fisik Terverifikasi (Verified)
          </span>
          <div className="flex items-baseline space-x-1.5 mt-1">
            <span className="text-xl font-mono font-bold text-emerald-700">
              {scurve.currentVerifiedPercent.toFixed(2)}%
            </span>
          </div>
          <span className="text-[10px] text-emerald-700/80 block mt-0.5">
            Lolos Gerbang Inspeksi & Bebas Cacat
          </span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[10px] uppercase font-bold text-slate-400 block">
            Deviasi / Varian (Δ)
          </span>
          <div className="flex items-baseline space-x-2 mt-1">
            <span
              className={`text-xl font-mono font-bold ${
                scurve.currentVariance >= 0 ? 'text-emerald-700' : 'text-rose-600'
              }`}
            >
              {scurve.currentVariance >= 0 ? `+${scurve.currentVariance.toFixed(2)}%` : `${scurve.currentVariance.toFixed(2)}%`}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                scurve.status === 'ahead'
                  ? 'bg-emerald-100 text-emerald-800'
                  : scurve.status === 'delayed'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {scurve.status === 'ahead' ? 'Lebih Cepat' : scurve.status === 'delayed' ? 'Terlambat' : 'Tepat Waktu'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Terhadap Kurva Target
          </span>
        </div>
      </div>

      {/* Main S-Curve Chart Container */}
      <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center space-x-2">
              <TrendingUp className="w-4 h-4 text-amber-600" />
              <span>Visualisasi Kurva S Mingguan (Senin 00:00 – Minggu 23:59)</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Arahkan kursor ke titik minggu untuk melihat detail bobot kumulatif dan deviasi per periode.
            </p>
          </div>

          {/* Legend */}
          <div className="flex items-center space-x-4 text-[11px] font-medium text-slate-600">
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-0.5 bg-slate-400 inline-block border-t border-dashed border-slate-600" />
              <span>Target Rencana</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-0.5 bg-amber-400 inline-block" />
              <span>Klaim Lapangan</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="w-3 h-0.5 bg-emerald-500 inline-block" />
              <span className="font-bold text-emerald-800">Fisik Terverifikasi</span>
            </div>
          </div>
        </div>

        {/* SVG Canvas Chart */}
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-64 select-none"
            aria-label="Kurva S Diagram"
          >
            {/* Background Grid Lines (0%, 25%, 50%, 75%, 100%) */}
            {[0, 25, 50, 75, 100].map((val) => {
              const y = getY(val);
              return (
                <g key={val}>
                  <line
                    x1={paddingX}
                    y1={y}
                    x2={svgWidth - paddingX}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeDasharray="3 3"
                    strokeWidth="1"
                  />
                  <text
                    x={paddingX - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize="9"
                    fontFamily="monospace"
                    fill="#94a3b8"
                  >
                    {val}%
                  </text>
                </g>
              );
            })}

            {/* Vertical Week Guidelines */}
            {points.map((p, idx) => {
              const x = getX(idx);
              const isCurrent = p.weekIndex === scurve.currentWeekIndex;
              return (
                <g key={p.weekIndex}>
                  <line
                    x1={x}
                    y1={paddingY}
                    x2={x}
                    y2={svgHeight - paddingY}
                    stroke={isCurrent ? '#f59e0b' : '#f1f5f9'}
                    strokeWidth={isCurrent ? '1.5' : '1'}
                    strokeDasharray={isCurrent ? '2 2' : undefined}
                  />
                  <text
                    x={x}
                    y={svgHeight - paddingY + 16}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="monospace"
                    fill={isCurrent ? '#b45309' : '#64748b'}
                    fontWeight={isCurrent ? 'bold' : 'normal'}
                  >
                    W{p.weekIndex}
                  </text>
                </g>
              );
            })}

            {/* Target Line (Dashed Slate) */}
            <path
              d={targetPath}
              fill="none"
              stroke="#64748b"
              strokeWidth="2"
              strokeDasharray="4 4"
            />

            {/* Claimed Line (Amber) */}
            <path
              d={claimedPath}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="2.5"
            />

            {/* Verified Line (Emerald) */}
            <path
              d={verifiedPath}
              fill="none"
              stroke="#10b981"
              strokeWidth="3"
            />

            {/* Interactive Circles & Points */}
            {points.map((p, idx) => {
              const x = getX(idx);
              const yTarget = getY(p.targetCumulative);
              const yClaimed = getY(p.claimedCumulative);
              const yVerified = getY(p.verifiedCumulative);
              const isHovered = hoveredPointIndex === idx;

              return (
                <g
                  key={idx}
                  onMouseEnter={() => setHoveredPointIndex(idx)}
                  className="cursor-pointer"
                  onClick={() => handleOpenOverride(p.weekIndex, p.targetCumulative)}
                >
                  {/* Invisible hit-area column */}
                  <rect
                    x={x - 12}
                    y={paddingY}
                    width="24"
                    height={chartHeight}
                    fill="transparent"
                  />

                  {/* Target Node Point */}
                  <circle
                    cx={x}
                    cy={yTarget}
                    r={p.isOverridden ? '4.5' : '3'}
                    fill={p.isOverridden ? '#ef4444' : '#64748b'}
                  />

                  {/* Claimed Point */}
                  <circle
                    cx={x}
                    cy={yClaimed}
                    r="3"
                    fill="#f59e0b"
                  />

                  {/* Verified Point */}
                  <circle
                    cx={x}
                    cy={yVerified}
                    r={isHovered ? '5' : '3.5'}
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Active Point Detail Bar */}
        {activePoint && (
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="font-bold text-slate-800">{activePoint.label}</span>
              {activePoint.isOverridden && (
                <span className="px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 text-[9px] font-bold">
                  Target Di-Override PM
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono">
              <span>
                Target: <b className="text-slate-800">{activePoint.targetCumulative.toFixed(2)}%</b>
              </span>
              <span>
                Klaim: <b className="text-amber-700">{activePoint.claimedCumulative.toFixed(2)}%</b>
              </span>
              <span>
                Terverifikasi: <b className="text-emerald-700">{activePoint.verifiedCumulative.toFixed(2)}%</b>
              </span>
              <span className={activePoint.variance >= 0 ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                Deviasi: {activePoint.variance >= 0 ? `+${activePoint.variance.toFixed(2)}%` : `${activePoint.variance.toFixed(2)}%`}
              </span>

              {canOverride && (
                <button
                  type="button"
                  onClick={() => handleOpenOverride(activePoint.weekIndex, activePoint.targetCumulative)}
                  className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-sans font-bold flex items-center space-x-1"
                >
                  <Edit3 className="w-3 h-3" />
                  <span>Override Target</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* PM Manual Target Override Modal */}
      {overrideModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">
                Override Target Rencana Minggu #{selectedWeekForOverride}
              </h3>
              <button onClick={() => setOverrideModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveOverride} className="p-6 space-y-4 text-xs">
              <p className="text-slate-600">
                Gunakan fitur ini untuk menyesuaikan kurva target rencana secara resmi berdasarkan Addendum Kontrak, Perubahan Jadwal Klien, atau Percepatan Operasional.
              </p>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Target Kumulatif Baru (%) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Alasan Perubahan / Dokumen Acuan (Addendum) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Contoh: Addendum Kontrak No. 04/ADD-TML/2026 tanggal 12 Januari 2026 perihal percepatan komisioning."
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-900"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setOverrideModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  Simpan Override Target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
