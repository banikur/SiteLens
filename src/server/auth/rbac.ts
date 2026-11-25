import type { Request, Response, NextFunction } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.ts';
import {
  permissions,
  roles,
  rolePermissions,
  roleAssignments,
  users,
  projects,
  auditLogs,
} from '../db/schema.ts';
import {
  getProjectIdByStageId,
  getProjectIdByInspectionId,
  getProjectIdByActionId,
} from './middleware.ts';

// -----------------------------------------------------------------------------
// F.3: Complete Permissions Catalog
// -----------------------------------------------------------------------------
  import { PERMISSIONS, type PermissionKey } from '../../types/permissions.ts';
  export { PERMISSIONS, type PermissionKey };

export interface PermissionDefinition {
  id: PermissionKey;
  module: string;
  description: string;
  scopeLevel: 'organization' | 'project' | 'organization_or_project';
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Master Project
  { id: PERMISSIONS.MASTERPROJECT_VIEW, module: 'masterproject', description: 'Melihat daftar & detail Master Project', scopeLevel: 'organization_or_project' },
  { id: PERMISSIONS.MASTERPROJECT_MANAGE, module: 'masterproject', description: 'Membuat, mengubah, dan mengarsipkan Master Project', scopeLevel: 'organization' },

  // Proyek & Keanggotaan
  { id: PERMISSIONS.PROJECT_VIEW, module: 'project', description: 'Melihat daftar & detail proyek', scopeLevel: 'organization_or_project' },
  { id: PERMISSIONS.PROJECT_CREATE, module: 'project', description: 'Membuat entitas proyek baru', scopeLevel: 'organization' },
  { id: PERMISSIONS.PROJECT_EDIT, module: 'project', description: 'Mengedit parameter/metadata proyek', scopeLevel: 'project' },
  { id: PERMISSIONS.PROJECT_MANAGE_MEMBERS, module: 'project', description: 'Mengelola tim & role proyek', scopeLevel: 'project' },

  // WBS, Bobot & Baseline
  { id: PERMISSIONS.WBS_VIEW, module: 'wbs', description: 'Melihat pohon WBS', scopeLevel: 'organization_or_project' },
  { id: PERMISSIONS.WBS_EDIT_STRUCTURE, module: 'wbs', description: 'HO/PMO: susun paket kerja level atas', scopeLevel: 'organization' },
  { id: PERMISSIONS.WBS_EDIT_DETAIL, module: 'wbs', description: 'Site: tambah aktivitas di bawah allow_detailing', scopeLevel: 'project' },
  { id: PERMISSIONS.WBS_FREEZE_BASELINE, module: 'wbs', description: 'HO/PMO: bekukan baseline acuan (R-0)', scopeLevel: 'organization' },
  { id: PERMISSIONS.WBS_REQUEST_CHANGE, module: 'wbs', description: 'Site: ajukan change request', scopeLevel: 'project' },
  { id: PERMISSIONS.WBS_APPROVE_CHANGE, module: 'wbs', description: 'HO/PMO: setujui change request', scopeLevel: 'organization' },

  // Tahapan Alur Kerja / RFI
  { id: PERMISSIONS.STAGE_VIEW, module: 'stage', description: 'Melihat alur kerja stage', scopeLevel: 'organization_or_project' },
  { id: PERMISSIONS.STAGE_REQUEST, module: 'stage', description: 'Site Engineer: ajukan RFI', scopeLevel: 'project' },
  { id: PERMISSIONS.STAGE_EXECUTE, module: 'stage', description: 'Inspector: isi checklist & foto', scopeLevel: 'project' },
  { id: PERMISSIONS.STAGE_APPROVE, module: 'stage', description: 'QA/QC Lead / Owner: sign-off four-eyes', scopeLevel: 'project' },
  { id: PERMISSIONS.STAGE_OVERRIDE, module: 'stage', description: 'HO Director / Owner Rep: bypass darurat', scopeLevel: 'organization' },

  // Inspeksi Non-WBS
  { id: PERMISSIONS.INSPECTION_ROUTINE, module: 'inspection', description: 'Jalankan inspeksi berkala terjadwal', scopeLevel: 'project' },
  { id: PERMISSIONS.INSPECTION_ADHOC, module: 'inspection', description: 'Buat inspeksi/temuan mendadak', scopeLevel: 'project' },
  { id: PERMISSIONS.INSPECTION_REVIEW, module: 'inspection', description: 'Review & approval inspeksi routine/adhoc', scopeLevel: 'project' },
  { id: PERMISSIONS.INSPECTION_DELETE, module: 'inspection', description: 'Hapus draf inspeksi yang belum disubmit', scopeLevel: 'project' },

  // Temuan Cacat & CAPA
  { id: PERMISSIONS.CAPA_VIEW, module: 'capa', description: 'Melihat daftar CAPA', scopeLevel: 'organization_or_project' },
  { id: PERMISSIONS.CAPA_CREATE, module: 'capa', description: 'Terbitkan temuan ketidaksesuaian', scopeLevel: 'project' },
  { id: PERMISSIONS.CAPA_UPDATE_PROGRESS, module: 'capa', description: 'Pelaksana: update progres perbaikan', scopeLevel: 'project' },
  { id: PERMISSIONS.CAPA_CLOSE, module: 'capa', description: 'QA/QC: verifikasi & tutup temuan', scopeLevel: 'project' },

  // Master Template & Standar Mutu
  { id: PERMISSIONS.TEMPLATE_VIEW, module: 'template', description: 'Melihat perpustakaan template', scopeLevel: 'organization_or_project' },
  { id: PERMISSIONS.TEMPLATE_MANAGE, module: 'template', description: 'Buat/edit template standar organisasi', scopeLevel: 'organization' },
  { id: PERMISSIONS.TEMPLATE_DELETE, module: 'template', description: 'Hapus template yang tidak terikat riwayat', scopeLevel: 'organization' },

  // Konfigurasi Alur & Penjadwalan
  { id: PERMISSIONS.FLOW_PRESET_MANAGE, module: 'flow_preset', description: 'Kelola preset alur RFI', scopeLevel: 'organization' },
  { id: PERMISSIONS.SCHEDULE_MANAGE, module: 'schedule', description: 'Atur jadwal inspeksi rutin proyek', scopeLevel: 'project' },

  // Monitoring, Cuaca, Kurva-S & Laporan
  { id: PERMISSIONS.REPORT_VIEW, module: 'report', description: 'Melihat dasbor Kurva-S & radar', scopeLevel: 'organization_or_project' },
  { id: PERMISSIONS.REPORT_EXPORT, module: 'report', description: 'Ekspor laporan resmi format PDF', scopeLevel: 'project' },
  { id: PERMISSIONS.WEATHER_LOG, module: 'weather', description: 'Catat jam hujan & kondisi cuaca', scopeLevel: 'project' },
  { id: PERMISSIONS.SCURVE_OVERRIDE, module: 'scurve', description: 'Site PM: penimpaan kurva target rencana', scopeLevel: 'project' },

  // Kepatuhan Regulasi & Fasilitas
  { id: PERMISSIONS.TENANT_COMPLIANCE_MANAGE, module: 'tenant', description: 'Kelola kepatuhan SMK3 & B3', scopeLevel: 'organization' },

  // Administrasi Tenant & Sistem
  { id: PERMISSIONS.ADMIN_ROLES, module: 'admin', description: 'Kelola role kustom & permission', scopeLevel: 'organization' },
  { id: PERMISSIONS.ADMIN_USERS, module: 'admin', description: 'Kelola akun pengguna & aktivasi', scopeLevel: 'organization' },
  { id: PERMISSIONS.ADMIN_AUDIT, module: 'admin', description: 'Melihat log jejak audit mutasi', scopeLevel: 'organization' },
  { id: PERMISSIONS.ADMIN_SETTINGS, module: 'admin', description: 'Konfigurasi server & integrasi', scopeLevel: 'organization' },
  { id: PERMISSIONS.SYSTEM_BREAK_GLASS, module: 'system', description: 'Akses pemulihan bencana (teraudit penuh)', scopeLevel: 'organization' },

  // Bukti Foto & Dokumen
  { id: PERMISSIONS.EVIDENCE_UPLOAD, module: 'evidence', description: 'Upload foto/dokumen bukti inspeksi', scopeLevel: 'project' },
];

// -----------------------------------------------------------------------------
// F.4: Built-in 7 Roles Matrix
// -----------------------------------------------------------------------------
export interface BuiltInRoleDefinition {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: PermissionKey[];
}

export const BUILTIN_ROLES: BuiltInRoleDefinition[] = [
  {
    id: 'field_inspector',
    name: 'Field Inspector',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.STAGE_EXECUTE,
      PERMISSIONS.INSPECTION_ROUTINE,
      PERMISSIONS.INSPECTION_ADHOC,
      PERMISSIONS.INSPECTION_DELETE,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.CAPA_CREATE,
      PERMISSIONS.TEMPLATE_VIEW,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.EVIDENCE_UPLOAD,
    ],
  },
  {
    id: 'subcontractor',
    name: 'Subcontractor / Mandor',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.CAPA_UPDATE_PROGRESS,
      PERMISSIONS.TEMPLATE_VIEW,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.EVIDENCE_UPLOAD,
    ],
  },
  {
    id: 'site_engineer',
    name: 'Site Engineer',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.WBS_EDIT_DETAIL,
      PERMISSIONS.WBS_REQUEST_CHANGE,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.STAGE_REQUEST,
      PERMISSIONS.INSPECTION_ADHOC,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.CAPA_CREATE,
      PERMISSIONS.CAPA_UPDATE_PROGRESS,
      PERMISSIONS.TEMPLATE_VIEW,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.WEATHER_LOG,
      PERMISSIONS.EVIDENCE_UPLOAD,
    ],
  },
  {
    id: 'qaqc_lead',
    name: 'QA/QC Lead',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.STAGE_APPROVE,
      PERMISSIONS.INSPECTION_ROUTINE,
      PERMISSIONS.INSPECTION_ADHOC,
      PERMISSIONS.INSPECTION_REVIEW,
      PERMISSIONS.INSPECTION_DELETE,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.CAPA_CREATE,
      PERMISSIONS.CAPA_CLOSE,
      PERMISSIONS.TEMPLATE_VIEW,
      PERMISSIONS.TEMPLATE_MANAGE,
      PERMISSIONS.SCHEDULE_MANAGE,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.EVIDENCE_UPLOAD,
    ],
  },
  {
    id: 'project_manager',
    name: 'Site Project Manager',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.PROJECT_EDIT,
      PERMISSIONS.PROJECT_MANAGE_MEMBERS,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.WBS_EDIT_DETAIL,
      PERMISSIONS.WBS_REQUEST_CHANGE,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.STAGE_REQUEST,
      PERMISSIONS.INSPECTION_ADHOC,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.CAPA_CREATE,
      PERMISSIONS.TEMPLATE_VIEW,
      PERMISSIONS.SCHEDULE_MANAGE,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.WEATHER_LOG,
      PERMISSIONS.SCURVE_OVERRIDE,
      PERMISSIONS.ADMIN_AUDIT,
      PERMISSIONS.EVIDENCE_UPLOAD,
    ],
  },
  {
    id: 'head_office_pmo',
    name: 'Head Office / PMO',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.MASTERPROJECT_MANAGE,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.PROJECT_CREATE,
      PERMISSIONS.PROJECT_EDIT,
      PERMISSIONS.PROJECT_MANAGE_MEMBERS,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.WBS_EDIT_STRUCTURE,
      PERMISSIONS.WBS_EDIT_DETAIL,
      PERMISSIONS.WBS_FREEZE_BASELINE,
      PERMISSIONS.WBS_REQUEST_CHANGE,
      PERMISSIONS.WBS_APPROVE_CHANGE,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.STAGE_OVERRIDE,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.TEMPLATE_VIEW,
      PERMISSIONS.TEMPLATE_MANAGE,
      PERMISSIONS.TEMPLATE_DELETE,
      PERMISSIONS.FLOW_PRESET_MANAGE,
      PERMISSIONS.SCHEDULE_MANAGE,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.SCURVE_OVERRIDE,
      PERMISSIONS.TENANT_COMPLIANCE_MANAGE,
      PERMISSIONS.ADMIN_ROLES,
      PERMISSIONS.ADMIN_USERS,
      PERMISSIONS.ADMIN_AUDIT,
      PERMISSIONS.ADMIN_SETTINGS,
      PERMISSIONS.SYSTEM_BREAK_GLASS,
    ],
  },
  {
    id: 'client_viewer',
    name: 'Client Viewer',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.REPORT_EXPORT,
    ],
  },
  {
    id: 'pso',
    name: 'Project Support Officer (PSO)',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.PROJECT_EDIT,
      PERMISSIONS.PROJECT_MANAGE_MEMBERS,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.WBS_EDIT_DETAIL,
      PERMISSIONS.WBS_REQUEST_CHANGE,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.STAGE_REQUEST,
      PERMISSIONS.STAGE_EXECUTE,
      PERMISSIONS.INSPECTION_ROUTINE,
      PERMISSIONS.INSPECTION_ADHOC,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.CAPA_CREATE,
      PERMISSIONS.CAPA_UPDATE_PROGRESS,
      PERMISSIONS.TEMPLATE_VIEW,
      PERMISSIONS.SCHEDULE_MANAGE,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.WEATHER_LOG,
      PERMISSIONS.EVIDENCE_UPLOAD,
    ],
  },
  {
    id: 'project_admin',
    name: 'Admin Project',
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERPROJECT_VIEW,
      PERMISSIONS.PROJECT_VIEW,
      PERMISSIONS.PROJECT_EDIT,
      PERMISSIONS.PROJECT_MANAGE_MEMBERS,
      PERMISSIONS.WBS_VIEW,
      PERMISSIONS.WBS_EDIT_DETAIL,
      PERMISSIONS.STAGE_VIEW,
      PERMISSIONS.STAGE_REQUEST,
      PERMISSIONS.STAGE_EXECUTE,
      PERMISSIONS.INSPECTION_ROUTINE,
      PERMISSIONS.CAPA_VIEW,
      PERMISSIONS.CAPA_UPDATE_PROGRESS,
      PERMISSIONS.TEMPLATE_VIEW,
      PERMISSIONS.SCHEDULE_MANAGE,
      PERMISSIONS.REPORT_VIEW,
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.WEATHER_LOG,
      PERMISSIONS.EVIDENCE_UPLOAD,
    ],
  },
];

// Helper to log critical audit
export async function logSecurityAudit(
  actorId: string,
  actorName: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, any> = {}
) {
  const db = getDb();
  if (!db) return;
  try {
    await db.insert(auditLogs).values({
      actorId: actorId as any,
      actorName,
      action,
      entityType,
      entityId,
      metadata,
    });
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}

// -----------------------------------------------------------------------------
// Catalog Sync (Idempotent Startup)
// -----------------------------------------------------------------------------
export async function syncRbacCatalog() {
  const db = getDb();
  if (!db) return;

  // 1. Upsert permissions
  for (const p of PERMISSION_DEFINITIONS) {
    await db
      .insert(permissions)
      .values({
        id: p.id,
        module: p.module,
        description: p.description,
        scopeLevel: p.scopeLevel,
      })
      .onConflictDoUpdate({
        target: permissions.id,
        set: {
          module: p.module,
          description: p.description,
          scopeLevel: p.scopeLevel,
        },
      });
  }

  // 2. Upsert built-in roles
  for (const r of BUILTIN_ROLES) {
    await db
      .insert(roles)
      .values({
        id: r.id,
        name: r.name,
        isSystem: r.isSystem,
      })
      .onConflictDoUpdate({
        target: roles.id,
        set: {
          name: r.name,
          isSystem: r.isSystem,
          updatedAt: new Date(),
        },
      });

    // 3. Upsert role permissions
    for (const permId of r.permissions) {
      await db
        .insert(rolePermissions)
        .values({
          roleId: r.id,
          permissionId: permId,
        })
        .onConflictDoNothing();
    }
  }
}

// -----------------------------------------------------------------------------
// G.1.C: Idempotent Seeding of role_assignments from legacy users
// -----------------------------------------------------------------------------
export async function seedLegacyRoleAssignments() {
  const db = getDb();
  if (!db) return;

  // Ensure catalog exists
  await syncRbacCatalog();

  const allUsers = await db.select().from(users);
  const allProjects = await db.select().from(projects);

  for (const u of allUsers) {
    const isGlobalAdmin =
      u.role === 'Project Director & Tenant Admin' ||
      u.role === 'HSE / Quality Manager & Tenant Admin';

    if (isGlobalAdmin) {
      // 1. Organization assignment (head_office_pmo)
      await db
        .insert(roleAssignments)
        .values({
          userId: u.id,
          roleId: 'head_office_pmo',
          scopeType: 'organization',
          projectId: null,
          isActive: true,
          source: 'legacy_sync',
        })
        .onConflictDoNothing();

      // 2. Project assignments (project_manager) for ALL active projects (G.1.C / Mitigasi Opsi 2)
      for (const p of allProjects) {
        await db
          .insert(roleAssignments)
          .values({
            userId: u.id,
            roleId: 'project_manager',
            scopeType: 'project',
            projectId: p.id,
            isActive: true,
            source: 'legacy_sync',
          })
          .onConflictDoNothing();
      }
    } else {
      // Non-admin project users
      let targetRoleId = 'client_viewer';
      if (u.role === 'Project / Site Engineer' || u.role === 'Office / Integrity Engineer') {
        targetRoleId = 'site_engineer';
      } else if (u.role === 'QA/QC Lead / Owner Inspector' || u.role === 'Authorized Inspector (API 510/570) & Verifikator K3') {
        targetRoleId = 'qaqc_lead';
      } else if (u.role === 'Field / QC Inspector' || u.role === 'Field Inspector / Petugas K3') {
        targetRoleId = 'field_inspector';
      } else if (u.role === 'Action Owner / Subcontractor' || u.role === 'Action Owner / Pelaksana Perbaikan') {
        targetRoleId = 'subcontractor';
      }

      const assignedProjectIds = Array.isArray(u.assignedProjects) ? u.assignedProjects : [];
      for (const prjId of assignedProjectIds) {
        if (!prjId) continue;
        await db
          .insert(roleAssignments)
          .values({
            userId: u.id,
            roleId: targetRoleId,
            scopeType: 'project',
            projectId: prjId as any,
            isActive: true,
            source: 'legacy_sync',
          })
          .onConflictDoNothing();
      }
    }
  }
}

// -----------------------------------------------------------------------------
// G.1.D: Per-User Synchronisation of legacy role_assignments (Tahap 2a item 3)
// Transactional, idempotent. Only touches rows where source = 'legacy_sync'.
// NEVER modifies rows where source = 'manual'.
// Call after any change to users.role, users.assignedProjects, or users.isActive.
// -----------------------------------------------------------------------------
export async function syncUserLegacyAssignments(userId: string): Promise<void> {
  const db = getDb();
  if (!db || !userId) return;

  await syncRbacCatalog();

  const [u] = await db.select().from(users).where(eq(users.id, userId as any)).limit(1);
  if (!u) return;

  await db.transaction(async (tx) => {
    if (!u.isActive) {
      // Deactivate all legacy_sync rows for this user
      await tx
        .update(roleAssignments)
        .set({ isActive: false })
        .where(
          and(
            eq(roleAssignments.userId, userId as any),
            eq(roleAssignments.source as any, 'legacy_sync')
          )
        );
      return;
    }

    const isGlobalAdmin =
      u.role === 'Project Director & Tenant Admin' ||
      u.role === 'HSE / Quality Manager & Tenant Admin';

    if (isGlobalAdmin) {
      // Upsert org-scope head_office_pmo
      await tx
        .insert(roleAssignments)
        .values({
          userId: u.id,
          roleId: 'head_office_pmo',
          scopeType: 'organization',
          projectId: null,
          isActive: true,
          source: 'legacy_sync',
        } as any)
        .onConflictDoNothing();

      // Reactivate if previously deactivated
      await tx
        .update(roleAssignments)
        .set({ isActive: true })
        .where(
          and(
            eq(roleAssignments.userId, userId as any),
            eq(roleAssignments.roleId, 'head_office_pmo'),
            eq(roleAssignments.scopeType, 'organization'),
            eq(roleAssignments.source as any, 'legacy_sync')
          )
        );

      // Deactivate all project-scope legacy_sync rows (global admin covers all via org-scope)
      await tx
        .update(roleAssignments)
        .set({ isActive: false })
        .where(
          and(
            eq(roleAssignments.userId, userId as any),
            eq(roleAssignments.scopeType, 'project'),
            eq(roleAssignments.source as any, 'legacy_sync')
          )
        );
    } else {
      // Map role string -> roleId
      let targetRoleId = 'client_viewer';
      if (u.role === 'Project / Site Engineer' || u.role === 'Office / Integrity Engineer') {
        targetRoleId = 'site_engineer';
      } else if (u.role === 'QA/QC Lead / Owner Inspector' || u.role === 'Authorized Inspector (API 510/570) & Verifikator K3') {
        targetRoleId = 'qaqc_lead';
      } else if (u.role === 'Field / QC Inspector' || u.role === 'Field Inspector / Petugas K3') {
        targetRoleId = 'field_inspector';
      } else if (u.role === 'Action Owner / Subcontractor' || u.role === 'Action Owner / Pelaksana Perbaikan') {
        targetRoleId = 'subcontractor';
      }

      const currentProjectIds = new Set<string>(
        Array.isArray(u.assignedProjects) ? (u.assignedProjects as string[]).filter(Boolean) : []
      );

      // Deactivate legacy_sync rows for projects no longer in assignedProjects
      const existingRows = await tx
        .select({ id: roleAssignments.id, projectId: roleAssignments.projectId })
        .from(roleAssignments)
        .where(
          and(
            eq(roleAssignments.userId, userId as any),
            eq(roleAssignments.scopeType, 'project'),
            eq(roleAssignments.source as any, 'legacy_sync'),
            eq(roleAssignments.isActive, true)
          )
        );

      for (const row of existingRows) {
        if (!row.projectId || !currentProjectIds.has(String(row.projectId))) {
          await tx
            .update(roleAssignments)
            .set({ isActive: false })
            .where(eq(roleAssignments.id, row.id));
        }
      }

      // Upsert rows for current assigned projects
      for (const prjId of currentProjectIds) {
        await tx
          .insert(roleAssignments)
          .values({
            userId: u.id,
            roleId: targetRoleId,
            scopeType: 'project',
            projectId: prjId as any,
            isActive: true,
            source: 'legacy_sync',
          } as any)
          .onConflictDoNothing();

        // Reactivate if previously deactivated (conflict key: userId+projectId for scope=project)
        await tx
          .update(roleAssignments)
          .set({ isActive: true, roleId: targetRoleId })
          .where(
            and(
              eq(roleAssignments.userId, userId as any),
              eq(roleAssignments.projectId, prjId as any),
              eq(roleAssignments.scopeType, 'project'),
              eq(roleAssignments.source as any, 'legacy_sync')
            )
          );
      }

      // Deactivate org-scope legacy_sync rows (non-admin user shouldn't have org scope)
      await tx
        .update(roleAssignments)
        .set({ isActive: false })
        .where(
          and(
            eq(roleAssignments.userId, userId as any),
            eq(roleAssignments.scopeType, 'organization'),
            eq(roleAssignments.source as any, 'legacy_sync')
          )
        );
    }
  });
}

// -----------------------------------------------------------------------------
// Effective Permissions Resolver
// -----------------------------------------------------------------------------
export interface EffectivePermissions {
  userId: string;
  orgPermissions: Set<string>;
  projectPermissions: Set<string>;
  allProjectPermissions: Set<string>;
  allEffectivePermissions: Set<string>;
  hasOrgScope: boolean;
  hasBreakGlass: boolean;
  assignedProjectIds: Set<string>;
}

export async function resolveUserPermissions(
  userId: string,
  targetProjectId?: string | null
): Promise<EffectivePermissions> {
  const db = getDb();
  const empty: EffectivePermissions = {
    userId,
    orgPermissions: new Set(),
    projectPermissions: new Set(),
    allProjectPermissions: new Set(),
    allEffectivePermissions: new Set(),
    hasOrgScope: false,
    hasBreakGlass: false,
    assignedProjectIds: new Set(),
  };
  if (!db || !userId) return empty;

  // Query active role assignments joined with permissions
  const rows = await db
    .select({
      scopeType: roleAssignments.scopeType,
      projectId: roleAssignments.projectId,
      permissionId: rolePermissions.permissionId,
    })
    .from(roleAssignments)
    .innerJoin(rolePermissions, eq(roleAssignments.roleId, rolePermissions.roleId))
    .where(and(eq(roleAssignments.userId, userId as any), eq(roleAssignments.isActive, true)));

  const orgPerms = new Set<string>();
  const projPerms = new Set<string>();
  const allProjPerms = new Set<string>();
  const assignedProjects = new Set<string>();
  let hasOrg = false;

  for (const r of rows) {
    if (r.scopeType === 'organization') {
      hasOrg = true;
      orgPerms.add(r.permissionId);
    } else if (r.scopeType === 'project' && r.projectId) {
      assignedProjects.add(String(r.projectId));
      allProjPerms.add(r.permissionId);
      if (targetProjectId && String(r.projectId) === String(targetProjectId)) {
        projPerms.add(r.permissionId);
      }
    }
  }

  const allEffective = new Set<string>([...orgPerms, ...allProjPerms]);
  const hasBreakGlass = orgPerms.has(PERMISSIONS.SYSTEM_BREAK_GLASS);

  return {
    userId,
    orgPermissions: orgPerms,
    projectPermissions: projPerms,
    allProjectPermissions: allProjPerms,
    allEffectivePermissions: allEffective,
    hasOrgScope: hasOrg,
    hasBreakGlass,
    assignedProjectIds: assignedProjects,
  };
}

// -----------------------------------------------------------------------------
// Route Declaration & Registry
// -----------------------------------------------------------------------------
export interface RouteRegistryEntry {
  method: string;
  path: string;
  permission: string | string[];
}

export const routeRegistry: RouteRegistryEntry[] = [];

export function registerRoutePermission(method: string, path: string, permission: string | string[]) {
  routeRegistry.push({ method: method.toUpperCase(), path, permission });
}

// -----------------------------------------------------------------------------
// Middleware: requirePermission
// -----------------------------------------------------------------------------
export function requirePermission(permissionOrList: PermissionKey | PermissionKey[]) {
  const requiredKeys = Array.isArray(permissionOrList) ? permissionOrList : [permissionOrList];

  const middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    // Resolve target projectId from various route params & paths
    const fullPath = (req.baseUrl || '') + (req.path || '');
    let targetProjectId: string | null = null;

    if (req.params?.projectId) {
      targetProjectId = String(req.params.projectId);
    } else if (fullPath.includes('/projects/') && req.params?.id) {
      targetProjectId = String(req.params.id);
    } else if (req.params?.stageId) {
      targetProjectId = await getProjectIdByStageId(req.params.stageId);
    } else if ((fullPath.includes('/inspections') || req.baseUrl?.includes('inspection')) && req.params?.id) {
      targetProjectId = await getProjectIdByInspectionId(req.params.id);
    } else if ((fullPath.includes('/actions') || req.baseUrl?.includes('action')) && req.params?.id) {
      targetProjectId = await getProjectIdByActionId(req.params.id);
    } else if (req.query?.projectId) {
      targetProjectId = String(req.query.projectId);
    } else if (req.body && typeof req.body === 'object' && req.body.projectId) {
      targetProjectId = String(req.body.projectId);
    }

    const perms = await resolveUserPermissions(req.authUser.id, targetProjectId);

    // 1. Break-Glass Emergency Bypass Check (F.1.E)
    const isBreakGlassRequested = req.headers['x-break-glass'] === 'true';
    if (isBreakGlassRequested && perms.hasBreakGlass) {
      await logSecurityAudit(
        req.authUser.id,
        req.authUser.name,
        'CRITICAL_SECURITY_AUDIT',
        'system_break_glass',
        targetProjectId || 'global',
        {
          requiredPermissions: requiredKeys,
          path: req.originalUrl || req.path,
          method: req.method,
          note: 'Break-glass emergency authorization granted.',
        }
      );
      next();
      return;
    }

    // 2. Evaluate required permissions against user's effective permissions
    let isAllowed = false;

    for (const key of requiredKeys) {
      const def = PERMISSION_DEFINITIONS.find((p) => p.id === key);
      const scopeLevel = def?.scopeLevel || 'project';

      if (scopeLevel === 'organization') {
        // [ORG]: Valid cross-project if user has organization-scoped assignment with this permission
        if (perms.orgPermissions.has(key)) {
          isAllowed = true;
          break;
        }
      } else if (scopeLevel === 'project') {
        // [PRJ]: Requires explicit project assignment with this permission on targetProjectId.
        // If route has no target project context (e.g. general POST /api/uploads), check any assigned project.
        const hasProjectPerm = targetProjectId
          ? perms.projectPermissions.has(key)
          : perms.allProjectPermissions.has(key);
        if (hasProjectPerm || (perms.hasOrgScope && perms.orgPermissions.has(key))) {
          isAllowed = true;
          break;
        }
      } else if (scopeLevel === 'organization_or_project') {
        // [ORG/PRJ]: Universal read if org assignment, or project-scoped read
        const hasProjectPerm = targetProjectId
          ? perms.projectPermissions.has(key)
          : perms.allProjectPermissions.has(key);
        if (perms.orgPermissions.has(key) || hasProjectPerm) {
          isAllowed = true;
          break;
        }
      }
    }

    if (!isAllowed) {
      res.status(403).json({
        error: 'Forbidden: Insufficient permissions.',
        required: requiredKeys,
      });
      return;
    }

    next();
  };

  // Stamp metadata onto handler for route reflection / audit tests
  (middleware as any)._requiredPermission = requiredKeys;
  return middleware;
}
