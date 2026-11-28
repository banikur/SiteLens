import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Building2,
  MapPin,
  FolderTree,
  Plus,
  RefreshCw,
  Search,
  ArrowRight,
  CheckCircle2,
  TrendingUp,
  Lock,
  Layers,
  AlertCircle,
} from 'lucide-react';
import {
  InspectionRecord,
  ChecklistTemplate,
  CorrectiveAction,
  Project,
  MasterProject,
  WorkNode,
  User,
  NationalHoliday,
} from '../types';
import {
  apiGetMasterProjects,
  apiGetMasterProjectSites,
  apiGetProjectWbs,
  apiGetHolidays,
} from '../services/api';
import { ProjectMiniCalendar, type CalendarAgendaItem } from './ProjectMiniCalendar';
import { buildWbsTree, calculateRollupProgress } from '../utils/wbs';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';
import { useLanguage } from '../i18n/LanguageContext';

interface DashboardProps {
  templates?: ChecklistTemplate[];
  inspections?: InspectionRecord[];
  actions?: CorrectiveAction[];
  projects?: Project[];
  currentUser: User;
  onExecuteTemplate?: (template: ChecklistTemplate) => void;
  onReviewInspection?: (inspection: InspectionRecord) => void;
  onNavigateToTemplates?: () => void;
  onNavigateToInspections?: () => void;
  onNavigateToActions?: () => void;
  onNavigateToProjects?: () => void;
  onOpenSiteWbs?: (site: Project) => void;
  onNewTemplate?: () => void;
  onOpenAIGenerator?: () => void;
}

interface SiteProgressSnapshot {
  site: Project;
  nodes: WorkNode[];
  nodesCount: number;
  strictCount: number;
  claimedPercent: number;
  verifiedPercent: number;
}

interface MasterProgressSnapshot {
  master: MasterProject;
  sites: SiteProgressSnapshot[];
  avgClaimedPercent: number;
  avgVerifiedPercent: number;
}

function computeSiteProgress(nodes: WorkNode[]): {
  nodesCount: number;
  strictCount: number;
  claimedPercent: number;
  verifiedPercent: number;
} {
  if (!nodes || nodes.length === 0) {
    return { nodesCount: 0, strictCount: 0, claimedPercent: 0, verifiedPercent: 0 };
  }
  const tree = buildWbsTree(nodes);
  const strictCount = nodes.filter((n) => Boolean(n.requiresChecklist)).length;

  let totalWeight = 0;
  let weightedClaimed = 0;
  let weightedVerified = 0;

  for (const root of tree) {
    const w = Number(root.weightPercent) || 0;
    const rollup = calculateRollupProgress(root);
    if (w > 0) {
      totalWeight += w;
      weightedClaimed += w * rollup.claimedProgress;
      weightedVerified += w * rollup.verifiedProgress;
    }
  }

  if (totalWeight <= 0) {
    const sumClaimed = tree.reduce((acc, r) => acc + calculateRollupProgress(r).claimedProgress, 0);
    const sumVerified = tree.reduce((acc, r) => acc + calculateRollupProgress(r).verifiedProgress, 0);
    return {
      nodesCount: nodes.length,
      strictCount,
      claimedPercent: tree.length > 0 ? Math.round(sumClaimed / tree.length) : 0,
      verifiedPercent: tree.length > 0 ? Math.round(sumVerified / tree.length) : 0,
    };
  }

  return {
    nodesCount: nodes.length,
    strictCount,
    claimedPercent: Math.round(weightedClaimed / totalWeight),
    verifiedPercent: Math.round(weightedVerified / totalWeight),
  };
}

export const Dashboard: React.FC<DashboardProps> = ({
  currentUser,
  onNavigateToProjects,
  onOpenSiteWbs,
}) => {
  const { translateRole } = useLanguage();
  const { can, isLoading: isLoadingPerms } = usePermission();
  const canManageMaster = !isLoadingPerms && can(PERMISSIONS.MASTERPROJECT_MANAGE);

  const [snapshots, setSnapshots] = useState<MasterProgressSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [holidays, setHolidays] = useState<NationalHoliday[]>([]);

  const loadPortfolioProgress = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const masterRes = await apiGetMasterProjects();
      const masters = masterRes.masterProjects || [];

      const masterSnapshots: MasterProgressSnapshot[] = await Promise.all(
        masters.map(async (mp) => {
          let sites: Project[] = [];
          try {
            const sitesRes = await apiGetMasterProjectSites(mp.id);
            sites = sitesRes.sites || [];
          } catch {
            sites = [];
          }

          const siteSnapshots: SiteProgressSnapshot[] = await Promise.all(
            sites.map(async (site) => {
              try {
                const wbsRes = await apiGetProjectWbs(site.id);
                const siteNodes = wbsRes.nodes || [];
                const stats = computeSiteProgress(siteNodes);
                return { site, nodes: siteNodes, ...stats };
              } catch {
                return {
                  site,
                  nodes: [],
                  nodesCount: 0,
                  strictCount: 0,
                  claimedPercent: 0,
                  verifiedPercent: 0,
                };
              }
            })
          );

          const count = siteSnapshots.length;
          const avgClaimed =
            count > 0
              ? Math.round(
                siteSnapshots.reduce((sum, s) => sum + s.claimedPercent, 0) / count
              )
              : 0;
          const avgVerified =
            count > 0
              ? Math.round(
                siteSnapshots.reduce((sum, s) => sum + s.verifiedPercent, 0) / count
              )
              : 0;

          return {
            master: mp,
            sites: siteSnapshots,
            avgClaimedPercent: avgClaimed,
            avgVerifiedPercent: avgVerified,
          };
        })
      );

      setSnapshots(masterSnapshots);
      setLastUpdated(
        new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        })
      );
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat data monitoring project.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPortfolioProgress();
    apiGetHolidays(new Date().getFullYear()).then((res) => setHolidays(res.holidays || []));
  }, [loadPortfolioProgress]);

  const calendarAgendas = useMemo<CalendarAgendaItem[]>(() => {
    const items: CalendarAgendaItem[] = [];
    for (const { master, sites } of snapshots) {
      if (master.startDate) {
        items.push({
          id: `mp-start-${master.id}`,
          date: String(master.startDate).slice(0, 10),
          title: `Mulai Project: ${master.name}`,
          subtitle: `${master.code} • ${master.ownerClient}`,
          kind: 'project_period',
        });
      }
      if (master.endDate) {
        items.push({
          id: `mp-end-${master.id}`,
          date: String(master.endDate).slice(0, 10),
          title: `Target Selesai: ${master.name}`,
          subtitle: `${master.code} • ${master.ownerClient}`,
          kind: 'project_period',
        });
      }
      for (const { site, nodes } of sites) {
        for (const n of nodes) {
          if (n.isMilestone && (n.plannedEndDate || n.plannedStartDate)) {
            items.push({
              id: `ms-${n.id}`,
              date: String(n.plannedEndDate || n.plannedStartDate).slice(0, 10),
              title: `[Milestone] ${n.wbsCode} ${n.name}`,
              subtitle: `${site.code} • ${site.name}`,
              kind: 'milestone',
              site,
            });
          } else {
            if (n.plannedStartDate) {
              items.push({
                id: `start-${n.id}`,
                date: String(n.plannedStartDate).slice(0, 10),
                title: `Mulai: ${n.wbsCode} ${n.name}`,
                subtitle: `${site.code} • ${site.name}`,
                kind: 'start',
                site,
              });
            }
            if (n.plannedEndDate) {
              items.push({
                id: `end-${n.id}`,
                date: String(n.plannedEndDate).slice(0, 10),
                title: `Target: ${n.wbsCode} ${n.name}`,
                subtitle: `${site.code} • ${site.name}`,
                kind: 'deadline',
                site,
              });
            }
          }
        }
      }
    }
    return items;
  }, [snapshots]);

  const filteredSnapshots = snapshots.filter((item) => {
    const matchesStatus =
      statusFilter === 'all' || item.master.status === statusFilter;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      item.master.name.toLowerCase().includes(q) ||
      item.master.code.toLowerCase().includes(q) ||
      item.master.ownerClient.toLowerCase().includes(q) ||
      item.sites.some(
        (s) =>
          s.site.name.toLowerCase().includes(q) ||
          s.site.code.toLowerCase().includes(q)
      );
    return matchesStatus && matchesSearch;
  });

  // Portfolio-wide KPI calculations (from active projects)
  const activeMasters = snapshots.filter((s) => s.master.status === 'active');
  const allActiveSites = activeMasters.flatMap((m) => m.sites);
  const totalProjectsCount = activeMasters.length;
  const totalSitesCount = allActiveSites.length;

  const avgPortfolioVerified =
    totalSitesCount > 0
      ? Math.round(
        allActiveSites.reduce((acc, s) => acc + s.verifiedPercent, 0) /
        totalSitesCount
      )
      : 0;

  const avgPortfolioClaimed =
    totalSitesCount > 0
      ? Math.round(
        allActiveSites.reduce((acc, s) => acc + s.claimedPercent, 0) /
        totalSitesCount
      )
      : 0;

  return (
    <div className="h-full flex flex-col space-y-3 overflow-hidden">
      {/* Top Executive Monitoring Header + Shortcuts */}
      <div className="bg-white px-4 py-3 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-[#d4f038] flex items-center justify-center font-bold text-xs shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                {canManageMaster
                  ? 'Monitoring Portofolio Project (PMO)'
                  : 'Monitoring Project & Progres Lapangan'}
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 font-semibold text-slate-700 border border-slate-200">
                {currentUser.name} ({translateRole(currentUser.role)})
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Pantau persentase progres klaim vs terverifikasi lintas Project &amp; Site secara real-time
              {lastUpdated ? ` • Diperbarui pukul ${lastUpdated}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => void loadPortfolioProgress()}
            disabled={loading}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
            title="Muat ulang data progres"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Segarkan</span>
          </button>

          {onNavigateToProjects && (
            <button
              type="button"
              onClick={onNavigateToProjects}
              className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
            >
              {canManageMaster ? (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Kelola Master Project</span>
                </>
              ) : (
                <>
                  <Building2 className="w-3.5 h-3.5" />
                  <span>Buka Master Project</span>
                </>
              )}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Headline KPI Row (4 Metrics) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 shrink-0">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-500 block">
              Project Aktif (Kontrak)
            </span>
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5 block">
              {totalProjectsCount}
            </span>
            <span className="text-[10px] text-slate-400">
              {snapshots.length - totalProjectsCount} diarsipkan
            </span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-500 block">
              Total Site Lapangan
            </span>
            <span className="text-2xl font-extrabold text-slate-900 tabular-nums mt-0.5 block">
              {totalSitesCount}
            </span>
            <span className="text-[10px] text-slate-400">
              Unit isolasi WBS &amp; Tim
            </span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-500 block">
              Progres Fisik Terverifikasi
            </span>
            <span className="text-2xl font-extrabold text-emerald-700 tabular-nums mt-0.5 block">
              {avgPortfolioVerified}%
            </span>
            <span className="text-[10px] text-emerald-600 font-medium">
              Target 100% (Lolos QA/QC)
            </span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-500 block">
              Klaim Progres Lapangan
            </span>
            <span className="text-2xl font-extrabold text-blue-700 tabular-nums mt-0.5 block">
              {avgPortfolioClaimed}%
            </span>
            <span className="text-[10px] text-slate-500">
              Selisih verifikasi: {Math.max(0, avgPortfolioClaimed - avgPortfolioVerified)}%
            </span>
          </div>
          <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Monitoring Grid: Project List + Mini Calendar */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-3 min-h-0 bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
        {/* Filter & Search Bar */}
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-800">
              Progres per Project &amp; Site ({filteredSnapshots.length})
            </span>
            <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-[11px]">
              {(['active', 'archived', 'all'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2 py-0.5 rounded-md font-semibold transition-colors cursor-pointer ${statusFilter === st
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  {st === 'active' ? 'Aktif' : st === 'archived' ? 'Arsip' : 'Semua'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-56 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari project, kode, klien, atau site..."
              className="w-full pl-8 pr-3 py-1 text-xs border border-slate-200 rounded-md bg-white text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-slate-800"
            />
          </div>
        </div>

        {/* Scrollable Project Monitoring Cards */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-xs">
              Memuat data progres project dan site...
            </div>
          ) : filteredSnapshots.length === 0 ? (
            <div className="py-16 text-center space-y-2.5">
              <Building2 className="w-9 h-9 mx-auto text-slate-300" />
              <div className="text-xs font-bold text-slate-700">
                {searchQuery
                  ? 'Tidak ada project yang cocok dengan pencarian.'
                  : 'Belum ada Project yang terdaftar atau ditugaskan kepada Anda.'}
              </div>
              <p className="text-[11px] text-slate-400 max-w-md mx-auto">
                {canManageMaster
                  ? 'Mulai dengan membuat Project (Kontrak) dan Site Lapangan di menu Master Project.'
                  : 'Hubungi PMO atau Project Manager agar Anda ditugaskan ke salah satu Site.'}
              </p>
              {onNavigateToProjects && canManageMaster && (
                <button
                  type="button"
                  onClick={onNavigateToProjects}
                  className="mt-2 px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs inline-flex items-center space-x-1.5 shadow-xs cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Buat Project Pertama</span>
                </button>
              )}
            </div>
          ) : (
            filteredSnapshots.map(({ master, sites, avgClaimedPercent, avgVerifiedPercent }) => (
              <div
                key={master.id}
                className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs"
              >
                {/* Project Header */}
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-slate-900 text-[#d4f038] text-[10px] font-bold">
                        {master.code}
                      </span>
                      <h3 className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                        {master.name}
                      </h3>
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${master.status === 'active'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                      >
                        {master.status === 'active' ? 'Aktif' : 'Arsip'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Klien: <strong className="text-slate-700">{master.ownerClient}</strong> •{' '}
                      {sites.length} Site Lapangan
                      {master.startDate || master.endDate
                        ? ` • Periode: ${master.startDate ? String(master.startDate).slice(0, 10) : '-'
                        } s/d ${master.endDate ? String(master.endDate).slice(0, 10) : '-'}`
                        : ''}
                    </div>
                  </div>

                  {/* Project Overall Progress Summary + Shortcut */}
                  <div className="flex items-center space-x-4 shrink-0">
                    <div className="text-right">
                      <div className="text-[10px] text-slate-500 font-semibold">
                        Rata-rata Progres Project
                      </div>
                      <div className="flex items-center space-x-2 text-xs font-bold tabular-nums">
                        <span className="text-emerald-700">{avgVerifiedPercent}% Verif</span>
                        <span className="text-slate-300">/</span>
                        <span className="text-blue-600">{avgClaimedPercent}% Klaim</span>
                      </div>
                    </div>

                    {onNavigateToProjects && (
                      <button
                        type="button"
                        onClick={onNavigateToProjects}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-[11px] font-semibold transition-colors cursor-pointer"
                      >
                        Kelola Project
                      </button>
                    )}
                  </div>
                </div>

                {/* Sites Progress Table */}
                {sites.length === 0 ? (
                  <div className="p-4 text-xs text-slate-400 text-center">
                    Belum ada Site Lapangan di bawah project ini.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white border-b border-slate-100 text-[10px] text-slate-400 uppercase font-semibold">
                        <tr>
                          <th className="py-2 px-4">Site Lapangan</th>
                          <th className="py-2 px-3">PM Lapangan</th>
                          <th className="py-2 px-3 text-center">Item WBS</th>
                          <th className="py-2 px-3 min-w-[200px]">Progres Fisik (Verif / Klaim)</th>
                          <th className="py-2 px-4 text-right">Pintasan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sites.map(({ site, nodesCount, strictCount, claimedPercent, verifiedPercent }) => (
                          <tr key={site.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="py-2.5 px-4">
                              <div className="flex items-center space-x-2">
                                <span className="px-1.5 py-0.5 rounded bg-blue-900 text-white text-[10px] font-bold shrink-0">
                                  {site.code}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-900 truncate max-w-[220px]">
                                    {site.name}
                                  </div>
                                  <div className="text-[10px] text-slate-400 flex items-center space-x-1 truncate max-w-[220px]">
                                    <MapPin className="w-2.5 h-2.5 shrink-0" />
                                    <span className="truncate">{site.location || 'Site Lapangan'}</span>
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-2.5 px-3 text-slate-700 font-medium">
                              {site.leadManager || '-'}
                            </td>

                            <td className="py-2.5 px-3 text-center">
                              <span className="font-bold text-slate-800">{nodesCount}</span>
                              {strictCount > 0 && (
                                <span
                                  className="ml-1.5 inline-flex items-center px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-semibold"
                                  title="Jumlah item mode strict wajib ceklis"
                                >
                                  <Lock className="w-2.5 h-2.5 mr-0.5" />
                                  {strictCount} Strict
                                </span>
                              )}
                            </td>

                            <td className="py-2.5 px-3">
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px] font-bold tabular-nums">
                                  <span className="text-emerald-700">{verifiedPercent}% Terverifikasi</span>
                                  <span className="text-blue-600">{claimedPercent}% Klaim</span>
                                </div>
                                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden relative">
                                  {/* Claimed Progress (Background Blue Bar) */}
                                  <div
                                    className="h-full bg-blue-300/70 rounded-full transition-all duration-500 absolute left-0 top-0"
                                    style={{ width: `${Math.min(100, claimedPercent)}%` }}
                                  />
                                  {/* Verified Progress (Foreground Emerald Bar) */}
                                  <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-500 relative z-10"
                                    style={{ width: `${Math.min(100, verifiedPercent)}%` }}
                                  />
                                </div>
                              </div>
                            </td>

                            <td className="py-2.5 px-4 text-right">
                              {onOpenSiteWbs && (
                                <button
                                  type="button"
                                  onClick={() => onOpenSiteWbs(site)}
                                  className="px-2.5 py-1 rounded-md bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-[11px] inline-flex items-center space-x-1 shadow-2xs transition-colors cursor-pointer"
                                  title="Langsung buka Rincian Pekerjaan (WBS) & Update Progres"
                                >
                                  <FolderTree className="w-3 h-3" />
                                  <span>Rincian &amp; Progres</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        </div>
        <div className="xl:col-span-1 min-h-0 overflow-y-auto">
          <ProjectMiniCalendar
            agendas={calendarAgendas}
            holidays={holidays}
            onOpenSiteWbs={onOpenSiteWbs}
          />
        </div>
      </div>
    </div>
  );
};
