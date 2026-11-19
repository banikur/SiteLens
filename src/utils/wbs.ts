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
