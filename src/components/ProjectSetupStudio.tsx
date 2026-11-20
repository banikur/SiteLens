import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle,
  FileText,
  FolderTree,
  Sparkles,
  Layers,
  ChevronRight,
  ChevronDown,
  X,
  Calendar,
  Lock,
  ShieldCheck,
  TrendingUp,
  Clock,
  CloudRain,
} from 'lucide-react';
import type { Project, User, WorkNode, SCurveSummary } from '../types';
import {
  apiGetProjectWbs,
  apiCreateWbsNode,
  apiUpdateWbsNode,
  apiDeleteWbsNode,
  apiApplyWbsPreset,
  apiGetProjectSCurve,
} from '../services/api';
import { NodeWorkflowModal } from './NodeWorkflowModal';
import { SCurveChart } from './SCurveChart';
import { BottleneckRadar } from './BottleneckRadar';
import { WeatherLogModal } from './WeatherLogModal';
import {
  buildWbsTree,
  flattenWbsTree,
  validateWbsWeights,
  calculateRollupProgress,
  WbsTreeNode,
} from '../utils/wbs';

interface ProjectSetupStudioProps {
  project: Project;
  currentUser: User;
  onBack: () => void;
}

export const ProjectSetupStudio: React.FC<ProjectSetupStudioProps> = ({
  project,
  currentUser,
  onBack,
}) => {
  const [nodes, setNodes] = useState<WorkNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Studio tabs & subviews
  const [activeStudioTab, setActiveStudioTab] = useState<'wbs' | 'scurve' | 'radar'>('wbs');
  const [scurveData, setScurveData] = useState<SCurveSummary | null>(null);
  const [weatherModalOpen, setWeatherModalOpen] = useState(false);

  // Modals state
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [nodeModalOpen, setNodeModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<WorkNode | null>(null);
  const [selectedWorkflowNode, setSelectedWorkflowNode] = useState<WorkNode | null>(null);
  const [presetSubmitting, setPresetSubmitting] = useState(false);
  const [deleteConfirmNode, setDeleteConfirmNode] = useState<WorkNode | null>(null);

  // Node form state
  const [formParentId, setFormParentId] = useState<string>('');
  const [formWbsCode, setFormWbsCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formWeight, setFormWeight] = useState('0.00');
  const [formDocRef, setFormDocRef] = useState('');
  const [formRevision, setFormRevision] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  // Check if current user is read-only Viewer
  const isViewer = currentUser.role === 'Client / Vendor Viewer';
  const canEdit =
    currentUser.role === 'Project Director & Tenant Admin' ||
    currentUser.role === 'Project / Site Engineer' ||
    currentUser.role === 'HSE / Quality Manager & Tenant Admin';

  const loadWbsData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiGetProjectWbs(project.id);
      setNodes(data.nodes || []);
      loadSCurveData();
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat struktur WBS.');
    } finally {
      setLoading(false);
    }
  };

  const loadSCurveData = async () => {
    try {
      const res = await apiGetProjectSCurve(project.id);
      setScurveData(res.scurve);
    } catch (err: any) {
      console.error('Failed to load S-Curve data:', err);
    }
  };

  useEffect(() => {
    loadWbsData();
  }, [project.id]);

  // Build tree & flat list
  const treeNodes = useMemo(() => buildWbsTree(nodes), [nodes]);
  const flatNodes = useMemo(() => flattenWbsTree(treeNodes), [treeNodes]);

  // Weight validation
  const weightValidation = useMemo(() => validateWbsWeights(nodes), [nodes]);

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return flatNodes;
    const q = searchQuery.toLowerCase();
    return flatNodes.filter(
      (n) =>
        n.wbsCode.toLowerCase().includes(q) ||
        n.name.toLowerCase().includes(q) ||
        (n.documentReferenceNo && n.documentReferenceNo.toLowerCase().includes(q))
    );
  }, [flatNodes, searchQuery]);

  const toggleCollapse = (nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleOpenAddModal = (parentId = '') => {
    setEditingNode(null);
    setFormParentId(parentId);

    // Auto-generate tentative WBS code
    if (parentId) {
      const parent = nodes.find((n) => n.id === parentId);
      const childCount = nodes.filter((n) => n.parentId === parentId).length;
      setFormWbsCode(parent ? `${parent.wbsCode}.${childCount + 1}` : '');
    } else {
      const rootCount = nodes.filter((n) => !n.parentId).length;
      setFormWbsCode(`${rootCount + 1}.0`);
    }

    setFormName('');
    setFormWeight('10.00');
    setFormDocRef('');
    setFormRevision('Rev A');
    setFormStartDate('');
    setFormEndDate('');
    setNodeModalOpen(true);
  };

  const handleOpenEditModal = (node: WorkNode) => {
    setEditingNode(node);
    setFormParentId(node.parentId || '');
    setFormWbsCode(node.wbsCode);
    setFormName(node.name);
    setFormWeight(String(node.weightPercent ?? '0.00'));
    setFormDocRef(node.documentReferenceNo || '');
    setFormRevision(node.activeRevision || '');
    setFormStartDate(node.plannedStartDate ? String(node.plannedStartDate).slice(0, 10) : '');
    setFormEndDate(node.plannedEndDate ? String(node.plannedEndDate).slice(0, 10) : '');
    setNodeModalOpen(true);
  };

  const handleSaveNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formWbsCode.trim() || !formName.trim()) {
      alert('WBS Code dan Nama Pekerjaan wajib diisi.');
      return;
    }

    try {
      const payload: Partial<WorkNode> = {
        parentId: formParentId || null,
        wbsCode: formWbsCode.trim(),
        name: formName.trim(),
        weightPercent: formWeight.trim() || '0.00',
        documentReferenceNo: formDocRef.trim() || null,
        activeRevision: formRevision.trim() || null,
        plannedStartDate: formStartDate || null,
        plannedEndDate: formEndDate || null,
      };

      if (editingNode) {
        await apiUpdateWbsNode(project.id, editingNode.id, payload);
        setActionSuccess(`Node ${payload.wbsCode} berhasil diperbarui.`);
      } else {
        await apiCreateWbsNode(project.id, payload);
        setActionSuccess(`Node ${payload.wbsCode} berhasil ditambahkan.`);
      }

      setNodeModalOpen(false);
      await loadWbsData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err?.message || 'Gagal menyimpan WBS node.');
    }
  };

  const handleDeleteNode = async (node: WorkNode) => {
    try {
      await apiDeleteWbsNode(project.id, node.id);
      setDeleteConfirmNode(null);
      setActionSuccess(`Node ${node.wbsCode} berhasil dihapus.`);
      await loadWbsData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err?.message || 'Gagal menghapus WBS node.');
    }
  };

  const handleApplyPreset = async (preset: 'general_epc' | 'civil_building' | 'blank') => {
    try {
      setPresetSubmitting(true);
      const res = await apiApplyWbsPreset(project.id, preset);
      setPresetModalOpen(false);
      setActionSuccess(res.message || 'Preset WBS berhasil diterapkan.');
      await loadWbsData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      alert(err?.message || 'Gagal menerapkan preset.');
    } finally {
      setPresetSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Navigation & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
            title="Kembali ke Daftar Proyek"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                {project.code}
              </span>
              <h1 className="text-lg md:text-xl font-bold text-slate-900">
                Project Setup Studio: WBS & Bobot
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {project.name} &bull; Konfigurasi Work Breakdown Structure, Bobot Relatif & Dokumen Acuan
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2.5">
          <button
            type="button"
            onClick={() => setWeatherModalOpen(true)}
            className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 text-xs font-bold transition-colors flex items-center shadow-xs"
            title="Buku Harian Cuaca, Curah Hujan & Klaim EOT"
          >
            <CloudRain className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
            <span>Cuaca & EOT</span>
          </button>

          {canEdit && (
            <>
              <button
                onClick={() => setPresetModalOpen(true)}
                className="px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 text-xs font-bold transition-colors flex items-center shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5 text-indigo-600" />
                Pilih Preset WBS
              </button>
              <button
                onClick={() => handleOpenAddModal('')}
                className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors flex items-center shadow-xs"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Tambah Root Node
              </button>
            </>
          )}

          {isViewer && (
            <div className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold flex items-center">
              <Lock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
              Mode Baca Saja (Client Viewer)
            </div>
          )}
        </div>
      </div>

      {/* Studio Navigation Tabs (Fase 4: WBS, S-Curve, Bottleneck Radar) */}
      <div className="flex border-b border-slate-200 space-x-6 text-xs font-bold bg-white px-5 pt-3 rounded-xl shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveStudioTab('wbs')}
          className={`pb-3 flex items-center space-x-2 transition-colors border-b-2 ${
            activeStudioTab === 'wbs'
              ? 'border-amber-500 text-amber-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <FolderTree className="w-4 h-4 text-amber-600" />
          <span>1. Struktur WBS & Bobot</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveStudioTab('scurve');
            loadSCurveData();
          }}
          className={`pb-3 flex items-center space-x-2 transition-colors border-b-2 ${
            activeStudioTab === 'scurve'
              ? 'border-amber-500 text-amber-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <TrendingUp className="w-4 h-4 text-indigo-600" />
          <span>2. Kurva S Mingguan & Deviasi</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveStudioTab('radar')}
          className={`pb-3 flex items-center space-x-2 transition-colors border-b-2 ${
            activeStudioTab === 'radar'
              ? 'border-amber-500 text-amber-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          }`}
        >
          <Clock className="w-4 h-4 text-rose-600" />
          <span>3. Bottleneck Radar SLA</span>
        </button>
      </div>

      {/* Success Banner */}
      {actionSuccess && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2 shadow-xs">
          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Tab 1: WBS & Bobot Struktur */}
      {activeStudioTab === 'wbs' && (
        <>
          {/* Non-Blocking Relative Weights Summary & Warning Banner */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                weightValidation.rootTotal === 100
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {weightValidation.rootTotal === 100 ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-slate-900">
                  Total Bobot Root Proyek:
                </span>
                <span
                  className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                    weightValidation.rootTotal === 100
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {weightValidation.rootTotal.toFixed(2)}%
                </span>
                <span className="text-[11px] text-slate-400">
                  (Target Ideal: 100.00%)
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {weightValidation.hasWarnings
                  ? 'Sistem toleransi non-blocking: Total bobot saat ini belum 100%. Anda tetap dapat menyimpan struktur dan melanjutkan pekerjaan.'
                  : 'Struktur bobot relatif tingkat proyek seimbang tepat 100.00%.'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4 text-xs text-slate-600 font-mono">
            <div>
              <span className="text-slate-400 block text-[10px]">TOTAL NODE</span>
              <span className="font-bold text-slate-800">{nodes.length} Item</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">ROOT ITEMS</span>
              <span className="font-bold text-slate-800">
                {treeNodes.length} Root
              </span>
            </div>
          </div>
        </div>

        {/* Detailed warnings breakdown if any group is != 100% */}
        {weightValidation.hasWarnings && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2 text-[11px]">
            {weightValidation.groups
              .filter((g) => !g.isValid)
              .map((g, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 flex items-center"
                >
                  <AlertTriangle className="w-3 h-3 mr-1 text-amber-600" />
                  {g.message}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="w-full sm:w-72">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari WBS Code, Nama, atau Dokumen..."
            className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
          />
        </div>
        <div className="text-xs text-slate-400">
          Menampilkan {filteredNodes.length} dari {nodes.length} node
        </div>
      </div>

      {/* WBS Tree Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-bold tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">WBS Code & Nama Pekerjaan</th>
                <th className="py-3 px-4 w-28 text-right">Bobot (%)</th>
                <th className="py-3 px-4 w-44">Dokumen Acuan & Rev</th>
                <th className="py-3 px-4 w-36">Jadwal Rencana</th>
                <th className="py-3 px-4 w-36">Progress (Klaim / Verifikasi)</th>
                <th className="py-3 px-4 w-28 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    Memuat struktur WBS...
                  </td>
                </tr>
              ) : filteredNodes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    {searchQuery ? (
                      'Tidak ada node yang cocok dengan pencarian.'
                    ) : (
                      <div className="space-y-2">
                        <FolderTree className="w-8 h-8 mx-auto text-slate-300" />
                        <p className="font-semibold text-slate-600">
                          Belum ada struktur WBS untuk proyek ini.
                        </p>
                        {canEdit && (
                          <div className="flex items-center justify-center space-x-2 pt-2">
                            <button
                              onClick={() => setPresetModalOpen(true)}
                              className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold hover:bg-indigo-100"
                            >
                              Pilih Preset Starter Pack
                            </button>
                            <button
                              onClick={() => handleOpenAddModal('')}
                              className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold hover:bg-amber-400"
                            >
                              Buat Node Manual
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                filteredNodes.map((node) => {
                  const hasChildren = node.children && node.children.length > 0;
                  const isCollapsed = collapsedNodes.has(node.id);
                  const rollup = calculateRollupProgress(node);

                  return (
                    <tr
                      key={node.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        node.level === 0 ? 'bg-slate-50/40 font-semibold' : ''
                      }`}
                    >
                      {/* WBS Code & Name with dynamic indentation */}
                      <td className="py-2.5 px-4">
                        <div
                          className="flex items-center"
                          style={{ paddingLeft: `${node.level * 24}px` }}
                        >
                          {hasChildren ? (
                            <button
                              onClick={() => toggleCollapse(node.id)}
                              className="p-1 mr-1.5 text-slate-400 hover:text-slate-700"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          ) : (
                            <span className="w-3.5 mr-2 inline-block text-slate-300">
                              &bull;
                            </span>
                          )}

                          <span className="font-mono font-bold text-amber-700 mr-2 text-[11px]">
                            {node.wbsCode}
                          </span>
                          <span
                            className={`truncate ${
                              node.level === 0
                                ? 'text-slate-900 font-bold'
                                : 'text-slate-700'
                            }`}
                          >
                            {node.name}
                          </span>
                        </div>
                      </td>

                      {/* Weight Percent */}
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-800">
                        {Number(node.weightPercent).toFixed(2)}%
                      </td>

                      {/* Document Reference & Active Revision */}
                      <td className="py-2.5 px-4">
                        {node.documentReferenceNo ? (
                          <div className="flex items-center space-x-1.5">
                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="font-mono text-slate-700 truncate">
                              {node.documentReferenceNo}
                            </span>
                            {node.activeRevision && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px] font-bold">
                                {node.activeRevision}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-300 italic text-[11px]">-</span>
                        )}
                      </td>

                      {/* Planned Schedule */}
                      <td className="py-2.5 px-4 text-slate-500 text-[11px]">
                        {node.plannedStartDate || node.plannedEndDate ? (
                          <div className="flex items-center space-x-1">
                            <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>
                              {node.plannedStartDate
                                ? String(node.plannedStartDate).slice(5, 10)
                                : '...'}
                              {' → '}
                              {node.plannedEndDate
                                ? String(node.plannedEndDate).slice(5, 10)
                                : '...'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-300 italic">-</span>
                        )}
                      </td>

                      {/* Progress Rollup */}
                      <td className="py-2.5 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-400">
                              Klaim: <b className="text-slate-700">{rollup.claimedProgress}%</b>
                            </span>
                            <span className="text-emerald-700 font-bold">
                              Verif: {rollup.verifiedProgress}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden flex">
                            <div
                              className="bg-emerald-500 h-1.5 rounded-l-full"
                              style={{ width: `${Math.min(rollup.verifiedProgress, 100)}%` }}
                              title={`Terverifikasi: ${rollup.verifiedProgress}%`}
                            />
                            <div
                              className="bg-amber-300 h-1.5"
                              style={{
                                width: `${Math.max(
                                  0,
                                  Math.min(rollup.claimedProgress - rollup.verifiedProgress, 100)
                                )}%`,
                              }}
                              title={`Klaim Belum Verifikasi: ${Math.max(
                                0,
                                rollup.claimedProgress - rollup.verifiedProgress
                              )}%`}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Action Buttons */}
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          <button
                            type="button"
                            onClick={() => setSelectedWorkflowNode(node)}
                            className="px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] flex items-center space-x-1 transition-colors"
                            title="Buka Alur Multi-Stage Workflow & Hold Point"
                          >
                            <ShieldCheck className="w-3 h-3 text-indigo-600" />
                            <span>Workflow</span>
                          </button>

                          {canEdit && (
                            <>
                              <button
                                onClick={() => handleOpenAddModal(node.id)}
                                className="p-1 rounded hover:bg-amber-100 text-amber-700 transition-colors"
                                title="Tambah Sub-Node di bawah item ini"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleOpenEditModal(node)}
                                className="p-1 rounded hover:bg-slate-100 text-slate-600 transition-colors"
                                title="Edit Node"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirmNode(node)}
                                className="p-1 rounded hover:bg-rose-100 text-rose-600 transition-colors"
                                title="Hapus Node"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* Tab 2: Kurva S Mingguan & Deviasi */}
      {activeStudioTab === 'scurve' && (
        <div className="space-y-4">
          {scurveData ? (
            <SCurveChart
              scurve={scurveData}
              currentUser={currentUser}
              onRefresh={() => {
                loadSCurveData();
                loadWbsData();
              }}
            />
          ) : (
            <div className="p-12 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
              Menghitung data Kurva S proyek...
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Bottleneck Radar SLA */}
      {activeStudioTab === 'radar' && (
        <BottleneckRadar
          project={project}
          currentUser={currentUser}
          onOpenStageWorkflow={(code) => {
            setSearchQuery(code);
            setActiveStudioTab('wbs');
          }}
        />
      )}

      {/* Preset Chooser Modal */}
      {presetModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Pilih Preset Starter WBS Pack
                </h3>
              </div>
              <button
                onClick={() => setPresetModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <p className="text-slate-600 leading-relaxed">
                Terapkan template struktur standar untuk memulai proyek secara instan.
                <span className="font-semibold text-rose-600 block mt-1">
                  Perhatian: Menerapkan preset akan mereset dan mengganti struktur node WBS yang ada saat ini.
                </span>
              </p>

              <div className="space-y-3">
                {/* Preset 1: General EPC */}
                <div
                  onClick={() => !presetSubmitting && handleApplyPreset('general_epc')}
                  className="p-4 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 cursor-pointer transition-all flex items-start space-x-3.5"
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                    1
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-900">General EPC Pack</h4>
                      <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-semibold text-[10px]">
                        Direkomendasikan
                      </span>
                    </div>
                    <p className="text-slate-500 mt-1 text-[11px] leading-snug">
                      Struktur standar: Engineering (15%), Procurement (35%), Civil & Construction (45% dengan sub-inspeksi), Pre-Commissioning (5%).
                    </p>
                  </div>
                </div>

                {/* Preset 2: Civil Building */}
                <div
                  onClick={() => !presetSubmitting && handleApplyPreset('civil_building')}
                  className="p-4 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50/40 cursor-pointer transition-all flex items-start space-x-3.5"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                    2
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900">Civil Building Pack</h4>
                    <p className="text-slate-500 mt-1 text-[11px] leading-snug">
                      Disesuaikan untuk proyek gedung & sipil: Persiapan (10%), Struktur Bawah (30%), Struktur Atas & Arsitektur (40%), MEP (20%).
                    </p>
                  </div>
                </div>

                {/* Preset 3: Blank Canvas */}
                <div
                  onClick={() => !presetSubmitting && handleApplyPreset('blank')}
                  className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 cursor-pointer transition-all flex items-start space-x-3.5"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                    3
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-900">Blank Canvas</h4>
                    <p className="text-slate-500 mt-1 text-[11px] leading-snug">
                      Mulai dari kanvas kosong tanpa node awal. Cocok untuk menyusun struktur kustom dari awal.
                    </p>
                  </div>
                </div>
              </div>

              {presetSubmitting && (
                <div className="py-2 text-center text-indigo-700 font-semibold animate-pulse">
                  Sedang menerapkan struktur preset...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Node Modal */}
      {nodeModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">
                {editingNode ? `Edit WBS Node: ${editingNode.wbsCode}` : 'Tambah Item WBS Baru'}
              </h3>
              <button
                onClick={() => setNodeModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNode} className="p-6 space-y-4 text-xs">
              {/* Parent Selector */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Parent Node (Hirarki)
                </label>
                <select
                  value={formParentId}
                  onChange={(e) => setFormParentId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 bg-white"
                >
                  <option value="">Root Level (Tingkat Utama Proyek)</option>
                  {flatNodes
                    .filter((n) => !editingNode || n.id !== editingNode.id)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {'-'.repeat(n.level * 2)} {n.wbsCode} - {n.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Code & Weight */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    WBS Code *
                  </label>
                  <input
                    type="text"
                    required
                    value={formWbsCode}
                    onChange={(e) => setFormWbsCode(e.target.value)}
                    placeholder="Contoh: 1.0 atau 3.2.1"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Bobot Relatif (%) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    required
                    value={formWeight}
                    onChange={(e) => setFormWeight(e.target.value)}
                    placeholder="15.00"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
              </div>

              {/* Work Name */}
              <div>
                <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Nama Pekerjaan / Paket Kerja *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Contoh: Civil & Structural Construction"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
                />
              </div>

              {/* Document Reference & Revision */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Nomor Dokumen Acuan / Gambar
                  </label>
                  <input
                    type="text"
                    value={formDocRef}
                    onChange={(e) => setFormDocRef(e.target.value)}
                    placeholder="Contoh: DWG-STR-104"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Revisi Aktif
                  </label>
                  <input
                    type="text"
                    value={formRevision}
                    onChange={(e) => setFormRevision(e.target.value)}
                    placeholder="Rev C"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono"
                  />
                </div>
              </div>

              {/* Schedule Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Rencana Mulai
                  </label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Rencana Selesai
                  </label>
                  <input
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2.5">
                <button
                  type="button"
                  onClick={() => setNodeModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  Simpan Node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmNode && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-slate-200 p-6 text-xs space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
              <Trash2 className="w-5 h-5" />
            </div>
            <div className="text-center">
              <h3 className="text-sm font-bold text-slate-900">
                Hapus Node WBS {deleteConfirmNode.wbsCode}?
              </h3>
              <p className="text-slate-500 mt-1">
                Apakah Anda yakin ingin menghapus "{deleteConfirmNode.name}"?
              </p>
            </div>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                onClick={() => setDeleteConfirmNode(null)}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
              >
                Batal
              </button>
              <button
                onClick={() => handleDeleteNode(deleteConfirmNode)}
                className="flex-1 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Stage Workflow & Hold Point Modal */}
      {selectedWorkflowNode && (
        <NodeWorkflowModal
          isOpen={Boolean(selectedWorkflowNode)}
          project={project}
          node={selectedWorkflowNode}
          currentUser={currentUser}
          onClose={() => setSelectedWorkflowNode(null)}
          onWorkflowUpdated={() => {
            loadWbsData();
          }}
        />
      )}

      {/* Weather & Rain Log Modal (EOT Claims) */}
      <WeatherLogModal
        project={project}
        currentUser={currentUser}
        isOpen={weatherModalOpen}
        onClose={() => setWeatherModalOpen(false)}
      />
    </div>
  );
};
