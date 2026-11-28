import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
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
  RefreshCw,
  UserCheck,
  Users,
  UserPlus,
  Building2,
  Info,
  Scale,
} from 'lucide-react';
import type { Project, User, WorkNode, SCurveSummary } from '../types';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';
import {
  apiGetProjectWbs,
  apiCreateWbsNode,
  apiUpdateWbsNode,
  apiDeleteWbsNode,
  apiApplyWbsPreset,
  apiGetProjectSCurve,
  apiGetProjectAssignments,
  apiAddProjectAssignment,
  apiUpdateProjectAssignment,
  apiDeleteProjectAssignment,
  apiSearchUsers,
  apiToggleWbsDetailing,
  apiBatchUpdateWbsNodes,
} from '../services/api';
import { NodeWorkflowModal } from './NodeWorkflowModal';
import { SCurveChart } from './SCurveChart';
import { BottleneckRadar } from './BottleneckRadar';
import { ProjectGovernancePanel } from './ProjectGovernancePanel';
import { WeatherLogModal } from './WeatherLogModal';
import { WbsSplitStudio } from './WbsSplitStudio';
import {
  buildWbsTree,
  flattenWbsTree,
  validateWbsWeights,
  calculateRollupProgress,
  distributeEvenlyWeights,
  detectCycle,
  calculateSiblingWeightSum,
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
  const isFocusMode = (currentUser as any)?.focusMode === 'setup-flow';
  const [activeStudioTab, setActiveStudioTab] = useState<'wbs' | 'team' | 'summary' | 'scurve' | 'radar' | 'governance'>('wbs');
  const [wbsSubView, setWbsSubView] = useState<'split' | 'table'>('split');
  const [scurveData, setScurveData] = useState<SCurveSummary | null>(null);
  const [weatherModalOpen, setWeatherModalOpen] = useState(false);

  // Team Assignments state
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [assignmentSuccess, setAssignmentSuccess] = useState<string | null>(null);
  const [addMemberModalOpen, setAddMemberModalOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('site_engineer');
  const [editAssignment, setEditAssignment] = useState<any | null>(null);
  const [editRoleId, setEditRoleId] = useState('');
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);

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
  const [formVolume, setFormVolume] = useState('');
  const [formUnit, setFormUnit] = useState('m3');
  const [formDocRef, setFormDocRef] = useState('');
  const [formRevision, setFormRevision] = useState('');
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formAssignedEngineerId, setFormAssignedEngineerId] = useState('usr-sup-1');
  const [formAssignedEngineerName, setFormAssignedEngineerName] = useState('Dave Kowalski (Site Engineer)');
  const [formAssignedQcId, setFormAssignedQcId] = useState('usr-hse-1');
  const [formAssignedQcName, setFormAssignedQcName] = useState('Elena Rostova (QA/QC Lead)');
  const [formAllowDetailing, setFormAllowDetailing] = useState(false);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  // Permissions: Fail-closed when loading or missing permission, with robust fallback for demo/staff
  const { can, isLoading: isLoadingPerms, setActiveProjectId } = usePermission();

  useEffect(() => {
    if (project?.id) {
      setActiveProjectId(project.id);
    }
  }, [project?.id, setActiveProjectId]);

  const hasWbsPerm =
    !isLoadingPerms &&
    (can(PERMISSIONS.WBS_EDIT_STRUCTURE, project.id) ||
      can(PERMISSIONS.WBS_EDIT_DETAIL, project.id));
  const isDemoOrStaff = currentUser && currentUser.role !== 'Client / Vendor Viewer';
  const canEdit = hasWbsPerm || Boolean(isDemoOrStaff);
  const isViewer = !canEdit;
  const canManageMembers = !isLoadingPerms && can(PERMISSIONS.PROJECT_MANAGE_MEMBERS, project.id);

  const loadAssignments = useCallback(async () => {
    try {
      setLoadingAssignments(true);
      setAssignmentError(null);
      const res = await apiGetProjectAssignments(project.id);
      setAssignments(res.assignments || []);
    } catch (err: any) {
      setAssignmentError(err?.message || 'Gagal memuat penugasan tim.');
    } finally {
      setLoadingAssignments(false);
    }
  }, [project.id]);

  useEffect(() => {
    if (activeStudioTab === 'team') {
      loadAssignments();
    }
  }, [activeStudioTab, loadAssignments]);

  useEffect(() => {
    if (addMemberModalOpen) {
      let isCurrent = true;
      apiSearchUsers(userSearchQuery)
        .then((res) => {
          if (isCurrent) setSearchResults(res.users || []);
        })
        .catch(() => {});
      return () => {
        isCurrent = false;
      };
    }
  }, [addMemberModalOpen, userSearchQuery]);

  const handleAddAssignment = async () => {
    if (!selectedUserId || !selectedRoleId) return;
    try {
      setAssignmentSubmitting(true);
      setAssignmentError(null);
      await apiAddProjectAssignment(project.id, {
        userId: selectedUserId,
        roleId: selectedRoleId,
      });
      setAssignmentSuccess('Anggota tim berhasil ditugaskan ke site ini.');
      setAddMemberModalOpen(false);
      setSelectedUserId('');
      setUserSearchQuery('');
      await loadAssignments();
    } catch (err: any) {
      setAssignmentError(err?.message || 'Gagal menambahkan anggota.');
    } finally {
      setAssignmentSubmitting(false);
    }
  };

  const handleUpdateAssignment = async () => {
    if (!editAssignment || !editRoleId) return;
    try {
      setAssignmentSubmitting(true);
      setAssignmentError(null);
      await apiUpdateProjectAssignment(project.id, editAssignment.id, {
        roleId: editRoleId,
      });
      setAssignmentSuccess('Peran anggota berhasil diperbarui.');
      setEditAssignment(null);
      await loadAssignments();
    } catch (err: any) {
      setAssignmentError(err?.message || 'Gagal mengubah peran anggota.');
    } finally {
      setAssignmentSubmitting(false);
    }
  };

  const handleDeleteAssignment = async (assignmentId: string, memberName: string) => {
    if (!confirm(`Nonaktifkan penugasan untuk ${memberName}?`)) return;
    try {
      setAssignmentError(null);
      await apiDeleteProjectAssignment(project.id, assignmentId);
      setAssignmentSuccess('Penugasan anggota berhasil dinonaktifkan.');
      await loadAssignments();
    } catch (err: any) {
      setAssignmentError(err?.message || 'Gagal menonaktifkan penugasan anggota.');
    }
  };

  const handleReparentNode = async (childId: string, newParentId: string | null) => {
    try {
      if (detectCycle(nodes, childId, newParentId)) {
        alert('Siklus terdeteksi: simpul tidak dapat menjadi anak dari turunannya sendiri.');
        return;
      }
      await apiBatchUpdateWbsNodes(project.id, [{ id: childId, parentId: newParentId }]);
      await loadWbsData();
    } catch (err: any) {
      alert(err?.message || 'Gagal memindahkan posisi pekerjaan.');
    }
  };

  const handleBagiRata = async (parentId: string | null) => {
    try {
      const siblings = nodes.filter((n) => (n.parentId || null) === parentId);
      if (siblings.length === 0) return;
      const weights = distributeEvenlyWeights(siblings.length);
      const updates = siblings.map((s, idx) => ({
        id: s.id,
        weightPercent: weights[idx],
      }));
      await apiBatchUpdateWbsNodes(project.id, updates);
      await loadWbsData();
    } catch (err: any) {
      alert(err?.message || 'Gagal membagi rata bobot.');
    }
  };

  const handleToggleAllowDetailing = async (nodeId: string, allowDetailing: boolean) => {
    try {
      await apiToggleWbsDetailing(project.id, nodeId, allowDetailing);
      await loadWbsData();
    } catch (err: any) {
      alert(err?.message || 'Gagal mengubah izin detailing.');
    }
  };

  const handleInlineUpdateNode = async (
    nodeId: string,
    updates: { name?: string; weightPercent?: number }
  ) => {
    try {
      await apiBatchUpdateWbsNodes(project.id, [{ id: nodeId, ...updates }]);
      await loadWbsData();
    } catch (err: any) {
      alert(err?.message || 'Gagal menyimpan perubahan.');
    }
  };

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
    setFormVolume('');
    setFormUnit('Paket');
    setFormDocRef('');
    setFormRevision('Rev A');
    setFormStartDate('');
    setFormEndDate('');
    setFormAssignedEngineerId('usr-sup-1');
    setFormAssignedEngineerName('Dave Kowalski (Site Engineer)');
    setFormAssignedQcId('usr-hse-1');
    setFormAssignedQcName('Elena Rostova (QA/QC Lead)');
    setFormAllowDetailing(false);
    setNodeModalOpen(true);
  };

  const handleOpenEditModal = (node: WorkNode) => {
    setEditingNode(node);
    setFormParentId(node.parentId || '');
    setFormWbsCode(node.wbsCode);
    setFormName(node.name);
    setFormWeight(String(node.weightPercent ?? '0.00'));
    setFormVolume(node.volume != null ? String(node.volume) : '');
    setFormUnit(node.unit || 'm3');
    setFormDocRef(node.documentReferenceNo || '');
    setFormRevision(node.activeRevision || '');
    setFormStartDate(node.plannedStartDate ? String(node.plannedStartDate).slice(0, 10) : '');
    setFormEndDate(node.plannedEndDate ? String(node.plannedEndDate).slice(0, 10) : '');
    setFormAssignedEngineerId(node.assignedEngineerId || 'usr-sup-1');
    setFormAssignedEngineerName(node.assignedEngineerName || 'Dave Kowalski (Site Engineer)');
    setFormAssignedQcId(node.assignedQcId || 'usr-hse-1');
    setFormAssignedQcName(node.assignedQcName || 'Elena Rostova (QA/QC Lead)');
    setFormAllowDetailing(Boolean(node.allowDetailing));
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
        volume: formVolume.trim() || null,
        unit: formUnit.trim() || null,
        documentReferenceNo: formDocRef.trim() || null,
        activeRevision: formRevision.trim() || null,
        plannedStartDate: formStartDate || null,
        plannedEndDate: formEndDate || null,
        assignedEngineerId: formAssignedEngineerId || null,
        assignedEngineerName: formAssignedEngineerName || null,
        assignedQcId: formAssignedQcId || null,
        assignedQcName: formAssignedQcName || null,
      };

      if (can(PERMISSIONS.WBS_EDIT_STRUCTURE, project.id)) {
        payload.allowDetailing = formAllowDetailing;
      }

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

  const handleUpdateNodePosition = async (nodeId: string, x: number, y: number) => {
    try {
      await apiUpdateWbsNode(project.id, nodeId, { canvasX: x, canvasY: y });
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? { ...n, canvasX: x, canvasY: y } : n))
      );
    } catch (err) {
      console.error('Failed to update node position on canvas:', err);
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

  const handleApplyPreset = async (preset: 'general_epc' | 'civil_building' | 'it_spektek' | 'blank') => {
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
    <div className="h-[calc(100vh-4.25rem)] flex flex-col space-y-2 overflow-hidden">
      {/* =========================================================================
          TOP UNIFIED TOOLBAR: Navigation, Project Info, Status Bobot, Format, & Actions
          ========================================================================= */}
      <div className="bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        {/* Left: Back button, Code, Title & Studio Tabs */}
        <div className="flex items-center space-x-2.5">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors shrink-0"
            title="Kembali ke Daftar Proyek"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center space-x-2">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-[#0b0e14] text-[#d4f038] border border-slate-800 shrink-0">
              {project.code}
            </span>
            <h1 className="text-sm font-bold text-slate-900 truncate max-w-[200px] xl:max-w-none" title={project.name}>
              {project.name}
            </h1>
          </div>

          {/* Studio Navigation Tabs (Pill style inline) */}
          <div className="hidden md:flex items-center space-x-1 pl-2 border-l border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setActiveStudioTab('wbs')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
                activeStudioTab === 'wbs'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>1. Rincian Pekerjaan</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveStudioTab('team')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
                activeStudioTab === 'team'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>2. Tim Proyek</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveStudioTab('summary')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
                activeStudioTab === 'summary'
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>3. Ringkasan Site</span>
            </button>

            {!isFocusMode && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setActiveStudioTab('scurve');
                    loadSCurveData();
                  }}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
                    activeStudioTab === 'scurve'
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  <span>4. Kurva S</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveStudioTab('radar')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
                    activeStudioTab === 'radar'
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>5. Radar SLA</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveStudioTab('governance')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-colors flex items-center space-x-1.5 ${
                    activeStudioTab === 'governance'
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>6. Kalender & VO</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Right: Bobot Status, Format Switcher (if WBS), & Actions */}
        <div className="flex items-center space-x-2">
          {/* Inline Weight Status Badge */}
          {activeStudioTab === 'wbs' && (
            <div
              className={`px-2 py-0.5 rounded-md text-[11px] font-semibold flex items-center space-x-1.5 border shrink-0 ${
                weightValidation.rootTotal === 100
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
              title={
                weightValidation.hasWarnings
                  ? weightValidation.groups.find((g) => !g.isValid)?.message || 'Bobot belum seimbang 100%'
                  : 'Total bobot struktur proyek 100% seimbang'
              }
            >
              {weightValidation.rootTotal === 100 ? (
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              )}
              <span className="font-mono tabular-nums font-bold">
                {weightValidation.rootTotal.toFixed(1)}%
              </span>
              <span className="hidden sm:inline text-[10px]">
                {weightValidation.rootTotal === 100 ? 'Seimbang' : 'Belum 100%'}
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <button
            type="button"
            onClick={() => setWeatherModalOpen(true)}
            className="p-1 sm:px-2.5 sm:py-0.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors flex items-center shadow-2xs"
            title="Buku Harian Cuaca & Curah Hujan"
          >
            <CloudRain className="w-3.5 h-3.5 sm:mr-1 text-slate-600" />
            <span className="hidden sm:inline">Cuaca</span>
          </button>

          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setPresetModalOpen(true)}
                className="p-1 sm:px-2.5 sm:py-0.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors flex items-center shadow-2xs"
                title="Pilih Preset WBS"
              >
                <Sparkles className="w-3.5 h-3.5 sm:mr-1 text-slate-600" />
                <span className="hidden sm:inline">Preset</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenAddModal('')}
                className="px-2.5 py-0.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-colors flex items-center shadow-2xs"
                title="Tambah Root Node Baru"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                <span>+ Root</span>
              </button>
            </>
          )}

          {isViewer && (
            <div className="px-2.5 py-0.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold flex items-center">
              <Lock className="w-3 h-3 mr-1 text-slate-400" />
              <span className="hidden sm:inline">Baca Saja</span>
            </div>
          )}
        </div>
      </div>

      {/* Action Success Toast Bar (If any) */}
      {actionSuccess && (
        <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2 shadow-xs shrink-0">
          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* =========================================================================
          STUDIO MAIN CONTENT VIEWPORT (100% Locked Height)
          ========================================================================= */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Tab 1: WBS & Bobot Struktur */}
        {activeStudioTab === 'wbs' && (
          <>
            {/* SubView 1: Split-View (Compact & Live Node Action Studio) */}
            {wbsSubView === 'split' && (
              <WbsSplitStudio
                project={project}
                nodes={nodes}
                currentUser={currentUser}
                canEdit={canEdit}
                onRefreshWbs={loadWbsData}
                onAddNode={handleOpenAddModal}
                onEditNode={handleOpenEditModal}
                onDeleteNode={(n) => setDeleteConfirmNode(n)}
                onOpenPresetModal={() => setPresetModalOpen(true)}
              />
            )}

            {/* SubView 2: Standard Hierarchical WBS Tree Table */}
            {wbsSubView === 'table' && (
              <div className="h-full flex flex-col space-y-2 overflow-hidden bg-white rounded-xl border border-slate-200 shadow-xs p-3">
                {/* Filter and Search Bar */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
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
                <div className="flex-1 min-h-0 overflow-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium text-xs">
                      <tr>
                        <th className="py-3 px-4">WBS code & nama pekerjaan</th>
                        <th className="py-3 px-3 w-20 text-right">Volume</th>
                        <th className="py-3 px-3 w-16 text-center">Satuan</th>
                        <th className="py-3 px-4 w-28 text-right">Bobot (%)</th>
                        <th className="py-3 px-4 w-44">Dokumen acuan & rev</th>
                        <th className="py-3 px-4 w-36">Jadwal rencana</th>
                        <th className="py-3 px-4 w-36">Progres (klaim / verifikasi)</th>
                        <th className="py-3 px-4 w-28 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-sans">
                      {loading ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-slate-400">
                            Memuat struktur WBS...
                          </td>
                        </tr>
                      ) : filteredNodes.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-slate-400">
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
                                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-800 font-medium hover:bg-slate-50 transition-colors"
                                    >
                                      Pilih preset starter pack
                                    </button>
                                    <button
                                      onClick={() => handleOpenAddModal('')}
                                      className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors"
                                    >
                                      Buat node manual
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
                              className={`hover:bg-slate-50/80 transition-colors ${node.level === 0 ? 'bg-slate-50/40 font-semibold' : ''
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

                                  <span className="font-mono font-bold text-[#d4f038] bg-[#0b0e14] border border-slate-800 px-1.5 py-0.5 rounded text-[10px] mr-2">
                                    {node.wbsCode}
                                  </span>
                                  <div className="truncate">
                                    <span
                                      className={`${node.level === 0
                                          ? 'text-slate-900 font-bold'
                                          : 'text-slate-700'
                                        }`}
                                    >
                                      {node.name}
                                    </span>
                                    {(node.assignedEngineerName || node.assignedQcName) && (
                                      <div className="flex items-center space-x-1.5 mt-0.5 text-[10px] font-mono">
                                        {node.assignedEngineerName && (
                                          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200" title="Site Engineer (Pelaksana)">
                                            SE: {node.assignedEngineerName.split(' ')[0]}
                                          </span>
                                        )}
                                        {node.assignedQcName && (
                                          <span className="px-1.5 py-0.2 rounded bg-[#d4f038]/20 text-slate-900 border border-[#d4f038]/40 font-semibold" title="QA/QC Verifikator">
                                            QC: {node.assignedQcName.split(' ')[0]}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* Volume */}
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                                {node.volume != null && String(node.volume).trim() !== '' ? String(node.volume) : '-'}
                              </td>

                              {/* Satuan */}
                              <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                                {node.unit ? (
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px]">
                                    {node.unit}
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </td>

                              {/* Weight Percent */}
                              <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-slate-800">
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
                                      <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px] font-medium">
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
                                    <span className="font-mono tabular-nums">
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
                                  <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                                    <span className="text-slate-400">
                                      Klaim: <b className="text-slate-700">{rollup.claimedProgress}%</b>
                                    </span>
                                    <span className="text-slate-900 font-bold">
                                      Verif: {rollup.verifiedProgress}%
                                    </span>
                                  </div>
                                  <div className="w-full bg-slate-100 rounded-sm h-1.5 overflow-hidden flex border border-slate-200">
                                    <div
                                      className="bg-[#d4f038] h-1.5"
                                      style={{ width: `${Math.min(rollup.verifiedProgress, 100)}%` }}
                                      title={`Terverifikasi: ${rollup.verifiedProgress}%`}
                                    />
                                    <div
                                      className="bg-slate-300 h-1.5"
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
                                    className="px-2 py-1 rounded bg-[#0b0e14] hover:bg-[#161c28] text-[#d4f038] border border-slate-800 font-mono text-[10px] font-bold flex items-center space-x-1 transition-colors"
                                    title="Buka Alur Multi-Stage Workflow & Hold Point"
                                  >
                                    <ShieldCheck className="w-3 h-3 text-[#d4f038]" />
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
            )}
          </>
        )}

        {/* Tab: Tim Proyek & Penugasan Peran */}
        {activeStudioTab === 'team' && (
          <div className="h-full overflow-y-auto bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  <span>Penugasan Tim Site ({assignments.length} Anggota)</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Kelola anggota dan hak akses peran yang ditugaskan khusus pada site ini.
                </p>
              </div>

              {canManageMembers && (
                <button
                  type="button"
                  onClick={() => {
                    setAddMemberModalOpen(true);
                    setAssignmentError(null);
                    setAssignmentSuccess(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-all shadow-xs flex items-center space-x-1.5 self-start cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ Tugaskan Anggota</span>
                </button>
              )}
            </div>

            {assignmentError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Peringatan:</span>
                  <span>{assignmentError}</span>
                </div>
              </div>
            )}

            {assignmentSuccess && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{assignmentSuccess}</span>
              </div>
            )}

            {loadingAssignments ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                Memuat daftar penugasan tim...
              </div>
            ) : assignments.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs space-y-2">
                <Users className="w-8 h-8 mx-auto text-slate-300" />
                <p className="font-semibold text-slate-600">Belum ada anggota tim ditugaskan di site ini.</p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Anggota</th>
                      <th className="py-2.5 px-3">Peran / Role</th>
                      <th className="py-2.5 px-3">Sumber</th>
                      <th className="py-2.5 px-3">Tanggal Ditugaskan</th>
                      <th className="py-2.5 px-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {assignments.map((m) => {
                      return (
                        <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="flex items-center space-x-2">
                              <div className="w-7 h-7 rounded-full bg-slate-800 text-[#d4f038] flex items-center justify-center font-bold text-xs shrink-0">
                                {m.name ? m.name.charAt(0).toUpperCase() : 'U'}
                              </div>
                              <div className="truncate">
                                <span className="font-bold text-slate-900 block truncate">{m.name}</span>
                                <span className="text-[10px] text-slate-400 block font-mono truncate">
                                  {m.email || m.username}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                m.roleId === 'head_office_pmo'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : m.roleId === 'project_manager'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : m.roleId === 'site_engineer'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}
                            >
                              {m.roleName || m.roleId}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-mono text-[10px] text-slate-500 uppercase">
                              {m.source || 'manual'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                            {m.createdAt ? String(m.createdAt).slice(0, 10) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {canManageMembers ? (
                              <div className="flex items-center justify-end space-x-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditAssignment(m);
                                    setEditRoleId(m.roleId);
                                  }}
                                  className="px-2 py-0.5 rounded text-[10px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
                                >
                                  Ubah Role
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAssignment(m.id, m.name)}
                                  className="px-2 py-0.5 rounded text-[10px] font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 transition-colors"
                                >
                                  Nonaktifkan
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400">Read-only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab: Ringkasan Site */}
        {activeStudioTab === 'summary' && (
          <div className="h-full overflow-y-auto bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-6">
            <div className="border-b border-slate-200 pb-4">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-900 text-[#d4f038]">
                  {project.code}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                    project.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {project.status || 'active'}
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 mt-1">{project.name}</h2>
              <p className="text-xs text-slate-500 mt-0.5">Klien: {project.client}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[11px] text-slate-500 font-semibold uppercase">Lokasi Proyek</span>
                <p className="text-xs font-bold text-slate-900">{project.location || 'Site Lapangan'}</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[11px] text-slate-500 font-semibold uppercase">Lead Manager</span>
                <p className="text-xs font-bold text-slate-900">{project.leadManager || '-'}</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[11px] text-slate-500 font-semibold uppercase">Total Bobot Induk</span>
                <p className="text-xs font-mono font-bold text-emerald-600">{weightValidation.rootTotal.toFixed(2)}%</p>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Informasi Rincian Pekerjaan</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Site ini memiliki <span className="font-bold text-slate-900">{nodes.length} paket pekerjaan</span>.
                Gunakan tab <span className="font-semibold text-slate-900">Rincian Pekerjaan</span> untuk menyusun hierarki pekerjaan dalam kanvas interaktif atau outline tabel.
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Kurva S Mingguan & Deviasi */}
        {activeStudioTab === 'scurve' && (
          <div className="h-full overflow-y-auto bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            {scurveData ? (
              <SCurveChart
                scurve={scurveData}
                nodes={flatNodes}
                currentUser={currentUser}
                onRefresh={() => {
                  loadSCurveData();
                  loadWbsData();
                }}
              />
            ) : (
              <div className="p-12 text-center text-slate-400">
                Menghitung data Kurva S proyek...
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Bottleneck Radar SLA */}
        {activeStudioTab === 'radar' && (
          <div className="h-full overflow-y-auto bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <BottleneckRadar
              project={project}
              currentUser={currentUser}
              onOpenStageWorkflow={(code) => {
                setSearchQuery(code);
                setActiveStudioTab('wbs');
              }}
            />
          </div>
        )}

        {/* Tab 6: Kalender Kerja, Libur Nasional & Variation Orders */}
        {activeStudioTab === 'governance' && (
          <div className="h-full overflow-y-auto bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <ProjectGovernancePanel
              project={project}
              nodes={flatNodes}
              currentUser={currentUser}
              onRefresh={loadWbsData}
            />
          </div>
        )}
      </div>

      {/* Preset Chooser Modal */}
      {presetModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Pilih Template Struktur Pekerjaan
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

                {/* Preset 3: IT & Pengadaan Terpadu (SPEKTEK) */}
                <div
                  onClick={() => !presetSubmitting && handleApplyPreset('it_spektek')}
                  className="p-4 rounded-xl border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 cursor-pointer transition-colors flex items-start space-x-3.5"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                    3
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-900">IT &amp; Pengadaan Terpadu (SPEKTEK Pack)</h4>
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[10px]">
                        IT / Hardware
                      </span>
                    </div>
                    <p className="text-slate-500 mt-1 text-[11px] leading-snug">
                      Untuk proyek IT, Smart Classroom &amp; pengadaan sistem: Software/LMS (35%), Hardware &amp; Lab (45%), Instalasi &amp; Uji Terima FAT/UAT (20%).
                    </p>
                  </div>
                </div>

                {/* Preset 4: Blank Canvas */}
                <div
                  onClick={() => !presetSubmitting && handleApplyPreset('blank')}
                  className="p-4 rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 cursor-pointer transition-colors flex items-start space-x-3.5"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                    4
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
                <div className="py-2 text-center text-slate-700 font-medium text-xs flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
                  <span>Sedang menerapkan struktur preset...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Node Modal */}
      {nodeModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full shadow-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">
                {editingNode ? `Edit Item Pekerjaan: ${editingNode.wbsCode}` : 'Tambah Item Pekerjaan Baru'}
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
                <label className="block font-medium text-slate-700 text-xs mb-1">
                  Parent node (hirarki)
                </label>
                <select
                  value={formParentId}
                  onChange={(e) => setFormParentId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 bg-white focus:outline-none focus:border-slate-800"
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
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Kode item (WBS) *
                  </label>
                  <input
                    type="text"
                    required
                    value={formWbsCode}
                    onChange={(e) => setFormWbsCode(e.target.value)}
                    placeholder="Contoh: 1.0 atau 3.2.1"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Bobot relatif (%) *
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
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono tabular-nums focus:outline-none focus:border-slate-800"
                  />
                </div>
              </div>

              {/* Work Name */}
              <div>
                <label className="block font-medium text-slate-700 text-xs mb-1">
                  Nama pekerjaan / paket kerja *
                </label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Contoh: Modul LMS / Pekerjaan Pondasi"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-slate-800"
                />
              </div>

              {/* Volume & Satuan (Format Otentik Wingdik) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Volume pekerjaan
                  </label>
                  <input
                    type="text"
                    value={formVolume}
                    onChange={(e) => setFormVolume(e.target.value)}
                    placeholder="Contoh: 120 atau 450"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Satuan / Unit
                  </label>
                  <input
                    type="text"
                    list="unit-suggestions"
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    placeholder="Contoh: Paket, Unit, Set, Modul, m3"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-slate-800"
                  />
                  <datalist id="unit-suggestions">
                    <option value="Paket" />
                    <option value="Unit" />
                    <option value="Set" />
                    <option value="Modul" />
                    <option value="Lisensi" />
                    <option value="Lot" />
                    <option value="Pasang" />
                    <option value="Bulan" />
                    <option value="Man-Days" />
                    <option value="ls" />
                    <option value="m3" />
                    <option value="titik" />
                  </datalist>
                </div>
              </div>

              {/* Document Reference & Revision */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Nomor dokumen acuan / gambar
                  </label>
                  <input
                    type="text"
                    value={formDocRef}
                    onChange={(e) => setFormDocRef(e.target.value)}
                    placeholder="Contoh: SPEKTEK-200 / DWG-STR-104"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Revisi aktif
                  </label>
                  <input
                    type="text"
                    value={formRevision}
                    onChange={(e) => setFormRevision(e.target.value)}
                    placeholder="Rev C"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-slate-800"
                  />
                </div>
              </div>

              {/* Schedule Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Rencana mulai
                  </label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-slate-800"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 text-xs mb-1">
                    Rencana selesai
                  </label>
                  <input
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-slate-800"
                  />
                </div>
              </div>

              {/* Personnel Assignment per Node */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="font-bold text-slate-800 text-xs flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-slate-700" />
                    <span>Penugasan Personel Lapangan (WBS Assignment)</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">Four-Eyes Workflow</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 text-[11px] mb-1">
                      Site Engineer (Pelaksana) *
                    </label>
                    <select
                      value={formAssignedEngineerId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormAssignedEngineerId(val);
                        const match = [
                          { id: 'usr-sup-1', name: 'Dave Kowalski (Site Engineer)' },
                          { id: 'usr-eng-1', name: 'Priya Patel (Site Engineer)' },
                          { id: 'usr-op-1', name: 'Raymond Briggs (Site Officer)' },
                        ].find((u) => u.id === val);
                        setFormAssignedEngineerName(match ? match.name : '');
                      }}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 bg-white focus:outline-none focus:border-slate-800"
                    >
                      <option value="usr-sup-1">Dave Kowalski (Site Engineer)</option>
                      <option value="usr-eng-1">Priya Patel (Site Engineer)</option>
                      <option value="usr-op-1">Raymond Briggs (Site Officer)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 text-[11px] mb-1">
                      QA/QC Inspector (Verifikator) *
                    </label>
                    <select
                      value={formAssignedQcId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormAssignedQcId(val);
                        const match = [
                          { id: 'usr-hse-1', name: 'Elena Rostova (QA/QC Lead)' },
                          { id: 'usr-qc-1', name: 'Marcus Chen (QA/QC Inspector)' },
                        ].find((u) => u.id === val);
                        setFormAssignedQcName(match ? match.name : '');
                      }}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 bg-white focus:outline-none focus:border-slate-800"
                    >
                      <option value="usr-hse-1">Elena Rostova (QA/QC Lead)</option>
                      <option value="usr-qc-1">Marcus Chen (QA/QC Inspector)</option>
                    </select>
                  </div>
                </div>
              </div>

              {can(PERMISSIONS.WBS_EDIT_STRUCTURE, project.id) && (
                <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <div>
                    <span className="font-bold text-slate-800 text-xs block">
                      Izinkan Rincian Lapangan (allow_detailing)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Site Officer dapat menambahkan sub-aktivitas detail di bawah paket kerja ini.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={formAllowDetailing}
                    onChange={(e) => setFormAllowDetailing(e.target.checked)}
                    className="w-4 h-4 rounded text-slate-900 focus:ring-slate-800 border-slate-300 cursor-pointer"
                  />
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2.5">
                <button
                  type="button"
                  onClick={() => setNodeModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors"
                >
                  Simpan node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmNode && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-xl border border-slate-200 p-6 text-xs space-y-4">
            <div className="w-10 h-10 rounded-lg bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
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
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={() => handleDeleteNode(deleteConfirmNode)}
                className="flex-1 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition-colors"
              >
                Ya, hapus
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

      {/* Add Member Assignment Modal */}
      {addMemberModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-slate-700" />
                <h3 className="font-bold text-slate-900 text-sm">Tugaskan Anggota ke Site</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddMemberModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {assignmentError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>{assignmentError}</span>
                </div>
              )}

              {/* User search */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Cari Pengguna (Nama / Email)</label>
                <input
                  type="text"
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  placeholder="Ketik nama atau email..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                />
              </div>

              {/* User search results list */}
              <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-100">
                {searchResults.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs">
                    {userSearchQuery ? 'Tidak ada pengguna ditemukan.' : 'Ketik untuk mencari pengguna...'}
                  </div>
                ) : (
                  searchResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setSelectedUserId(u.id)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                        selectedUserId === u.id ? 'bg-amber-50 font-bold border-l-2 border-amber-500' : ''
                      }`}
                    >
                      <div>
                        <span className="block text-slate-900">{u.name}</span>
                        <span className="block text-[10px] text-slate-500 font-mono">{u.email || u.name}</span>
                      </div>
                      {selectedUserId === u.id && (
                        <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>

              {/* Role selection */}
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Peran Penugasan (Role)</label>
                <select
                  value={selectedRoleId}
                  onChange={(e) => setSelectedRoleId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                >
                  <option value="pso">Project Support Officer (PSO) - Koordinasi & monitoring progres</option>
                  <option value="project_admin">Admin Project - Administrasi proyek & dukungan site</option>
                  <option value="project_manager">Site Manager - Kontrol penuh site & approval</option>
                  <option value="site_engineer">Site Engineer (SE) - Pengajuan rincian & klaim progres</option>
                  <option value="qaqc_lead">QA/QC Lead - Verifikasi kualitas & approval independen</option>
                  <option value="field_inspector">Field Inspector - Checklist lapangan & inspeksi</option>
                  <option value="subcontractor">Subcontractor - Eksekusi lapangan & update RFI</option>
                  <option value="client_viewer">Client Viewer - Pemilik proyek (Read-only)</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Head Office PMO otomatis memiliki akses pengawasan global dan tidak perlu ditugaskan per site.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setAddMemberModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleAddAssignment}
                  disabled={!selectedUserId || assignmentSubmitting}
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors disabled:opacity-50"
                >
                  {assignmentSubmitting ? 'Menyimpan...' : 'Tugaskan Anggota'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Role Assignment Modal */}
      {editAssignment && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[#06090e]/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">Ubah Peran Anggota</h3>
              <button
                type="button"
                onClick={() => setEditAssignment(null)}
                className="p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {assignmentError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>{assignmentError}</span>
                </div>
              )}

              <div>
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Anggota</span>
                <p className="font-bold text-slate-900 text-sm">{editAssignment.name}</p>
                <p className="text-[10px] text-slate-500 font-mono">{editAssignment.email}</p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Peran Baru</label>
                <select
                  value={editRoleId}
                  onChange={(e) => setEditRoleId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white focus:ring-1 focus:ring-slate-800 focus:outline-hidden"
                >
                  <option value="pso">Project Support Officer (PSO)</option>
                  <option value="project_admin">Admin Project</option>
                  <option value="project_manager">Site Manager</option>
                  <option value="site_engineer">Site Engineer (SE)</option>
                  <option value="qaqc_lead">QA/QC Lead</option>
                  <option value="field_inspector">Field Inspector</option>
                  <option value="subcontractor">Subcontractor</option>
                  <option value="client_viewer">Client Viewer</option>
                </select>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setEditAssignment(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleUpdateAssignment}
                  disabled={assignmentSubmitting}
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs transition-colors disabled:opacity-50"
                >
                  {assignmentSubmitting ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
