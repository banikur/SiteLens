import 'dotenv/config';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb, closeDb } from './index.ts';
import {
  users,
  masterProjects,
  projects,
  roleAssignments,
  workNodes,
} from './schema.ts';
import { hashSecret } from '../auth/crypto.ts';

function toUuid(id: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const hex = crypto.createHash('sha256').update(id).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function runDemoSeed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed demo dilarang dijalankan pada production environment (NODE_ENV=production).');
  }

  const password = process.env.DEMO_USER_PASSWORD;
  if (!password || !password.trim()) {
    throw new Error('Environment variable DEMO_USER_PASSWORD wajib disetel dan tidak boleh kosong.');
  }

  const db = getDb();
  if (!db) {
    throw new Error('Database is not configured.');
  }

  // Ensure tables and columns exist idempotently
  await (db as any).execute(`
    CREATE TABLE IF NOT EXISTS "flow_presets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "name" text NOT NULL,
      "description" text,
      "is_organization_default" boolean DEFAULT false NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "flow_preset_steps" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "preset_id" uuid NOT NULL,
      "step_order" integer NOT NULL,
      "step_type" text NOT NULL,
      "name" text NOT NULL,
      "required_permission" text,
      "can_combine_with_next" boolean DEFAULT false NOT NULL,
      "requires_signature" boolean DEFAULT false NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "master_projects" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "code" text NOT NULL,
      "name" text NOT NULL,
      "owner_client" text NOT NULL,
      "description" text,
      "status" text DEFAULT 'active' NOT NULL,
      "start_date" date,
      "end_date" date,
      "created_by" uuid,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "master_projects_code_unique" UNIQUE("code")
    );
    ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "master_project_id" uuid;
    ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "sites" jsonb DEFAULT '[]'::jsonb NOT NULL;
    ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "flow_preset_id" uuid;
    ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "require_pm_approval_for_detailing" boolean DEFAULT false NOT NULL;
    ALTER TABLE "work_nodes" ADD COLUMN IF NOT EXISTS "allow_detailing" boolean DEFAULT false NOT NULL;
    ALTER TABLE "work_nodes" ADD COLUMN IF NOT EXISTS "detailing_status" text DEFAULT 'active' NOT NULL;
    ALTER TABLE "work_nodes" ADD COLUMN IF NOT EXISTS "volume" numeric(12, 2);
    ALTER TABLE "work_nodes" ADD COLUMN IF NOT EXISTS "unit" text;
  `);

  console.log('🌱 Starting idempotent Demo Setup Flow Seed...');

  const passwordHash = hashSecret(password.trim());

  // 1. Demo Users & Employees
  const DEMO_USERS = [
    {
      id: toUuid('demo-user-pmo'),
      username: 'pmo',
      name: 'Citra PMO (Head Office)',
      email: 'pmo@sitelens.demo',
      title: 'Head Office PMO Lead',
      role: 'Head Office PMO / Quality Director' as const,
    },
    {
      id: toUuid('demo-user-pm'),
      username: 'pm',
      name: 'Agus Pratama (Project Manager)',
      email: 'pm@sitelens.demo',
      title: 'Site Project Manager',
      role: 'Project Director & Tenant Admin' as const,
    },
    {
      id: toUuid('demo-user-se'),
      username: 'se',
      name: 'Dewi Lestari (Site Engineer)',
      email: 'se@sitelens.demo',
      title: 'Lead Site Engineer',
      role: 'Project / Site Engineer' as const,
    },
    {
      id: toUuid('demo-user-client'),
      username: 'client',
      name: 'Pak Bambang (Client Owner)',
      email: 'client@sitelens.demo',
      title: 'Owner Representative / Client Viewer',
      role: 'Client / Vendor Viewer' as const,
    },
    {
      id: toUuid('demo-user-budi'),
      username: 'budi',
      name: 'Budi Santoso (Contextual Engineer)',
      email: 'budi@sitelens.demo',
      title: 'Site Engineer at Site A / Viewer at Site B',
      role: 'Project / Site Engineer' as const,
    },
    {
      id: toUuid('demo-user-pso-1'),
      username: 'pso_rina',
      name: 'Rina Kusuma (PSO)',
      email: 'rina.pso@sitelens.demo',
      title: 'Project Support Officer',
      role: 'Project / Site Engineer' as const,
    },
    {
      id: toUuid('demo-user-pso-2'),
      username: 'pso_dimas',
      name: 'Dimas Aditya (PSO)',
      email: 'dimas.pso@sitelens.demo',
      title: 'Project Support Officer',
      role: 'Project / Site Engineer' as const,
    },
    {
      id: toUuid('demo-user-admin-1'),
      username: 'admin_sari',
      name: 'Sari Wulandari (Admin Project)',
      email: 'sari.admin@sitelens.demo',
      title: 'Admin Project',
      role: 'Project / Site Engineer' as const,
    },
    {
      id: toUuid('demo-user-admin-2'),
      username: 'admin_fajar',
      name: 'Fajar Nugroho (Admin Project)',
      email: 'fajar.admin@sitelens.demo',
      title: 'Admin Project',
      role: 'Project / Site Engineer' as const,
    },
    {
      id: toUuid('demo-user-pm-2'),
      username: 'pm_hendra',
      name: 'Hendra Wijaya (Site Manager)',
      email: 'hendra.pm@sitelens.demo',
      title: 'Project Site Manager',
      role: 'Project Director & Tenant Admin' as const,
    },
    {
      id: toUuid('demo-user-se-2'),
      username: 'se_putri',
      name: 'Putri Rahayu (Site Engineer)',
      email: 'putri.se@sitelens.demo',
      title: 'Civil & Structural Site Engineer',
      role: 'Project / Site Engineer' as const,
    },
    {
      id: toUuid('demo-user-qa-1'),
      username: 'qa_reza',
      name: 'Reza Mahendra (QA/QC Lead)',
      email: 'reza.qa@sitelens.demo',
      title: 'QA/QC Lead Inspector',
      role: 'QA/QC Lead / Owner Inspector' as const,
    },
    {
      id: toUuid('demo-user-insp-1'),
      username: 'insp_andi',
      name: 'Andi Setiawan (Field Inspector)',
      email: 'andi.inspector@sitelens.demo',
      title: 'Field QC Inspector',
      role: 'Field / QC Inspector' as const,
    },
    {
      id: toUuid('demo-user-insp-2'),
      username: 'insp_nia',
      name: 'Nia Kartika (Field Inspector)',
      email: 'nia.inspector@sitelens.demo',
      title: 'MEP Field Inspector',
      role: 'Field / QC Inspector' as const,
    },
    {
      id: toUuid('demo-user-subcon-1'),
      username: 'subcon_eko',
      name: 'Eko Prasetyo (Subcontractor)',
      email: 'eko.subcon@sitelens.demo',
      title: 'Structural Subcontractor Lead',
      role: 'Action Owner / Subcontractor' as const,
    },
  ];

  for (const u of DEMO_USERS) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, u.id as any));
    if (existing) {
      await db
        .update(users)
        .set({
          username: u.username,
          name: u.name,
          email: u.email,
          title: u.title,
          role: u.role as any,
          passwordHash,
          isActive: true,
        })
        .where(eq(users.id, u.id as any));
    } else {
      await db.insert(users).values({
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email,
        title: u.title,
        role: u.role as any,
        passwordHash,
        isActive: true,
      } as any);
    }
  }

  // 2. Master Project
  const MASTER_ID = toUuid('demo-master-ikn-1');
  const [existingMaster] = await db
    .select({ id: masterProjects.id })
    .from(masterProjects)
    .where(eq(masterProjects.id, MASTER_ID as any));

  if (existingMaster) {
    await db
      .update(masterProjects)
      .set({
        code: 'MP-IKN-001',
        name: 'Kawasan Kompleks Pemerintahan Terpadu IKN',
        ownerClient: 'Kementerian PUPR & OIKN',
        description: 'Pembangunan terpadu gedung perkantoran, infrastruktur drainase, dan fasilitas Kawasan Inti Pusat Pemerintahan.',
        status: 'active',
        startDate: '2026-01-01',
        endDate: '2027-12-31',
        updatedAt: new Date(),
      })
      .where(eq(masterProjects.id, MASTER_ID as any));
  } else {
    await db.insert(masterProjects).values({
      id: MASTER_ID,
      code: 'MP-IKN-001',
      name: 'Kawasan Kompleks Pemerintahan Terpadu IKN',
      ownerClient: 'Kementerian PUPR & OIKN',
      description: 'Pembangunan terpadu gedung perkantoran, infrastruktur drainase, dan fasilitas Kawasan Inti Pusat Pemerintahan.',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2027-12-31',
      createdBy: toUuid('demo-user-pmo'),
    });
  }

  // 3. Two Project Sites
  const SITE_A_ID = toUuid('demo-site-ikn-a');
  const SITE_B_ID = toUuid('demo-site-ikn-b');

  const DEMO_SITES = [
    {
      id: SITE_A_ID,
      masterProjectId: MASTER_ID,
      code: 'SITE-IKN-A',
      name: 'Gedung Kantor Utama & Plaza Site A',
      client: 'Kementerian PUPR & OIKN',
      location: 'KIPP Zona 1A, Nusantara',
      leadManager: 'Agus Pratama',
      status: 'active' as const,
    },
    {
      id: SITE_B_ID,
      masterProjectId: MASTER_ID,
      code: 'SITE-IKN-B',
      name: 'Infrastruktur Struktur & MEP Site B',
      client: 'Kementerian PUPR & OIKN',
      location: 'KIPP Zona 1B, Nusantara',
      leadManager: 'Agus Pratama',
      status: 'active' as const,
    },
  ];

  for (const site of DEMO_SITES) {
    const [existingSite] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, site.id as any));
    if (existingSite) {
      await db
        .update(projects)
        .set({
          masterProjectId: site.masterProjectId,
          code: site.code,
          name: site.name,
          client: site.client,
          location: site.location,
          leadManager: site.leadManager,
          status: site.status,
        })
        .where(eq(projects.id, site.id as any));
    } else {
      await db.insert(projects).values({
        id: site.id,
        masterProjectId: site.masterProjectId,
        code: site.code,
        name: site.name,
        client: site.client,
        location: site.location,
        leadManager: site.leadManager,
        status: site.status,
        zones: [{ id: 'z1', name: 'Zona Utama', description: 'Area Konstruksi Inti', safetyLevel: 'High' }],
        sites: [{ id: 's1', name: site.location, description: 'Lokasi Proyek', isPrimary: true }],
      } as any);
    }
  }

  // 4. Role Assignments (source='manual', isActive=true)
  const DEMO_ASSIGNMENTS = [
    // PMO: Organization scope
    {
      id: toUuid('assign-pmo-org'),
      userId: toUuid('demo-user-pmo'),
      roleId: 'head_office_pmo',
      scopeType: 'organization' as const,
      projectId: null,
    },
    // PM: Project scope on Site A & Site B
    {
      id: toUuid('assign-pm-site-a'),
      userId: toUuid('demo-user-pm'),
      roleId: 'project_manager',
      scopeType: 'project' as const,
      projectId: SITE_A_ID,
    },
    {
      id: toUuid('assign-pm-site-b'),
      userId: toUuid('demo-user-pm'),
      roleId: 'project_manager',
      scopeType: 'project' as const,
      projectId: SITE_B_ID,
    },
    // SE: Site Engineer on Site A
    {
      id: toUuid('assign-se-site-a'),
      userId: toUuid('demo-user-se'),
      roleId: 'site_engineer',
      scopeType: 'project' as const,
      projectId: SITE_A_ID,
    },
    // Client: Client Viewer on Site A & Site B
    {
      id: toUuid('assign-client-site-a'),
      userId: toUuid('demo-user-client'),
      roleId: 'client_viewer',
      scopeType: 'project' as const,
      projectId: SITE_A_ID,
    },
    {
      id: toUuid('assign-client-site-b'),
      userId: toUuid('demo-user-client'),
      roleId: 'client_viewer',
      scopeType: 'project' as const,
      projectId: SITE_B_ID,
    },
    // Budi: Contextual Engineer
    // Site Engineer on Site A, Client Viewer on Site B
    {
      id: toUuid('assign-budi-site-a'),
      userId: toUuid('demo-user-budi'),
      roleId: 'site_engineer',
      scopeType: 'project' as const,
      projectId: SITE_A_ID,
    },
    {
      id: toUuid('assign-budi-site-b'),
      userId: toUuid('demo-user-budi'),
      roleId: 'client_viewer',
      scopeType: 'project' as const,
      projectId: SITE_B_ID,
    },
  ];

  for (const asg of DEMO_ASSIGNMENTS) {
    const [existingAsg] = await db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(eq(roleAssignments.id, asg.id as any));

    if (existingAsg) {
      await db
        .update(roleAssignments)
        .set({
          userId: asg.userId as any,
          roleId: asg.roleId,
          scopeType: asg.scopeType,
          projectId: asg.projectId as any,
          source: 'manual',
          isActive: true,
        })
        .where(eq(roleAssignments.id, asg.id as any));
    } else {
      await db.insert(roleAssignments).values({
        id: asg.id,
        userId: asg.userId as any,
        roleId: asg.roleId,
        scopeType: asg.scopeType,
        projectId: asg.projectId as any,
        source: 'manual',
        isActive: true,
      });
    }
  }

  // 5. Site B WBS Sample (Site A is kept EMPTY for live demo creation)
  const WBS_SITE_B_NODES = [
    {
      id: toUuid('wbs-site-b-root-1'),
      projectId: SITE_B_ID,
      parentId: null,
      wbsCode: '1.0',
      name: 'Pekerjaan Struktur Bawah & Pondasi',
      weightPercent: '35.00',
      allowDetailing: true,
      sortOrder: 1,
    },
    {
      id: toUuid('wbs-site-b-child-1-1'),
      projectId: SITE_B_ID,
      parentId: toUuid('wbs-site-b-root-1'),
      wbsCode: '1.1',
      name: 'Pekerjaan Tiang Pancang & Bore Pile Pier P14',
      weightPercent: '20.00',
      allowDetailing: false,
      sortOrder: 1,
    },
    {
      id: toUuid('wbs-site-b-child-1-2'),
      projectId: SITE_B_ID,
      parentId: toUuid('wbs-site-b-root-1'),
      wbsCode: '1.2',
      name: 'Pembesian & Bekisting Pile Cap Grid 4-8',
      weightPercent: '15.00',
      allowDetailing: false,
      sortOrder: 2,
    },
    {
      id: toUuid('wbs-site-b-root-2'),
      projectId: SITE_B_ID,
      parentId: null,
      wbsCode: '2.0',
      name: 'Pekerjaan Struktur Atas & Kolom Lantai 2',
      weightPercent: '40.00',
      allowDetailing: false,
      sortOrder: 2,
    },
    {
      id: toUuid('wbs-site-b-root-3'),
      projectId: SITE_B_ID,
      parentId: null,
      wbsCode: '3.0',
      name: 'Pekerjaan Mekanikal & Elektrikal (MEP)',
      weightPercent: '25.00',
      allowDetailing: false,
      sortOrder: 3,
    },
  ];

  for (const node of WBS_SITE_B_NODES) {
    const [existingNode] = await db
      .select({ id: workNodes.id })
      .from(workNodes)
      .where(eq(workNodes.id, node.id as any));

    if (existingNode) {
      await db
        .update(workNodes)
        .set({
          parentId: node.parentId as any,
          wbsCode: node.wbsCode,
          name: node.name,
          weightPercent: node.weightPercent,
          allowDetailing: node.allowDetailing,
          sortOrder: node.sortOrder,
          updatedAt: new Date(),
        })
        .where(eq(workNodes.id, node.id as any));
    } else {
      await db.insert(workNodes).values({
        id: node.id,
        projectId: node.projectId as any,
        parentId: node.parentId as any,
        wbsCode: node.wbsCode,
        name: node.name,
        weightPercent: node.weightPercent,
        allowDetailing: node.allowDetailing,
        sortOrder: node.sortOrder,
        claimedProgressPercent: 0,
        verifiedProgressPercent: 0,
      });
    }
  }

  console.log('✅ Demo seed completed successfully!');
  console.log('Users created: pmo, pm, se, client, budi (Password from DEMO_USER_PASSWORD)');
  console.log(`Master Project: MP-IKN-001 (ID: ${MASTER_ID})`);
  console.log(`Site A (Live Demo - Empty WBS): SITE-IKN-A (ID: ${SITE_A_ID})`);
  console.log(`Site B (Sample Preset WBS): SITE-IKN-B (ID: ${SITE_B_ID})`);
}

// Execute directly if invoked via CLI
if (process.argv[1]?.includes('seed-demo')) {
  runDemoSeed()
    .then(() => closeDb())
    .catch((err) => {
      console.error('❌ Demo seed failed:', err.message);
      closeDb().finally(() => process.exit(1));
    });
}
