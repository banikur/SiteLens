import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Plus,
  Move,
  FolderTree,
  ShieldCheck,
  Edit2,
  Trash2,
  UserCheck,
  Sparkles,
  Layers,
  ArrowRight,
  GripHorizontal,
} from 'lucide-react';
import type { WorkNode, User } from '../types';
import { calculateRollupProgress, buildWbsTree, WbsTreeNode } from '../utils/wbs';

interface WbsCanvasStudioProps {
  nodes: WorkNode[];
  currentUser: User;
  canEdit: boolean;
  onAddNode: (parentId?: string) => void;
  onEditNode: (node: WorkNode) => void;
  onDeleteNode: (node: WorkNode) => void;
  onOpenWorkflow: (node: WorkNode) => void;
  onUpdateNodePosition: (nodeId: string, x: number, y: number) => void;
  onReparentNode: (childId: string, newParentId: string | null) => void;
}

interface NodePosition {
  x: number;
  y: number;
}

const CARD_WIDTH = 240;
const CARD_HEIGHT = 140;
const HORIZONTAL_GAP = 50;
const VERTICAL_GAP = 90;

export const WbsCanvasStudio: React.FC<WbsCanvasStudioProps> = ({
  nodes,
  currentUser,
  canEdit,
  onAddNode,
  onEditNode,
  onDeleteNode,
  onOpenWorkflow,
  onUpdateNodePosition,
  onReparentNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Canvas Pan & Zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 80, y: 60 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Node Dragging state
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragCurrentPos, setDragCurrentPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null);

  // Local positions cache: fallback or manual overrides
  const [localPositions, setLocalPositions] = useState<Record<string, NodePosition>>({});

  // Compute hierarchical tree
  const tree = useMemo(() => buildWbsTree(nodes), [nodes]);

  // Flatten map of tree nodes for quick lookup of rollup progress
  const treeNodeMap = useMemo(() => {
    const map = new Map<string, WbsTreeNode>();
    const register = (item: WbsTreeNode) => {
      map.set(item.id, item);
      item.children.forEach(register);
    };
    tree.forEach(register);
    return map;
  }, [tree]);

  // Hierarchical auto-layout generator
  const computeAutoLayout = useCallback(() => {
    const positions: Record<string, NodePosition> = {};
    let currentX = 50;

    const layoutSubtree = (node: WbsTreeNode, depth: number, startX: number): number => {
      const y = 50 + depth * (CARD_HEIGHT + VERTICAL_GAP);

      if (!node.children || node.children.length === 0) {
        positions[node.id] = { x: startX, y };
        return startX + CARD_WIDTH + HORIZONTAL_GAP;
      }

      let childX = startX;
      node.children.forEach((child) => {
        childX = layoutSubtree(child, depth + 1, childX);
      });

      // Center parent over children
      const firstChild = node.children[0];
      const lastChild = node.children[node.children.length - 1];
      const parentX =
        (positions[firstChild.id].x + positions[lastChild.id].x) / 2;

      positions[node.id] = { x: parentX, y };
      return Math.max(childX, parentX + CARD_WIDTH + HORIZONTAL_GAP);
    };

    tree.forEach((root) => {
      currentX = layoutSubtree(root, 0, currentX);
    });

    return positions;
  }, [tree]);

  // Initialize or synchronize layout
  useEffect(() => {
    const auto = computeAutoLayout();
    setLocalPositions((prev) => {
      const updated: Record<string, NodePosition> = { ...auto };
      // Preserve existing valid positions
      nodes.forEach((n) => {
        if (n.canvasX != null && n.canvasY != null) {
          updated[n.id] = { x: Number(n.canvasX), y: Number(n.canvasY) };
        } else if (prev[n.id]) {
          updated[n.id] = prev[n.id];
        }
      });
      return updated;
    });
  }, [nodes, computeAutoLayout]);

  // Handle Pan start
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
      // Calculate position in canvas space
      const newX = (e.clientX - pan.x) / zoom - dragOffset.x;
      const newY = (e.clientY - pan.y) / zoom - dragOffset.y;
      setDragCurrentPos({ x: newX, y: newY });

      // Check if hovering over any other node card to reparent
      const hovered = nodes.find((n) => {
        if (n.id === draggingNodeId) return false;
        const pos = localPositions[n.id];
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

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingNodeId) {
      const activeId = draggingNodeId;
      const finalPos = dragCurrentPos;
      const targetParentId = dragOverNodeId;

      // Update position
      setLocalPositions((prev) => ({
        ...prev,
        [activeId]: finalPos,
      }));
      onUpdateNodePosition(activeId, Math.round(finalPos.x), Math.round(finalPos.y));

      // Handle Reparenting if dropped over another node
      if (targetParentId && targetParentId !== activeId) {
        onReparentNode(activeId, targetParentId);
      }

      setDraggingNodeId(null);
      setDragOverNodeId(null);
    }
  };

  // Node Drag Start
  const handleNodeDragStart = (e: React.MouseEvent, node: WorkNode) => {
    if (!canEdit) return;
    e.stopPropagation();
    const pos = localPositions[node.id] || { x: 50, y: 50 };
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
    const auto = computeAutoLayout();
    setLocalPositions(auto);
    setZoom(1);
    setPan({ x: 80, y: 60 });
  };

  // Generate Orthogonal Connectors from Parent to Children
  const connectionLines = useMemo(() => {
    const lines: { id: string; d: string; parentId: string; childId: string }[] = [];

    nodes.forEach((child) => {
      if (!child.parentId) return;
      const parentPos = localPositions[child.parentId];
      const childPos =
        draggingNodeId === child.id ? dragCurrentPos : localPositions[child.id];

      if (parentPos && childPos) {
        // Output point: center-bottom of parent
        const startX = parentPos.x + CARD_WIDTH / 2;
        const startY = parentPos.y + CARD_HEIGHT;

        // Input point: center-top of child
        const endX = childPos.x + CARD_WIDTH / 2;
        const endY = childPos.y;

        // Orthogonal step curve
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
  }, [nodes, localPositions, draggingNodeId, dragCurrentPos]);

  return (
    <div className="relative w-full h-[640px] bg-[#0d1117] rounded-xl border border-slate-800 overflow-hidden select-none flex flex-col shadow-inner">
      {/* Top Floating Control Bar (Draw.io style) */}
      <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
        {/* Left: Quick Actions & Instructions */}
        <div className="bg-[#161c24]/90 backdrop-blur-md px-3.5 py-1.5 rounded-lg border border-slate-700/80 text-xs text-slate-300 flex items-center space-x-3 pointer-events-auto shadow-md">
          <div className="flex items-center space-x-1.5 text-[#d4f038] font-bold">
            <Layers className="w-3.5 h-3.5" />
            <span>Draw.io Working Tree Canvas</span>
          </div>
          <span className="text-slate-600">|</span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Drag node untuk mengatur posisi &bull; Geser ke node lain untuk mengubah parent (reparenting)
          </span>
        </div>

        {/* Right: Zoom & Layout Controls */}
        <div className="bg-[#161c24]/90 backdrop-blur-md px-2 py-1.5 rounded-lg border border-slate-700/80 flex items-center space-x-1.5 pointer-events-auto shadow-md">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}
            className="p-1 rounded text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            title="Perkecil Kanvas (Zoom Out)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-slate-300 w-12 text-center">
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
          <div className="w-px h-4 bg-slate-700 mx-1" />
          <button
            type="button"
            onClick={handleFitView}
            className="px-2.5 py-1 rounded bg-[#0b0e14] hover:bg-slate-800 text-[#d4f038] text-[11px] font-semibold flex items-center space-x-1 border border-slate-700 transition-colors"
            title="Rapatkan & Rapikan Susunan Pohon WBS (Auto-Layout)"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto-Layout</span>
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => onAddNode('')}
              className="px-2.5 py-1 rounded bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] text-[11px] font-bold flex items-center space-x-1 transition-colors"
              title="Tambah Root Node Baru"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Node</span>
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
          backgroundImage: `radial-gradient(circle, #2a3447 1px, transparent 1px)`,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        {/* Transform Container (Pan & Zoom) */}
        <div
          className="absolute origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: '4000px',
            height: '4000px',
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
                <polygon points="0 0, 8 3, 0 6" fill="#64748b" />
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
                  strokeDasharray={isLinkedToDrag ? '3 3' : undefined}
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
              : localPositions[node.id] || { x: 50, y: 50 };
            const treeNode = treeNodeMap.get(node.id);
            const rollup = treeNode
              ? calculateRollupProgress(treeNode)
              : {
                  claimedProgress: node.claimedProgressPercent || 0,
                  verifiedProgress: node.verifiedProgressPercent || 0,
                };
            const isRoot = !node.parentId;

            return (
              <div
                key={node.id}
                onMouseDown={(e) => handleNodeDragStart(e, node)}
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  width: `${CARD_WIDTH}px`,
                  zIndex: isDragging ? 50 : isDropTarget ? 40 : 10,
                }}
                className={`absolute rounded-xl transition-shadow cursor-grab active:cursor-grabbing border ${
                  isDragging
                    ? 'shadow-2xl ring-2 ring-[#d4f038] opacity-90 scale-105'
                    : isDropTarget
                    ? 'shadow-2xl ring-2 ring-emerald-400 bg-emerald-950/40 border-emerald-500'
                    : isRoot
                    ? 'bg-[#161c28] border-slate-700 shadow-md hover:border-slate-500'
                    : 'bg-[#111722] border-slate-800 shadow-md hover:border-slate-600'
                }`}
              >
                {/* Node Card Header */}
                <div className="p-2.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 rounded-t-xl">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-mono font-bold text-[#d4f038] bg-[#0b0e14] border border-slate-700 px-1.5 py-0.5 rounded text-[10px]">
                      {node.wbsCode}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 font-bold">
                      {Number(node.weightPercent).toFixed(1)}%
                    </span>
                  </div>

                  {/* Drag Handle & Level badge */}
                  <div className="flex items-center space-x-1 text-slate-500">
                    {node.allowDetailing && (
                      <span className="text-[8px] font-mono px-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800" title="Detailing diizinkan">
                        Detailing OK
                      </span>
                    )}
                    {node.detailingStatus === 'pending_pm_approval' && (
                      <span className="text-[8px] font-mono px-1 rounded bg-amber-950 text-amber-400 border border-amber-800" title="Menunggu approval PM">
                        Pending PM
                      </span>
                    )}
                    <span className="text-[9px] uppercase tracking-wider font-semibold px-1 rounded bg-slate-800 text-slate-400">
                      {isRoot ? 'Phase' : 'Task'}
                    </span>
                    <GripHorizontal className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300" />
                  </div>
                </div>

                {/* Node Card Body */}
                <div className="p-2.5 space-y-2">
                  <h4
                    className="text-xs font-bold text-white line-clamp-2 leading-tight"
                    title={node.name}
                  >
                    {node.name}
                  </h4>

                  {/* Volume & Unit Metadata */}
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>
                      Vol:{' '}
                      <b className="text-slate-200">
                        {node.volume ? String(node.volume) : '-'}
                      </b>{' '}
                      {node.unit || ''}
                    </span>
                    {node.activeRevision && (
                      <span className="px-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
                        {node.activeRevision}
                      </span>
                    )}
                  </div>

                  {/* Assigned Personnel */}
                  <div className="flex items-center space-x-1.5 text-[9px] font-mono text-slate-400">
                    {node.assignedEngineerName && (
                      <span
                        className="truncate px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700"
                        title={`Site Engineer: ${node.assignedEngineerName}`}
                      >
                        SE: {node.assignedEngineerName.split(' ')[0]}
                      </span>
                    )}
                    {node.assignedQcName && (
                      <span
                        className="truncate px-1.5 py-0.2 rounded bg-[#d4f038]/15 text-[#d4f038] border border-[#d4f038]/30 font-semibold"
                        title={`QA/QC Inspector: ${node.assignedQcName}`}
                      >
                        QC: {node.assignedQcName.split(' ')[0]}
                      </span>
                    )}
                  </div>

                  {/* Progress Rollup Bar */}
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between text-[9px] font-mono tabular-nums text-slate-400">
                      <span>Klaim: {rollup.claimedProgress}%</span>
                      <span className="text-[#d4f038] font-bold">
                        Verif: {rollup.verifiedProgress}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-xs h-1 overflow-hidden flex border border-slate-800">
                      <div
                        className="bg-[#d4f038] h-1"
                        style={{ width: `${Math.min(rollup.verifiedProgress, 100)}%` }}
                      />
                      <div
                        className="bg-slate-500 h-1"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(rollup.claimedProgress - rollup.verifiedProgress, 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Node Card Actions Footer */}
                <div className="p-1.5 bg-slate-900/80 border-t border-slate-800 flex items-center justify-between rounded-b-xl">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenWorkflow(node);
                    }}
                    className="px-2 py-0.5 rounded bg-[#0b0e14] hover:bg-slate-800 text-[#d4f038] text-[10px] font-bold flex items-center space-x-1 border border-slate-700 transition-colors"
                    title="Buka Alur Multi-Stage Workflow & Hold Point"
                  >
                    <ShieldCheck className="w-3 h-3 text-[#d4f038]" />
                    <span>Workflow</span>
                  </button>

                  {canEdit && (
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddNode(node.id);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Tambah Child Node"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditNode(node);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        title="Edit Node"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteNode(node);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                        title="Hapus Node"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Reparent Drop Overlay indicator */}
                {isDropTarget && (
                  <div className="absolute inset-0 bg-emerald-950/80 backdrop-blur-xs rounded-xl flex items-center justify-center border-2 border-dashed border-emerald-400 z-50 text-emerald-200 text-xs font-bold text-center p-2">
                    Jadikan sub-node di bawah item ini
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
