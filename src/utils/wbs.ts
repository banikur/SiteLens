import type { WorkNode } from '../types';

export interface WbsTreeNode extends WorkNode {
  level: number;
  children: WbsTreeNode[];
  effectiveWeight: number; // Parsed float
}

/**
 * Builds a nested hierarchical tree from a flat list of WorkNodes.
 */
export function buildWbsTree(nodes: WorkNode[]): WbsTreeNode[] {
  const nodeMap = new Map<string, WbsTreeNode>();

  // Initialize nodes with empty children array and level 0
  for (const node of nodes) {
    nodeMap.set(node.id, {
      ...node,
      level: 0,
      children: [],
      effectiveWeight: Number(node.weightPercent) || 0,
    });
  }

  const roots: WbsTreeNode[] = [];

  for (const node of nodes) {
    const treeNode = nodeMap.get(node.id)!;
    if (node.parentId && nodeMap.has(node.parentId)) {
      const parent = nodeMap.get(node.parentId)!;
      treeNode.level = parent.level + 1;
      parent.children.push(treeNode);
    } else {
      roots.push(treeNode);
    }
  }

  // Recursive level updater in case children were linked before parent level was resolved
  function syncLevels(nodeList: WbsTreeNode[], currentLevel: number) {
    for (const n of nodeList) {
      n.level = currentLevel;
      if (n.children.length > 0) {
        syncLevels(n.children, currentLevel + 1);
      }
    }
  }
  syncLevels(roots, 0);

  return roots;
}

/**
 * Flattens a tree into a linear list preserving hierarchical order for table rendering.
 */
export function flattenWbsTree(treeNodes: WbsTreeNode[]): WbsTreeNode[] {
  const result: WbsTreeNode[] = [];
  function traverse(list: WbsTreeNode[]) {
    for (const item of list) {
      result.push(item);
      if (item.children.length > 0) {
        traverse(item.children);
      }
    }
  }
  traverse(treeNodes);
  return result;
}

export interface WeightValidationResult {
  parentId: string | null;
  parentName: string;
  totalWeight: number;
  isValid: boolean; // true if Math.abs(totalWeight - 100) < 0.001
  message: string;
}

/**
 * Validates weights per sibling group (root nodes and each parent node's children).
 * In SiteLens, validation is non-blocking: warnings are surfaced for user awareness.
 */
export function validateWbsWeights(nodes: WorkNode[]): {
  groups: WeightValidationResult[];
  hasWarnings: boolean;
  rootTotal: number;
} {
  const nodeMap = new Map<string, WorkNode>();
  const childrenByParent = new Map<string | null, WorkNode[]>();

  for (const n of nodes) {
    nodeMap.set(n.id, n);
    const pid = n.parentId || null;
    const group = childrenByParent.get(pid) || [];
    group.push(n);
    childrenByParent.set(pid, group);
  }

  const groups: WeightValidationResult[] = [];
  let hasWarnings = false;
  let rootTotal = 0;

  for (const [pid, siblings] of childrenByParent.entries()) {
    const sum = siblings.reduce((acc, curr) => acc + (Number(curr.weightPercent) || 0), 0);
    const roundedSum = Math.round(sum * 100) / 100;
    const isValid = Math.abs(roundedSum - 100) < 0.01;

    if (pid === null) {
      rootTotal = roundedSum;
    }

    if (!isValid) {
      hasWarnings = true;
    }

    const parentName = pid ? (nodeMap.get(pid)?.name || `Node ${pid}`) : 'Root (Proyek)';
    groups.push({
      parentId: pid,
      parentName,
      totalWeight: roundedSum,
      isValid,
      message: isValid
        ? `Bobot total ${parentName} adalah 100%`
        : `Bobot total ${parentName} adalah ${roundedSum}% (ideal: 100%)`,
    });
  }

  return { groups, hasWarnings, rootTotal };
}

/**
 * Calculates weighted progress rollup for a node.
 * If leaf node: returns claimed and verified progress directly.
 * If parent: rolls up child progress proportionally based on relative weights.
 */
export function calculateRollupProgress(node: WbsTreeNode): {
  claimedProgress: number;
  verifiedProgress: number;
} {
  if (!node.children || node.children.length === 0) {
    return {
      claimedProgress: node.claimedProgressPercent || 0,
      verifiedProgress: node.verifiedProgressPercent || 0,
    };
  }

  let totalChildWeight = 0;
  let weightedClaimed = 0;
  let weightedVerified = 0;

  for (const child of node.children) {
    const childRollup = calculateRollupProgress(child);
    const weight = Number(child.weightPercent) || 0;
    totalChildWeight += weight;
    weightedClaimed += (childRollup.claimedProgress * weight);
    weightedVerified += (childRollup.verifiedProgress * weight);
  }

  if (totalChildWeight <= 0) {
    return { claimedProgress: 0, verifiedProgress: 0 };
  }

  return {
    claimedProgress: Math.round((weightedClaimed / totalChildWeight) * 100) / 100,
    verifiedProgress: Math.round((weightedVerified / totalChildWeight) * 100) / 100,
  };
}

/**
 * Pure tree logic: Detects whether moving `moveNodeId` under `newParentId` would form a cycle.
 */
export function detectCycle(
  nodes: { id: string; parentId?: string | null }[],
  moveNodeId: string,
  newParentId: string | null
): boolean {
  if (!newParentId) return false;
  if (moveNodeId === newParentId) return true;

  const parentMap = new Map<string, string | null>();
  for (const n of nodes) {
    parentMap.set(n.id, n.parentId || null);
  }

  let curr: string | null = newParentId;
  const visited = new Set<string>();

  while (curr) {
    if (curr === moveNodeId) return true;
    if (visited.has(curr)) return true;
    visited.add(curr);
    curr = parentMap.get(curr) || null;
  }

  return false;
}

/**
 * Pure tree logic: Distributes 100.00% evenly across `count` sibling items.
 * The remainder is assigned to the first item so sum is strictly 100.00%.
 */
export function distributeEvenlyWeights(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [100.0];

  const base = Math.floor(10000 / count) / 100;
  const remainder = Math.round((10000 - base * 100 * count)) / 100;

  const weights = new Array(count).fill(base);
  weights[0] = Math.round((weights[0] + remainder) * 100) / 100;
  return weights;
}

/**
 * Pure tree logic: Computes total weight sum for a sibling array, rounded to 2 decimals.
 */
export function calculateSiblingWeightSum(siblings: { weightPercent: string | number }[]): number {
  const sum = siblings.reduce((acc, curr) => acc + (Number(curr.weightPercent) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Pure tree logic: Reparents a node in an immutable array of nodes.
 * Throws an error if cycle is detected.
 */
export function reparentNode(
  nodes: any[],
  nodeId: string,
  newParentId: string | null,
  newSortOrder?: number
): WorkNode[] {
  if (detectCycle(nodes, nodeId, newParentId)) {
    throw new Error('Siklus terdeteksi: tidak dapat memindahkan simpul ke bawah turunannya sendiri.');
  }

  return nodes.map((n) => {
    if (n.id === nodeId) {
      return {
        ...n,
        parentId: newParentId,
        sortOrder: newSortOrder !== undefined ? newSortOrder : n.sortOrder,
      };
    }
    return n;
  });
}

/**
 * Pure tree logic: Checks whether a node is inside an allow_detailing subtree.
 */
export function isNodeInAllowedDetailingSubtree(
  nodes: any[],
  targetNodeId: string
): boolean {
  const nodeMap = new Map<string, any>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }

  let curr: WorkNode | undefined = nodeMap.get(targetNodeId);
  const visited = new Set<string>();

  while (curr) {
    if (curr.allowDetailing) return true;
    if (visited.has(curr.id)) break;
    visited.add(curr.id);
    curr = curr.parentId ? nodeMap.get(curr.parentId) : undefined;
  }

  return false;
}

export interface CpmNodeResult {
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  isCritical: boolean;
}

/**
 * Critical Path Method (CPM) engine for WBS nodes with Finish-to-Start dependencies.
 * Detects dependency cycles via Kahn's topological sort and computes forward/backward passes.
 */
export function computeWbsCriticalPath(nodes: WorkNode[]): {
  hasCycle: boolean;
  cycleNodeIds: string[];
  criticalNodeIds: Set<string>;
  scheduleMap: Record<string, CpmNodeResult>;
} {
  const nodeMap = new Map<string, WorkNode>();
  const durationMap = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Array<{ targetId: string; lagDays: number }>>();
  const predsMap = new Map<string, Array<{ sourceId: string; lagDays: number }>>();

  for (const n of nodes) {
    nodeMap.set(n.id, n);
    inDegree.set(n.id, 0);
    dependents.set(n.id, []);
    predsMap.set(n.id, []);

    if (n.isMilestone) {
      durationMap.set(n.id, 0);
    } else if (n.plannedStartDate && n.plannedEndDate) {
      const days = Math.ceil(
        (new Date(n.plannedEndDate).getTime() - new Date(n.plannedStartDate).getTime()) / 86400000
      );
      durationMap.set(n.id, Math.max(1, days));
    } else {
      durationMap.set(n.id, 1);
    }
  }

  for (const n of nodes) {
    for (const pred of n.predecessorIds || []) {
      if (!nodeMap.has(pred.nodeId) || pred.nodeId === n.id) {
        if (pred.nodeId === n.id) {
          return { hasCycle: true, cycleNodeIds: [n.id], criticalNodeIds: new Set(), scheduleMap: {} };
        }
        continue;
      }
      const lag = Number(pred.lagDays) || 0;
      dependents.get(pred.nodeId)!.push({ targetId: n.id, lagDays: lag });
      predsMap.get(n.id)!.push({ sourceId: pred.nodeId, lagDays: lag });
      inDegree.set(n.id, (inDegree.get(n.id) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topoOrder.push(id);
    for (const edge of dependents.get(id) || []) {
      const nextDeg = (inDegree.get(edge.targetId) || 0) - 1;
      inDegree.set(edge.targetId, nextDeg);
      if (nextDeg === 0) queue.push(edge.targetId);
    }
  }

  if (topoOrder.length !== nodes.length) {
    const cycleNodeIds = nodes.filter((n) => !topoOrder.includes(n.id)).map((n) => n.id);
    return { hasCycle: true, cycleNodeIds, criticalNodeIds: new Set(), scheduleMap: {} };
  }

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of topoOrder) {
    let start = 0;
    for (const pred of predsMap.get(id) || []) {
      start = Math.max(start, (ef.get(pred.sourceId) || 0) + pred.lagDays);
    }
    const dur = durationMap.get(id) || 0;
    es.set(id, start);
    ef.set(id, start + dur);
  }

  const projectEnd = Math.max(0, ...Array.from(ef.values()));
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const outs = dependents.get(id) || [];
    let finish = projectEnd;
    if (outs.length > 0) {
      finish = Math.min(...outs.map((o) => (ls.get(o.targetId) ?? projectEnd) - o.lagDays));
    }
    const dur = durationMap.get(id) || 0;
    lf.set(id, finish);
    ls.set(id, finish - dur);
  }

  const scheduleMap: Record<string, CpmNodeResult> = {};
  const criticalNodeIds = new Set<string>();
  const hasAnyDeps = nodes.some((n) => (n.predecessorIds?.length || 0) > 0);

  for (const id of topoOrder) {
    const earlyStart = es.get(id) || 0;
    const earlyFinish = ef.get(id) || 0;
    const lateStart = ls.get(id) || 0;
    const lateFinish = lf.get(id) || 0;
    const totalFloat = lateStart - earlyStart;
    const isCritical = hasAnyDeps && totalFloat <= 0;
    if (isCritical) criticalNodeIds.add(id);
    scheduleMap[id] = { earlyStart, earlyFinish, lateStart, lateFinish, totalFloat, isCritical };
  }

  return { hasCycle: false, cycleNodeIds: [], criticalNodeIds, scheduleMap };
}
