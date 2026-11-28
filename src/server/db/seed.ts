import 'dotenv/config';
import crypto from 'crypto';
import { count } from 'drizzle-orm';
import { getDb, closeDb } from './index.ts';
import {
  users,
  projects,
  checklistTemplates,
  notificationSettings,
  workNodes,
  workWorkflows,
  workStages,
} from './schema.ts';
import { getLocalizedSeedData } from '../../data/mockData.ts';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function toUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hex = crypto.createHash('sha256').update(id).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function seed() {
  const db = getDb();
  if (!db) {
    console.error('DATABASE_URL is not set. Cannot seed database.');
    process.exit(1);
  }

  const [{ value: userCount }] = await db.select({ value: count() }).from(users);
  if (userCount === 0) {
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'SiteLens#Pilot2026';

    const PILOTING_USERS = [
      {
        id: toUuid('usr-admin-1'),
        username: adminUsername,
        name: 'SiteLens Admin',
        email: 'admin@sitelens.local',
        passwordHash: hashPassword(adminPassword),
        role: 'Project Director & Tenant Admin' as const,
        title: 'Project Director / Tenant Admin',
        assignedProjects: ['prj-101', 'prj-102'].map(toUuid),
        isActive: true,
      },
      {
        id: toUuid('usr-eng-1'),
        username: 'engineer',
        name: 'Priya Patel',
        email: 'engineer@sitelens.local',
        passwordHash: hashPassword('SiteLens#Eng2026'),
        role: 'Project / Site Engineer' as const,
        title: 'Lead Site & Planning Engineer',
        assignedProjects: ['prj-101', 'prj-102'].map(toUuid),
        isActive: true,
      },
      {
        id: toUuid('usr-op-1'),
        username: 'inspector',
        name: 'Raymond Briggs',
        email: 'inspector@sitelens.local',
        passwordHash: hashPassword('SiteLens#Insp2026'),
        role: 'Field / QC Inspector' as const,
        title: 'Field QC & Structural Inspector',
        assignedProjects: ['prj-101'].map(toUuid),
        isActive: true,
      },
      {
        id: toUuid('usr-sup-1'),
        username: 'subcon',
        name: 'Dave Kowalski',
        email: 'subcon@sitelens.local',
        passwordHash: hashPassword('SiteLens#Sub2026'),
        role: 'Action Owner / Subcontractor' as const,
        title: 'Site Execution & Remediation Supervisor',
        assignedProjects: ['prj-101'].map(toUuid),
        isActive: true,
      },
      {
        id: toUuid('usr-qc-1'),
        username: 'qalead',
        name: 'Marcus Chen',
        email: 'qalead@sitelens.local',
        passwordHash: hashPassword('SiteLens#Qa2026'),
        role: 'QA/QC Lead / Owner Inspector' as const,
        title: 'QA/QC Lead / Owner Inspection Authority',
        assignedProjects: ['prj-101', 'prj-102'].map(toUuid),
        isActive: true,
      },
      {
        id: toUuid('usr-view-1'),
        username: 'viewer',
        name: 'David Vance',
        email: 'viewer@sitelens.local',
        passwordHash: hashPassword('SiteLens#View2026'),
        role: 'Client / Vendor Viewer' as const,
        title: 'Client Project Oversight Representative',
        assignedProjects: ['prj-101'].map(toUuid),
        isActive: true,
      },
    ];

    await db.insert(users).values(PILOTING_USERS);
    console.log(`Seeded ${PILOTING_USERS.length} piloting users (6 practical roles)`);
  }

  const seedData = getLocalizedSeedData('en');

  const [{ value: projectCount }] = await db.select({ value: count() }).from(projects);
  if (projectCount === 0) {
    await db.insert(projects).values(
      seedData.projects.map((p) => ({
        id: toUuid(p.id),
        name: p.name,
        code: p.code,
        client: p.client,
        location: p.location,
        status: p.status,
        zones: p.zones,
        leadManager: p.leadManager,
      }))
    );
    console.log(`Seeded ${seedData.projects.length} projects`);
  }

  const [{ value: templateCount }] = await db
    .select({ value: count() })
    .from(checklistTemplates);
  if (templateCount === 0) {
    await db.insert(checklistTemplates).values(
      seedData.templates.map((t) => ({
        id: toUuid(t.id),
        title: t.title,
        category: t.category,
        description: t.description,
        version: t.version,
        standardBody: t.tags.some((tag) => tag.includes('ASME'))
          ? ('ASME' as const)
          : t.tags.some((tag) => tag.includes('ISO'))
          ? ('ISO' as const)
          : t.tags.some((tag) => tag.includes('SNI'))
          ? ('SNI' as const)
          : ('Custom' as const),
        standardCode: t.tags.find((tag) => /ISO|ASME|API|SNI|OSHA|ACI/.test(tag)) || null,
        projectId: t.projectId ? toUuid(t.projectId) : null,
        targetRole: t.targetRole || null,
        requiresApproval: t.requiresApproval,
        approvalRole: t.approvalRole || null,
        workflowSteps: t.requiresApproval && t.approvalRole
          ? [
              {
                order: 1,
                label: `${t.approvalRole} Sign-off`,
                role: t.approvalRole,
                trigger: 'always' as const,
                requiresSignature: true,
              },
            ]
          : [],
        estimatedMinutes: t.estimatedMinutes,
        sections: t.sections,
        tags: t.tags,
        isMasterTemplate: true,
        authorId: toUuid('usr-admin-1'),
        authorName: t.authorName,
        authorRole: t.authorRole,
      }))
    );
    console.log(`Seeded ${seedData.templates.length} master templates`);
  }

  const [{ value: notifCount }] = await db
    .select({ value: count() })
    .from(notificationSettings);
  if (notifCount === 0) {
    await db.insert(notificationSettings).values({
      id: 'default',
      smtpHost: process.env.SMTP_HOST || null,
      smtpPort: Number(process.env.SMTP_PORT || 587),
      smtpUser: process.env.SMTP_USER || null,
      smtpPass: process.env.SMTP_PASS || null,
      smtpFrom: process.env.SMTP_FROM || null,
      webhookUrl: process.env.WEBHOOK_URL || null,
      webhookType: 'generic',
      notifyOnCriticalCapa: true,
      notifyOnApproval: true,
    });
  }

  // ---------------- WBS NODES SEEDING ----------------

  const [{ value: nodeCount }] = await db
    .select({ value: count() })
    .from(workNodes);
  if (nodeCount === 0) {
    const prj101Id = toUuid('prj-101');
    const parentConstId = toUuid('wn-300');

    const WBS_NODES = [
      {
        id: toUuid('wn-100'),
        projectId: prj101Id,
        wbsCode: '1.0',
        name: 'Engineering & Detailed Design',
        weightPercent: '15.00',
        claimedProgressPercent: 100,
        verifiedProgressPercent: 100,
        sortOrder: 1,
      },
      {
        id: toUuid('wn-200'),
        projectId: prj101Id,
        wbsCode: '2.0',
        name: 'Procurement & Long-Lead Equipment',
        weightPercent: '35.00',
        claimedProgressPercent: 80,
        verifiedProgressPercent: 75,
        sortOrder: 2,
      },
      {
        id: parentConstId,
        projectId: prj101Id,
        wbsCode: '3.0',
        name: 'Civil & Structural Construction',
        weightPercent: '45.00',
        claimedProgressPercent: 40,
        verifiedProgressPercent: 30,
        sortOrder: 3,
      },
      {
        id: toUuid('wn-310'),
        projectId: prj101Id,
        parentId: parentConstId,
        wbsCode: '3.1',
        name: 'Substructure & Piling Inspection',
        weightPercent: '20.00',
        documentReferenceNo: 'DWG-CIV-001',
        activeRevision: 'Rev B',
        claimedProgressPercent: 100,
        verifiedProgressPercent: 100,
        sortOrder: 4,
      },
      {
        id: toUuid('wn-320'),
        projectId: prj101Id,
        parentId: parentConstId,
        wbsCode: '3.2',
        name: 'Superstructure & Core Wall Pouring',
        weightPercent: '25.00',
        documentReferenceNo: 'DWG-STR-104',
        activeRevision: 'Rev C',
        claimedProgressPercent: 30,
        verifiedProgressPercent: 0,
        sortOrder: 5,
      },
      {
        id: toUuid('wn-400'),
        projectId: prj101Id,
        wbsCode: '4.0',
        name: 'Pre-Commissioning & Handover',
        weightPercent: '5.00',
        claimedProgressPercent: 0,
        verifiedProgressPercent: 0,
        sortOrder: 6,
      },
    ];

    await db.insert(workNodes).values(WBS_NODES);
    console.log(`Seeded ${WBS_NODES.length} initial WBS nodes for General EPC Pack`);
  }

  await closeDb();
  console.log('Seed complete.');
}

seed().catch(async (err) => {
  console.error('Seed failed:', err);
  await closeDb();
  process.exit(1);
});

