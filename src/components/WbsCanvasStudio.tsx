import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Plus,
  Trash2,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Edit2,
  Sparkles,
  Layers,
  Scale,
} from 'lucide-react';
import type { WorkNode, User, Project } from '../types';
import {
  buildWbsTree,
  WbsTreeNode,
  detectCycle,
  distributeEvenlyWeights,
  calculateSiblingWeightSum,
  isNodeInAllowedDetailingSubtree,
} from '../utils/wbs';
import { usePermission, PERMISSIONS } from '../hooks/usePermission';

interface WbsCanvasStudioProps {
  project: Project;
  nodes: WorkNode[];
  currentUser: User;
  canEdit: boolean;
  onRefreshWbs: () => Promise<void>;
  onAddNode: (parentId?: string) => void;
  onEditNode?: (node: WorkNode) => void;
  onDeleteNode: (node: WorkNode) => void;
  onReparentNode: (childId: string, newParentId: string | null) => Promise<void>;
  onBagiRata: (parentId: string | null) => Promise<void>;
  onToggleAllowDetailing?: (nodeId: string, allowDetailing: boolean) => Promise<void>;
  onInlineUpdateNode?: (nodeId: string, updates: { name?: string; weightPercent?: number }) => Promise<void>;
}

interface NodePosition {
  x: number;
  y: number;
}

const CARD_WIDTH = 260;
const CARD_HEIGHT = 145;
const HORIZONTAL_GAP = 40;
const VERTICAL_GAP = 80;

export const WbsCanvasStudio: React.FC<WbsCanvasStudioProps> = ({
  project,
  nodes,
  currentUser,
  canEdit,
  onRefreshWbs,
  onAddNode,
  onEditNode,
  onDeleteNode,
  onReparentNode,
  onBagiRata,
  onToggleAllowDetailing,
  onInlineUpdateNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { can, isLoading: isLoadingPerms } = usePermission();

  // Role Permissions
  const canEditStructure = !isLoadingPerms && can(PERMISSIONS.WBS_EDIT_STRUCTURE, project.id);
  const canEditDetail = !isLoadingPerms && can(PERMISSIONS.WBS_EDIT_DETAIL, project.id);
  const isClientViewer = currentUser?.role === 'Client / Vendor Viewer' || (!canEditStructure && !canEditDetail);

  // Canvas Pan & Zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 80, y: 70 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Drag-and-drop reparenting
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragCurrentPos, setDragCurrentPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);

  // Collapsed branches state
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(new Set());

  // Inline editing state: { nodeId, field: 'name' | 'weight', value }
  const [editingField, setEditingField] = useState<{ nodeId: string; field: 'name' | 'weight'; value: string } | null>(null);

  // Toggle branch collapse
  const toggleBranch = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Compute hierarchical tree
  const tree = useMemo(() => buildWbsTree(nodes), [nodes]);

  // Compute auto-layout positions purely from parentId and sortOrder
  const computedPositions = useMemo(() => {
    const positions: Record<string, NodePosition> = {};
    let currentX = 60;

    const layoutSubtree = (node: WbsTreeNode, depth: number, startX: number): number => {
      const y = 60 + depth * (CARD_HEIGHT + VERTICAL_GAP);
      const isCollapsed = collapsedBranchIds.has(node.id);

      if (!node.children || node.children.length === 0 || isCollapsed) {
        positions[node.id] = { x: startX, y };
        return startX + CARD_WIDTH + HORIZONTAL_GAP;
      }

      let childX = startX;
      node.children.forEach((child) => {
        childX = layoutSubtree(child, depth + 1, childX);
      });

      const firstChild = node.children[0];
      const lastChild = node.children[node.children.length - 1];
      const parentX = (positions[firstChild.id].x + positions[lastChild.id].x) / 2;

      positions[node.id] = { x: parentX, y };
      return Math.max(childX, parentX + CARD_WIDTH + HORIZONTAL_GAP);
    };

    tree.forEach((root) => {
      currentX = layoutSubtree(root, 0, currentX);
    });

    return positions;
  }, [tree, collapsedBranchIds]);

  // Group siblings by parentId to compute total weights & Bagi Rata availability
  const siblingsByParent = useMemo(() => {
    const map = new Map<string | null, WorkNode[]>();
    for (const n of nodes) {
      const pid = n.parentId || null;
      const list = map.get(pid) || [];
      list.push(n);
      map.set(pid, list);
    }
    return map;
  }, [nodes]);

  // Root total weight
  const rootSiblings = siblingsByParent.get(null) || [];
  const rootTotalWeight = useMemo(() => calculateSiblingWeightSum(rootSiblings), [rootSiblings]);

  // Check if a node is editable by current user
  const checkNodeEditable = useCallback((node: WorkNode): boolean => {
    if (isClientViewer) return false;
    if (canEditStructure) return true;
    if (canEditDetail) {
      return isNodeInAllowedDetailingSubtree(nodes, node.id);
    }
    return false;
  }, [isClientViewer, canEditStructure, canEditDetail, nodes]);

  // Handle Pan start on background
  const handleMouseDownBackground = (e: React.MouseEvent) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).tagName !== 'svg') {
      return;
    }
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    } else if (draggingNodeId) {
      const mouseCanvasX = (e.clientX - pan.x) / zoom;
      const mouseCanvasY = (e.clientY - pan.y) / zoom;
      const newX = mouseCanvasX - dragOffset.x;
      const newY = mouseCanvasY - dragOffset.y;
      setDragCurrentPos({ x: newX, y: newY });

      // Find node under cursor
      const hovered = nodes.find((n) => {
        if (n.id === draggingNodeId) return false;
        const pos = computedPositions[n.id];
        if (!pos) return false;
        return (
          newX + CARD_WIDTH / 2 >= pos.x &&
          newX + CARD_WIDTH / 2 <= pos.x + CARD_WIDTH &&
          newY + CARD_HEIGHT / 2 >= pos.y &&
          newY + CARD_HEIGHT / 2 <= pos.y + CARD_HEIGHT
        );
      });

      setDragOverNodeId(hovered ? hovered.id : null);
    }
  };

  const handleMouseUp = async () => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingNodeId) {
      const activeId = draggingNodeId;
      const targetParentId = dragOverNodeId;

      setDraggingNodeId(null);
      setDragOverNodeId(null);

      if (targetParentId && targetParentId !== activeId) {
        if (detectCycle(nodes, activeId, targetParentId)) {
          alert('Siklus terdeteksi: tidak dapat memindahkan simpul ke bawah turunannya sendiri.');
          return;
        }
        await onReparentNode(activeId, targetParentId);
      }
    }
  };

  // Node Drag Start via 6-dot grip
  const handleGripDragStart = (e: React.MouseEvent, node: WorkNode) => {
    if (!checkNodeEditable(node)) return;
    e.stopPropagation();
    const pos = computedPositions[node.id] || { x: 60, y: 60 };
    const mouseCanvasX = (e.clientX - pan.x) / zoom;
    const mouseCanvasY = (e.clientY - pan.y) / zoom;

    setDraggingNodeId(node.id);
    setDragOffset({
      x: mouseCanvasX - pos.x,
      y: mouseCanvasY - pos.y,
    });
    setDragCurrentPos(pos);
  };

  // Auto-fit / Center Zoom
  const handleFitView = () => {
    setZoom(1);
    setPan({ x: 80, y: 70 });
  };

  // Inline edit submission
  const handleSaveInlineEdit = async () => {
    if (!editingField) return;
    const { nodeId, field, value } = editingField;
    setEditingField(null);

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (field === 'name') {
      const trimmed = value.trim();
      if (trimmed && trimmed !== node.name && onInlineUpdateNode) {
        await onInlineUpdateNode(nodeId, { name: trimmed });
      }
    } else if (field === 'weight') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100 && onInlineUpdateNode) {
        await onInlineUpdateNode(nodeId, { weightPercent: parsed });
      }
    }
  };

  // Generate Orthogonal Connectors from Parent to Children
  const connectionLines = useMemo(() => {
    const lines: { id: string; d: string; parentId: string; childId: string }[] = [];

    nodes.forEach((child) => {
      if (!child.parentId) return;
      if (collapsedBranchIds.has(child.parentId)) return;

      const parentPos = computedPositions[child.parentId];
      const childPos =
        draggingNodeId === child.id ? dragCurrentPos : computedPositions[child.id];

      if (parentPos && childPos) {
        const startX = parentPos.x + CARD_WIDTH / 2;
        const startY = parentPos.y + CARD_HEIGHT;
        const endX = childPos.x + CARD_WIDTH / 2;
        const endY = childPos.y;

        const midY = (startY + endY) / 2;
        const path = `M ${startX} ${startY} L ${startX} ${midY} L ${endX} ${midY} L ${endX} ${endY}`;

        lines.push({
          id: `line-${child.parentId}-${child.id}`,
          d: path,
          parentId: child.parentId,
          childId: child.id,
        });
      }
    });

    return lines;
  }, [nodes, computedPositions, draggingNodeId, dragCurrentPos, collapsedBranchIds]);

  return (
    <div className="relative w-full h-[640px] bg-[#0b0e14] rounded-xl border border-slate-800 overflow-hidden select-none flex flex-col shadow-inner">
      {/* Top Floating Control Bar */}
      <div className="absolute top-3 left-3 right-3 z-30 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: Quick Status & Root Weight Badge */}
        <div className="bg-[#161c28]/95 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/80 text-xs text-slate-300 flex items-center space-x-2.5 pointer-events-auto shadow-md">
          <div className="flex items-center space-x-1.5 text-[#d4f038] font-bold">
            <Layers className="w-3.5 h-3.5" />
            <span>Kanvas Rincian Pekerjaan</span>
          </div>

          <span className="text-slate-600">|</span>

          {/* Root Sibling Weight Sum */}
          <div
            className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${
              rootTotalWeight === 100
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
                : 'bg-amber-950/80 text-amber-300 border-amber-800'
            }`}
            title={`Total bobot tingkat induk (Root): ${rootTotalWeight}% (Target: 100.00%)`}
          >
            {rootTotalWeight === 100 ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-3 h-3 text-amber-400" />
            )}
            <span>Induk: {rootTotalWeight.toFixed(1)}%</span>
            {rootTotalWeight !== 100 && (
              <span className="text-[10px] text-amber-400 font-sans font-normal">(Belum 100%)</span>
            )}
          </div>

          {rootSiblings.length > 1 && canEditStructure && (
            <button
              type="button"
              onClick={() => onBagiRata(null)}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[#d4f038] text-[10px] font-bold transition-colors flex items-center space-x-1 border border-slate-700 shadow-2xs"
              title="Bagi rata 100% bobot antar semua simpul induk (Root)"
            >
              <Scale className="w-2.5 h-2.5" />
              <span>Bagi Rata Induk</span>
            </button>
          )}
        </div>

        {/* Right: Zoom & Add Node Controls */}
        <div className="bg-[#161c28]/95 backdrop-blur-md px-2 py-1.5 rounded-lg border border-slate-700/80 flex items-center space-x-1.5 pointer-events-auto shadow-md">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}
            className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            title="Perkecil Kanvas (Zoom Out)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-slate-300 w-11 text-center font-bold">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.0, Math.round((z + 0.1) * 10) / 10))}
            className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            title="Perbesar Kanvas (Zoom In)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleFitView}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
            title="Reset Posisi Tampilan (Center View)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-slate-700 mx-1" />

          {canEditStructure && (
            <button
              type="button"
              onClick={() => onAddNode('')}
              className="px-2.5 py-1 rounded bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-[11px] font-bold flex items-center space-x-1 transition-colors shadow-xs"
              title="Tambah Pekerjaan Tingkat Induk (Root)"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Tambah Pekerjaan</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Interactive Canvas Plane */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDownBackground}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className={`w-full h-full relative overflow-hidden cursor-${
          isPanning ? 'grabbing' : 'grab'
        }`}
        style={{
          backgroundImage: `radial-gradient(circle, #222b3a 1.2px, transparent 1.2px)`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        {/* Empty Canvas State */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="bg-[#161c28]/95 border border-slate-700 rounded-2xl p-8 max-w-md text-center shadow-2xl pointer-events-auto space-y-4">
              <div className="w-14 h-14 mx-auto rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-[#d4f038]">
                <Layers className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-100">Belum Ada Rincian Pekerjaan</h4>
                <p className="text-xs text-slate-400">
                  Site ini masih kosong. Mulai susun rincian paket kerja (WBS) pertama dengan satu klik di bawah.
                </p>
              </div>
              {canEditStructure && (
                <button
                  type="button"
                  onClick={() => onAddNode('')}
                  className="px-4 py-2 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-xs font-bold transition-all shadow-md inline-flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Tambah Pekerjaan Pertama</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Transform Container (Pan & Zoom) */}
        <div
          className="absolute origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: '6000px',
            height: '6000px',
          }}
        >
          {/* SVG Connection Lines */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#475569" />
              </marker>
              <marker
                id="arrowhead-active"
                markerWidth="8"
                markerHeight="6"
                refX="7"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#d4f038" />
              </marker>
            </defs>

            {connectionLines.map((line) => {
              const isLinkedToDrag =
                draggingNodeId === line.childId || draggingNodeId === line.parentId;
              return (
                <path
                  key={line.id}
                  d={line.d}
                  fill="none"
                  stroke={isLinkedToDrag ? '#d4f038' : '#334155'}
                  strokeWidth={isLinkedToDrag ? '2.5' : '1.8'}
                  markerEnd={isLinkedToDrag ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                  strokeDasharray={isLinkedToDrag ? '4 4' : undefined}
                />
              );
            })}
          </svg>

          {/* Render Node Cards */}
          {nodes.map((node) => {
            const isDragging = draggingNodeId === node.id;
            const isDropTarget = dragOverNodeId === node.id;
            const pos = isDragging
              ? dragCurrentPos
              : computedPositions[node.id] || { x: 60, y: 60 };

            const isRoot = !node.parentId;
            const isEditable = checkNodeEditable(node);
            const isLockedForUser = !isEditable && !isClientViewer;

            // Children of this node
            const children = siblingsByParent.get(node.id) || [];
            const hasChildren = children.length > 0;
            const isBranchCollapsed = collapsedBranchIds.has(node.id);

            // Sibling weight sum for this node's children
            const childWeightSum = hasChildren ? calculateSiblingWeightSum(children) : 0;

            return (
              <div
                key={node.id}
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  width: `${CARD_WIDTH}px`,
                  zIndex: isDragging ? 50 : isDropTarget ? 40 : 10,
                }}
                className={`absolute rounded-xl transition-shadow border text-slate-100 ${
                  isDragging
                    ? 'shadow-2xl ring-2 ring-[#d4f038] opacity-95 scale-105'
                    : isDropTarget
                    ? 'shadow-2xl ring-2 ring-emerald-400 bg-emerald-950/60 border-emerald-500 scale-[1.02]'
                    : isRoot
                    ? 'bg-[#161c28] border-slate-700 shadow-md hover:border-slate-500'
                    : 'bg-[#111722] border-slate-800 shadow-md hover:border-slate-600'
                }`}
              >
                {/* Node Card Header */}
                <div className="p-2.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 rounded-t-xl">
                  <div className="flex items-center space-x-1.5 min-w-0">
                    {/* 6-Dot Grip Handle for Drag & Drop Reparenting */}
                    {isEditable && (
                      <div
                        onMouseDown={(e) => handleGripDragStart(e, node)}
                        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-[#d4f038] p-0.5 rounded transition-colors shrink-0"
                        title="Tarik handle 6-titik ini untuk memindahkan induk atau hierarki (Drag & Drop)"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </div>
                    )}

                    {/* WBS Code Pill */}
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold shrink-0 ${
                        isRoot
                          ? 'bg-slate-950 text-[#d4f038] border border-slate-700'
                          : 'bg-blue-950 text-blue-300 border border-blue-800'
                      }`}
                    >
                      {node.wbsCode}
                    </span>

                    {/* Weight Inline Edit */}
                    {editingField?.nodeId === node.id && editingField?.field === 'weight' ? (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        autoFocus
                        value={editingField.value}
                        onChange={(e) =>
                          setEditingField({ ...editingField, value: e.target.value })
                        }
                        onBlur={handleSaveInlineEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveInlineEdit();
                          if (e.key === 'Escape') setEditingField(null);
                        }}
                        className="w-16 px-1 py-0.5 text-[11px] font-mono bg-slate-950 text-[#d4f038] border border-[#d4f038] rounded focus:outline-hidden"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={!isEditable}
                        onClick={() =>
                          isEditable &&
                          setEditingField({
                            nodeId: node.id,
                            field: 'weight',
                            value: String(node.weightPercent || '0'),
                          })
                        }
                        className={`text-[11px] font-mono font-bold px-1 py-0.5 rounded transition-colors ${
                          isEditable
                            ? 'hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer'
                            : 'text-slate-400 cursor-default'
                        }`}
                        title={isEditable ? 'Klik untuk edit bobot (%)' : 'Bobot simpul'}
                      >
                        {Number(node.weightPercent).toFixed(1)}%
                      </button>
                    )}
                  </div>

                  {/* Top-Right Badges & Detailing Controls */}
                  <div className="flex items-center space-x-1 shrink-0">
                    {/* Visual Lock for non-authorized users */}
                    {isLockedForUser && (
                      <span
                        className="p-1 rounded text-slate-400 bg-slate-800/80"
                        title="Terkunci: Anda tidak memiliki hak edit pada cabang ini"
                      >
                        <Lock className="w-3 h-3 text-slate-400" />
                      </span>
                    )}

                    {/* PMO Toggle: Izinkan Detail (allowDetailing) */}
                    {canEditStructure ? (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleAllowDetailing &&
                          onToggleAllowDetailing(node.id, !node.allowDetailing)
                        }
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-colors flex items-center space-x-1 ${
                          node.allowDetailing
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-700 hover:bg-emerald-900'
                            : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                        }`}
                        title={
                          node.allowDetailing
                            ? 'Detailing Aktif: Site Engineer dapat menambah aktivitas di bawah simpul ini (Klik untuk kunci)'
                            : 'Kunci Detailing: Site Engineer tidak dapat merinci simpul ini (Klik untuk izinkan)'
                        }
                      >
                        {node.allowDetailing ? (
                          <>
                            <Unlock className="w-2.5 h-2.5 text-emerald-400" />
                            <span>Detail OK</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-2.5 h-2.5 text-slate-400" />
                            <span>Kunci</span>
                          </>
                        )}
                      </button>
                    ) : node.allowDetailing ? (
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-emerald-950 text-emerald-300 border border-emerald-800"
                        title="Detailing diizinkan oleh PMO"
                      >
                        Detail OK
                      </span>
                    ) : null}

                    {/* Collapse / Expand Subtree */}
                    {hasChildren && (
                      <button
                        type="button"
                        onClick={(e) => toggleBranch(node.id, e)}
                        className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                        title={isBranchCollapsed ? 'Buka cabang sub-pekerjaan' : 'Tutup cabang'}
                      >
                        {isBranchCollapsed ? (
                          <ChevronRight className="w-3.5 h-3.5 text-amber-400 font-bold" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {/* Node Card Body: Title (Inline Editable) */}
                <div className="p-3 space-y-2">
                  {editingField?.nodeId === node.id && editingField?.field === 'name' ? (
                    <input
                      type="text"
                      autoFocus
                      value={editingField.value}
                      onChange={(e) =>
                        setEditingField({ ...editingField, value: e.target.value })
                      }
                      onBlur={handleSaveInlineEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveInlineEdit();
                        if (e.key === 'Escape') setEditingField(null);
                      }}
                      className="w-full px-2 py-1 text-xs font-semibold bg-slate-950 text-slate-100 border border-[#d4f038] rounded focus:outline-hidden"
                    />
                  ) : (
                    <div
                      onClick={() =>
                        isEditable &&
                        setEditingField({
                          nodeId: node.id,
                          field: 'name',
                          value: node.name,
                        })
                      }
                      className={`text-xs font-bold leading-snug line-clamp-2 transition-colors ${
                        isEditable
                          ? 'hover:text-[#d4f038] cursor-pointer'
                          : 'cursor-default text-slate-200'
                      }`}
                      title={isEditable ? 'Klik untuk edit nama pekerjaan' : node.name}
                    >
                      <span>{node.name}</span>
                      {isEditable && (
                        <Edit2 className="w-2.5 h-2.5 inline-block ml-1.5 opacity-0 group-hover:opacity-100 text-slate-400" />
                      )}
                    </div>
                  )}

                  {/* Children sibling weight summary banner */}
                  {hasChildren && !isBranchCollapsed && (
                    <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                      <span
                        className={`font-mono font-bold flex items-center space-x-1 ${
                          childWeightSum === 100 ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                        title={`Total bobot anak: ${childWeightSum}%`}
                      >
                        {childWeightSum === 100 ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                        )}
                        <span>Sub: {childWeightSum.toFixed(1)}%</span>
                      </span>

                      {/* Bagi Rata Button for this node's children */}
                      {isEditable && children.length > 1 && (
                        <button
                          type="button"
                          onClick={() => onBagiRata(node.id)}
                          className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[#d4f038] font-bold text-[9px] transition-colors border border-slate-700 shadow-2xs"
                          title="Bagi rata 100% bobot antar semua anak langsung di bawah simpul ini"
                        >
                          Bagi Rata
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Node Card Footer Actions */}
                <div className="px-3 py-2 border-t border-slate-800/80 bg-slate-900/40 rounded-b-xl flex items-center justify-between text-xs">
                  {/* Single-Click "+ Anak" button */}
                  {isEditable ? (
                    <button
                      type="button"
                      onClick={() => onAddNode(node.id)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[#d4f038] text-[10px] font-bold transition-colors flex items-center space-x-1 border border-slate-700 shadow-2xs"
                      title="Tambah sub-pekerjaan di bawah simpul ini"
                    >
                      <Plus className="w-3 h-3" />
                      <span>+ Anak</span>
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-500 font-mono">Read-only</span>
                  )}

                  {/* Delete button with confirmation */}
                  {isEditable && (
                    <button
                      type="button"
                      onClick={() => {
                        const warnText = hasChildren
                          ? `Simpul "${node.name}" memiliki ${children.length} sub-pekerjaan. Hapus seluruh cabang pekerjaan ini?`
                          : `Hapus pekerjaan "${node.name}"?`;
                        if (confirm(warnText)) {
                          onDeleteNode(node);
                        }
                      }}
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors"
                      title="Hapus simpul pekerjaan ini"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
