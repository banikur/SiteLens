import React, { useState, useId, useMemo } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Calendar,
  Edit3,
  X,
  Info,
  Table,
  Layers,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
} from 'lucide-react';
import type { SCurveSummary, User, WorkNode } from '../types';
import { apiOverrideSCurve } from '../services/api';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';

interface SCurveChartProps {
  scurve: SCurveSummary;
  nodes?: WorkNode[];
  currentUser: User;
  onRefresh: () => void;
}

type ViewMode = 'both' | 'table' | 'chart';

export const SCurveChart: React.FC<SCurveChartProps> = ({
  scurve,
  nodes = [],
  currentUser,
  onRefresh,
}) => {
  const chartId = useId();
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [selectedWeekForOverride, setSelectedWeekForOverride] = useState<number>(1);
  const [overrideValue, setOverrideValue] = useState<string>('50.00');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const { can, isLoading: isLoadingPerms } = usePermission();
  const canOverride =
    !isLoadingPerms &&
    (can(PERMISSIONS.SCURVE_OVERRIDE, (scurve as any).projectId) || can(PERMISSIONS.SCURVE_OVERRIDE));

  const points = scurve.points || [];
  const weekCount = Math.max(1, points.length);

  // SVG Chart Geometry
  const svgWidth = 720;
  const svgHeight = 240;
  const paddingX = 45;
  const paddingY = 25;
  const chartWidth = svgWidth - paddingX * 2;
  const chartHeight = svgHeight - paddingY * 2;

  const getX = (idx: number) => {
    if (weekCount === 1) return paddingX + chartWidth / 2;
    return paddingX + (idx / (weekCount - 1)) * chartWidth;
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

  // Month groupings for two-tiered time schedule header
  const monthGroups = useMemo(() => {
    const groups: { monthNumber: number; label: string; weekIndices: number[]; count: number }[] = [];
    points.forEach((p, idx) => {
      const monthIdx = Math.floor(idx / 4) + 1;
      let existing = groups.find((g) => g.monthNumber === monthIdx);
      if (!existing) {
        existing = {
          monthNumber: monthIdx,
          label: `BULAN KE-${monthIdx}`,
          weekIndices: [],
          count: 0,
        };
        groups.push(existing);
      }
      existing.weekIndices.push(p.weekIndex);
      existing.count += 1;
    });
    return groups;
  }, [points]);

  // Prepare WBS items for the Time Schedule Matrix Table
  const tableNodes = useMemo(() => {
    if (nodes && nodes.length > 0) return nodes;

    // Fallback seed items if no nodes in props
    return [
      {
        id: 'fallback-1',
        projectId: scurve.projectId,
        wbsCode: '1.0',
        name: 'Pekerjaan Struktur Bawah & Pondasi',
        weightPercent: '35.00',
        volume: '1',
        unit: 'ls',
        verifiedProgressPercent: 100,
        claimedProgressPercent: 100,
        sortOrder: 1,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'fallback-1-1',
        projectId: scurve.projectId,
        parentId: 'fallback-1',
        wbsCode: '1.1',
        name: 'Tiang Pancang & Bore Pile Pier P14',
        weightPercent: '20.00',
        volume: '120',
        unit: 'titik',
        verifiedProgressPercent: 100,
        claimedProgressPercent: 100,
        sortOrder: 1,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'fallback-1-2',
        projectId: scurve.projectId,
        parentId: 'fallback-1',
        wbsCode: '1.2',
        name: 'Pembesian & Bekisting Pile Cap Grid 4-8',
        weightPercent: '15.00',
        volume: '450',
        unit: 'm3',
        verifiedProgressPercent: 50,
        claimedProgressPercent: 75,
        sortOrder: 2,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'fallback-2',
        projectId: scurve.projectId,
        wbsCode: '2.0',
        name: 'Pekerjaan Struktur Atas & Kolom Lantai 2',
        weightPercent: '40.00',
        volume: '850',
        unit: 'm3',
        verifiedProgressPercent: 20,
        claimedProgressPercent: 30,
        sortOrder: 2,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 'fallback-3',
        projectId: scurve.projectId,
        wbsCode: '3.0',
        name: 'Pekerjaan Mekanikal & Elektrikal (MEP)',
        weightPercent: '25.00',
        volume: '1',
        unit: 'ls',
        verifiedProgressPercent: 10,
        claimedProgressPercent: 15,
        sortOrder: 3,
        createdAt: '',
        updatedAt: '',
      },
    ] as WorkNode[];
  }, [nodes, scurve.projectId]);

  // Total weight sum for table
  const totalWeightSum = useMemo(() => {
    // Only sum root items (nodes without parentId) to prevent double counting
    const roots = tableNodes.filter((n) => !n.parentId);
    if (roots.length > 0) {
      return roots.reduce((acc, n) => acc + Number(n.weightPercent || 0), 0);
    }
    return tableNodes.reduce((acc, n) => acc + Number(n.weightPercent || 0), 0) || 100;
  }, [tableNodes]);

  /**
   * Distribute planned and verified weight per week for a specific work item.
   * Mirrors formal civil engineering time schedule allocation curves.
   */
  const computeItemWeeklySpread = (node: WorkNode, nodeIdx: number, totalNodeCount: number) => {
    const weight = Number(node.weightPercent || 0);
    const verifiedPercent = Number(node.verifiedProgressPercent || 0);

    // Determine active week window based on sort position or dates
    const ratio = totalNodeCount > 1 ? nodeIdx / (totalNodeCount - 1) : 0;
    const startWeek = Math.max(1, Math.min(weekCount - 1, Math.floor(ratio * (weekCount - 2)) + 1));
    const durationWeeks = Math.max(2, Math.min(weekCount, Math.ceil(weekCount * 0.45)));
    const endWeek = Math.min(weekCount, startWeek + durationWeeks - 1);
    const span = Math.max(1, endWeek - startWeek + 1);

    const weeklyPlans: number[] = [];
    const weeklyVerified: (number | null)[] = [];

    for (let w = 1; w <= weekCount; w++) {
      // Planned allocation
      if (w >= startWeek && w <= endWeek) {
        weeklyPlans.push(Math.round((weight / span) * 100) / 100);
      } else {
        weeklyPlans.push(0);
      }

      // Verified progress allocation
      if (w <= scurve.currentWeekIndex) {
        if (w >= startWeek && w <= endWeek) {
          const itemVerWeight = (weight * (verifiedPercent / 100));
          const pastWeeksInSpan = Math.min(span, scurve.currentWeekIndex - startWeek + 1);
          const perWeekVer = pastWeeksInSpan > 0 ? itemVerWeight / pastWeeksInSpan : 0;
          weeklyVerified.push(Math.round(perWeekVer * 100) / 100);
        } else {
          weeklyVerified.push(0);
        }
      } else {
        // Future weeks have not occurred yet
        weeklyVerified.push(null);
      }
    }

    return { weeklyPlans, weeklyVerified };
  };

  const activePoint =
    hoveredPointIndex !== null
      ? points[hoveredPointIndex]
      : points[scurve.currentWeekIndex - 1] || points[0];

  return (
    <div className="space-y-5 select-none">
      {/* Top Controls & View Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div>
          <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <TrendingUp className="w-4 h-4 text-slate-900" />
            <span>Jadwal Progres Pelaksanaan & Kurva S (Time Schedule Matrix)</span>
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Format resmi matriks konstruksi: WBS hirarkis, alokasi bobot per minggu, dan rekapitulasi deviasi fisik.
          </p>
        </div>

        {/* View Mode Segmented Switcher */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('both')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
              viewMode === 'both'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Grafik & Tabel Matriks</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
              viewMode === 'table'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Hanya Tabel Matriks</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('chart')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
              viewMode === 'chart'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Hanya Grafik Garis</span>
          </button>
        </div>
      </div>

      {/* KPI Headline Readout Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-medium text-slate-500 block">
            Target rencana (planned)
          </span>
          <div className="flex items-baseline space-x-1.5 mt-1">
            <span className="text-xl font-mono tabular-nums font-bold text-slate-800">
              {scurve.currentPlannedPercent.toFixed(2)}%
            </span>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
              Minggu ke-{scurve.currentWeekIndex}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Kumulatif baseline kontrak</span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-medium text-slate-500 block">
            Klaim lapangan (claimed)
          </span>
          <div className="flex items-baseline space-x-1.5 mt-1">
            <span className="text-xl font-mono tabular-nums font-bold text-slate-700">
              {scurve.currentClaimedPercent.toFixed(2)}%
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Pengajuan mandor/kontraktor</span>
        </div>

        {/* Hero Card: Verified Physical Progress */}
        <div className="p-4 rounded-xl bg-[#0b0e14] border border-slate-800 shadow-xs">
          <span className="text-[11px] font-medium text-[#d4f038] block flex items-center justify-between">
            <span>Fisik terverifikasi (QA/QC)</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#d4f038]" />
          </span>
          <div className="flex items-baseline space-x-1.5 mt-1">
            <span className="text-xl font-mono tabular-nums font-bold text-[#d4f038]">
              {scurve.currentVerifiedPercent.toFixed(2)}%
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Lolos gerbang inspeksi bebas cacat
          </span>
        </div>

        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-medium text-slate-500 block">
            Deviasi kumulatif (Δ)
          </span>
          <div className="flex items-baseline space-x-2 mt-1">
            <span
              className={`text-xl font-mono tabular-nums font-bold ${
                scurve.currentVariance >= 0 ? 'text-emerald-700' : 'text-rose-600'
              }`}
            >
              {scurve.currentVariance >= 0
                ? `+${scurve.currentVariance.toFixed(2)}%`
                : `${scurve.currentVariance.toFixed(2)}%`}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums font-semibold ${
                scurve.status === 'ahead'
                  ? 'bg-emerald-100 text-emerald-800'
                  : scurve.status === 'delayed'
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {scurve.status === 'ahead' ? 'Ahead' : scurve.status === 'delayed' ? 'Delayed' : 'On-Track'}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Terhadap kurva target
          </span>
        </div>
      </div>

      {/* SECTION 1: VISUAL S-CURVE CHART */}
      {(viewMode === 'both' || viewMode === 'chart') && (
        <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-900 flex items-center space-x-2">
                <TrendingUp className="w-4 h-4 text-slate-800" />
                <span>Visualisasi Grafik Kurva S Kumulatif</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Garis kurva sinkron langsung dengan kolom mendatar tabel rekapitulasi mingguan di bawahnya.
              </p>
            </div>

            {/* Legend */}
            <div className="flex items-center space-x-4 text-[11px] font-medium text-slate-600">
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-0.5 bg-sky-500 inline-block border-t border-dashed border-sky-600" />
                <span>Target rencana</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-0.5 bg-slate-400 inline-block" />
                <span>Klaim lapangan</span>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="w-3 h-1 bg-[#d4f038] rounded-xs inline-block" />
                <span className="font-bold text-slate-900">Fisik terverifikasi</span>
              </div>
            </div>
          </div>

          {/* SVG Canvas Chart */}
          <div className="overflow-x-auto">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full h-60 select-none"
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
                const isHovered = hoveredPointIndex === idx;
                return (
                  <g key={p.weekIndex}>
                    <line
                      x1={x}
                      y1={paddingY}
                      x2={x}
                      y2={svgHeight - paddingY}
                      stroke={isHovered ? '#d4f038' : isCurrent ? '#0b0e14' : '#f1f5f9'}
                      strokeWidth={isHovered ? '1.5' : isCurrent ? '1.5' : '1'}
                      strokeDasharray={isHovered || isCurrent ? '2 2' : undefined}
                    />
                    <text
                      x={x}
                      y={svgHeight - paddingY + 16}
                      textAnchor="middle"
                      fontSize="9"
                      fontFamily="monospace"
                      fill={isHovered ? '#0b0e14' : isCurrent ? '#0b0e14' : '#64748b'}
                      fontWeight={isHovered || isCurrent ? 'bold' : 'normal'}
                    >
                      W{p.weekIndex}
                    </text>
                  </g>
                );
              })}

              {/* Target Line (Dashed Cold Technical Blue) */}
              <path
                d={targetPath}
                fill="none"
                stroke="#0284c7"
                strokeWidth="2"
                strokeDasharray="4 4"
              />

              {/* Claimed Line (Quiet Slate 400) */}
              <path
                d={claimedPath}
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2"
              />

              {/* Verified Line (Hero Laser Chartreuse) */}
              <path
                d={verifiedPath}
                fill="none"
                stroke="#d4f038"
                strokeWidth="3.5"
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
                      fill={p.isOverridden ? '#ef4444' : '#0284c7'}
                    />

                    {/* Claimed Point */}
                    <circle cx={x} cy={yClaimed} r="3" fill="#94a3b8" />

                    {/* Verified Point */}
                    <circle
                      cx={x}
                      cy={yVerified}
                      r={isHovered ? '6' : '4'}
                      fill="#d4f038"
                      stroke="#0b0e14"
                      strokeWidth="1.5"
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Active Point Detail Bar */}
          {activePoint && (
            <div className="p-3.5 rounded-lg bg-[#0b0e14] border border-slate-800 text-slate-200 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-3">
              <div className="flex items-center space-x-2">
                <Calendar className="w-4 h-4 text-[#d4f038] shrink-0" />
                <span className="font-bold text-white">{activePoint.label}</span>
                {activePoint.isOverridden && (
                  <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-mono">
                    Override PM
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
                <span className="text-slate-400">
                  Target: <b className="text-white tabular-nums">{activePoint.targetCumulative.toFixed(2)}%</b>
                </span>
                <span className="text-slate-400">
                  Klaim: <b className="text-slate-300 tabular-nums">{activePoint.claimedCumulative.toFixed(2)}%</b>
                </span>
                <span className="text-slate-400">
                  Terverifikasi: <b className="text-[#d4f038] tabular-nums">{activePoint.verifiedCumulative.toFixed(2)}%</b>
                </span>
                <span className={activePoint.variance >= 0 ? 'text-[#d4f038] font-bold tabular-nums' : 'text-rose-400 font-bold tabular-nums'}>
                  Deviasi: {activePoint.variance >= 0 ? `+${activePoint.variance.toFixed(2)}%` : `${activePoint.variance.toFixed(2)}%`}
                </span>

                {canOverride && (
                  <button
                    type="button"
                    onClick={() => handleOpenOverride(activePoint.weekIndex, activePoint.targetCumulative)}
                    className="px-2.5 py-1 rounded bg-[#161c28] hover:bg-[#202738] text-slate-200 hover:text-white border border-slate-700 text-[10px] font-sans font-semibold flex items-center space-x-1 transition-colors"
                  >
                    <Edit3 className="w-3 h-3 text-[#d4f038]" />
                    <span>Override target</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: TIME SCHEDULE & S-CURVE MATRIX TABLE */}
      {(viewMode === 'both' || viewMode === 'table') && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          {/* Table Header Controls */}
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-2.5">
              <FileSpreadsheet className="w-4 h-4 text-slate-700 shrink-0" />
              <div>
                <h3 className="text-xs font-bold text-slate-900 leading-tight">
                  Tabel Jadwal Pelaksanaan & Distribusi Bobot Mingguan (S-Curve Table)
                </h3>
                <span className="text-[11px] text-slate-500">
                  Item pekerjaan di kiri, bobot rencana, kolom mendatar mingguan, dan rekapitulasi persentase di footer.
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-3 text-[11px] text-slate-600 font-mono">
              <span className="flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-sky-500" />
                <span>R = Rencana</span>
              </span>
              <span className="flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-[#d4f038] border border-slate-700" />
                <span>V = Verifikasi (QA/QC)</span>
              </span>
            </div>
          </div>

          {/* Matrix Scrollable Container */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[950px]">
              {/* Table Column Group Headers (2-Tiered Wingdik Standard: Bulan > Minggu) */}
              <thead>
                {/* Level 1 Header: Left identity columns + Monthly spans */}
                <tr className="bg-slate-100 text-slate-800 border-b border-slate-200 font-bold text-[11px]">
                  <th rowSpan={2} className="py-2.5 px-2.5 w-14 text-center border-r border-slate-200 sticky left-0 bg-slate-100 z-10">
                    NO
                  </th>
                  <th rowSpan={2} className="py-2.5 px-3 min-w-[220px] border-r border-slate-200 sticky left-14 bg-slate-100 z-10">
                    URAIAN PEKERJAAN
                  </th>
                  <th rowSpan={2} className="py-2.5 px-2 w-20 text-right border-r border-slate-200 font-mono">
                    VOLUME
                  </th>
                  <th rowSpan={2} className="py-2.5 px-2 w-16 text-center border-r border-slate-200 font-mono">
                    SATUAN
                  </th>
                  <th rowSpan={2} className="py-2.5 px-2.5 w-24 text-right border-r border-slate-200 font-mono tabular-nums">
                    BOBOT (%)
                  </th>

                  {/* Horizontal Month Span Headers */}
                  {monthGroups.map((m) => (
                    <th
                      key={m.monthNumber}
                      colSpan={m.count}
                      className="py-1.5 px-2 text-center border-r border-slate-200 bg-slate-200/80 text-slate-900 font-mono text-[10px] tracking-wide"
                    >
                      {m.label}
                    </th>
                  ))}

                  {/* Right Summary Column */}
                  <th rowSpan={2} className="py-2.5 px-3 text-right font-mono min-w-[100px] bg-slate-100">
                    PROGRES (%)
                  </th>
                </tr>

                {/* Level 2 Header: Weekly Columns (W1, W2, etc.) */}
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 font-semibold text-[10px]">
                  {points.map((p) => {
                    const isCurrent = p.weekIndex === scurve.currentWeekIndex;
                    return (
                      <th
                        key={p.weekIndex}
                        className={`py-1.5 px-2 text-center border-r border-slate-200 min-w-[85px] ${
                          isCurrent
                            ? 'bg-[#d4f038]/20 border-b-2 border-b-[#0b0e14] text-slate-950 font-bold'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="font-mono font-bold leading-tight">
                          W#{p.weekIndex}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                          {p.startDate.slice(5)} - {p.endDate.slice(5)}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Body: Items & Sub-items */}
              <tbody className="divide-y divide-slate-100 font-sans text-xs">
                {tableNodes.map((node, nodeIdx) => {
                  const isParent = !node.parentId;
                  const spread = computeItemWeeklySpread(node, nodeIdx, tableNodes.length);
                  const verPercent = Number(node.verifiedProgressPercent || 0);
                  const nodeWeight = Number(node.weightPercent || 0);

                  return (
                    <tr
                      key={node.id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isParent ? 'bg-slate-50/50 font-semibold' : ''
                      }`}
                    >
                      {/* NO (WBS Code) */}
                      <td className="py-2 px-2 text-center font-mono text-[11px] font-bold text-slate-700 border-r border-slate-200 sticky left-0 bg-white z-0">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                          {node.wbsCode}
                        </span>
                      </td>

                      {/* Uraian Pekerjaan */}
                      <td className="py-2 px-3 border-r border-slate-200 sticky left-14 bg-white z-0">
                        <div
                          className="flex items-center space-x-1.5"
                          style={{ paddingLeft: node.parentId ? '14px' : '0px' }}
                        >
                          {node.parentId && (
                            <span className="text-slate-400 font-mono text-[10px]">└</span>
                          )}
                          <span
                            className={`truncate ${
                              isParent ? 'text-slate-900 font-bold' : 'text-slate-700'
                            }`}
                          >
                            {node.name}
                          </span>
                        </div>
                      </td>

                      {/* Volume */}
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-700 border-r border-slate-200">
                        {node.volume ? String(node.volume) : '-'}
                      </td>

                      {/* Satuan */}
                      <td className="py-2 px-2 text-center font-mono text-slate-600 border-r border-slate-200">
                        {node.unit ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-[10px]">
                            {node.unit}
                          </span>
                        ) : (
                          '-'
                        )}
                      </td>

                      {/* Bobot (%) */}
                      <td className="py-2 px-2.5 text-right font-mono tabular-nums font-bold text-slate-800 border-r border-slate-200">
                        {nodeWeight.toFixed(2)}%
                      </td>

                      {/* Horizontal Weekly Cells */}
                      {points.map((p, pIdx) => {
                        const isCurrent = p.weekIndex === scurve.currentWeekIndex;
                        const planVal = spread.weeklyPlans[pIdx];
                        const verVal = spread.weeklyVerified[pIdx];

                        return (
                          <td
                            key={p.weekIndex}
                            className={`py-1.5 px-2 text-center font-mono tabular-nums text-[11px] border-r border-slate-200 ${
                              isCurrent ? 'bg-[#d4f038]/5' : ''
                            }`}
                          >
                            {planVal > 0 || (verVal !== null && verVal > 0) ? (
                              <div className="space-y-0.5">
                                <div className="text-[10px] text-sky-700 font-medium">
                                  R: {planVal.toFixed(2)}%
                                </div>
                                <div
                                  className={`text-[10px] font-bold ${
                                    verVal !== null && verVal > 0
                                      ? 'text-emerald-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {verVal !== null ? `V: ${verVal.toFixed(2)}%` : '-'}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-300 text-[10px]">-</span>
                            )}
                          </td>
                        );
                      })}

                      {/* Current Progress Summary Cell */}
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-[11px] font-bold text-slate-900">
                        <div className="flex items-center justify-end space-x-1.5">
                          <span className={verPercent >= 100 ? 'text-emerald-600' : 'text-slate-800'}>
                            {verPercent}%
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ({((nodeWeight * verPercent) / 100).toFixed(2)}%)
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* FOOTER: FORMAL 5-ROW WINGDIK EPC STANDARD */}
              <tfoot className="border-t-2 border-slate-300 font-mono text-xs select-none">
                {/* 1. Bobot Progress Perminggu (Realisasi Mingguan %) */}
                <tr className="bg-slate-100/90 text-slate-800 border-b border-slate-200">
                  <td colSpan={4} className="py-2 px-3 font-bold font-sans text-xs text-slate-900 sticky left-0 bg-slate-100 z-10">
                    Bobot Progress Perminggu (Realisasi Aktual %)
                  </td>
                  <td className="py-2 px-2.5 text-right font-bold text-slate-900 border-r border-slate-200">
                    -
                  </td>
                  {points.map((p) => {
                    const isCurrent = p.weekIndex === scurve.currentWeekIndex;
                    const isFuture = p.weekIndex > scurve.currentWeekIndex;
                    return (
                      <td
                        key={p.weekIndex}
                        className={`py-1.5 px-2 text-center tabular-nums font-bold border-r border-slate-200 ${
                          isFuture
                            ? 'text-slate-300'
                            : isCurrent
                            ? 'bg-[#d4f038]/20 text-slate-950 font-bold'
                            : 'text-slate-800'
                        }`}
                      >
                        {!isFuture ? `${p.verifiedIncremental.toFixed(2)}%` : '-'}
                      </td>
                    );
                  })}
                  <td className="py-2 px-3 text-right font-bold text-slate-900">
                    {scurve.currentVerifiedPercent.toFixed(2)}%
                  </td>
                </tr>

                {/* 2. Bobot Kumulatif Progress Per Minggu (Kumulatif Fisik %) - Hero Row */}
                <tr className="bg-[#0b0e14] text-white border-b border-slate-800">
                  <td colSpan={4} className="py-2.5 px-3 font-bold font-sans text-xs text-[#d4f038] sticky left-0 bg-[#0b0e14] z-10">
                    Bobot Kumulatif Progress Per Minggu (Fisik Terverifikasi %)
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono text-slate-400 border-r border-slate-800">
                    -
                  </td>
                  {points.map((p) => {
                    const isCurrent = p.weekIndex === scurve.currentWeekIndex;
                    const isFuture = p.weekIndex > scurve.currentWeekIndex;
                    return (
                      <td
                        key={p.weekIndex}
                        className={`py-2 px-2 text-center tabular-nums font-bold border-r border-slate-800 ${
                          isFuture
                            ? 'text-slate-600'
                            : isCurrent
                            ? 'bg-[#d4f038] text-[#0b0e14] font-black'
                            : 'text-[#d4f038]'
                        }`}
                      >
                        {!isFuture ? `${p.verifiedCumulative.toFixed(2)}%` : '-'}
                      </td>
                    );
                  })}
                  <td className="py-2.5 px-3 text-right font-bold text-[#d4f038]">
                    {scurve.currentVerifiedPercent.toFixed(2)}%
                  </td>
                </tr>

                {/* 3. Bobot Rencana Per Minggu (Rencana Mingguan %) */}
                <tr className="bg-slate-100/90 text-slate-800 border-b border-slate-200">
                  <td colSpan={4} className="py-2 px-3 font-bold font-sans text-xs text-slate-900 sticky left-0 bg-slate-100 z-10">
                    Bobot Rencana Per Minggu (Target Baseline %)
                  </td>
                  <td className="py-2 px-2.5 text-right font-bold text-slate-900 border-r border-slate-200">
                    {totalWeightSum.toFixed(2)}%
                  </td>
                  {points.map((p) => {
                    const isCurrent = p.weekIndex === scurve.currentWeekIndex;
                    return (
                      <td
                        key={p.weekIndex}
                        className={`py-1.5 px-2 text-center tabular-nums font-semibold border-r border-slate-200 ${
                          isCurrent ? 'bg-[#d4f038]/20 font-bold text-slate-950' : 'text-slate-700'
                        }`}
                      >
                        {p.targetIncremental.toFixed(2)}%
                      </td>
                    );
                  })}
                  <td className="py-2 px-3 text-right font-bold text-slate-900">
                    100.00%
                  </td>
                </tr>

                {/* 4. Bobot Kumulatif Rencana Perminggu (Kumulatif Rencana %) */}
                <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <td colSpan={4} className="py-2 px-3 font-medium font-sans text-xs text-slate-700 sticky left-0 bg-slate-50 z-10">
                    Bobot Kumulatif Rencana Perminggu (Target Kumulatif %)
                  </td>
                  <td className="py-2 px-2.5 text-right text-slate-400 border-r border-slate-200">
                    -
                  </td>
                  {points.map((p) => {
                    const isCurrent = p.weekIndex === scurve.currentWeekIndex;
                    return (
                      <td
                        key={p.weekIndex}
                        className={`py-1.5 px-2 text-center tabular-nums border-r border-slate-200 ${
                          isCurrent ? 'bg-[#d4f038]/20 font-bold text-slate-950' : 'text-slate-700'
                        }`}
                      >
                        {p.targetCumulative.toFixed(2)}%
                      </td>
                    );
                  })}
                  <td className="py-2 px-3 text-right text-slate-500 font-semibold">
                    100.00%
                  </td>
                </tr>

                {/* 5. Deviasi Kumulatif (+ / - %) */}
                <tr className="bg-slate-50 text-slate-900">
                  <td colSpan={4} className="py-2 px-3 font-bold font-sans text-xs text-slate-900 sticky left-0 bg-slate-50 z-10">
                    Deviasi Kumulatif (+ / - %) [Aktual - Rencana]
                  </td>
                  <td className="py-2 px-2.5 text-right text-slate-400 border-r border-slate-200">
                    -
                  </td>
                  {points.map((p) => {
                    const isCurrent = p.weekIndex === scurve.currentWeekIndex;
                    const isFuture = p.weekIndex > scurve.currentWeekIndex;
                    const diff = p.variance;
                    const isPositive = diff >= 0;

                    return (
                      <td
                        key={p.weekIndex}
                        className={`py-1.5 px-2 text-center tabular-nums font-bold border-r border-slate-200 ${
                          isFuture
                            ? 'text-slate-300'
                            : isPositive
                            ? 'text-emerald-700'
                            : 'text-rose-600'
                        }`}
                      >
                        {!isFuture
                          ? isPositive
                            ? `+${diff.toFixed(2)}%`
                            : `${diff.toFixed(2)}%`
                          : '-'}
                      </td>
                    );
                  })}
                  <td
                    className={`py-2 px-3 text-right font-bold tabular-nums ${
                      scurve.currentVariance >= 0 ? 'text-emerald-700' : 'text-rose-600'
                    }`}
                  >
                    {scurve.currentVariance >= 0
                      ? `+${scurve.currentVariance.toFixed(2)}%`
                      : `${scurve.currentVariance.toFixed(2)}%`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* PM Manual Target Override Modal */}
      {overrideModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">
                Override Target Rencana Minggu #{selectedWeekForOverride}
              </h3>
              <button
                onClick={() => setOverrideModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveOverride} className="p-6 space-y-4 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Gunakan fitur ini untuk menyesuaikan kurva target rencana secara resmi berdasarkan Addendum Kontrak, Perubahan Jadwal Klien, atau Percepatan Operasional.
              </p>

              <div>
                <label className="block font-medium text-slate-700 text-xs mb-1">
                  Target kumulatif baru (%) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  required
                  value={overrideValue}
                  onChange={(e) => setOverrideValue(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs font-mono font-bold text-slate-900 tabular-nums focus:outline-none focus:border-slate-800"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 text-xs mb-1">
                  Alasan perubahan atau dokumen acuan (Addendum) *
                </label>
                <textarea
                  rows={3}
                  required
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Contoh: Addendum Kontrak No. 04/ADD-TML/2026 tanggal 12 Januari 2026 perihal percepatan komisioning."
                  className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-slate-800"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setOverrideModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors"
                >
                  Simpan override target
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
