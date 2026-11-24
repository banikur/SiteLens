import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderTree,
  ChevronRight,
  ChevronDown,
  Plus,
  Edit2,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  CheckCircle2,
  Clock,
  Send,
  Lock,
  Layers,
  FileText,
  Calendar,
  UserCheck,
  Sparkles,
  Scale,
  RefreshCw,
  Search,
  CheckSquare,
  AlertTriangle,
  PenTool,
  Printer,
  X,
  ExternalLink,
  GripVertical,
} from 'lucide-react';
import type { WorkNode, WorkWorkflow, WorkStage, InspectionAttempt, Project, User } from '../types';
import {
  apiGetNodeWorkflow,
  apiInitDefaultWorkflow,
  apiRequestStageRfi,
  apiSubmitStageAttempt,
  apiReviewStageAttempt,
  apiUpdateWbsNode,
} from '../services/api';
import {
  buildWbsTree,
  flattenWbsTree,
  validateWbsWeights,
  calculateRollupProgress,
  WbsTreeNode,
} from '../utils/wbs';
import { canProceedToStage, validateFourEyesDetails } from '../utils/workflow';
import { SignatureCanvasModal } from './SignatureCanvasModal';
import { PhysicalSheetModal } from './PhysicalSheetModal';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';

interface WbsSplitStudioProps {
  project: Project;
  nodes: WorkNode[];
  currentUser: User;
  canEdit: boolean;
  onRefreshWbs: () => Promise<void>;
  onAddNode: (parentId?: string) => void;
  onEditNode: (node: WorkNode) => void;
  onDeleteNode: (node: WorkNode) => void;
  onOpenPresetModal: () => void;
}

export const WbsSplitStudio: React.FC<WbsSplitStudioProps> = ({
  project,
  nodes,
  currentUser,
  canEdit,
  onRefreshWbs,
  onAddNode,
  onEditNode,
  onDeleteNode,
  onOpenPresetModal,
}) => {
  // Tree & selection state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [inspectorTab, setInspectorTab] = useState<'workflow' | 'edit' | 'punchlist'>('workflow');

  // Node workflow state
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflow, setWorkflow] = useState<WorkWorkflow | null>(null);
  const [stages, setStages] = useState<WorkStage[]>([]);
  const [attempts, setAttempts] = useState<InspectionAttempt[]>([]);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowSuccess, setWorkflowSuccess] = useState<string | null>(null);

  // Workflow submission & review states
  const [submittingStage, setSubmittingStage] = useState<WorkStage | null>(null);
  const [reviewingStage, setReviewingStage] = useState<WorkStage | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'approved' | 'rejected'>('approved');
  const [reviewNotes, setReviewNotes] = useState('');
  const [checkpoint1, setCheckpoint1] = useState(true);
  const [checkpoint2, setCheckpoint2] = useState(true);
  const [checkpoint3, setCheckpoint3] = useState(true);
  const [submissionNotes, setSubmissionNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Signature modals
  const [sigCanvasOpen, setSigCanvasOpen] = useState(false);
  const [physicalModalOpen, setPhysicalModalOpen] = useState(false);
  const [targetSigStage, setTargetSigStage] = useState<WorkStage | null>(null);
  const [capturedDigitalSig, setCapturedDigitalSig] = useState<string | null>(null);
  const [capturedWetScanUrl, setCapturedWetScanUrl] = useState<string | null>(null);

  // Inline Quick Edit state
  const [inlineWbsCode, setInlineWbsCode] = useState('');
  const [inlineName, setInlineName] = useState('');
  const [inlineWeight, setInlineWeight] = useState('0.00');
  const [inlineVolume, setInlineVolume] = useState('');
  const [inlineUnit, setInlineUnit] = useState('m3');
  const [inlineDocRef, setInlineDocRef] = useState('');
  const [inlineRevision, setInlineRevision] = useState('');
  const [inlineStartDate, setInlineStartDate] = useState('');
  const [inlineEndDate, setInlineEndDate] = useState('');
  const [inlineEngineerName, setInlineEngineerName] = useState('');
  const [inlineQcName, setInlineQcName] = useState('');
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineSaveSuccess, setInlineSaveSuccess] = useState(false);

  // Drag and drop reparenting states
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);
  const [reparentingLoading, setReparentingLoading] = useState(false);

  const checkIsDescendant = (potentialChildId: string, potentialParentId: string): boolean => {
    let curr = nodes.find((n) => n.id === potentialParentId);
    while (curr && curr.parentId) {
      if (curr.parentId === potentialChildId) return true;
      const nextPid: string = curr.parentId;
      curr = nodes.find((n) => n.id === nextPid);
    }
    return false;
  };

  const handleDropOnNode = async (targetParentId: string) => {
    if (!draggedNodeId || draggedNodeId === targetParentId) {
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      return;
    }

    const dragged = nodes.find((n) => n.id === draggedNodeId);
    const targetParent = nodes.find((n) => n.id === targetParentId);
    if (!dragged || !targetParent) return;

    if (dragged.parentId === targetParentId) {
      // Already child of target
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      return;
    }

    if (checkIsDescendant(draggedNodeId, targetParentId)) {
      alert(`Tidak dapat memindahkan '${dragged.name}' ke dalam anaknya sendiri ('${targetParent.name}'). Siklus hierarki dilarang.`);
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      return;
    }

    try {
      setReparentingLoading(true);
      await apiUpdateWbsNode(project.id, draggedNodeId, { parentId: targetParentId });
      setWorkflowSuccess(`Hierarki berhasil diubah: '${dragged.name}' kini berada di bawah '${targetParent.name}'.`);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal memindahkan posisi node.');
    } finally {
      setReparentingLoading(false);
      setDraggedNodeId(null);
      setDragOverNodeId(null);
    }
  };

  const handleDropToRoot = async () => {
    if (!draggedNodeId) return;
    const dragged = nodes.find((n) => n.id === draggedNodeId);
    if (!dragged) return;

    if (!dragged.parentId) {
      // Already root
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setIsDragOverRoot(false);
      return;
    }

    try {
      setReparentingLoading(true);
      await apiUpdateWbsNode(project.id, draggedNodeId, { parentId: null });
      setWorkflowSuccess(`Node '${dragged.name}' berhasil dipindahkan menjadi Node Tingkat Induk (Root).`);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal memindahkan node ke root.');
    } finally {
      setReparentingLoading(false);
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setIsDragOverRoot(false);
    }
  };

  const { can, isLoading: isLoadingPerms } = usePermission();
  const canExecute = !isLoadingPerms && can(PERMISSIONS.STAGE_EXECUTE, project.id);
  const canApprove = !isLoadingPerms && can(PERMISSIONS.STAGE_APPROVE, project.id);
  const canRequest = !isLoadingPerms && can(PERMISSIONS.STAGE_REQUEST, project.id);

  // Build tree & flat list
  const treeNodes = useMemo(() => buildWbsTree(nodes), [nodes]);
  const flatNodes = useMemo(() => flattenWbsTree(treeNodes), [treeNodes]);
  const weightValidation = useMemo(() => validateWbsWeights(nodes), [nodes]);

  // Default selection to first node if none selected
  useEffect(() => {
    if (flatNodes.length > 0 && !selectedNodeId) {
      setSelectedNodeId(flatNodes[0].id);
    }
  }, [flatNodes, selectedNodeId]);

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || (flatNodes.length > 0 ? flatNodes[0] : null);
  }, [nodes, selectedNodeId, flatNodes]);

  // Populate inline form when selected node changes
  useEffect(() => {
    if (selectedNode) {
      setInlineWbsCode(selectedNode.wbsCode || '');
      setInlineName(selectedNode.name || '');
      setInlineWeight(String(selectedNode.weightPercent ?? '0.00'));
      setInlineVolume(selectedNode.volume != null ? String(selectedNode.volume) : '');
      setInlineUnit(selectedNode.unit || 'm3');
      setInlineDocRef(selectedNode.documentReferenceNo || '');
      setInlineRevision(selectedNode.activeRevision || 'Rev A');
      setInlineStartDate(selectedNode.plannedStartDate ? String(selectedNode.plannedStartDate).slice(0, 10) : '');
      setInlineEndDate(selectedNode.plannedEndDate ? String(selectedNode.plannedEndDate).slice(0, 10) : '');
      setInlineEngineerName(selectedNode.assignedEngineerName || 'Dave Kowalski (Site Engineer)');
      setInlineQcName(selectedNode.assignedQcName || 'Elena Rostova (QA/QC Lead)');
      setInlineSaveSuccess(false);

      // Reset action states
      setSubmittingStage(null);
      setReviewingStage(null);
      setWorkflowSuccess(null);
      setWorkflowError(null);

      // Load workflow for selected node
      loadWorkflow(selectedNode.id);
    }
  }, [selectedNode?.id]);

  const loadWorkflow = async (nodeId: string) => {
    try {
      setWorkflowLoading(true);
      setWorkflowError(null);
      const res = await apiGetNodeWorkflow(project.id, nodeId);
      setWorkflow(res.workflow);
      setStages(res.stages || []);
      setAttempts(res.attempts || []);
    } catch (err: any) {
      setWorkflowError(err?.message || 'Gagal memuat tahapan workflow.');
    } finally {
      setWorkflowLoading(false);
    }
  };

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

  const handleInitDefaultWorkflow = async () => {
    if (!selectedNode) return;
    try {
      setActionLoading(true);
      const res = await apiInitDefaultWorkflow(project.id, selectedNode.id);
      setWorkflow(res.workflow);
      setStages(res.stages || []);
      setWorkflowSuccess('Template 3-tahap inspeksi standar (Preparation, Hold Point, Sign-off) berhasil diterapkan.');
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal membuat workflow standar.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestRfi = async (stage: WorkStage) => {
    const check = canProceedToStage(stages, stage.id);
    if (!check.allowed) {
      alert(`Peringatan Hold Point:\n${check.reason}`);
      return;
    }
    try {
      setActionLoading(true);
      const res = await apiRequestStageRfi(stage.id);
      setWorkflowSuccess(res.message);
      if (selectedNode) await loadWorkflow(selectedNode.id);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal mengajukan RFI.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartSubmit = (stage: WorkStage) => {
    const check = canProceedToStage(stages, stage.id);
    if (!check.allowed) {
      alert(`Peringatan Hold Point:\n${check.reason}`);
      return;
    }
    setSubmittingStage(stage);
    setReviewingStage(null);
    setCapturedDigitalSig(null);
    setCapturedWetScanUrl(null);
    setCheckpoint1(true);
    setCheckpoint2(true);
    setCheckpoint3(true);
    setSubmissionNotes('');
  };

  const handleSubmitAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submittingStage || !selectedNode) return;

    if (!capturedDigitalSig && !capturedWetScanUrl) {
      alert('Pilih salah satu metode tanda tangan: Tanda Tangan Digital Kanvas ATAU Scan Lembar Fisik.');
      return;
    }

    try {
      setActionLoading(true);
      const payload = {
        answers: {
          specCompliance: checkpoint1 ? 'PASS' : 'FAIL',
          qualityTolerance: checkpoint2 ? 'PASS' : 'FAIL',
          safetyConditions: checkpoint3 ? 'PASS' : 'FAIL',
          notes: submissionNotes,
        },
        signatureCanvasUrl: capturedDigitalSig,
        wetSignatureDocumentUrl: capturedWetScanUrl,
      };

      const res = await apiSubmitStageAttempt(submittingStage.id, payload);
      setWorkflowSuccess(res.message);
      setSubmittingStage(null);
      await loadWorkflow(selectedNode.id);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal mengajukan inspeksi.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartReview = (stage: WorkStage) => {
    const stageAttempts = attempts.filter((a) => a.stageId === stage.id);
    const latest = stageAttempts[0];

    if (!latest) {
      alert('Belum ada pengajuan inspeksi pada tahapan ini untuk ditinjau.');
      return;
    }

    const fourEyesCheck = validateFourEyesDetails(
      latest.requesterId,
      latest.submitterId,
      currentUser.id
    );

    if (!fourEyesCheck.valid) {
      alert(fourEyesCheck.reason || 'Pelanggaran Prinsip Four-Eyes: Anda tidak diizinkan menyetujui tahapan ini.');
      return;
    }

    setReviewingStage(stage);
    setSubmittingStage(null);
    setReviewDecision('approved');
    setReviewNotes('');
  };

  const handleReviewAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingStage || !selectedNode) return;

    try {
      setActionLoading(true);
      const res = await apiReviewStageAttempt(reviewingStage.id, {
        decision: reviewDecision,
        notes: reviewNotes,
      });

      setWorkflowSuccess(res.message);
      setReviewingStage(null);
      await loadWorkflow(selectedNode.id);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal meninjau inspeksi.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveInlineEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode) return;
    if (!inlineWbsCode.trim() || !inlineName.trim()) {
      alert('WBS Code dan Nama Pekerjaan wajib diisi.');
      return;
    }

    try {
      setInlineSaving(true);
      const payload: Partial<WorkNode> = {
        wbsCode: inlineWbsCode.trim(),
        name: inlineName.trim(),
        weightPercent: inlineWeight.trim() || '0.00',
        volume: inlineVolume.trim() || null,
        unit: inlineUnit.trim() || null,
        documentReferenceNo: inlineDocRef.trim() || null,
        activeRevision: inlineRevision.trim() || null,
        plannedStartDate: inlineStartDate || null,
        plannedEndDate: inlineEndDate || null,
        assignedEngineerName: inlineEngineerName || null,
        assignedQcName: inlineQcName || null,
      };

      await apiUpdateWbsNode(project.id, selectedNode.id, payload);
      setInlineSaveSuccess(true);
      await onRefreshWbs();
      setTimeout(() => setInlineSaveSuccess(false), 3000);
    } catch (err: any) {
      alert(err?.message || 'Gagal menyimpan pembaruan node.');
    } finally {
      setInlineSaving(false);
    }
  };

  const filteredFlatNodes = useMemo(() => {
    if (!searchQuery.trim()) return flatNodes;
    const q = searchQuery.toLowerCase();
    return flatNodes.filter(
      (n) =>
        n.wbsCode.toLowerCase().includes(q) ||
        n.name.toLowerCase().includes(q) ||
        (n.documentReferenceNo && n.documentReferenceNo.toLowerCase().includes(q))
    );
  }, [flatNodes, searchQuery]);

  // Compute node ancestors for breadcrumb
  const breadcrumbPath = useMemo(() => {
    if (!selectedNode) return [];
    const path: WorkNode[] = [selectedNode];
    let curr = selectedNode;
    while (curr.parentId) {
      const parent = nodes.find((n) => n.id === curr.parentId);
      if (parent) {
        path.unshift(parent);
        curr = parent;
      } else {
        break;
      }
    }
    return path;
  }, [selectedNode, nodes]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      {/* =========================================================================
          LEFT PANE: Master WBS Tree & Quick Hierarchy Navigator (42% Width)
          ========================================================================= */}
      <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col h-[750px]">
        {/* Left Header & Actions */}
        <div className="p-3.5 border-b border-slate-200 bg-slate-50 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FolderTree className="w-4 h-4 text-slate-700" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Struktur WBS ({nodes.length} Node)
              </h3>
            </div>
            <div className="flex items-center space-x-1">
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={onOpenPresetModal}
                    className="px-2 py-1 text-[10px] font-semibold rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 shadow-2xs transition-colors flex items-center space-x-1"
                    title="Gunakan Starter Pack Preset"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>Preset</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddNode('')}
                    className="px-2 py-1 text-[10px] font-bold rounded bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] shadow-2xs transition-colors flex items-center space-x-1"
                    title="Tambah Node Tingkat Induk (Root)"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Induk</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari kode, nama, atau drawing..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500 text-slate-800 placeholder-slate-400"
            />
          </div>

          {/* Tip for Drag & Drop */}
          {canEdit && (
            <div className="text-[10px] text-slate-500 flex items-center space-x-1.5 px-0.5">
              <GripVertical className="w-3 h-3 text-slate-400 shrink-0" />
              <span className="truncate">Tarik & lepas (drag-and-drop) item untuk mengatur struktur parent/anak.</span>
            </div>
          )}

          {/* Sibling Weight Validation Banner */}
          <div className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-white border border-slate-200">
            <span className="text-slate-500 font-medium">Validasi Bobot Sibling:</span>
            {!weightValidation.hasWarnings ? (
              <span className="text-emerald-700 font-bold flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>100% Seimbang</span>
              </span>
            ) : (
              <span className="text-amber-700 font-semibold flex items-center space-x-1" title={weightValidation.groups.find((g) => !g.isValid)?.message}>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span className="truncate max-w-[170px]">
                  {weightValidation.groups.find((g) => !g.isValid)?.message || 'Bobot belum 100%'}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Tree List (Scrollable) */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-1.5 font-sans">
          {/* Drop Target for Root Level */}
          {draggedNodeId && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setIsDragOverRoot(true);
              }}
              onDragLeave={() => setIsDragOverRoot(false)}
              onDrop={(e) => {
                e.preventDefault();
                handleDropToRoot();
              }}
              className={`p-2.5 mb-2 rounded-lg border-2 border-dashed text-center text-xs font-bold transition-all cursor-pointer ${
                isDragOverRoot
                  ? 'border-blue-500 bg-blue-100 text-blue-900 scale-[1.01] shadow-xs'
                  : 'border-slate-300 bg-slate-50 text-slate-600 hover:border-slate-400'
              }`}
            >
              <span>📦 Jatuhkan di sini untuk jadikan Node Tingkat Induk (Root)</span>
            </div>
          )}

          {filteredFlatNodes.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <FolderTree className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-xs font-semibold text-slate-600">
                {searchQuery ? 'Tidak ada node cocok.' : 'Belum ada struktur WBS.'}
              </p>
              {canEdit && (
                <button
                  onClick={() => onAddNode('')}
                  className="px-3 py-1.5 rounded-lg bg-[#d4f038] text-[#0b0e14] font-bold text-xs"
                >
                  + Buat Node Baru
                </button>
              )}
            </div>
          ) : (
            filteredFlatNodes.map((node) => {
              const hasChildren = node.children && node.children.length > 0;
              const isCollapsed = collapsedNodes.has(node.id);
              const isSelected = selectedNode?.id === node.id;
              const isCurrentlyDragged = draggedNodeId === node.id;
              const isDragOver = dragOverNodeId === node.id;
              const rollup = calculateRollupProgress(node);

              return (
                <div
                  key={node.id}
                  draggable={canEdit}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', node.id);
                    setDraggedNodeId(node.id);
                  }}
                  onDragOver={(e) => {
                    if (draggedNodeId && draggedNodeId !== node.id) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      setDragOverNodeId(node.id);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverNodeId === node.id) {
                      setDragOverNodeId(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOnNode(node.id);
                  }}
                  onDragEnd={() => {
                    setDraggedNodeId(null);
                    setDragOverNodeId(null);
                    setIsDragOverRoot(false);
                  }}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`group px-2 py-2 rounded-lg cursor-pointer transition-all flex items-center justify-between gap-2 relative ${
                    isDragOver
                      ? 'border-2 border-amber-500 bg-amber-100/90 shadow-md ring-2 ring-amber-300 scale-[1.01]'
                      : isCurrentlyDragged
                      ? 'opacity-35 border-dashed border-slate-400 bg-slate-100'
                      : isSelected
                      ? 'bg-amber-50/80 border border-amber-300 shadow-2xs text-slate-900'
                      : 'hover:bg-slate-50 border border-transparent text-slate-700'
                  }`}
                  style={{ marginLeft: `${node.level * 14}px` }}
                >
                  <div className="flex items-center space-x-1.5 overflow-hidden min-w-0">
                    {/* Drag Handle Icon */}
                    {canEdit && (
                      <span
                        className="cursor-grab active:cursor-grabbing text-slate-400 group-hover:text-slate-700 p-0.5 shrink-0"
                        title="Geser untuk memindahkan hierarki (Drag & Drop)"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                    )}

                    {/* Expand/Collapse Chevron */}
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(node.id);
                        }}
                        className="p-0.5 rounded text-slate-400 hover:text-slate-800 hover:bg-slate-200/60 shrink-0"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-3.5 text-center text-slate-300 font-mono text-[10px] shrink-0">•</span>
                    )}

                    {/* WBS Code Pill */}
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold shrink-0 ${
                        node.level === 0
                          ? 'bg-slate-900 text-white'
                          : node.level === 1
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-800 border border-slate-200'
                      }`}
                    >
                      {node.wbsCode}
                    </span>

                    {/* Work Title */}
                    <div className="truncate text-xs font-semibold">
                      <span className={isSelected ? 'text-slate-950 font-bold' : 'text-slate-800'}>
                        {node.name}
                      </span>
                    </div>

                    {/* Drop indication badge */}
                    {isDragOver && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[9px] font-mono font-bold shrink-0 shadow-2xs">
                        ↪ Jadikan Sub-Pekerjaan
                      </span>
                    )}
                  </div>

                  {/* Right Meta in Row */}
                  <div className="flex items-center space-x-2 shrink-0">
                    {/* Weight % */}
                    <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1 rounded">
                      {Number(node.weightPercent).toFixed(1)}%
                    </span>

                    {/* Mini Progress */}
                    <div className="w-12 bg-slate-100 rounded-xs h-2 overflow-hidden flex border border-slate-200" title={`Verif: ${rollup.verifiedProgress}%`}>
                      <div
                        className="bg-emerald-500 h-2"
                        style={{ width: `${Math.min(rollup.verifiedProgress, 100)}%` }}
                      />
                      <div
                        className="bg-amber-400 h-2"
                        style={{ width: `${Math.max(0, Math.min(rollup.claimedProgress - rollup.verifiedProgress, 100))}%` }}
                      />
                    </div>

                    {/* Hover Add Child Button */}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddNode(node.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-200 text-slate-600 transition-opacity"
                        title="Tambah Sub-Pekerjaan di bawah ini"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* =========================================================================
          RIGHT PANE: Live Node Inspector & Multi-Stage Workflow Studio (58% Width)
          ========================================================================= */}
      <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col min-h-[750px]">
        {selectedNode ? (
          <>
            {/* Inspector Header */}
            <div className="p-4 border-b border-slate-200 bg-slate-50/80">
              {/* Breadcrumb Path */}
              <div className="flex items-center space-x-1.5 text-[10px] text-slate-500 font-mono overflow-hidden truncate mb-1">
                {breadcrumbPath.map((item, idx) => (
                  <React.Fragment key={item.id}>
                    {idx > 0 && <span>/</span>}
                    <span className={idx === breadcrumbPath.length - 1 ? 'text-slate-900 font-bold' : ''}>
                      {item.wbsCode} {item.name}
                    </span>
                  </React.Fragment>
                ))}
              </div>

              {/* Title & Level */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-900 text-[#d4f038]">
                      {selectedNode.wbsCode}
                    </span>
                    <h2 className="text-sm font-bold text-slate-900 leading-tight">
                      {selectedNode.name}
                    </h2>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700">
                      {(selectedNode.wbsCode.split('.').filter(Boolean).length - 1) === 0
                        ? 'Work Package'
                        : (selectedNode.wbsCode.split('.').filter(Boolean).length - 1) === 1
                        ? 'Phase'
                        : 'Task Item'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Dokumen: <strong className="text-slate-700">{selectedNode.documentReferenceNo || 'DWG-STR-101'}</strong> ({selectedNode.activeRevision || 'Rev A'})
                    {' · '}SE: <strong className="text-slate-700">{selectedNode.assignedEngineerName || 'Dave Kowalski'}</strong>
                    {' · '}QC: <strong className="text-slate-700">{selectedNode.assignedQcName || 'Elena Rostova'}</strong>
                  </p>
                </div>

                {/* Top Action Buttons */}
                <div className="flex items-center space-x-1.5 shrink-0">
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => onAddNode(selectedNode.id)}
                        className="px-2.5 py-1 text-xs font-semibold rounded bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 flex items-center space-x-1 transition-colors"
                        title="Tambah Sub-Node di bawah item ini"
                      >
                        <Plus className="w-3.5 h-3.5 text-amber-600" />
                        <span>Sub-Node</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteNode(selectedNode)}
                        className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-transparent hover:border-rose-200 transition-colors"
                        title="Hapus node ini"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Progress Summary Strip */}
              <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-slate-200/80 text-[11px]">
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <div className="text-slate-400 text-[10px]">Bobot Sibling</div>
                  <div className="text-slate-900 font-bold font-mono text-xs">{Number(selectedNode.weightPercent).toFixed(2)}%</div>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <div className="text-slate-400 text-[10px]">Volume Rencana</div>
                  <div className="text-slate-900 font-bold font-mono text-xs">
                    {selectedNode.volume ? `${selectedNode.volume} ${selectedNode.unit || 'm3'}` : '-'}
                  </div>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <div className="text-slate-400 text-[10px]">Klaim Progres</div>
                  <div className="text-blue-600 font-bold font-mono text-xs">{selectedNode.claimedProgressPercent || 0}%</div>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <div className="text-slate-400 text-[10px]">Verifikasi Mutu</div>
                  <div className="text-emerald-600 font-bold font-mono text-xs">{selectedNode.verifiedProgressPercent || 0}%</div>
                </div>
              </div>

              {/* Tab Switcher inside Right Panel */}
              <div className="flex items-center space-x-1 mt-3 border-b border-slate-200 pt-1">
                <button
                  type="button"
                  onClick={() => setInspectorTab('workflow')}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors ${
                    inspectorTab === 'workflow'
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                  <span>Tahapan Workflow & Hold Point</span>
                  {stages.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 text-slate-700">
                      {stages.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setInspectorTab('edit')}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors ${
                    inspectorTab === 'edit'
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Edit2 className="w-3.5 h-3.5 text-amber-600" />
                  <span>Edit Cepat Data Teknis</span>
                </button>
              </div>
            </div>

            {/* Inspector Tab Content Area */}
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {/* Feedback Alerts */}
              {workflowError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{workflowError}</span>
                </div>
              )}
              {workflowSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{workflowSuccess}</span>
                </div>
              )}

              {/* -----------------------------------------------------------------
                  SUB-TAB 1: LIVE WORKFLOW STAGES & HOLD POINTS
                  ----------------------------------------------------------------- */}
              {inspectorTab === 'workflow' && (
                <div className="space-y-4">
                  {workflowLoading ? (
                    <div className="py-12 text-center text-slate-400 space-y-2">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto text-slate-400" />
                      <p className="text-xs">Memuat tahapan alur kerja...</p>
                    </div>
                  ) : stages.length === 0 ? (
                    <div className="p-8 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-3">
                      <ShieldCheck className="w-10 h-10 text-slate-300 mx-auto" />
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">
                          Belum Ada Alur Tahapan Inspeksi
                        </h4>
                        <p className="text-[11px] text-slate-500 max-w-md mx-auto mt-1">
                          Node ini belum memiliki rangkaian gerbang inspeksi (RFI, Checklist, dan Four-Eyes Hold Point).
                        </p>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={handleInitDefaultWorkflow}
                          disabled={actionLoading}
                          className="px-3.5 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs shadow-xs transition-colors inline-flex items-center space-x-2"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>Terapkan Alur Standar 3-Tahap</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {stages.map((stage, idx) => {
                        const check = canProceedToStage(stages, stage.id);
                        const stageAttempts = attempts.filter((a) => a.stageId === stage.id);
                        const isUnderSubmit = submittingStage?.id === stage.id;
                        const isUnderReview = reviewingStage?.id === stage.id;

                        return (
                          <div
                            key={stage.id}
                            className={`p-3.5 rounded-xl border transition-all ${
                              stage.status === 'approved'
                                ? 'bg-emerald-50/50 border-emerald-200'
                                : stage.status === 'rejected'
                                ? 'bg-rose-50/50 border-rose-200'
                                : stage.status === 'submitted'
                                ? 'bg-indigo-50/50 border-indigo-200'
                                : stage.status === 'requested'
                                ? 'bg-blue-50/50 border-blue-200'
                                : !check.allowed
                                ? 'bg-slate-50 border-slate-200 opacity-80'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1">
                                <div className="flex items-center space-x-2">
                                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                                    {stage.stageOrder}
                                  </span>
                                  <h4 className="text-xs font-bold text-slate-900">
                                    {stage.name}
                                  </h4>
                                  {stage.stageType === 'hold' && (
                                    <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center space-x-1">
                                      <Lock className="w-2.5 h-2.5 text-amber-700" />
                                      <span>HOLD POINT</span>
                                    </span>
                                  )}
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                                      stage.status === 'approved'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : stage.status === 'rejected'
                                        ? 'bg-rose-100 text-rose-800'
                                        : stage.status === 'submitted'
                                        ? 'bg-indigo-100 text-indigo-800'
                                        : stage.status === 'requested'
                                        ? 'bg-blue-100 text-blue-800'
                                        : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {stage.status.toUpperCase()}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 pl-7">
                                  Role Pengaju: <strong className="text-slate-700">{stage.assignedRole}</strong>
                                  {stage.approvalRole ? ` · Role Penyetuju: ${stage.approvalRole}` : ''}
                                  {stage.requiresWetSignature ? ' · (Wajib Tanda Tangan Basah/Fisik)' : ''}
                                </p>
                              </div>

                              {/* Action Buttons Per Stage */}
                              <div className="flex items-center space-x-1.5 shrink-0">
                                {stage.status === 'pending' && (
                                  <button
                                    type="button"
                                    onClick={() => handleRequestRfi(stage)}
                                    disabled={actionLoading || !check.allowed}
                                    className="px-2.5 py-1 text-xs font-bold rounded bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition-colors flex items-center space-x-1 disabled:opacity-50"
                                    title="Daftarkan RFI untuk tahap ini"
                                  >
                                    <Send className="w-3 h-3" />
                                    <span>Ajukan RFI</span>
                                  </button>
                                )}

                                {(stage.status === 'requested' || stage.status === 'rejected') && (
                                  <button
                                    type="button"
                                    onClick={() => handleStartSubmit(stage)}
                                    disabled={actionLoading || !check.allowed}
                                    className="px-2.5 py-1 text-xs font-bold rounded bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] shadow-2xs transition-colors flex items-center space-x-1 disabled:opacity-50"
                                    title="Buka form ceklis dan tanda tangan"
                                  >
                                    <CheckSquare className="w-3 h-3" />
                                    <span>Eksekusi Ceklis</span>
                                  </button>
                                )}

                                {stage.status === 'submitted' && (
                                  <button
                                    type="button"
                                    onClick={() => handleStartReview(stage)}
                                    disabled={actionLoading}
                                    className="px-2.5 py-1 text-xs font-bold rounded bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition-colors flex items-center space-x-1"
                                    title="Persetujuan independen (Four-Eyes)"
                                  >
                                    <Scale className="w-3 h-3" />
                                    <span>Review (Four-Eyes)</span>
                                  </button>
                                )}

                                {stage.status === 'approved' && (
                                  <span className="px-2 py-1 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center space-x-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                                    <span>Lulus</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Upstream Hold Point Lock Warning */}
                            {!check.allowed && (
                              <div className="mt-2 text-[10px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 flex items-center space-x-1.5 ml-7">
                                <Lock className="w-3 h-3 text-amber-600 shrink-0" />
                                <span>{check.reason}</span>
                              </div>
                            )}

                            {/* Embedded Checklist Form */}
                            {isUnderSubmit && (
                              <form onSubmit={handleSubmitAttempt} className="mt-3 p-3 bg-white rounded-lg border border-slate-300 space-y-3 ml-7">
                                <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                                  <span className="font-bold text-slate-800 text-xs">
                                    Form Pengisian Ceklis: {stage.name}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setSubmittingStage(null)}
                                    className="text-slate-400 hover:text-slate-700"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="space-y-2 text-xs">
                                  <label className="flex items-center space-x-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checkpoint1}
                                      onChange={(e) => setCheckpoint1(e.target.checked)}
                                      className="rounded text-emerald-600 focus:ring-0"
                                    />
                                    <span className="text-slate-700">1. Kepatuhan Spesifikasi Teknis & Gambar Kerja</span>
                                  </label>
                                  <label className="flex items-center space-x-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checkpoint2}
                                      onChange={(e) => setCheckpoint2(e.target.checked)}
                                      className="rounded text-emerald-600 focus:ring-0"
                                    />
                                    <span className="text-slate-700">2. Toleransi Dimensi, Elevasi & Leveling Lapangan</span>
                                  </label>
                                  <label className="flex items-center space-x-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checkpoint3}
                                      onChange={(e) => setCheckpoint3(e.target.checked)}
                                      className="rounded text-emerald-600 focus:ring-0"
                                    />
                                    <span className="text-slate-700">3. Kondisi K3, Kebersihan Area & Perlindungan Permukaan</span>
                                  </label>
                                </div>

                                {/* Dual-Track Signature Selection */}
                                <div className="p-2.5 rounded bg-slate-50 border border-slate-200 space-y-2">
                                  <div className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                                    Otorisasi Tanda Tangan:
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTargetSigStage(stage);
                                        setSigCanvasOpen(true);
                                      }}
                                      className={`px-2.5 py-1.5 rounded text-[11px] font-semibold border flex items-center space-x-1.5 transition-colors ${
                                        capturedDigitalSig
                                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                                      }`}
                                    >
                                      <PenTool className="w-3.5 h-3.5" />
                                      <span>{capturedDigitalSig ? '✓ TTD Kanvas Siap' : 'Tanda Tangan Digital'}</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTargetSigStage(stage);
                                        setPhysicalModalOpen(true);
                                      }}
                                      className={`px-2.5 py-1.5 rounded text-[11px] font-semibold border flex items-center space-x-1.5 transition-colors ${
                                        capturedWetScanUrl
                                          ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                          : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                                      }`}
                                    >
                                      <Printer className="w-3.5 h-3.5" />
                                      <span>{capturedWetScanUrl ? '✓ Scan Lembar Terunggah' : 'Lembar Fisik / Scan'}</span>
                                    </button>
                                  </div>
                                </div>

                                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-200">
                                  <button
                                    type="button"
                                    onClick={() => setSubmittingStage(null)}
                                    className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
                                  >
                                    Batal
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={actionLoading}
                                    className="px-3 py-1.5 text-xs font-bold rounded bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] shadow-xs"
                                  >
                                    {actionLoading ? 'Menyimpan...' : 'Kirim Pengajuan Inspeksi'}
                                  </button>
                                </div>
                              </form>
                            )}

                            {/* Embedded Review Form (Four-Eyes Approval) */}
                            {isUnderReview && (
                              <form onSubmit={handleReviewAttempt} className="mt-3 p-3 bg-white rounded-lg border border-indigo-200 space-y-3 ml-7">
                                <div className="flex items-center justify-between pb-1.5 border-b border-indigo-100">
                                  <span className="font-bold text-indigo-950 text-xs flex items-center space-x-1.5">
                                    <Scale className="w-3.5 h-3.5 text-indigo-600" />
                                    <span>Persetujuan Mutu Four-Eyes: {stage.name}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setReviewingStage(null)}
                                    className="text-slate-400 hover:text-slate-700"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>

                                <div className="space-y-2 text-xs">
                                  <div className="flex items-center space-x-4">
                                    <label className="flex items-center space-x-1.5 cursor-pointer">
                                      <input
                                        type="radio"
                                        name="reviewDecision"
                                        value="approved"
                                        checked={reviewDecision === 'approved'}
                                        onChange={() => setReviewDecision('approved')}
                                        className="text-emerald-600"
                                      />
                                      <span className="font-bold text-emerald-700">Setujui (Approved / Pass)</span>
                                    </label>
                                    <label className="flex items-center space-x-1.5 cursor-pointer">
                                      <input
                                        type="radio"
                                        name="reviewDecision"
                                        value="rejected"
                                        checked={reviewDecision === 'rejected'}
                                        onChange={() => setReviewDecision('rejected')}
                                        className="text-rose-600"
                                      />
                                      <span className="font-bold text-rose-700">Tolak (Rejected / CAPA)</span>
                                    </label>
                                  </div>

                                  <div>
                                    <textarea
                                      rows={2}
                                      value={reviewNotes}
                                      onChange={(e) => setReviewNotes(e.target.value)}
                                      placeholder="Catatan persetujuan verifikator independen..."
                                      className="w-full p-2 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-indigo-500"
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center justify-end space-x-2 pt-2 border-t border-indigo-100">
                                  <button
                                    type="button"
                                    onClick={() => setReviewingStage(null)}
                                    className="px-3 py-1.5 text-xs text-slate-600"
                                  >
                                    Batal
                                  </button>
                                  <button
                                    type="submit"
                                    disabled={actionLoading}
                                    className="px-3 py-1.5 text-xs font-bold rounded bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
                                  >
                                    {actionLoading ? 'Menyimpan...' : 'Sahkan Keputusan Review'}
                                  </button>
                                </div>
                              </form>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* -----------------------------------------------------------------
                  SUB-TAB 2: INLINE QUICK EDIT FORM (DATA TEKNIS)
                  ----------------------------------------------------------------- */}
              {inspectorTab === 'edit' && (
                <form onSubmit={handleSaveInlineEdit} className="p-4 bg-slate-50/70 rounded-xl border border-slate-200 space-y-4 text-xs">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="font-bold text-slate-900 text-xs">
                      Perbarui Informasi Teknis Node {selectedNode.wbsCode}
                    </span>
                    {inlineSaveSuccess && (
                      <span className="text-emerald-700 font-bold text-xs flex items-center space-x-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Tersimpan!</span>
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        WBS Code *
                      </label>
                      <input
                        type="text"
                        value={inlineWbsCode}
                        onChange={(e) => setInlineWbsCode(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Bobot Relatif Sibling (%) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={inlineWeight}
                        onChange={(e) => setInlineWeight(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 font-mono"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Nama Pekerjaan *
                    </label>
                    <input
                      type="text"
                      value={inlineName}
                      onChange={(e) => setInlineName(e.target.value)}
                      className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 font-semibold"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Volume Rencana
                      </label>
                      <input
                        type="text"
                        value={inlineVolume}
                        onChange={(e) => setInlineVolume(e.target.value)}
                        placeholder="Contoh: 450"
                        className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Satuan Unit
                      </label>
                      <input
                        type="text"
                        value={inlineUnit}
                        onChange={(e) => setInlineUnit(e.target.value)}
                        placeholder="Contoh: m3, ton, titik"
                        className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        No. Dokumen Acuan (Drawing)
                      </label>
                      <input
                        type="text"
                        value={inlineDocRef}
                        onChange={(e) => setInlineDocRef(e.target.value)}
                        placeholder="Contoh: DWG-FDN-001"
                        className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Revisi Aktif
                      </label>
                      <input
                        type="text"
                        value={inlineRevision}
                        onChange={(e) => setInlineRevision(e.target.value)}
                        placeholder="Contoh: Rev C"
                        className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Tanggal Rencana Mulai
                      </label>
                      <input
                        type="date"
                        value={inlineStartDate}
                        onChange={(e) => setInlineStartDate(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Tanggal Rencana Selesai
                      </label>
                      <input
                        type="date"
                        value={inlineEndDate}
                        onChange={(e) => setInlineEndDate(e.target.value)}
                        className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={inlineSaving || !canEdit}
                      className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs shadow-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{inlineSaving ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-400 space-y-3">
            <FolderTree className="w-12 h-12 text-slate-300 stroke-1" />
            <h3 className="text-sm font-bold text-slate-700">Pilih Pekerjaan di Sebelah Kiri</h3>
            <p className="text-xs text-slate-500 max-w-sm">
              Klik salah satu item pada pohon WBS untuk melihat informasi teknis, bobot sibling, dan eksekusi tahapan alur kerja langsung tanpa jendela pop-up.
            </p>
          </div>
        )}
      </div>

      {/* Signature & Physical Scanned Modals */}
      {targetSigStage && (
        <>
          <SignatureCanvasModal
            isOpen={sigCanvasOpen}
            currentUser={currentUser}
            onClose={() => setSigCanvasOpen(false)}
            onSaveSignature={(dataUrl: string) => {
              setCapturedDigitalSig(dataUrl);
              setSigCanvasOpen(false);
            }}
          />

          <PhysicalSheetModal
            isOpen={physicalModalOpen}
            currentUser={currentUser}
            onClose={() => setPhysicalModalOpen(false)}
            onScanUploaded={(fileUrl: string) => {
              setCapturedWetScanUrl(fileUrl);
              setPhysicalModalOpen(false);
            }}
            project={project}
            node={selectedNode || flatNodes[0]}
            stage={targetSigStage}
          />
        </>
      )}
    </div>
  );
};
