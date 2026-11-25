import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWbsTree,
  flattenWbsTree,
  validateWbsWeights,
  calculateRollupProgress,
  detectCycle,
  distributeEvenlyWeights,
  calculateSiblingWeightSum,
  reparentNode,
  isNodeInAllowedDetailingSubtree,
} from '../src/utils/wbs';
import type { WorkNode } from '../src/types';

test('WBS Tree: builds a nested tree with correct depth levels and children', () => {
  const sampleNodes: WorkNode[] = [
    {
      id: 'node-1',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '1.0',
      name: 'Engineering & Design',
      weightPercent: '20.00',
      claimedProgressPercent: 100,
      verifiedProgressPercent: 100,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-2',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '2.0',
      name: 'Procurement',
      weightPercent: '30.00',
      claimedProgressPercent: 50,
      verifiedProgressPercent: 50,
      sortOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '3.0',
      name: 'Construction',
      weightPercent: '50.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 3,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3-1',
      projectId: 'prj-101',
      parentId: 'node-3',
      wbsCode: '3.1',
      name: 'Civil Works',
      weightPercent: '40.00',
      claimedProgressPercent: 50,
      verifiedProgressPercent: 40,
      documentReferenceNo: 'DWG-CIV-101',
      activeRevision: 'Rev B',
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3-2',
      projectId: 'prj-101',
      parentId: 'node-3',
      wbsCode: '3.2',
      name: 'Steel Structure',
      weightPercent: '60.00',
      claimedProgressPercent: 20,
      verifiedProgressPercent: 10,
      documentReferenceNo: 'DWG-STR-202',
      activeRevision: 'Rev A',
      sortOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const tree = buildWbsTree(sampleNodes);
  assert.equal(tree.length, 3); // 3 root nodes
  assert.equal(tree[0].level, 0);
  assert.equal(tree[0].wbsCode, '1.0');

  const constructionNode = tree[2];
  assert.equal(constructionNode.wbsCode, '3.0');
  assert.equal(constructionNode.children.length, 2);
  assert.equal(constructionNode.children[0].level, 1);
  assert.equal(constructionNode.children[0].wbsCode, '3.1');
  assert.equal(constructionNode.children[0].documentReferenceNo, 'DWG-CIV-101');
  assert.equal(constructionNode.children[0].activeRevision, 'Rev B');
});

test('WBS Tree: flattens hierarchical tree preserving depth-first traversal order', () => {
  const sampleNodes: WorkNode[] = [
    {
      id: 'node-1',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '1.0',
      name: 'Engineering',
      weightPercent: '20.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-2',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '2.0',
      name: 'Procurement',
      weightPercent: '30.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '3.0',
      name: 'Construction',
      weightPercent: '50.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 3,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3-1',
      projectId: 'prj-101',
      parentId: 'node-3',
      wbsCode: '3.1',
      name: 'Civil',
      weightPercent: '40.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3-2',
      projectId: 'prj-101',
      parentId: 'node-3',
      wbsCode: '3.2',
      name: 'Steel',
      weightPercent: '60.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const tree = buildWbsTree(sampleNodes);
  const flat = flattenWbsTree(tree);
  assert.equal(flat.length, 5);
  assert.deepEqual(
    flat.map((n) => n.wbsCode),
    ['1.0', '2.0', '3.0', '3.1', '3.2']
  );
});

test('WBS Tree: validates 100% sibling weight sums and surfaces non-blocking warnings when != 100%', () => {
  const sampleNodes: WorkNode[] = [
    {
      id: 'node-1',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '1.0',
      name: 'Engineering',
      weightPercent: '20.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-2',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '2.0',
      name: 'Procurement',
      weightPercent: '30.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '3.0',
      name: 'Construction',
      weightPercent: '50.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 3,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  // Balanced tree: 20 + 30 + 50 = 100%
  const validCheck = validateWbsWeights(sampleNodes);
  assert.equal(validCheck.hasWarnings, false);
  assert.equal(validCheck.rootTotal, 100);

  // Unbalanced tree (modify node-1 weight to 15% -> total 95%)
  const unbalancedNodes: WorkNode[] = sampleNodes.map((n) =>
    n.id === 'node-1' ? { ...n, weightPercent: '15.00' } : n
  );
  const invalidCheck = validateWbsWeights(unbalancedNodes);
  assert.equal(invalidCheck.hasWarnings, true);
  assert.equal(invalidCheck.rootTotal, 95);

  const rootGroup = invalidCheck.groups.find((g) => g.parentId === null);
  assert.equal(rootGroup?.isValid, false);
  assert.equal(rootGroup?.totalWeight, 95);
  assert.match(rootGroup?.message || '', /95% \(ideal: 100%\)/);
});

test('WBS Tree: computes weighted progress rollups correctly from child leaves to parent nodes', () => {
  const sampleNodes: WorkNode[] = [
    {
      id: 'node-3',
      projectId: 'prj-101',
      parentId: null,
      wbsCode: '3.0',
      name: 'Construction',
      weightPercent: '100.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 3,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3-1',
      projectId: 'prj-101',
      parentId: 'node-3',
      wbsCode: '3.1',
      name: 'Civil Works',
      weightPercent: '40.00',
      claimedProgressPercent: 50,
      verifiedProgressPercent: 40,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'node-3-2',
      projectId: 'prj-101',
      parentId: 'node-3',
      wbsCode: '3.2',
      name: 'Steel Structure',
      weightPercent: '60.00',
      claimedProgressPercent: 20,
      verifiedProgressPercent: 10,
      sortOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  const tree = buildWbsTree(sampleNodes);
  const constructionNode = tree[0];

  // Child 3.1: weight 40%, claimed 50%, verified 40%
  // Child 3.2: weight 60%, claimed 20%, verified 10%
  // Rollup Claimed = (50 * 40 + 20 * 60) / 100 = (2000 + 1200) / 100 = 32%
  // Rollup Verified = (40 * 40 + 10 * 60) / 100 = (1600 + 600) / 100 = 22%
  const progress = calculateRollupProgress(constructionNode);
  assert.equal(progress.claimedProgress, 32);
  assert.equal(progress.verifiedProgress, 22);
});

test('WBS Tree Logic: detectCycle identifies direct and indirect cyclic hierarchies', () => {
  const nodes = [
    { id: 'root', parentId: null },
    { id: 'child-1', parentId: 'root' },
    { id: 'grandchild-1', parentId: 'child-1' },
    { id: 'other-root', parentId: null },
  ];

  // Self parent is a cycle
  assert.equal(detectCycle(nodes, 'root', 'root'), true);

  // Making parent child of its own descendant is a cycle
  assert.equal(detectCycle(nodes, 'root', 'child-1'), true);
  assert.equal(detectCycle(nodes, 'root', 'grandchild-1'), true);

  // Moving grandchild under other root is NOT a cycle
  assert.equal(detectCycle(nodes, 'grandchild-1', 'other-root'), false);

  // Moving to root is NOT a cycle
  assert.equal(detectCycle(nodes, 'grandchild-1', null), false);
});

test('WBS Tree Logic: distributeEvenlyWeights strictly sums to 100.00%', () => {
  // 1 item
  assert.deepEqual(distributeEvenlyWeights(1), [100.0]);

  // 2 items
  assert.deepEqual(distributeEvenlyWeights(2), [50.0, 50.0]);

  // 3 items -> 33.34 + 33.33 + 33.33 = 100.00
  const three = distributeEvenlyWeights(3);
  assert.equal(three.length, 3);
  const sum3 = three.reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum3 * 100) / 100, 100.0);
  assert.deepEqual(three, [33.34, 33.33, 33.33]);

  // 6 items -> 16.70 + 5 * 16.66 = 100.00
  const six = distributeEvenlyWeights(6);
  assert.equal(six.length, 6);
  const sum6 = six.reduce((a, b) => a + b, 0);
  assert.equal(Math.round(sum6 * 100) / 100, 100.0);
});

test('WBS Tree Logic: calculateSiblingWeightSum calculates sum with 2 decimals', () => {
  const siblings = [
    { weightPercent: '33.34' },
    { weightPercent: '33.33' },
    { weightPercent: '33.33' },
  ];
  assert.equal(calculateSiblingWeightSum(siblings), 100.0);

  const unbalanced = [
    { weightPercent: '40.0' },
    { weightPercent: '35.0' },
  ];
  assert.equal(calculateSiblingWeightSum(unbalanced), 75.0);
});

test('WBS Tree Logic: reparentNode updates hierarchy and rejects cycles', () => {
  const nodes: WorkNode[] = [
    {
      id: 'root-1',
      projectId: 'p1',
      parentId: null,
      wbsCode: '1.0',
      name: 'Root 1',
      weightPercent: '100.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'child-1',
      projectId: 'p1',
      parentId: 'root-1',
      wbsCode: '1.1',
      name: 'Child 1',
      weightPercent: '100.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  // Valid reparenting
  const reparented = reparentNode(nodes, 'child-1', null, 2);
  assert.equal(reparented.find((n) => n.id === 'child-1')?.parentId, null);
  assert.equal(reparented.find((n) => n.id === 'child-1')?.sortOrder, 2);

  // Cycle throws
  assert.throws(() => {
    reparentNode(nodes, 'root-1', 'child-1');
  }, /Siklus terdeteksi/);
});

test('WBS Tree Logic: isNodeInAllowedDetailingSubtree walks parent chain', () => {
  const nodes: WorkNode[] = [
    {
      id: 'root-locked',
      projectId: 'p1',
      parentId: null,
      wbsCode: '1.0',
      name: 'Root Locked',
      weightPercent: '50.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      allowDetailing: false,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'root-allowed',
      projectId: 'p1',
      parentId: null,
      wbsCode: '2.0',
      name: 'Root Allowed',
      weightPercent: '50.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      allowDetailing: true,
      sortOrder: 2,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'child-locked',
      projectId: 'p1',
      parentId: 'root-locked',
      wbsCode: '1.1',
      name: 'Child Locked',
      weightPercent: '100.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      allowDetailing: false,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: 'child-allowed',
      projectId: 'p1',
      parentId: 'root-allowed',
      wbsCode: '2.1',
      name: 'Child Allowed',
      weightPercent: '100.00',
      claimedProgressPercent: 0,
      verifiedProgressPercent: 0,
      allowDetailing: false,
      sortOrder: 1,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ];

  assert.equal(isNodeInAllowedDetailingSubtree(nodes, 'root-locked'), false);
  assert.equal(isNodeInAllowedDetailingSubtree(nodes, 'child-locked'), false);
  assert.equal(isNodeInAllowedDetailingSubtree(nodes, 'root-allowed'), true);
  assert.equal(isNodeInAllowedDetailingSubtree(nodes, 'child-allowed'), true);
});
