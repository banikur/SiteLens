import 'dotenv/config';
import crypto from 'crypto';
import { count } from 'drizzle-orm';
import { getDb, closeDb } from './index.ts';
import {
  users,
  projects,
  checklistTemplates,
  notificationSettings,
} from './schema.ts';
import { getLocalizedSeedData } from '../../data/mockData.ts';

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
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

    await db.insert(users).values({
      id: 'usr-admin-1',
      username: adminUsername,
      name: 'SiteLens Admin',
      email: 'admin@sitelens.local',
      passwordHash: hashPassword(adminPassword),
      role: 'HSE / Quality Manager & Tenant Admin',
      title: 'HSE & Quality Director / Tenant Admin',
      avatar: '',
      assignedProjects: ['proj-1', 'proj-2'],
      certifications: ['ISO 9001 Lead Auditor', 'ISO 45001 Lead Auditor', 'AK3 Umum'],
      isActive: true,
    });
    console.log(`Seeded admin user "${adminUsername}"`);
  }

  const seedData = getLocalizedSeedData('en');

  const [{ value: projectCount }] = await db.select({ value: count() }).from(projects);
  if (projectCount === 0) {
    await db.insert(projects).values(
      seedData.projects.map((p) => ({
        id: p.id,
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
        id: t.id,
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
        projectId: t.projectId || null,
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

  await closeDb();
  console.log('Seed complete.');
}

seed().catch(async (err) => {
  console.error('Seed failed:', err);
  await closeDb();
  process.exit(1);
});

