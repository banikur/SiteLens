import { eq } from 'drizzle-orm';
import { workNodes } from './db/schema.ts';

export interface RollupNode {
  id: string;
  parentId: string | null;
  wbsCode?: string;
  name?: string;
  weightPercent: string | number;
  verifiedProgressPercent?: number;
  claimedProgressPercent?: number;
  detailingStatus?: 'active' | 'pending_pm_approval' | 'rejected' | string;
}

export interface RollupProgressResult {
  verifiedProgressPercent: number;
  claimedProgressPercent: number;
}

/**
 * Computes hierarchical progress roll-ups for an array of nodes in memory.
 * - Leaf nodes retain their own progress.
 * - Parent nodes roll up child progress proportionally based on relative sibling weights.
 *
 * Returns a Map of nodeId -> { verifiedProgressPercent, claimedProgressPercent }
 */
export function computeHierarchicalRollups(nodes: RollupNode[]): Map<string, RollupProgressResult> {
  const result = new Map<string, RollupProgressResult>();
  const childrenMap = new Map<string, RollupNode[]>();
  const nodeMap = new Map<string, RollupNode>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    if (node.parentId) {
      const list = childrenMap.get(node.parentId) || [];
      list.push(node);
      childrenMap.set(node.parentId, list);
    }
  }

  // Recursive post-order traversal to calculate parent values from children up
  function calculateNode(nodeId: string): RollupProgressResult {
    if (result.has(nodeId)) {
      return result.get(nodeId)!;
    }

    const node = nodeMap.get(nodeId);
    if (!node) {
      return { verifiedProgressPercent: 0, claimedProgressPercent: 0 };
    }

    const children = childrenMap.get(nodeId);
    // Only active children contribute to parent progress rollup
    const activeChildren = (children || []).filter(
      (c) => !c.detailingStatus || c.detailingStatus === 'active'
    );

    // If leaf node (no active children), return its current progress directly
    if (activeChildren.length === 0) {
      const leafRes: RollupProgressResult = {
        verifiedProgressPercent: Number(node.verifiedProgressPercent) || 0,
        claimedProgressPercent: Number(node.claimedProgressPercent) || 0,
      };
      result.set(nodeId, leafRes);
      return leafRes;
    }

    // Non-leaf (parent) node: compute weighted average of active children
    let totalChildWeight = 0;
    let weightedVerified = 0;
    let weightedClaimed = 0;

    for (const child of activeChildren) {
      const childRes = calculateNode(child.id);
      const weight = Number(child.weightPercent) || 0;
      totalChildWeight += weight;
      weightedVerified += (childRes.verifiedProgressPercent * weight);
      weightedClaimed += (childRes.claimedProgressPercent * weight);
    }

    let verifiedProgress = 0;
    let claimedProgress = 0;

    if (totalChildWeight > 0) {
      verifiedProgress = Math.round((weightedVerified / totalChildWeight) * 100) / 100;
      claimedProgress = Math.round((weightedClaimed / totalChildWeight) * 100) / 100;
    }

    const parentRes: RollupProgressResult = {
      verifiedProgressPercent: verifiedProgress,
      claimedProgressPercent: claimedProgress,
    };
    result.set(nodeId, parentRes);
    return parentRes;
  }

  // Compute for all nodes
  for (const node of nodes) {
    calculateNode(node.id);
  }

  return result;
}

/**
 * Re-evaluates all parent nodes for a project in the database.
 * If any parent node's verified or claimed progress has changed compared to its stored value,
 * it updates the database record.
 */
export async function recalculateAndSaveNodeRollups(
  db: any,
  projectId: string
): Promise<{
  updatedCount: number;
  updatedNodes: Array<{ id: string; name: string; verifiedProgressPercent: number; claimedProgressPercent: number }>;
}> {
  if (!db || !projectId) {
    return { updatedCount: 0, updatedNodes: [] };
  }

  const nodes = await db
    .select({
      id: workNodes.id,
      parentId: workNodes.parentId,
      wbsCode: workNodes.wbsCode,
      name: workNodes.name,
      weightPercent: workNodes.weightPercent,
      verifiedProgressPercent: workNodes.verifiedProgressPercent,
      claimedProgressPercent: workNodes.claimedProgressPercent,
      detailingStatus: workNodes.detailingStatus,
    })
    .from(workNodes)
    .where(eq(workNodes.projectId, projectId as any));

  if (!nodes || nodes.length === 0) {
    return { updatedCount: 0, updatedNodes: [] };
  }

  const rollups = computeHierarchicalRollups(nodes);
  const parentIds = new Set(nodes.map((n: any) => n.parentId).filter(Boolean));

  const updatedNodes: Array<{ id: string; name: string; verifiedProgressPercent: number; claimedProgressPercent: number }> = [];

  for (const node of nodes) {
    // Only update parent nodes (leaf nodes are updated by their workflows/inspections)
    if (!parentIds.has(node.id)) {
      continue;
    }

    const computed = rollups.get(node.id);
    if (!computed) continue;

    const currentVerified = Number(node.verifiedProgressPercent) || 0;
    const currentClaimed = Number(node.claimedProgressPercent) || 0;

    if (
      computed.verifiedProgressPercent !== currentVerified ||
      computed.claimedProgressPercent !== currentClaimed
    ) {
      await db
        .update(workNodes)
        .set({
          verifiedProgressPercent: computed.verifiedProgressPercent,
          claimedProgressPercent: computed.claimedProgressPercent,
          updatedAt: new Date(),
        })
        .where(eq(workNodes.id, node.id));

      updatedNodes.push({
        id: node.id,
        name: node.name,
        verifiedProgressPercent: computed.verifiedProgressPercent,
        claimedProgressPercent: computed.claimedProgressPercent,
      });
    }
  }

  return {
    updatedCount: updatedNodes.length,
    updatedNodes,
  };
}
