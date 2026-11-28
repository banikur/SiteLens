import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderTree,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
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
  CornerUpLeft,
  CornerDownRight,
} from 'lucide-react';
import type { WorkNode, WorkWorkflow, WorkStage, InspectionAttempt, Project, User } from '../types';
import {
  apiGetNodeWorkflow,
  apiInitDefaultWorkflow,
  apiRequestStageRfi,
  apiSubmitStageAttempt,
  apiReviewStageAttempt,
  apiUpdateWbsNode,
  apiApproveWbsDetails,
  apiAddWbsStage,
  apiUpdateWbsStage,
  apiDeleteWbsStage,
  apiGetNodeProgressLogs,
  apiDeleteNodeProgressLog,
  type WbsProgressLog,
} from '../services/api';
import {
  buildWbsTree,
  flattenWbsTree,
  validateWbsWeights,
  calculateRollupProgress,
  computeWbsCriticalPath,
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

const SixDotsGripHandle: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
  >
    <circle cx="7.5" cy="5" r="2.2" />
    <circle cx="16.5" cy="5" r="2.2" />
    <circle cx="7.5" cy="12" r="2.2" />
    <circle cx="16.5" cy="12" r="2.2" />
    <circle cx="7.5" cy="19" r="2.2" />
    <circle cx="16.5" cy="19" r="2.2" />
  </svg>
);

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
  // Granular Permissions with reliable fallback for staff/demo
  const { can, isLoading: isLoadingPerms, setActiveProjectId } = usePermission();

  useEffect(() => {
    if (project?.id) {
      setActiveProjectId(project.id);
    }
  }, [project?.id, setActiveProjectId]);

  const isStaffRole = Boolean(currentUser && currentUser.role !== 'Client / Vendor Viewer');
  const isEditor = canEdit || isStaffRole || Boolean(currentUser?.role === 'Project Director & Tenant Admin' || currentUser?.role === ('Head Office PMO / Quality Director' as any));
  const canEditStructure =
    (!isLoadingPerms && can(PERMISSIONS.WBS_EDIT_STRUCTURE, project.id)) ||
    Boolean(
      currentUser &&
        (currentUser.role === 'Project Director & Tenant Admin' ||
          currentUser.role === ('Head Office PMO / Quality Director' as any))
    );
  const canEditDetail = (!isLoadingPerms && can(PERMISSIONS.WBS_EDIT_DETAIL, project.id)) || isEditor;

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
  const [inlineAllowDetailing, setInlineAllowDetailing] = useState(false);
  const [inlineIsMilestone, setInlineIsMilestone] = useState(false);
  const [inlineIsUnplanned, setInlineIsUnplanned] = useState(false);
  const [inlinePredecessorId, setInlinePredecessorId] = useState('');
  const [inlineLagDays, setInlineLagDays] = useState('0');
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineSaveSuccess, setInlineSaveSuccess] = useState(false);
  const [approvingDetailsLoading, setApprovingDetailsLoading] = useState(false);
  const [claimProgressDraft, setClaimProgressDraft] = useState<number>(0);
  const [savingProgressClaim, setSavingProgressClaim] = useState(false);
  const [progressLogs, setProgressLogs] = useState<WbsProgressLog[]>([]);
  const [loadingProgressLogs, setLoadingProgressLogs] = useState(false);
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimModalDate, setClaimModalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [claimModalNotes, setClaimModalNotes] = useState('');
  const [togglingStrict, setTogglingStrict] = useState(false);
  const [newStageName, setNewStageName] = useState('');
  const [newStageType, setNewStageType] = useState<'work' | 'hold' | 'review'>('work');
  const [addingStage, setAddingStage] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState('');
  const [editingStageType, setEditingStageType] = useState<'work' | 'hold' | 'review'>('work');

  // Drag and drop reparenting & reordering states
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'inside' | 'after' | null>(null);
  const [activeDragHandleId, setActiveDragHandleId] = useState<string | null>(null);
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
      setDropPosition(null);
      setActiveDragHandleId(null);
      return;
    }

    const dragged = nodes.find((n) => n.id === draggedNodeId);
    const targetParent = nodes.find((n) => n.id === targetParentId);
    if (!dragged || !targetParent) return;

    if (dragged.parentId === targetParentId) {
      // Already child of target
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setDropPosition(null);
      setActiveDragHandleId(null);
      return;
    }

    if (checkIsDescendant(draggedNodeId, targetParentId)) {
      alert(`Tidak dapat memindahkan '${dragged.name}' ke dalam anaknya sendiri ('${targetParent.name}'). Siklus hierarki dilarang.`);
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setDropPosition(null);
      setActiveDragHandleId(null);
      return;
    }

    try {
      setReparentingLoading(true);
      await apiUpdateWbsNode(project.id, draggedNodeId, { parentId: targetParentId });
      setWorkflowSuccess(`Hierarki berhasil diubah: '${dragged.name}' kini menjadi sub-item di bawah '${targetParent.name}'.`);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal memindahkan posisi node.');
    } finally {
      setReparentingLoading(false);
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setDropPosition(null);
      setActiveDragHandleId(null);
    }
  };

  const handleDropReorder = async (targetNodeId: string, position: 'before' | 'after') => {
    if (!draggedNodeId || draggedNodeId === targetNodeId) {
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setDropPosition(null);
      setActiveDragHandleId(null);
      return;
    }

    const dragged = nodes.find((n) => n.id === draggedNodeId);
    const target = nodes.find((n) => n.id === targetNodeId);
    if (!dragged || !target) return;

    if (checkIsDescendant(draggedNodeId, target.id)) {
      alert(`Tidak dapat memindahkan '${dragged.name}' karena target adalah anak/keturunannya.`);
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setDropPosition(null);
      setActiveDragHandleId(null);
      return;
    }

    try {
      setReparentingLoading(true);
      const targetParentId = target.parentId ?? null;
      const targetOrder = Number(target.sortOrder) || 0;
      const newOrder = position === 'before' ? targetOrder - 1 : targetOrder + 1;

      await apiUpdateWbsNode(project.id, draggedNodeId, {
        parentId: targetParentId,
        sortOrder: newOrder,
      });

      setWorkflowSuccess(`Urutan diperbarui: '${dragged.name}' dipindahkan ke ${position === 'before' ? 'sebelum' : 'setelah'} '${target.name}'.`);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal mengubah urutan node.');
    } finally {
      setReparentingLoading(false);
      setDraggedNodeId(null);
      setDragOverNodeId(null);
      setDropPosition(null);
      setIsDragOverRoot(false);
      setActiveDragHandleId(null);
    }
  };

  const handleMoveNodeOrder = async (node: WorkNode, direction: 'up' | 'down') => {
    const siblings = nodes
      .filter((n) => (n.parentId || null) === (node.parentId || null))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));

    const idx = siblings.findIndex((s) => s.id === node.id);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === siblings.length - 1) return;

    const swapTarget = direction === 'up' ? siblings[idx - 1] : siblings[idx + 1];
    const currentOrder = Number(node.sortOrder) || idx;
    const targetOrder = Number(swapTarget.sortOrder) || (direction === 'up' ? idx - 1 : idx + 1);

    try {
      setReparentingLoading(true);
      await apiUpdateWbsNode(project.id, node.id, { sortOrder: targetOrder });
      await apiUpdateWbsNode(project.id, swapTarget.id, { sortOrder: currentOrder });
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal memindahkan urutan.');
    } finally {
      setReparentingLoading(false);
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
      setDropPosition(null);
      setIsDragOverRoot(false);
      setActiveDragHandleId(null);
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
      setDropPosition(null);
      setIsDragOverRoot(false);
      setActiveDragHandleId(null);
    }
  };

  const handleOutdentNode = async (node: WbsTreeNode) => {
    if (!node.parentId) return;
    const parent = nodes.find((n) => n.id === node.parentId);
    const nextParentId = parent?.parentId ?? null;
    try {
      setReparentingLoading(true);
      await apiUpdateWbsNode(project.id, node.id, { parentId: nextParentId });
      setWorkflowSuccess(
        nextParentId
          ? `'${node.name}' dipindahkan keluar satu tingkat.`
          : `'${node.name}' dijadikan Item Tingkat Induk (Root).`
      );
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal mengeluarkan item dari induknya.');
    } finally {
      setReparentingLoading(false);
    }
  };

  const getPrevSibling = (node: WbsTreeNode): WorkNode | null => {
    const siblings = nodes
      .filter((n) => (n.parentId || null) === (node.parentId || null))
      .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
    const idx = siblings.findIndex((s) => s.id === node.id);
    return idx > 0 ? siblings[idx - 1] : null;
  };

  const handleIndentNode = async (node: WbsTreeNode) => {
    const prevSibling = getPrevSibling(node);
    if (!prevSibling) return;
    if (checkIsDescendant(node.id, prevSibling.id)) return;
    try {
      setReparentingLoading(true);
      await apiUpdateWbsNode(project.id, node.id, { parentId: prevSibling.id });
      setWorkflowSuccess(`'${node.name}' dimasukkan ke bawah induk '${prevSibling.name}'.`);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal memasukkan item ke induk di atasnya.');
    } finally {
      setReparentingLoading(false);
    }
  };

  const handleToggleStrictChecklist = async () => {
    if (!selectedNode) return;
    const nextVal = !Boolean(selectedNode.requiresChecklist);
    try {
      setTogglingStrict(true);
      await apiUpdateWbsNode(project.id, selectedNode.id, {
        requiresChecklist: nextVal,
      });
      setWorkflowSuccess(
        nextVal
          ? `Node '${selectedNode.name}' diset ke Mode Strict (Wajib Ceklis Inspeksi).`
          : `Node '${selectedNode.name}' diset ke Mode Klaim Langsung.`
      );
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal mengubah mode strict node.');
    } finally {
      setTogglingStrict(false);
    }
  };

  const loadProgressLogs = async (nodeId: string) => {
    try {
      setLoadingProgressLogs(true);
      const res = await apiGetNodeProgressLogs(project.id, nodeId);
      setProgressLogs(res.logs || []);
    } catch {
      setProgressLogs([]);
    } finally {
      setLoadingProgressLogs(false);
    }
  };

  const handleSaveClaimProgress = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedNode) return;
    try {
      setSavingProgressClaim(true);
      await apiUpdateWbsNode(project.id, selectedNode.id, {
        claimedProgressPercent: claimProgressDraft,
        progressDate: claimModalDate || new Date().toISOString().slice(0, 10),
        progressNotes: claimModalNotes.trim() || null,
      });
      setClaimModalOpen(false);
      setClaimModalNotes('');
      setWorkflowSuccess(
        `Log progres '${selectedNode.name}' (${claimProgressDraft}% pada ${claimModalDate}) berhasil dicatat.`
      );
      await Promise.all([loadProgressLogs(selectedNode.id), onRefreshWbs()]);
    } catch (err: any) {
      alert(err?.message || 'Gagal menyimpan log klaim progres.');
    } finally {
      setSavingProgressClaim(false);
    }
  };

  const handleDeleteProgressLog = async (logId: string) => {
    if (!selectedNode) return;
    if (!confirm('Hapus catatan log progres ini?')) return;
    try {
      await apiDeleteNodeProgressLog(project.id, selectedNode.id, logId);
      await Promise.all([loadProgressLogs(selectedNode.id), onRefreshWbs()]);
    } catch (err: any) {
      alert(err?.message || 'Gagal menghapus log progres.');
    }
  };

  const handleAddCustomStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNode || !newStageName.trim()) return;
    try {
      setAddingStage(true);
      await apiAddWbsStage(project.id, selectedNode.id, {
        name: newStageName.trim(),
        stageType: newStageType,
      });
      setNewStageName('');
      setNewStageType('work');
      const res = await apiGetNodeWorkflow(project.id, selectedNode.id);
      setWorkflow(res.workflow);
      setStages(res.stages || []);
      setAttempts(res.attempts || []);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal menambah tahapan.');
    } finally {
      setAddingStage(false);
    }
  };

  const handleUpdateStage = async (stageId: string) => {
    if (!selectedNode || !editingStageName.trim()) return;
    try {
      setActionLoading(true);
      await apiUpdateWbsStage(project.id, stageId, {
        name: editingStageName.trim(),
        stageType: editingStageType,
      });
      setEditingStageId(null);
      const res = await apiGetNodeWorkflow(project.id, selectedNode.id);
      setWorkflow(res.workflow);
      setStages(res.stages || []);
      setAttempts(res.attempts || []);
    } catch (err: any) {
      alert(err?.message || 'Gagal mengubah tahapan.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteStage = async (stageId: string, stageName: string) => {
    if (!selectedNode) return;
    if (!confirm(`Hapus tahapan "${stageName}"?`)) return;
    try {
      setActionLoading(true);
      await apiDeleteWbsStage(project.id, stageId);
      const res = await apiGetNodeWorkflow(project.id, selectedNode.id);
      setWorkflow(res.workflow);
      setStages(res.stages || []);
      setAttempts(res.attempts || []);
      await onRefreshWbs();
    } catch (err: any) {
      alert(err?.message || 'Gagal menghapus tahapan.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCollapseAll = () => {
    const parentIds = new Set<string>();
    for (const n of nodes) {
      if (nodes.some((child) => child.parentId === n.id)) {
        parentIds.add(n.id);
      }
    }
    setCollapsedNodes(parentIds);
  };

  const handleExpandAll = () => {
    setCollapsedNodes(new Set());
  };

  const canExecute = !isLoadingPerms && can(PERMISSIONS.STAGE_EXECUTE, project.id);
  const canApprove = !isLoadingPerms && can(PERMISSIONS.STAGE_APPROVE, project.id);
  const canRequest = !isLoadingPerms && can(PERMISSIONS.STAGE_REQUEST, project.id);

  // Build tree & flat list
  const treeNodes = useMemo(() => buildWbsTree(nodes), [nodes]);
  const flatNodes = useMemo(() => flattenWbsTree(treeNodes), [nodes]);
  const weightValidation = useMemo(() => validateWbsWeights(nodes), [nodes]);
  const cpmResult = useMemo(() => computeWbsCriticalPath(nodes), [nodes]);

  // Keep selection valid when nodes are added, edited, or deleted
  useEffect(() => {
    if (nodes.length > 0) {
      if (!selectedNodeId || !nodes.some((n) => n.id === selectedNodeId)) {
        const first = flatNodes[0]?.id || nodes[0]?.id;
        setSelectedNodeId(first);
      }
    } else {
      setSelectedNodeId(null);
    }
  }, [nodes, flatNodes, selectedNodeId]);

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
      setInlineUnit(selectedNode.unit || 'Paket');
      setInlineDocRef(selectedNode.documentReferenceNo || '');
      setInlineRevision(selectedNode.activeRevision || 'Rev A');
      setInlineStartDate(selectedNode.plannedStartDate ? String(selectedNode.plannedStartDate).slice(0, 10) : '');
      setInlineEndDate(selectedNode.plannedEndDate ? String(selectedNode.plannedEndDate).slice(0, 10) : '');
      setInlineEngineerName(selectedNode.assignedEngineerName || 'Dave Kowalski (Site Engineer)');
      setInlineQcName(selectedNode.assignedQcName || 'Elena Rostova (QA/QC Lead)');
      setInlineAllowDetailing(Boolean(selectedNode.allowDetailing));
      setInlineIsMilestone(Boolean(selectedNode.isMilestone));
      setInlineIsUnplanned(Boolean(selectedNode.isUnplanned));
      const firstPred = selectedNode.predecessorIds?.[0];
      setInlinePredecessorId(firstPred?.nodeId || '');
      setInlineLagDays(String(firstPred?.lagDays ?? 0));
      setClaimProgressDraft(Number(selectedNode.claimedProgressPercent) || 0);
      setInlineSaveSuccess(false);

      // Reset action states
      setSubmittingStage(null);
      setReviewingStage(null);
      setWorkflowSuccess(null);
      setWorkflowError(null);

      // Load workflow & direct progress logs for selected node
      loadWorkflow(selectedNode.id);
      loadProgressLogs(selectedNode.id);
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
        plannedEndDate: inlineIsMilestone ? (inlineStartDate || null) : (inlineEndDate || null),
        assignedEngineerName: inlineEngineerName || null,
        assignedQcName: inlineQcName || null,
        isMilestone: inlineIsMilestone,
        isUnplanned: inlineIsUnplanned,
        predecessorIds: inlinePredecessorId
          ? [{ nodeId: inlinePredecessorId, lagDays: Number(inlineLagDays) || 0 }]
          : [],
      };

      const simulated = nodes.map((n) => (n.id === selectedNode.id ? { ...n, predecessorIds: payload.predecessorIds } : n));
      if (computeWbsCriticalPath(simulated).hasCycle) {
        alert('Dependensi membentuk siklus (A → B → A). Pilih predecessor lain.');
        return;
      }

      if (canEditStructure) {
        payload.allowDetailing = inlineAllowDetailing;
      }

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

  const handleApprovePendingDetails = async () => {
    if (!selectedNode) return;
    try {
      setApprovingDetailsLoading(true);
      await apiApproveWbsDetails(project.id, selectedNode.parentId || selectedNode.id);
      await onRefreshWbs();
      alert('Rincian detail berhasil disetujui PM dan kini aktif di Kurva-S!');
    } catch (err: any) {
      alert(err?.message || 'Gagal menyetujui rincian detail.');
    } finally {
      setApprovingDetailsLoading(false);
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

  // Filter out nodes whose ancestor is collapsed (unless searching)
  const visibleFlatNodes = useMemo(() => {
    if (searchQuery.trim()) return filteredFlatNodes;
    if (collapsedNodes.size === 0) return filteredFlatNodes;

    const hiddenParentIds = new Set<string>();
    const visible: WbsTreeNode[] = [];

    for (const node of filteredFlatNodes) {
      if (node.parentId && hiddenParentIds.has(node.parentId)) {
        hiddenParentIds.add(node.id);
        continue;
      }
      if (collapsedNodes.has(node.id)) {
        hiddenParentIds.add(node.id);
      }
      visible.push(node);
    }
    return visible;
  }, [filteredFlatNodes, collapsedNodes, searchQuery]);

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
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {/* =========================================================================
          LEFT PANE: Master WBS Tree & Quick Hierarchy Navigator (38% Width)
          ========================================================================= */}
      <div className="w-full lg:w-[40%] xl:w-[38%] border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col min-h-0 h-full bg-white">
        {/* Left Header & Actions */}
        <div className="p-3 border-b border-slate-200 bg-slate-50/70 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FolderTree className="w-4 h-4 text-slate-700" />
              <h3 className="text-xs font-bold text-slate-900 tracking-wide">
                Rincian Pekerjaan ({nodes.length})
              </h3>
              <div className="flex items-center space-x-0.5 pl-1">
                <button
                  type="button"
                  onClick={handleExpandAll}
                  className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-800 transition-colors"
                  title="Buka Semua Rincian (Expand All)"
                >
                  <ChevronsDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCollapseAll}
                  className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-800 transition-colors"
                  title="Tutup Semua Rincian (Collapse All)"
                >
                  <ChevronsUp className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center space-x-1">
              {isEditor && (
                <>
                  <button
                    type="button"
                    onClick={onOpenPresetModal}
                    className="px-2 py-0.5 text-[10px] font-semibold rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 shadow-2xs transition-colors flex items-center space-x-1"
                    title="Gunakan Starter Pack Preset"
                  >
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>Preset</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddNode('')}
                    className="px-2 py-0.5 text-[10px] font-bold rounded bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] shadow-2xs transition-colors flex items-center space-x-1"
                    title="Tambah Item Tingkat Induk (Root)"
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
              className="w-full pl-8 pr-3 py-1 text-xs border border-slate-200 rounded-md bg-white focus:outline-hidden focus:ring-1 focus:ring-amber-500 text-slate-800 placeholder-slate-400"
            />
          </div>
        </div>

        {/* Tree List (Scrollable) */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-1.5 font-sans">
          {/* Sticky Drop Target for Root Level at Top */}
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
              className={`sticky top-0 z-20 p-3 mb-2 rounded-lg border-2 border-dashed text-center text-xs font-bold transition-all cursor-pointer ${
                isDragOverRoot
                  ? 'border-blue-600 bg-blue-100 text-blue-950 scale-[1.01] shadow-md'
                  : 'border-blue-300 bg-blue-50/95 text-blue-800 hover:border-blue-500 shadow-xs'
              }`}
            >
              <span>📦 Jatuhkan di sini untuk Keluar dari Induk (Jadikan Tingkat Induk / Root)</span>
            </div>
          )}

          {visibleFlatNodes.length === 0 ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <FolderTree className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-xs font-semibold text-slate-600">
                {searchQuery ? 'Tidak ada rincian pekerjaan cocok.' : 'Belum ada rincian pekerjaan.'}
              </p>
              {isEditor && (
                <button
                  onClick={() => onAddNode('')}
                  className="px-3 py-1.5 rounded-lg bg-[#d4f038] text-[#0b0e14] font-bold text-xs"
                >
                  + Buat Item Baru
                </button>
              )}
            </div>
          ) : (
            visibleFlatNodes.map((node) => {
              const hasChildren = node.children && node.children.length > 0;
              const isCollapsed = collapsedNodes.has(node.id);
              const isSelected = selectedNode?.id === node.id;
              const isCurrentlyDragged = draggedNodeId === node.id;
              const isDragOver = dragOverNodeId === node.id;
              const rollup = calculateRollupProgress(node);

              return (
                <div
                  key={node.id}
                  onDragOver={(e) => {
                    if (draggedNodeId && draggedNodeId !== node.id) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';

                      const rect = e.currentTarget.getBoundingClientRect();
                      const offsetY = e.clientY - rect.top;
                      const height = rect.height;

                      let pos: 'before' | 'inside' | 'after' = 'inside';
                      if (offsetY < height * 0.28) {
                        pos = 'before';
                      } else if (offsetY > height * 0.72) {
                        pos = 'after';
                      } else {
                        pos = 'inside';
                      }

                      setDragOverNodeId(node.id);
                      setDropPosition(pos);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      if (dragOverNodeId === node.id) {
                        setDragOverNodeId(null);
                        setDropPosition(null);
                      }
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dropPosition === 'inside') {
                      handleDropOnNode(node.id);
                    } else if (dropPosition === 'before' || dropPosition === 'after') {
                      handleDropReorder(node.id, dropPosition);
                    }
                  }}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`group px-2 py-1.5 rounded-lg cursor-pointer transition-all flex items-center justify-between gap-2 relative ${
                    isDragOver && dropPosition === 'inside'
                      ? 'border-2 border-amber-500 bg-amber-100/90 shadow-md ring-2 ring-amber-300 scale-[1.01]'
                      : isDragOver && dropPosition === 'before'
                      ? 'border-t-2 border-t-blue-600 bg-blue-50/80 border-x border-b border-transparent'
                      : isDragOver && dropPosition === 'after'
                      ? 'border-b-2 border-b-blue-600 bg-blue-50/80 border-x border-t border-transparent'
                      : isCurrentlyDragged
                      ? 'opacity-35 border-dashed border-slate-400 bg-slate-100'
                      : isSelected
                      ? 'bg-amber-50/80 border border-amber-300 shadow-2xs text-slate-900'
                      : 'hover:bg-slate-50 border border-transparent text-slate-700'
                  }`}
                  style={{ marginLeft: `${node.level * 14}px` }}
                >
                  <div className="flex items-center space-x-1.5 overflow-hidden min-w-0">
                    {/* 6-Dot Drag Handle Icon - Grabbing directly activates drag-and-drop */}
                    {isEditor && (
                      <div
                        draggable={true}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData('text/plain', node.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggedNodeId(node.id);
                        }}
                        onDragEnd={() => {
                          setDraggedNodeId(null);
                          setDragOverNodeId(null);
                          setDropPosition(null);
                          setIsDragOverRoot(false);
                          setActiveDragHandleId(null);
                        }}
                        className="cursor-grab active:cursor-grabbing bg-slate-100 hover:bg-amber-100 border border-slate-300 hover:border-amber-400 text-slate-600 hover:text-slate-900 p-0.5 rounded shrink-0 transition-colors pointer-events-auto shadow-2xs"
                        title="Tarik icon 6-titik ini untuk memindahkan hierarki atau urutan pekerjaan (Drag & Drop)"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </div>
                    )}

                    {/* Expand/Collapse Chevron */}
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCollapse(node.id);
                        }}
                        className="p-0.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200 shrink-0 pointer-events-auto"
                        title={isCollapsed ? 'Buka sub-pekerjaan' : 'Tutup sub-pekerjaan'}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="w-3.5 h-3.5 text-amber-600 font-bold" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-700 font-bold" />
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

                    {/* Detailing Status & Allow Detailing Badges */}
                    {node.allowDetailing && (
                      <span
                        className="px-1 py-0.2 rounded text-[9px] font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0"
                        title="Simpul ini mengizinkan penambahan rincian detail oleh Site Officer (allow_detailing = true)"
                      >
                        Detailing OK
                      </span>
                    )}
                    {node.detailingStatus === 'pending_pm_approval' && (
                      <span
                        className="px-1 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-50 text-amber-800 border border-amber-300 shrink-0"
                        title="Menunggu persetujuan PM sebelum aktif di Kurva-S"
                      >
                        Pending PM
                      </span>
                    )}
                    {node.isMilestone && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
                        Milestone
                      </span>
                    )}
                    {node.isUnplanned && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-sky-100 text-sky-900 border border-sky-300 shrink-0">
                        {node.provisionalStatus === 'pending_vo' ? 'Provisional' : 'Unplanned'}
                      </span>
                    )}
                    {cpmResult.criticalNodeIds.has(node.id) && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-purple-100 text-purple-900 border border-purple-300 shrink-0">
                        Critical
                      </span>
                    )}

                    {/* Drop indication badge */}
                    {isDragOver && dropPosition === 'inside' && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[9px] font-mono font-bold shrink-0 shadow-2xs">
                        ↪ Jadikan Sub-Pekerjaan
                      </span>
                    )}
                    {isDragOver && dropPosition === 'before' && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] font-mono font-bold shrink-0 shadow-2xs">
                        ↑ Sisipkan di Atas
                      </span>
                    )}
                    {isDragOver && dropPosition === 'after' && (
                      <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] font-mono font-bold shrink-0 shadow-2xs">
                        ↓ Sisipkan di Bawah
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

                    {/* Action Buttons */}
                    {isEditor && (
                      <div className="flex items-center space-x-0.5 opacity-60 group-hover:opacity-100 hover:opacity-100 transition-opacity pointer-events-auto">
                        {node.parentId && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleOutdentNode(node);
                            }}
                            className="p-1 rounded hover:bg-blue-100 text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                            title="Keluarkan dari induk (Outdent / naik 1 tingkat)"
                          >
                            <CornerUpLeft className="w-3 h-3" />
                          </button>
                        )}
                        {getPrevSibling(node) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleIndentNode(node);
                            }}
                            className="p-1 rounded hover:bg-emerald-100 text-emerald-600 hover:text-emerald-800 transition-colors cursor-pointer"
                            title={`Jadikan sub-item di bawah '${getPrevSibling(node)?.name}' (Indent)`}
                          >
                            <CornerDownRight className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveNodeOrder(node, 'up');
                          }}
                          className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-800 transition-colors"
                          title="Geser posisi ke atas"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveNodeOrder(node, 'down');
                          }}
                          className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-800 transition-colors"
                          title="Geser posisi ke bawah"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddNode(node.id);
                          }}
                          className="p-1 rounded hover:bg-slate-200 text-slate-600 transition-colors"
                          title="Tambah Sub-Pekerjaan di bawah ini"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteNode(node);
                          }}
                          className="p-1 rounded hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition-colors"
                          title="Hapus pekerjaan ini"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Spacious Bottom Drop Target for Root Level (always easy to reach when dragging down) */}
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
              className={`mt-2 min-h-[72px] p-4 rounded-xl border-2 border-dashed flex items-center justify-center text-center text-xs font-bold transition-all cursor-pointer ${
                isDragOverRoot
                  ? 'border-blue-600 bg-blue-100 text-blue-950 scale-[1.01] shadow-md'
                  : 'border-blue-300 bg-blue-50/70 text-blue-700 hover:border-blue-500'
              }`}
            >
              <span>📦 Jatuhkan di area kosong ini untuk Keluar dari Induk (Jadikan Tingkat Induk / Root)</span>
            </div>
          )}
        </div>
      </div>

      {/* =========================================================================
          RIGHT PANE: Live Node Inspector & Multi-Stage Workflow Studio (62% Width)
          ========================================================================= */}
      <div className="flex-1 min-h-0 flex flex-col h-full overflow-hidden bg-white">
        {selectedNode ? (
          <>
            {/* Inspector Header */}
            <div className="p-3 border-b border-slate-200 bg-slate-50/80 shrink-0">
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

              {/* Title & Level & Actions */}
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span className="px-1.5 py-0.5 rounded font-mono font-bold text-xs bg-slate-900 text-[#d4f038]">
                      {selectedNode.wbsCode}
                    </span>
                    <h2 className="text-sm font-bold text-slate-900 truncate">
                      {selectedNode.name}
                    </h2>
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-slate-200 text-slate-700">
                      {(selectedNode.wbsCode.split('.').filter(Boolean).length - 1) === 0
                        ? 'Work Package'
                        : (selectedNode.wbsCode.split('.').filter(Boolean).length - 1) === 1
                        ? 'Phase'
                        : 'Task Item'}
                    </span>
                    {selectedNode.allowDetailing ? (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        Detailing Diizinkan
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                        Struktur Baku
                      </span>
                    )}
                    {selectedNode.detailingStatus === 'pending_pm_approval' && (
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                        Menunggu Persetujuan PM
                      </span>
                    )}
                  </div>
                </div>

                {/* Top Action Buttons */}
                <div className="flex items-center space-x-1.5 shrink-0">
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => onAddNode(selectedNode.id)}
                        className="px-2 py-0.5 text-xs font-semibold rounded bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 flex items-center space-x-1 transition-colors"
                        title="Tambah Sub-Node di bawah item ini"
                      >
                        <Plus className="w-3.5 h-3.5 text-amber-600" />
                        <span>Sub-Node</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteNode(selectedNode)}
                        className="px-2 py-0.5 text-xs font-semibold rounded bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 flex items-center space-x-1 transition-colors shadow-2xs"
                        title="Hapus node pekerjaan ini"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                        <span>Hapus</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Compact Inline Metadata & Stats Strip */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600">
                <div className="flex items-center space-x-1">
                  <span className="text-slate-400">Bobot:</span>
                  <span className="font-mono font-bold text-slate-900">{Number(selectedNode.weightPercent).toFixed(2)}%</span>
                </div>
                <span className="text-slate-300">•</span>
                <div className="flex items-center space-x-1">
                  <span className="text-slate-400">Vol:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    {selectedNode.volume ? `${selectedNode.volume} ${selectedNode.unit || 'm3'}` : '-'}
                  </span>
                </div>
                <span className="text-slate-300">•</span>
                <div className="flex items-center space-x-1">
                  <span className="text-slate-400">Progres:</span>
                  <span className="font-mono font-semibold text-blue-600">{selectedNode.claimedProgressPercent || 0}% klaim</span>
                  <span className="text-slate-400">/</span>
                  <span className="font-mono font-semibold text-emerald-600">{selectedNode.verifiedProgressPercent || 0}% verif</span>
                </div>
                <span className="text-slate-300">•</span>
                <div className="flex items-center space-x-1">
                  <span className="text-slate-400">Dok:</span>
                  <span className="font-medium text-slate-700">{selectedNode.documentReferenceNo || 'DWG-STR-101'}</span>
                  <span className="text-[10px] text-slate-400">({selectedNode.activeRevision || 'Rev A'})</span>
                </div>
                <span className="text-slate-300">•</span>
                <div className="flex items-center space-x-1">
                  <span className="text-slate-400">SE/QC:</span>
                  <span className="text-slate-700">
                    {selectedNode.assignedEngineerName?.split(' ')[0] || 'Dave'} / {selectedNode.assignedQcName?.split(' ')[0] || 'Elena'}
                  </span>
                </div>
              </div>

              {/* Hybrid Progress Control: Strict (Flow Required) vs Direct Claim */}
              <div className="mt-2 p-2.5 rounded-lg bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center space-x-2">
                  {selectedNode.requiresChecklist ? (
                    <span className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800 font-bold text-[11px] flex items-center space-x-1">
                      <Lock className="w-3 h-3 text-amber-600" />
                      <span>Mode Strict (Terkunci ke Flow Tahapan)</span>
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-bold text-[11px] flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3 text-blue-600" />
                      <span>Mode Klaim Langsung</span>
                    </span>
                  )}

                  {canEditStructure && (
                    <button
                      type="button"
                      disabled={togglingStrict}
                      onClick={() => void handleToggleStrictChecklist()}
                      className={`px-2.5 py-1 rounded-md border font-semibold text-[11px] transition-colors cursor-pointer disabled:opacity-50 ${
                        selectedNode.requiresChecklist
                          ? 'border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700'
                          : 'border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900'
                      }`}
                      title="Ubah antara Mode Strict (wajib selesaikan flow tahapan) dan Klaim Langsung"
                    >
                      {togglingStrict
                        ? 'Menyimpan...'
                        : selectedNode.requiresChecklist
                        ? 'Buka ke Klaim Langsung'
                        : 'Kunci Mode Strict'}
                    </button>
                  )}
                </div>

                {selectedNode.requiresChecklist ? (
                  <div className="text-[11px] text-amber-900 bg-amber-50/70 border border-amber-200/80 px-2.5 py-1 rounded-md">
                    {stages.length > 0 ? (
                      <span>
                        Terkunci:{' '}
                        <strong>
                          {stages.filter((s) => s.status === 'approved').length}/{stages.length} Tahapan
                        </strong>{' '}
                        selesai (
                        <strong>
                          {Math.round(
                            (stages.filter((s) => s.status === 'approved').length / stages.length) * 100
                          )}
                          %
                        </strong>
                        ). Selesaikan semua tahapan untuk 100%.
                      </span>
                    ) : (
                      <span>
                        Terkunci: Tambahkan minimal 1 tahapan flow di bawah untuk menghitung progres menuju 100%.
                      </span>
                    )}
                  </div>
                ) : (
                  isEditor && (
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] font-semibold text-slate-600">Progres Langsung:</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={claimProgressDraft}
                        onChange={(e) => setClaimProgressDraft(Number(e.target.value))}
                        className="w-28 accent-slate-900 cursor-pointer"
                      />
                      <div className="flex items-center space-x-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={claimProgressDraft}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const stripped = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
                            const num = stripped === '' ? 0 : Math.min(100, Number(stripped));
                            setClaimProgressDraft(num);
                          }}
                          className="w-14 px-2 py-1 rounded border border-slate-300 text-xs font-bold text-right"
                        />
                        <span className="text-slate-500 font-semibold">%</span>
                      </div>
                      <button
                        type="button"
                        disabled={savingProgressClaim}
                        onClick={() => {
                          setClaimModalDate(new Date().toISOString().slice(0, 10));
                          setClaimModalNotes('');
                          setClaimModalOpen(true);
                        }}
                        className="px-2.5 py-1 rounded-md bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-[11px] shadow-2xs cursor-pointer disabled:opacity-50"
                      >
                        {savingProgressClaim ? 'Menyimpan...' : 'Catat Progres'}
                      </button>
                    </div>
                  )
                )}
              </div>

              {/* Pending PM Approval Action Banner */}
              {selectedNode.detailingStatus === 'pending_pm_approval' && (
                <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs flex items-center justify-between gap-2 shadow-2xs">
                  <div className="flex items-center space-x-2 text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Aktivitas ini diajukan oleh Site Officer dan menunggu persetujuan PM untuk aktif di Kurva-S.</span>
                  </div>
                  {canEditStructure && (
                    <button
                      type="button"
                      disabled={approvingDetailsLoading}
                      onClick={handleApprovePendingDetails}
                      className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 shadow-2xs transition-colors"
                    >
                      {approvingDetailsLoading ? 'Memproses...' : 'Setujui Rincian PM'}
                    </button>
                  )}
                </div>
              )}

              {/* Tab Switcher inside Right Panel */}
              <div className="flex items-center space-x-1 mt-2 border-b border-slate-200 pt-0.5">
                <button
                  type="button"
                  onClick={() => setInspectorTab('workflow')}
                  className={`pb-1.5 px-3 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors ${
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
                  className={`pb-1.5 px-3 text-xs font-bold border-b-2 flex items-center space-x-1.5 transition-colors ${
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
                    <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center space-y-4">
                      <Layers className="w-8 h-8 text-slate-300 mx-auto" />
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">
                          Belum Ada Tahapan Pekerjaan / Flow
                        </h4>
                        <p className="text-[11px] text-slate-500 max-w-md mx-auto mt-1">
                          Tambahkan tahapan kerja atau verifikasi yang harus diselesaikan pada item ini.
                        </p>
                      </div>
                      {isEditor && (
                        <div className="max-w-md mx-auto space-y-2.5 text-left">
                          <form onSubmit={handleAddCustomStage} className="flex flex-wrap sm:flex-nowrap gap-1.5">
                            <input
                              type="text"
                              value={newStageName}
                              onChange={(e) => setNewStageName(e.target.value)}
                              placeholder="Nama tahapan, mis. Persiapan Lahan / Review Dokumen..."
                              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs focus:outline-none focus:border-slate-800"
                            />
                            <select
                              value={newStageType}
                              onChange={(e) => setNewStageType(e.target.value as any)}
                              className="px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                            >
                              <option value="work">Tahap Kerja</option>
                              <option value="hold">Hold Point</option>
                              <option value="review">Review</option>
                            </select>
                            <button
                              type="submit"
                              disabled={addingStage || !newStageName.trim()}
                              className="px-3 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs cursor-pointer disabled:opacity-50 shrink-0"
                            >
                              {addingStage ? '...' : '+ Tambah'}
                            </button>
                          </form>
                          <div className="text-center pt-1">
                            <button
                              type="button"
                              onClick={handleInitDefaultWorkflow}
                              disabled={actionLoading}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-[11px] transition-colors inline-flex items-center space-x-1.5 cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                              <span>Atau Gunakan Template Standar 3-Tahap</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {isEditor && (
                        <form
                          onSubmit={handleAddCustomStage}
                          className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap sm:flex-nowrap gap-1.5 items-center"
                        >
                          <input
                            type="text"
                            value={newStageName}
                            onChange={(e) => setNewStageName(e.target.value)}
                            placeholder="Tambah tahapan baru..."
                            className="flex-1 min-w-0 px-2.5 py-1 rounded-md border border-slate-300 bg-white text-xs focus:outline-none focus:border-slate-800"
                          />
                          <select
                            value={newStageType}
                            onChange={(e) => setNewStageType(e.target.value as any)}
                            className="px-2 py-1 rounded-md border border-slate-300 bg-white text-xs"
                          >
                            <option value="work">Tahap Kerja</option>
                            <option value="hold">Hold Point</option>
                            <option value="review">Review</option>
                          </select>
                          <button
                            type="submit"
                            disabled={addingStage || !newStageName.trim()}
                            className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            {addingStage ? '...' : '+ Tambah Tahapan'}
                          </button>
                        </form>
                      )}
                      {stages.map((stage, idx) => {
                        const check = canProceedToStage(stages, stage.id);
                        const stageAttempts = attempts.filter((a) => a.stageId === stage.id);
                        const isUnderSubmit = submittingStage?.id === stage.id;
                        const isUnderReview = reviewingStage?.id === stage.id;

                        return (
                          <div
                            key={stage.id}
                            className={`p-2.5 rounded-lg border transition-all ${
                              stage.status === 'approved'
                                ? 'bg-emerald-50/40 border-emerald-200'
                                : stage.status === 'rejected'
                                ? 'bg-rose-50/40 border-rose-200'
                                : stage.status === 'submitted'
                                ? 'bg-indigo-50/40 border-indigo-200'
                                : stage.status === 'requested'
                                ? 'bg-blue-50/40 border-blue-200'
                                : !check.allowed
                                ? 'bg-slate-50 border-slate-200 opacity-80'
                                : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="space-y-0.5 min-w-0">
                                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                                    {stage.stageOrder}
                                  </span>
                                  {editingStageId === stage.id ? (
                                    <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
                                      <input
                                        type="text"
                                        value={editingStageName}
                                        onChange={(e) => setEditingStageName(e.target.value)}
                                        className="px-2 py-0.5 rounded border border-slate-300 text-xs bg-white font-semibold"
                                      />
                                      <select
                                        value={editingStageType}
                                        onChange={(e) => setEditingStageType(e.target.value as any)}
                                        className="px-1.5 py-0.5 rounded border border-slate-300 text-xs bg-white"
                                      >
                                        <option value="work">Tahap Kerja</option>
                                        <option value="hold">Hold Point</option>
                                        <option value="review">Review</option>
                                      </select>
                                      <button
                                        type="button"
                                        disabled={actionLoading}
                                        onClick={() => void handleUpdateStage(stage.id)}
                                        className="px-2 py-0.5 rounded bg-slate-900 text-white text-[10px] font-bold cursor-pointer"
                                      >
                                        Simpan
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingStageId(null)}
                                        className="px-2 py-0.5 rounded border border-slate-300 text-slate-600 text-[10px] cursor-pointer"
                                      >
                                        Batal
                                      </button>
                                    </div>
                                  ) : (
                                    <h4 className="text-xs font-bold text-slate-900 truncate">
                                      {stage.name}
                                    </h4>
                                  )}
                                  {stage.stageType === 'hold' && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center space-x-1 shrink-0">
                                      <Lock className="w-2.5 h-2.5 text-amber-700" />
                                      <span>HOLD POINT</span>
                                    </span>
                                  )}
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold font-mono shrink-0 ${
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
                                <p className="text-[10px] text-slate-500 pl-7">
                                  Pengaju: <strong className="text-slate-700">{stage.assignedRole}</strong>
                                  {stage.approvalRole ? ` · Penyetuju: ${stage.approvalRole}` : ''}
                                  {stage.requiresWetSignature ? ' · (Wajib Fisik)' : ''}
                                </p>
                              </div>

                              {/* Action Buttons Per Stage */}
                              <div className="flex items-center space-x-1.5 shrink-0">
                                {isEditor && stage.status !== 'approved' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingStageId(stage.id);
                                        setEditingStageName(stage.name);
                                        setEditingStageType(stage.stageType as any);
                                      }}
                                      className="p-1 rounded border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                                      title="Edit nama atau tipe tahapan ini"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => void handleDeleteStage(stage.id, stage.name)}
                                      className="p-1 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer"
                                      title="Hapus tahapan ini"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
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
                                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center space-x-1">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                                    <span>Lulus</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Upstream Hold Point Lock Warning */}
                            {!check.allowed && (
                              <div className="mt-1.5 text-[10px] text-amber-700 bg-amber-50/80 px-2 py-1 rounded border border-amber-200 flex items-center space-x-1.5 ml-7">
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

                  {/* Riwayat Log Progres Langsung (Direct Progress Logs) */}
                  {!selectedNode.requiresChecklist && (
                    <div className="mt-4 p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">
                          Riwayat Log Progres Langsung ({progressLogs.length})
                        </span>
                        {isEditor && (
                          <button
                            type="button"
                            onClick={() => {
                              setClaimModalDate(new Date().toISOString().slice(0, 10));
                              setClaimModalNotes('');
                              setClaimModalOpen(true);
                            }}
                            className="text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
                          >
                            + Catat Log Tanggal Baru
                          </button>
                        )}
                      </div>
                      {loadingProgressLogs ? (
                        <div className="text-[11px] text-slate-400 py-2">Memuat riwayat progres...</div>
                      ) : progressLogs.length === 0 ? (
                        <div className="text-[11px] text-slate-400 py-1">
                          Belum ada log progres bertanggal. Klik &quot;Catat Progres&quot; untuk mencatat progres sesuai tanggal lapangan agar Kurva S tidak menumpuk di satu hari.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-200/80 border border-slate-200 rounded-lg bg-white overflow-hidden">
                          {progressLogs.map((log) => (
                            <div key={log.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center space-x-2">
                                  <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {String(log.recordedDate).slice(0, 10)}
                                  </span>
                                  <span className="font-bold text-emerald-700 tabular-nums">
                                    {log.progressPercent}%
                                  </span>
                                  {log.recordedByName && (
                                    <span className="text-[10px] text-slate-400 truncate">
                                      oleh {log.recordedByName}
                                    </span>
                                  )}
                                </div>
                                {log.notes && (
                                  <p className="text-[11px] text-slate-600 mt-0.5 truncate">{log.notes}</p>
                                )}
                              </div>
                              {isEditor && (
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteProgressLog(log.id)}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer shrink-0"
                                  title="Hapus log progres"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
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
                        type="text"
                        inputMode="decimal"
                        value={inlineWeight}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          let cleaned = e.target.value.replace(/[^0-9.]/g, '').replace(/^0+(?=\d)/, '');
                          const dotIdx = cleaned.indexOf('.');
                          if (dotIdx !== -1) {
                            cleaned = cleaned.slice(0, dotIdx + 1) + cleaned.slice(dotIdx + 1).replace(/\./g, '');
                          }
                          if (cleaned !== '' && Number(cleaned) > 100) cleaned = '100';
                          setInlineWeight(cleaned);
                        }}
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

                  {/* Milestone, Unplanned & CPM Predecessor */}
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inlineIsMilestone}
                          onChange={(e) => setInlineIsMilestone(e.target.checked)}
                        />
                        <span className="font-medium text-slate-800">Milestone (0 hari)</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={inlineIsUnplanned}
                          onChange={(e) => setInlineIsUnplanned(e.target.checked)}
                        />
                        <span className="font-medium text-slate-800">Pekerjaan Tambahan (Unplanned)</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <select
                        value={inlinePredecessorId}
                        onChange={(e) => setInlinePredecessorId(e.target.value)}
                        className="sm:col-span-2 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white"
                      >
                        <option value="">-- Tanpa Predecessor (CPM) --</option>
                        {flatNodes
                          .filter((n) => n.id !== selectedNode.id)
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.wbsCode} - {n.name}
                            </option>
                          ))}
                      </select>
                      <input
                        type="number"
                        value={inlineLagDays}
                        onChange={(e) => setInlineLagDays(e.target.value)}
                        placeholder="Lag (hari)"
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono"
                      />
                    </div>
                  </div>

                  {/* Allow Detailing Switch */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 bg-white">
                    <div>
                      <span className="font-bold text-slate-800 text-xs block">
                        Izinkan Rincian Lapangan (allow_detailing)
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {canEditStructure
                          ? 'Jika aktif, Site Officer dapat menambahkan sub-aktivitas detail di bawah paket kerja ini.'
                          : 'Hanya Project Manager / Head Office yang dapat mengubah izin rincian lapangan.'}
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!canEditStructure}
                        checked={inlineAllowDetailing}
                        onChange={(e) => setInlineAllowDetailing(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600 peer-disabled:opacity-50"></div>
                    </label>
                  </div>

                  <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => onDeleteNode(selectedNode)}
                        className="px-3 py-2 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-colors flex items-center space-x-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                        <span>Hapus Pekerjaan Ini</span>
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={inlineSaving || !canEdit}
                      className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold text-xs shadow-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50 ml-auto"
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

      {/* Pop-up Modal Catat Log Progres Langsung */}
      {claimModalOpen && selectedNode && (
        <div className="fixed inset-0 z-50 bg-[#06090e]/75 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveClaimProgress}
            className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden text-xs"
          >
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Catat Progres Langsung</h3>
                <p className="text-[11px] text-slate-500 truncate max-w-xs">
                  {selectedNode.wbsCode} — {selectedNode.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClaimModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tanggal Progres Lapangan
                </label>
                <input
                  type="date"
                  required
                  value={claimModalDate}
                  onChange={(e) => setClaimModalDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-900 focus:outline-hidden"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Kurva S akan membaca progres ini pada minggu sesuai tanggal yang dipilih.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Kumulatif Progres (%)
                </label>
                <div className="flex items-center space-x-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={claimProgressDraft}
                    onChange={(e) => setClaimProgressDraft(Number(e.target.value))}
                    className="flex-1 accent-slate-900 cursor-pointer"
                  />
                  <div className="flex items-center space-x-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      value={claimProgressDraft}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const stripped = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
                        const num = stripped === '' ? 0 : Math.min(100, Number(stripped));
                        setClaimProgressDraft(num);
                      }}
                      className="w-16 px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-right tabular-nums"
                    />
                    <span className="text-slate-500 font-semibold">%</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Catatan / Keterangan Lapangan (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={claimModalNotes}
                  onChange={(e) => setClaimModalNotes(e.target.value)}
                  placeholder="Mis. Pengecoran kolom zona A selesai 25%"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-slate-900 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setClaimModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-medium hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingProgressClaim}
                className="px-4 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold shadow-xs cursor-pointer disabled:opacity-50"
              >
                {savingProgressClaim ? 'Menyimpan...' : 'Simpan Log Progres'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
