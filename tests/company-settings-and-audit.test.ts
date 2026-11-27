import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { ensureTestDatabaseSchema, TEST_DATABASE_URL } from './helpers/setup-test-db.ts';

process.env.DATABASE_URL = TEST_DATABASE_URL;

import { getDb, closeDb } from '../src/server/db/index.ts';
import { attachSessionUser } from '../src/server/auth/middleware.ts';
import { apiRouter } from '../src/server/routes/api.ts';
import { companySettings } from '../src/server/db/schema.ts';
import { eq } from 'drizzle-orm';
import { seedMatrixDatabase } from './fixtures/stage2a-db-seed.ts';
import { ROLE_USER_MAP } from './fixtures/stage2a-matrix-fixtures.ts';

function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser);
  app.use('/api', apiRouter);
  return app;
}

test('Company Settings & SQL Audit Search Tests', async (t) => {
  await ensureTestDatabaseSchema();
  await seedMatrixDatabase();
  const db = getDb();
  assert.ok(db, 'DB must be ready');

  const app = createTestApp();
  const agent = supertest(app);

  const adminToken = ROLE_USER_MAP.head_office_pmo.token;
  const viewerToken = ROLE_USER_MAP.client_viewer.token;

  await t.test('1. GET /api/company-settings returns 200 with default settings for authenticated users', async () => {
    const res = await agent
      .get('/api/company-settings')
      .set('Cookie', `sitelens_session=${viewerToken}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.settings, 'Settings object should exist');
    assert.ok(res.body.settings.companyName, 'companyName should be populated');
  });

  await t.test('2. PUT /api/company-settings is rejected for unauthenticated request', async () => {
    const res = await agent.put('/api/company-settings').send({ companyName: 'Hacked Name' });
    assert.strictEqual(res.status, 401);
  });

  await t.test('3. PUT /api/company-settings is rejected for unauthorized viewer role', async () => {
    const res = await agent
      .put('/api/company-settings')
      .set('Cookie', `sitelens_session=${viewerToken}`)
      .send({ companyName: 'Unauthorized Update' });
    assert.strictEqual(res.status, 403);
  });

  await t.test('4. PUT /api/company-settings persists valid updates for tenant admin', async () => {
    const res = await agent
      .put('/api/company-settings')
      .set('Cookie', `sitelens_session=${adminToken}`)
      .send({
        companyName: 'PT ADHI TEST PERSISTED TBK',
        companyAddress: 'Jl. Sudirman No. 99, Jakarta',
        letterheadHeader: 'KONTRAKTOR UTAMA RESMI',
        documentRegistrationNo: 'DOC-TEST-001',
      });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.settings.companyName, 'PT ADHI TEST PERSISTED TBK');

    // Verify GET reflects the update
    const getRes = await agent
      .get('/api/company-settings')
      .set('Cookie', `sitelens_session=${adminToken}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.settings.companyName, 'PT ADHI TEST PERSISTED TBK');
    assert.strictEqual(getRes.body.settings.documentRegistrationNo, 'DOC-TEST-001');
  });

  await t.test('5. GET /api/audit-logs filters in SQL with total count and search query', async () => {
    // We updated company settings in test 4, which logged 'UPDATE_COMPANY_SETTINGS'
    const res = await agent
      .get('/api/audit-logs?search=UPDATE_COMPANY_SETTINGS')
      .set('Cookie', `sitelens_session=${adminToken}`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.auditLogs), 'auditLogs must be array');
    assert.ok(res.body.total >= 1, 'Total matching count must be at least 1');
    assert.ok(
      res.body.auditLogs.some((l: any) => l.action === 'UPDATE_COMPANY_SETTINGS'),
      'Should contain UPDATE_COMPANY_SETTINGS log'
    );
  });

  // Clean up
  await db.delete(companySettings).where(eq(companySettings.id, 'default')).catch(() => {});
  await closeDb();
});
