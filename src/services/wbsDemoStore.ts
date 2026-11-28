import type {
  WorkNode,
  WorkWorkflow,
  WorkStage,
  InspectionAttempt,
  SCurveSummary,
  BottleneckItem,
  User,
} from '../types';
import { generateDefaultStages, canProceedToStage, validateFourEyes } from '../utils/workflow';
import { saveOfflineWbsAttempt } from './wbsOfflineStore';

const WBS_NODES_KEY = 'sitelens_demo_wbs_nodes_v1';
const WBS_WORKFLOWS_KEY = 'sitelens_demo_wbs_workflows_v1';
const WBS_STAGES_KEY = 'sitelens_demo_wbs_stages_v1';
const WBS_ATTEMPTS_KEY = 'sitelens_demo_wbs_attempts_v1';

// Seed demo nodes with explicit assigned personnel
const getInitialSeedNodes = (projectId: string): WorkNode[] => [
  {
    id: `node-${projectId}-1`,
    projectId,
    parentId: null,
    wbsCode: '1.0',
    name: 'Pekerjaan Struktur Bawah & Pondasi',
    weightPercent: '35.00',
    volume: '1',
    unit: 'ls',
    claimedProgressPercent: 60,
    verifiedProgressPercent: 50,
    sortOrder: 1,
    documentReferenceNo: 'DWG-FDN-001',
    activeRevision: 'Rev B',
    assignedEngineerId: 'usr-sup-1',
    assignedEngineerName: 'Dave Kowalski (Site Engineer)',
    assignedQcId: 'usr-hse-1',
    assignedQcName: 'Elena Rostova (QA/QC Lead)',
    canvasX: 120,
    canvasY: 60,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: `node-${projectId}-1-1`,
    projectId,
    parentId: `node-${projectId}-1`,
    wbsCode: '1.1',
    name: 'Pekerjaan Tiang Pancang & Bore Pile Pier P14',
    weightPercent: '20.00',
    volume: '120',
    unit: 'titik',
    claimedProgressPercent: 100,
    verifiedProgressPercent: 100,
    sortOrder: 1,
    documentReferenceNo: 'DWG-FDN-002',
    activeRevision: 'Rev C',
    assignedEngineerId: 'usr-sup-1',
    assignedEngineerName: 'Dave Kowalski (Site Engineer)',
    assignedQcId: 'usr-qc-1',
    assignedQcName: 'Marcus Chen (QA/QC Inspector)',
    canvasX: 60,
    canvasY: 220,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: `node-${projectId}-1-2`,
    projectId,
    parentId: `node-${projectId}-1`,
    wbsCode: '1.2',
    name: 'Pembesian & Bekisting Pile Cap Grid 4-8',
    weightPercent: '15.00',
    volume: '450',
    unit: 'm3',
    claimedProgressPercent: 75,
    verifiedProgressPercent: 50,
    sortOrder: 2,
    documentReferenceNo: 'DWG-CAP-004',
    activeRevision: 'Rev A',
    assignedEngineerId: 'usr-sup-1',
    assignedEngineerName: 'Dave Kowalski (Site Engineer)',
    assignedQcId: 'usr-hse-1',
    assignedQcName: 'Elena Rostova (QA/QC Lead)',
    canvasX: 340,
    canvasY: 220,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: `node-${projectId}-2`,
    projectId,
    parentId: null,
    wbsCode: '2.0',
    name: 'Pekerjaan Struktur Atas & Kolom Lantai 2',
    weightPercent: '40.00',
    volume: '850',
    unit: 'm3',
    claimedProgressPercent: 30,
    verifiedProgressPercent: 20,
    sortOrder: 2,
    documentReferenceNo: 'DWG-STR-101',
    activeRevision: 'Rev B',
    assignedEngineerId: 'usr-eng-1',
    assignedEngineerName: 'Priya Patel (Site Engineer)',
    assignedQcId: 'usr-qc-1',
    assignedQcName: 'Marcus Chen (QA/QC Inspector)',
    canvasX: 620,
    canvasY: 60,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: `node-${projectId}-3`,
    projectId,
    parentId: null,
    wbsCode: '3.0',
    name: 'Pekerjaan Mekanikal & Elektrikal (MEP)',
    weightPercent: '25.00',
    volume: '1',
    unit: 'ls',
    claimedProgressPercent: 15,
    verifiedProgressPercent: 10,
    sortOrder: 3,
    documentReferenceNo: 'DWG-MEP-202',
    activeRevision: 'Rev A',
    assignedEngineerId: 'usr-op-1',
    assignedEngineerName: 'Raymond Briggs (Site Officer)',
    assignedQcId: 'usr-hse-1',
    assignedQcName: 'Elena Rostova (QA/QC Lead)',
    canvasX: 940,
    canvasY: 60,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

function loadJson<T>(key: string, defaultVal: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultVal;
    return JSON.parse(raw);
  } catch {
    return defaultVal;
  }
}

function saveJson<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.error('Failed to save to localStorage:', key, e);
  }
}

export function getDemoWbs(projectId: string): {
  project: { id: string; name: string; code: string };
  nodes: WorkNode[];
  workflows: WorkWorkflow[];
  stages: WorkStage[];
} {
  const allNodes = loadJson<WorkNode[]>(WBS_NODES_KEY, []);
  let projectNodes = allNodes.filter((n) => n.projectId === projectId);
  if (projectNodes.length === 0) {
    const seeded = getInitialSeedNodes(projectId);
    const updated = [...allNodes.filter((n) => n.projectId !== projectId), ...seeded];
    saveJson(WBS_NODES_KEY, updated);
    projectNodes = seeded;
  }

  const allWorkflows = loadJson<WorkWorkflow[]>(WBS_WORKFLOWS_KEY, []);
  const allStages = loadJson<WorkStage[]>(WBS_STAGES_KEY, []);

  return {
    project: { id: projectId, name: `Project ${projectId}`, code: `PRJ-${projectId}` },
    nodes: projectNodes,
    workflows: allWorkflows,
    stages: allStages,
  };
}

export function createDemoWbsNode(projectId: string, data: Partial<WorkNode>): WorkNode {
  const allNodes = loadJson<WorkNode[]>(WBS_NODES_KEY, []);
  const newNode: WorkNode = {
    id: `node-${Date.now()}`,
    projectId,
    parentId: data.parentId || null,
    wbsCode: data.wbsCode || '1.0',
    name: data.name || 'New Work Node',
    weightPercent: data.weightPercent || '10.00',
    volume: data.volume || null,
    unit: data.unit || null,
    canvasX: data.canvasX || null,
    canvasY: data.canvasY || null,
    plannedStartDate: data.plannedStartDate || null,
    plannedEndDate: data.plannedEndDate || null,
    documentReferenceNo: data.documentReferenceNo || null,
    activeRevision: data.activeRevision || 'Rev A',
    claimedProgressPercent: Number(data.claimedProgressPercent) || 0,
    verifiedProgressPercent: Number(data.verifiedProgressPercent) || 0,
    sortOrder: Number(data.sortOrder) || allNodes.length + 1,
    assignedEngineerId: data.assignedEngineerId || null,
    assignedEngineerName: data.assignedEngineerName || null,
    assignedQcId: data.assignedQcId || null,
    assignedQcName: data.assignedQcName || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const updated = [...allNodes, newNode];
  saveJson(WBS_NODES_KEY, updated);
  return newNode;
}

export function updateDemoWbsNode(projectId: string, nodeId: string, data: Partial<WorkNode>): WorkNode {
  const allNodes = loadJson<WorkNode[]>(WBS_NODES_KEY, []);
  const idx = allNodes.findIndex((n) => n.id === nodeId);
  if (idx < 0) {
    throw new Error('Node not found');
  }

  const current = allNodes[idx];
  const updatedNode: WorkNode = {
    ...current,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  allNodes[idx] = updatedNode;
  saveJson(WBS_NODES_KEY, allNodes);
  return updatedNode;
}

export function deleteDemoWbsNode(projectId: string, nodeId: string): void {
  const allNodes = loadJson<WorkNode[]>(WBS_NODES_KEY, []);
  const toDelete = new Set<string>([nodeId]);
  let added = true;
  while (added) {
    added = false;
    for (const n of allNodes) {
      if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
        toDelete.add(n.id);
        added = true;
      }
    }
  }
  const filtered = allNodes.filter((n) => !toDelete.has(n.id));
  saveJson(WBS_NODES_KEY, filtered);
}

export function applyDemoWbsPreset(
  projectId: string,
  preset: 'general_epc' | 'civil_building' | 'it_spektek' | 'blank'
): { message: string; nodes: WorkNode[] } {
  const allNodes = loadJson<WorkNode[]>(WBS_NODES_KEY, []).filter((n) => n.projectId !== projectId);

  if (preset === 'blank') {
    saveJson(WBS_NODES_KEY, allNodes);
    return { message: 'Kanvas kosong diterapkan.', nodes: [] };
  }

  let presetNodes: WorkNode[] = [];
  if (preset === 'it_spektek') {
    const now = new Date().toISOString();
    presetNodes = [
      {
        id: `it-${Date.now()}-1`,
        projectId,
        parentId: null,
        wbsCode: '1.0',
        name: 'Software & Sistem Informasi (LMS / AI / Portal)',
        weightPercent: '35.00',
        unit: 'Paket',
        claimedProgressPercent: 0,
        verifiedProgressPercent: 0,
        sortOrder: 1,
        documentReferenceNo: 'SPEKTEK-SW-01',
        activeRevision: 'Rev 1',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `it-${Date.now()}-2`,
        projectId,
        parentId: null,
        wbsCode: '2.0',
        name: 'Hardware, Jaringan & Perangkat Lab',
        weightPercent: '45.00',
        unit: 'Set',
        claimedProgressPercent: 0,
        verifiedProgressPercent: 0,
        sortOrder: 2,
        documentReferenceNo: 'SPEKTEK-HW-01',
        activeRevision: 'Rev 1',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `it-${Date.now()}-3`,
        projectId,
        parentId: null,
        wbsCode: '3.0',
        name: 'Pekerjaan Pendukung, Instalasi & Uji Terima (FAT/UAT)',
        weightPercent: '20.00',
        unit: 'Lot',
        claimedProgressPercent: 0,
        verifiedProgressPercent: 0,
        sortOrder: 3,
        documentReferenceNo: 'SPEKTEK-UAT-01',
        activeRevision: 'Rev 1',
        createdAt: now,
        updatedAt: now,
      },
    ];
  } else if (preset === 'general_epc') {
    presetNodes = [
      {
        id: `epc-${Date.now()}-1`,
        projectId,
        parentId: null,
        wbsCode: '1.0',
        name: 'Detailed Engineering & Specification Review',
        weightPercent: '15.00',
        claimedProgressPercent: 100,
        verifiedProgressPercent: 100,
        sortOrder: 1,
        documentReferenceNo: 'ENG-SPEC-01',
        activeRevision: 'Rev 0',
        assignedEngineerId: 'usr-eng-1',
        assignedEngineerName: 'Priya Patel (Site Engineer)',
        assignedQcId: 'usr-hse-1',
        assignedQcName: 'Elena Rostova (QA/QC Lead)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: `epc-${Date.now()}-2`,
        projectId,
        parentId: null,
        wbsCode: '2.0',
        name: 'Equipment Procurement & Mill Certificates',
        weightPercent: '30.00',
        claimedProgressPercent: 80,
        verifiedProgressPercent: 80,
        sortOrder: 2,
        documentReferenceNo: 'PO-MEP-880',
        activeRevision: 'Rev A',
        assignedEngineerId: 'usr-eng-1',
        assignedEngineerName: 'Priya Patel (Site Engineer)',
        assignedQcId: 'usr-qc-1',
        assignedQcName: 'Marcus Chen (QA/QC Inspector)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: `epc-${Date.now()}-3`,
        projectId,
        parentId: null,
        wbsCode: '3.0',
        name: 'Civil, Structural & Piping Installation',
        weightPercent: '45.00',
        claimedProgressPercent: 40,
        verifiedProgressPercent: 30,
        sortOrder: 3,
        documentReferenceNo: 'DWG-CIV-301',
        activeRevision: 'Rev B',
        assignedEngineerId: 'usr-sup-1',
        assignedEngineerName: 'Dave Kowalski (Site Engineer)',
        assignedQcId: 'usr-hse-1',
        assignedQcName: 'Elena Rostova (QA/QC Lead)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: `epc-${Date.now()}-4`,
        projectId,
        parentId: null,
        wbsCode: '4.0',
        name: 'Pre-Commissioning & Final Handover',
        weightPercent: '10.00',
        claimedProgressPercent: 0,
        verifiedProgressPercent: 0,
        sortOrder: 4,
        documentReferenceNo: 'HO-CERT-01',
        activeRevision: 'Draft',
        assignedEngineerId: 'usr-sup-1',
        assignedEngineerName: 'Dave Kowalski (Site Engineer)',
        assignedQcId: 'usr-qc-1',
        assignedQcName: 'Marcus Chen (QA/QC Inspector)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  } else {
    presetNodes = getInitialSeedNodes(projectId);
  }

  const updated = [...allNodes, ...presetNodes];
  saveJson(WBS_NODES_KEY, updated);
  return { message: 'Preset WBS berhasil diterapkan.', nodes: presetNodes };
}

export function getDemoNodeWorkflow(
  projectId: string,
  nodeId: string
): {
  node: WorkNode;
  workflow: WorkWorkflow | null;
  stages: WorkStage[];
  attempts: InspectionAttempt[];
} {
  const { nodes } = getDemoWbs(projectId);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) {
    throw new Error('Node not found');
  }

  const allWorkflows = loadJson<WorkWorkflow[]>(WBS_WORKFLOWS_KEY, []);
  let wf = allWorkflows.find((w) => w.nodeId === nodeId) || null;
  const allStages = loadJson<WorkStage[]>(WBS_STAGES_KEY, []);
  let stages: WorkStage[] = [];

  // If no workflow, auto-initialize standard 3-stage workflow
  if (!wf) {
    const initRes = initDemoDefaultWorkflow(projectId, nodeId);
    wf = initRes.workflow;
    stages = initRes.stages;
  } else {
    stages = allStages.filter((s) => s.workflowId === wf!.id);
  }

  const allAttempts = loadJson<InspectionAttempt[]>(WBS_ATTEMPTS_KEY, []);
  const stageIds = new Set(stages.map((s) => s.id));
  const attempts = allAttempts.filter((a) => stageIds.has(a.stageId));

  return { node, workflow: wf, stages, attempts };
}

export function initDemoDefaultWorkflow(
  projectId: string,
  nodeId: string
): { workflow: WorkWorkflow; stages: WorkStage[] } {
  const allWorkflows = loadJson<WorkWorkflow[]>(WBS_WORKFLOWS_KEY, []);
  const allStages = loadJson<WorkStage[]>(WBS_STAGES_KEY, []);

  const wfId = `wf-${nodeId}`;
  const newWf: WorkWorkflow = {
    id: wfId,
    nodeId,
    title: 'Standar 3-Tahap Workflow & Hold Point',
    createdAt: new Date().toISOString(),
  };

  const stagesRaw = generateDefaultStages('Pekerjaan Standar');
  const newStages: WorkStage[] = stagesRaw.map((s, idx) => ({
    id: `stage-${nodeId}-${idx + 1}`,
    workflowId: wfId,
    stageOrder: s.stageOrder,
    stageType: s.stageType,
    name: s.name,
    assignedRole: s.assignedRole as any,
    approvalRole: s.approvalRole as any,
    requiresWetSignature: s.requiresWetSignature,
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  }));

  const updatedWfs = [...allWorkflows.filter((w) => w.nodeId !== nodeId), newWf];
  const updatedStages = [...allStages.filter((s) => s.workflowId !== wfId), ...newStages];

  saveJson(WBS_WORKFLOWS_KEY, updatedWfs);
  saveJson(WBS_STAGES_KEY, updatedStages);

  return { workflow: newWf, stages: newStages };
}

export function submitDemoStageAttempt(
  stageId: string,
  data: {
    answers?: Record<string, any>;
    signatureCanvasUrl?: string | null;
    wetSignatureDocumentUrl?: string | null;
  },
  currentUser: User
): { attempt: InspectionAttempt; stage: WorkStage; message: string } {
  const allStages = loadJson<WorkStage[]>(WBS_STAGES_KEY, []);
  const stageIndex = allStages.findIndex((s) => s.id === stageId);
  if (stageIndex < 0) throw new Error('Stage not found');

  const stage = allStages[stageIndex];
  const allAttempts = loadJson<InspectionAttempt[]>(WBS_ATTEMPTS_KEY, []);
  const stageAttempts = allAttempts.filter((a) => a.stageId === stageId);

  const newAttempt: InspectionAttempt = {
    id: `att-${Date.now()}`,
    stageId,
    attemptNumber: stageAttempts.length + 1,
    submitterId: currentUser.id,
    submittedAt: new Date().toISOString(),
    status: 'submitted',
    answers: data.answers || {},
    signatureCanvasUrl: data.signatureCanvasUrl || null,
    wetSignatureDocumentUrl: data.wetSignatureDocumentUrl || null,
    createdAt: new Date().toISOString(),
  };

  const updatedStage: WorkStage = {
    ...stage,
    status: 'submitted',
  };

  allStages[stageIndex] = updatedStage;
  saveJson(WBS_STAGES_KEY, allStages);
  saveJson(WBS_ATTEMPTS_KEY, [newAttempt, ...allAttempts]);
  saveOfflineWbsAttempt(newAttempt).catch(() => {});

  return {
    attempt: newAttempt,
    stage: updatedStage,
    message: 'Pengajuan inspeksi tahap berhasil dikirim. Menunggu verifikasi QA/QC (Hold Point aktif).',
  };
}

export function reviewDemoStageAttempt(
  stageId: string,
  data: { decision: 'approved' | 'rejected'; notes?: string },
  currentUser: User
): { stage: WorkStage; attempt: InspectionAttempt; message: string } {
  const allStages = loadJson<WorkStage[]>(WBS_STAGES_KEY, []);
  const stageIndex = allStages.findIndex((s) => s.id === stageId);
  if (stageIndex < 0) throw new Error('Stage not found');

  const stage = allStages[stageIndex];
  const allAttempts = loadJson<InspectionAttempt[]>(WBS_ATTEMPTS_KEY, []);
  const stageAttempts = allAttempts.filter((a) => a.stageId === stageId);
  const latestAttempt = stageAttempts[0];

  if (!latestAttempt) {
    throw new Error('No submission found for this stage.');
  }

  // Four-Eyes Principle check
  if (!validateFourEyes(latestAttempt.submitterId, currentUser.id)) {
    throw new Error(
      'Pelanggaran Prinsip Four-Eyes: Pengguna yang mengajukan inspeksi tidak boleh mengesahkan hasil inspeksinya sendiri.'
    );
  }

  const updatedAttempt: InspectionAttempt = {
    ...latestAttempt,
    status: data.decision,
    approverId: currentUser.id,
    decidedAt: new Date().toISOString(),
    rejectionReason: data.decision === 'rejected' ? data.notes : null,
  };

  const updatedStage: WorkStage = {
    ...stage,
    status: data.decision,
    actualCompletedAt: data.decision === 'approved' ? new Date().toISOString() : null,
  };

  allStages[stageIndex] = updatedStage;
  const updatedAttempts = allAttempts.map((a) => (a.id === latestAttempt.id ? updatedAttempt : a));

  saveJson(WBS_STAGES_KEY, allStages);
  saveJson(WBS_ATTEMPTS_KEY, updatedAttempts);
  saveOfflineWbsAttempt(updatedAttempt).catch(() => {});

  // If approved, increment verified progress on the associated node
  const allWorkflows = loadJson<WorkWorkflow[]>(WBS_WORKFLOWS_KEY, []);
  const wf = allWorkflows.find((w) => w.id === stage.workflowId);
  if (wf && data.decision === 'approved') {
    const allNodes = loadJson<WorkNode[]>(WBS_NODES_KEY, []);
    const nodeIdx = allNodes.findIndex((n) => n.id === wf.nodeId);
    if (nodeIdx >= 0) {
      const cur = allNodes[nodeIdx];
      const newProgress = Math.min(100, (cur.verifiedProgressPercent || 0) + 25);
      allNodes[nodeIdx] = {
        ...cur,
        claimedProgressPercent: Math.max(cur.claimedProgressPercent || 0, newProgress),
        verifiedProgressPercent: newProgress,
        updatedAt: new Date().toISOString(),
      };
      saveJson(WBS_NODES_KEY, allNodes);
    }
  }

  return {
    stage: updatedStage,
    attempt: updatedAttempt,
    message:
      data.decision === 'approved'
        ? 'Verifikasi QA/QC berhasil. Hold Point telah disetujui dan dilepaskan.'
        : 'Inspeksi ditolak. Temuan dicatat untuk perbaikan remedial.',
  };
}

export function getDemoSCurve(projectId: string): SCurveSummary {
  const { nodes } = getDemoWbs(projectId);
  const totalWeight = nodes.reduce((sum, n) => sum + Number(n.weightPercent || 0), 0) || 100;
  const verifiedSum = nodes.reduce(
    (sum, n) => sum + (Number(n.weightPercent || 0) * (n.verifiedProgressPercent || 0)) / 100,
    0
  );
  const currentVerified = Math.round((verifiedSum / totalWeight) * 1000) / 10;
  const currentClaimed = Math.round(
    (nodes.reduce((sum, n) => sum + (Number(n.weightPercent || 0) * (n.claimedProgressPercent || 0)) / 100, 0) /
      totalWeight) *
      1000
  ) / 10;

  return {
    projectId,
    projectName: `Project ${projectId}`,
    totalWeeks: 6,
    currentWeekIndex: 4,
    currentPlannedPercent: 65,
    currentClaimedPercent: currentClaimed,
    currentVerifiedPercent: currentVerified,
    currentVariance: currentVerified - 65,
    status: currentVerified >= 65 ? 'ahead' : currentVerified >= 55 ? 'on_track' : 'delayed',
    totalHoldPoints: 8,
    activeHoldPoints: 2,
    points: [
      {
        weekIndex: 1,
        startDate: '2026-10-05',
        endDate: '2026-10-11',
        label: 'Minggu 1',
        targetIncremental: 10,
        targetCumulative: 10,
        claimedIncremental: 10,
        claimedCumulative: 10,
        verifiedIncremental: 10,
        verifiedCumulative: 10,
        variance: 0,
      },
      {
        weekIndex: 2,
        startDate: '2026-10-12',
        endDate: '2026-10-18',
        label: 'Minggu 2',
        targetIncremental: 15,
        targetCumulative: 25,
        claimedIncremental: 15,
        claimedCumulative: 25,
        verifiedIncremental: 14.5,
        verifiedCumulative: 24.5,
        variance: -0.5,
      },
      {
        weekIndex: 3,
        startDate: '2026-10-19',
        endDate: '2026-10-25',
        label: 'Minggu 3',
        targetIncremental: 20,
        targetCumulative: 45,
        claimedIncremental: 20,
        claimedCumulative: 45,
        verifiedIncremental: 19,
        verifiedCumulative: 43.5,
        variance: -1.5,
      },
      {
        weekIndex: 4,
        startDate: '2026-10-26',
        endDate: '2026-11-01',
        label: 'Minggu 4',
        targetIncremental: 20,
        targetCumulative: 65,
        claimedIncremental: Math.max(15, currentClaimed - 45),
        claimedCumulative: currentClaimed,
        verifiedIncremental: Math.max(14, currentVerified - 43.5),
        verifiedCumulative: currentVerified,
        variance: currentVerified - 65,
      },
      {
        weekIndex: 5,
        startDate: '2026-11-02',
        endDate: '2026-11-08',
        label: 'Minggu 5',
        targetIncremental: 20,
        targetCumulative: 85,
        claimedIncremental: 0,
        claimedCumulative: 0,
        verifiedIncremental: 0,
        verifiedCumulative: 0,
        variance: -85,
      },
      {
        weekIndex: 6,
        startDate: '2026-11-09',
        endDate: '2026-11-15',
        label: 'Minggu 6',
        targetIncremental: 15,
        targetCumulative: 100,
        claimedIncremental: 0,
        claimedCumulative: 0,
        verifiedIncremental: 0,
        verifiedCumulative: 0,
        variance: -100,
      },
    ],
  };
}

export function getDemoBottleneckRadar(projectId: string): {
  bottlenecks: BottleneckItem[];
  criticalCount: number;
  warningCount: number;
  normalCount: number;
} {
  const items: BottleneckItem[] = [
    {
      stageId: 'stage-1',
      stageName: 'Stage 2: Hold Point Witness & Formwork Sign-Off',
      stageType: 'hold',
      wbsCode: '1.2',
      nodeName: 'Pembesian & Bekisting Pile Cap Grid 4-8',
      attemptNumber: 1,
      submitterName: 'Dave Kowalski',
      submittedAt: new Date(Date.now() - 32 * 3600 * 1000).toISOString(),
      approvalRole: 'QA/QC Lead / Owner Inspector',
      waitingHours: 32,
      status: 'critical',
      scheduleImpactDays: 1.5,
    },
    {
      stageId: 'stage-2',
      stageName: 'Stage 1: Pemasangan Rebar Kolom Lt 2',
      stageType: 'work',
      wbsCode: '2.0',
      nodeName: 'Pekerjaan Struktur Atas & Kolom Lantai 2',
      attemptNumber: 1,
      submitterName: 'Priya Patel',
      submittedAt: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
      approvalRole: 'Project / Site Engineer',
      waitingHours: 18,
      status: 'warning',
      scheduleImpactDays: 0.5,
    },
  ];

  return {
    bottlenecks: items,
    criticalCount: 1,
    warningCount: 1,
    normalCount: 3,
  };
}
