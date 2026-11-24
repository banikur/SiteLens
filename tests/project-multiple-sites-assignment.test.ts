import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { getDb, closeDb } from '../src/server/db/index.ts';
import {
  users,
  sessions,
  projects,
  roles,
  roleAssignments,
  permissions,
  auditLogs,
  inspectionAttempts,
  evidenceAttachments,
  workStages,
  workWorkflows,
  workNodes,
  inspections,
  correctiveActions,
} from '../src/server/db/schema.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { hashSessionToken, hashSecret } from '../src/server/auth/crypto.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { authRouter } from '../src/server/routes/auth.ts';
import { syncRbacCatalog } from '../src/server/auth/rbac.ts';
import type { ProjectSite } from '../src/types/index.ts';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser);
  app.use('/api/auth', authRouter);
  app.use('/api', apiRouter);
  return app;
}

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const ENGINEER_ID = '88888888-8888-4888-8888-888888888888';
const QC_LEAD_ID = '77777777-7777-4777-8777-777777777777';

const ADMIN_TOKEN = 'session-admin-multiple-sites-token-123456789012';

let server: http.Server;
let baseUrl: string;

test('Multiple Sites with Leaflet & Merged Employee Assignment', async (t) => {
  await ensureTestDatabaseSchema();
  const db = getDb();
  if (!db) throw new Error('Database not connected');

  await syncRbacCatalog();

  // Clean data in reverse foreign key order
  await db.delete(auditLogs);
  await db.delete(roleAssignments);
  await db.delete(sessions);
  await db.delete(evidenceAttachments);
  await db.delete(inspectionAttempts);
  await db.delete(workStages);
  await db.delete(workWorkflows);
  await db.delete(workNodes);
  await db.delete(correctiveActions);
  await db.delete(inspections);
  await db.delete(users);
  await db.delete(projects);

  // Insert test users
  const pwd = await hashSecret('Password123!');
  await db.insert(users).values([
    {
      id: ADMIN_ID,
      username: 'admin_sites',
      name: 'Admin Multi Site',
      email: 'admin_sites@sitelens.id',
      passwordHash: pwd,
      role: 'Project Director & Tenant Admin',
      title: 'Project Director',
    },
    {
      id: ENGINEER_ID,
      username: 'se_sites',
      name: 'Site Engineer Dave',
      email: 'se_sites@sitelens.id',
      passwordHash: pwd,
      role: 'Project / Site Engineer',
      title: 'Site Engineer',
    },
    {
      id: QC_LEAD_ID,
      username: 'qc_sites',
      name: 'Elena Rostova',
      email: 'qc_sites@sitelens.id',
      passwordHash: pwd,
      role: 'QA/QC Lead / Owner Inspector',
      title: 'QA/QC Lead',
    },
  ]);

  // Admin session
  const adminTokenHash = hashSessionToken(ADMIN_TOKEN);
  await db.insert(sessions).values({
    id: adminTokenHash,
    userId: ADMIN_ID,
    expiresAt: new Date(Date.now() + 86400000),
  });

  // Assign admin global tenant role
  await db.insert(roleAssignments).values({
    userId: ADMIN_ID,
    roleId: 'head_office_pmo',
    scopeType: 'organization',
    isActive: true,
  });

  const app = createTestApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  t.after(async () => {
    server.close();
    await closeDb();
  });

  let createdProjectId = '';

  await t.test('1. POST /api/projects creates project with multiple sites and atomic team assignments', async () => {
    const testSites: ProjectSite[] = [
      {
        id: 'site-1',
        name: 'Sector 4 Wharf & Staging Yard',
        code: 'SIT-01',
        latitude: -1.265386,
        longitude: 116.8312,
        isPrimary: true,
        radiusMeters: 250,
        address: 'Jl. Minyak No. 1, Pelabuhan Semayang, Balikpapan',
      },
      {
        id: 'site-2',
        name: 'IKN Access Toll KM 38',
        code: 'SIT-02',
        latitude: -0.970035,
        longitude: 116.707758,
        isPrimary: false,
        radiusMeters: 500,
        address: 'Samboja - IKN Toll Corridor',
      },
    ];

    const teamMembers = [
      { userId: ENGINEER_ID, roleId: 'site_engineer' },
      { userId: QC_LEAD_ID, roleId: 'qaqc_lead' },
    ];

    const res = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `sitelens_session=${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({
        name: 'Trans-Kalimantan Highway Extension',
        code: 'TKH-01',
        client: 'BBPJN Kalimantan Timur',
        sites: testSites,
        teamMembers,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.project);
    assert.equal(body.project.name, 'Trans-Kalimantan Highway Extension');
    assert.equal(body.project.code, 'TKH-01');
    assert.equal(body.project.location, 'Sector 4 Wharf & Staging Yard'); // derived from primary site
    assert.equal(body.project.sites.length, 2);
    assert.equal(body.project.sites[0].id, 'site-1');
    assert.equal(body.project.sites[1].id, 'site-2');

    createdProjectId = body.project.id;

    // Verify team members were atomically assigned in database
    const membersRes = await fetch(`${baseUrl}/api/projects/${createdProjectId}/members`, {
      headers: { Cookie: `sitelens_session=${ADMIN_TOKEN}` },
    });
    assert.equal(membersRes.status, 200);
    const membersData = await membersRes.json();
    assert.ok(Array.isArray(membersData.members));

    const engineerAssignment = membersData.members.find((m: any) => m.userId === ENGINEER_ID);
    assert.ok(engineerAssignment);
    assert.equal(engineerAssignment.roleId, 'site_engineer');

    const qcAssignment = membersData.members.find((m: any) => m.userId === QC_LEAD_ID);
    assert.ok(qcAssignment);
    assert.equal(qcAssignment.roleId, 'qaqc_lead');
  });

  await t.test('2. PUT /api/projects/:projectId updates multiple sites and adjusts team roles', async () => {
    const updatedSites: ProjectSite[] = [
      {
        id: 'site-1',
        name: 'Sector 4 Wharf & Staging Yard (Updated)',
        code: 'SIT-01',
        latitude: -1.265386,
        longitude: 116.8312,
        isPrimary: false,
        radiusMeters: 300,
      },
      {
        id: 'site-2',
        name: 'IKN Access Toll KM 38 (Now Primary)',
        code: 'SIT-02',
        latitude: -0.970035,
        longitude: 116.707758,
        isPrimary: true,
        radiusMeters: 600,
      },
      {
        id: 'site-3',
        name: 'Kariangau Precast Facility',
        code: 'SIT-03',
        latitude: -1.189,
        longitude: 116.804,
        isPrimary: false,
        radiusMeters: 400,
      },
    ];

    // Promote Dave from site_engineer to project_manager
    const updatedTeamMembers = [
      { userId: ENGINEER_ID, roleId: 'project_manager' },
    ];

    const res = await fetch(`${baseUrl}/api/projects/${createdProjectId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `sitelens_session=${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({
        sites: updatedSites,
        teamMembers: updatedTeamMembers,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.project.sites.length, 3);
    assert.equal(body.project.location, 'IKN Access Toll KM 38 (Now Primary)'); // auto-derived

    // Verify updated member role
    const membersRes = await fetch(`${baseUrl}/api/projects/${createdProjectId}/members`, {
      headers: { Cookie: `sitelens_session=${ADMIN_TOKEN}` },
    });
    const membersData = await membersRes.json();
    const updatedEngineer = membersData.members.find((m: any) => m.userId === ENGINEER_ID);
    assert.ok(updatedEngineer);
    assert.equal(updatedEngineer.roleId, 'project_manager');
  });
});
