import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWbsTree,
  flattenWbsTree,
  validateWbsWeights,
  calculateRollupProgress,
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
