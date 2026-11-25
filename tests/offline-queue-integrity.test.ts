import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setCustomOfflineDb,
  setOfflineQueueApiHandlers,
  queueOfflinePhoto,
  queueOfflineInspection,
  syncOfflineQueue,
  getRejectedDrafts,
  retryRejectedDraft,
  deleteRejectedDraft,
  exportRejectedDraftsAsJson,
  OFFLINE_PHOTO_PREFIX,
} from '../src/services/offlineQueue';
import {
  setCustomAuthOfflineDb,
  savePermissionSnapshot,
  getCachedPermissionSnapshot,
  isSnapshotValid,
  canOffline,
  clearPermissionSnapshot,
  SNAPSHOT_TTL_MS,
} from '../src/services/authOffline';
import {
  setCustomWbsOfflineDb,
  saveOfflineWbsAttempt,
  getOfflineWbsAttempts,
  saveOfflineStageDraft,
  getOfflineStageDraft,
  deleteOfflineStageDraft,
  clearAllOfflineWbsData,
} from '../src/services/wbsOfflineStore';
import type { InspectionRecord, CorrectiveAction, InspectionAttempt } from '../src/types';

function createMockIdb(storeNames: string[]) {
  const storage: Record<string, Map<string, any>> = {};
  for (const name of storeNames) {
    storage[name] = new Map();
  }

  return {
    _storage: storage,
    get: async (store: string, key: string) => {
      const val = storage[store]?.get(key);
      return val ? JSON.parse(JSON.stringify(val)) : undefined;
    },
    put: async (store: string, val: any) => {
      const key = val.id ?? val.key ?? val.userId ?? val.stageId;
      storage[store]?.set(key, JSON.parse(JSON.stringify(val)));
      return key;
    },
    delete: async (store: string, key: string) => {
      storage[store]?.delete(key);
    },
    getAll: async (store: string) => {
      return Array.from(storage[store]?.values() ?? []).map((v) => JSON.parse(JSON.stringify(v)));
    },
    count: async (store: string) => {
      return storage[store]?.size ?? 0;
    },
    clear: async (store: string) => {
      storage[store]?.clear();
    },
    getAllFromIndex: async (store: string, _indexName: string, queryKey: string) => {
      const all = Array.from(storage[store]?.values() ?? []);
      return all
        .filter((v: any) => v.stageId === queryKey || v.projectId === queryKey)
        .map((v) => JSON.parse(JSON.stringify(v)));
    },
  } as any;
}

function createMockInspection(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    id: overrides.id || crypto.randomUUID(),
    templateId: overrides.templateId || 'tmpl-qc-1',
    templateTitle: overrides.templateTitle || 'Pier Quality Check',
    category: 'Civil & Structural',
    projectId: overrides.projectId || 'proj-offline-1',
    projectName: overrides.projectName || 'Tol Trans Sumatera',
    siteZone: overrides.siteZone || 'Pier 14',
    inspectorId: 'usr-eng-1',
    inspectorName: overrides.inspectorName || 'Budi Inspector',
    inspectorRole: 'Project / Site Engineer',
    status: 'submitted',
    scorePercent: 100,
    passedCount: 5,
    failedCount: 0,
    nonApplicableCount: 0,
    answers: overrides.answers || {},
    evidencePhotos: overrides.evidencePhotos || [],
    notes: overrides.notes || '',
    createdAt: overrides.createdAt || new Date().toISOString(),
    ...overrides,
  };
}

describe('Tahap 4: Penguatan PWA Offline, Zero Photo Loss & Otorisasi Offline', () => {
  let offlineDbMock: any;
  let authDbMock: any;
  let wbsDbMock: any;

  beforeEach(() => {
    offlineDbMock = createMockIdb([
      'cache',
      'pending_photos',
      'pending_inspections',
      'rejected_drafts',
    ]);
    setCustomOfflineDb(offlineDbMock);
    setOfflineQueueApiHandlers(null); // Reset API handlers

    authDbMock = createMockIdb(['cached_permissions']);
    setCustomAuthOfflineDb(authDbMock);

    wbsDbMock = createMockIdb(['wbs_attempts', 'wbs_drafts']);
    setCustomWbsOfflineDb(wbsDbMock);
  });

  describe('1. Zero Photo Data Loss & Deferred Deletion', () => {
    test('Foto lokal TIDAK dihapus jika submission inspeksi ke server gagal (network error / 500)', async () => {
      const fakeBlob = new Blob(['sample-photo-data'], { type: 'image/jpeg' });
      const photoUri = await queueOfflinePhoto(fakeBlob, 'pier14-crack.jpg');
      const photoId = photoUri.replace(OFFLINE_PHOTO_PREFIX, '');

      assert.equal(offlineDbMock._storage.pending_photos.has(photoId), true);

      const inspection = createMockInspection({
        id: 'insp-fail-sim-1',
        answers: { checkpoint_photo: photoUri },
        evidencePhotos: [
          {
            fieldId: 'checkpoint_photo',
            url: photoUri,
            caption: 'Retak Rambut',
            timestamp: '2026-11-25',
          },
        ],
      });

      await queueOfflineInspection(inspection, 0);
      assert.equal(offlineDbMock._storage.pending_inspections.has('insp-fail-sim-1'), true);

      // Mock upload photo succeeds, but submit inspection fails
      setOfflineQueueApiHandlers({
        uploadPhoto: async () =>
          ({
            url: 'https://cdn.sitelens.internal/photos/uploaded-pier14.jpg',
            filename: 'pier14-crack.jpg',
            size: 1024,
            sha256: 'abcdef1234567890',
            integrityVersion: 1,
            integrity: {
              verified: true,
              sha256: 'abcdef1234567890',
              size: 1024,
              mimeType: 'image/jpeg',
              uploadedAt: new Date().toISOString(),
            },
          }) as any,
        submitInspection: async () => {
          throw new Error('500 Internal Server Error: Database connection lost during transaction');
        },
      });

      const result = await syncOfflineQueue();
      assert.equal(result.synced, 0);
      assert.equal(result.failed, 1);

      // CRITICAL INVARIANT: The local photo MUST STILL EXIST in pending_photos!
      assert.equal(
        offlineDbMock._storage.pending_photos.has(photoId),
        true,
        'Pending photo must NOT be deleted when inspection submission fails'
      );
      // Inspection record must still be in pending_inspections
      assert.equal(offlineDbMock._storage.pending_inspections.has('insp-fail-sim-1'), true);
    });

    test('Foto lokal dan draft inspeksi dibersihkan HANYA setelah submission berhasil 100%', async () => {
      const fakeBlob = new Blob(['sample-photo-data-2'], { type: 'image/jpeg' });
      const photoUri = await queueOfflinePhoto(fakeBlob, 'rebar-spacing.jpg');
      const photoId = photoUri.replace(OFFLINE_PHOTO_PREFIX, '');

      const inspection = createMockInspection({
        id: 'insp-success-1',
        siteZone: 'Pier 15',
        answers: { p1: photoUri },
        evidencePhotos: [
          {
            fieldId: 'p1',
            url: photoUri,
            caption: 'Jarak Tulangan',
            timestamp: '2026-11-25',
          },
        ],
      });

      await queueOfflineInspection(inspection, 0);

      let submittedPayload: any = null;
      setOfflineQueueApiHandlers({
        uploadPhoto: async () =>
          ({
            url: 'https://cdn.sitelens.internal/photos/uploaded-rebar.jpg',
            filename: 'rebar-spacing.jpg',
            size: 2048,
            sha256: '9988776655443322',
            integrityVersion: 1,
            integrity: {
              verified: true,
              sha256: '9988776655443322',
              size: 2048,
              mimeType: 'image/jpeg',
              uploadedAt: new Date().toISOString(),
            },
          }) as any,
        submitInspection: async (payload: InspectionRecord) => {
          submittedPayload = payload;
          return { ...payload, id: 'insp-saved-server-1' };
        },
      });

      const result = await syncOfflineQueue();
      assert.equal(result.synced, 1);
      assert.equal(result.failed, 0);

      // Inspection submitted with replaced uploaded URL
      assert.equal(
        submittedPayload?.evidencePhotos[0]?.url,
        'https://cdn.sitelens.internal/photos/uploaded-rebar.jpg'
      );

      // Cleared from pending_photos and pending_inspections
      assert.equal(offlineDbMock._storage.pending_photos.has(photoId), false);
      assert.equal(offlineDbMock._storage.pending_inspections.has('insp-success-1'), false);
    });
  });

  describe('2. Standardisasi UUID v4 untuk ID Corrective Action', () => {
    test('Corrective Action offline yang dibuat saat ada checkpoint fail memiliki format UUID v4 valid', async () => {
      const inspection = createMockInspection({
        id: 'insp-with-defects',
        notes: 'Ditemukan keropos beton',
      });

      await queueOfflineInspection(inspection, 2);

      let savedAction: CorrectiveAction | null = null;
      setOfflineQueueApiHandlers({
        submitInspection: async (p: InspectionRecord) => p,
        saveAction: async (action: CorrectiveAction) => {
          savedAction = action;
          return action;
        },
      });

      const result = await syncOfflineQueue();
      assert.equal(result.synced, 1);
      assert.notEqual(savedAction, null);

      // Validate UUID v4 format
      const uuidV4Regex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assert.match(
        savedAction!.id,
        uuidV4Regex,
        `Action ID "${savedAction!.id}" must strictly match standard UUID v4 format`
      );
      // Ensure old legacy pattern act-${Math.random()} is gone
      assert.equal(savedAction!.id.startsWith('act-'), false);
    });
  });

  describe('3. Isolasi Draf Yatim / Rejected Drafts pada Error 401/403', () => {
    test('Draf yang ditolak 403 (hak akses dicabut saat offline) diisolasi ke rejected_drafts tanpa memacetkan queue', async () => {
      const revokedInspection = createMockInspection({
        id: 'insp-revoked-user',
        templateTitle: 'Inspection by Revoked User',
        projectId: 'proj-locked',
        inspectorName: 'Ex-Employee',
        notes: 'Submitted while permissions were being revoked',
      });

      const validInspection = createMockInspection({
        id: 'insp-valid-subsequent',
        templateTitle: 'Valid Inspection',
        projectId: 'proj-active',
        inspectorName: 'Active User',
        notes: 'Should succeed',
      });

      await queueOfflineInspection(revokedInspection, 0);
      await queueOfflineInspection(validInspection, 0);

      setOfflineQueueApiHandlers({
        submitInspection: async (p: InspectionRecord) => {
          if (p.id === 'insp-revoked-user') {
            const err: any = new Error('Forbidden: User does not hold stage.request permission');
            err.statusCode = 403;
            throw err;
          }
          return p;
        },
      });

      const syncResult = await syncOfflineQueue();
      assert.equal(syncResult.synced, 1);
      assert.equal(syncResult.failed, 1);

      // 1. The rejected item is NO LONGER blocking pending_inspections
      assert.equal(offlineDbMock._storage.pending_inspections.has('insp-revoked-user'), false);
      assert.equal(offlineDbMock._storage.pending_inspections.has('insp-valid-subsequent'), false);

      // 2. The rejected item is safely isolated into rejected_drafts
      const rejectedDrafts = await getRejectedDrafts();
      assert.equal(rejectedDrafts.length, 1);
      assert.equal(rejectedDrafts[0].id, 'insp-revoked-user');
      assert.equal(rejectedDrafts[0].statusCode, 403);
      assert.match(rejectedDrafts[0].rejectionReason, /Forbidden/);

      // 3. Export JSON works for field recovery
      const jsonExport = await exportRejectedDraftsAsJson();
      assert.match(jsonExport, /insp-revoked-user/);

      // 4. Retry moves item back to pending queue
      const retried = await retryRejectedDraft('insp-revoked-user');
      assert.equal(retried, true);
      assert.equal(offlineDbMock._storage.pending_inspections.has('insp-revoked-user'), true);
      assert.equal((await getRejectedDrafts()).length, 0);

      // 5. Delete rejected draft works
      await queueOfflineInspection(revokedInspection, 0);
      // Force reject again
      await syncOfflineQueue();
      assert.equal((await getRejectedDrafts()).length, 1);
      await deleteRejectedDraft('insp-revoked-user');
      assert.equal((await getRejectedDrafts()).length, 0);
    });
  });

  describe('4. Auth Offline Snapshot & 24-Jam TTL Enforcement', () => {
    test('Snapshot permission disimpan di IndexedDB dengan TTL 24 jam dan divalidasi fail-closed', async () => {
      const userId = 'usr-site-engineer-1';
      const globalPerms = ['wbs.view'];
      const projectPerms = {
        'proj-sumatera': ['stage.request', 'wbs.edit_detail'],
      };

      const now = Date.now();
      const snapshot = await savePermissionSnapshot(userId, globalPerms, projectPerms);

      assert.equal(snapshot.userId, userId);
      assert.deepEqual(snapshot.globalPermissions, ['wbs.view']);
      assert.deepEqual(snapshot.projectPermissions['proj-sumatera'], [
        'stage.request',
        'wbs.edit_detail',
      ]);

      const cached = await getCachedPermissionSnapshot(userId);
      assert.notEqual(cached, null);
      assert.equal(cached?.userId, userId);

      // Within 24-hour window: valid!
      assert.equal(isSnapshotValid(cached, now), true);
      assert.equal(isSnapshotValid(cached, now + 12 * 3600 * 1000), true);

      // Evaluasi canOffline
      assert.equal(await canOffline(userId, 'wbs.view', undefined, now), true);
      assert.equal(await canOffline(userId, 'stage.request', 'proj-sumatera', now), true);
      assert.equal(await canOffline(userId, 'stage.approve', 'proj-sumatera', now), false);

      // EXPIRED: exactly past 24 hours (24h + 1ms)
      const expiredTime = now + SNAPSHOT_TTL_MS + 1;
      assert.equal(
        isSnapshotValid(cached, expiredTime),
        false,
        'Snapshot must expire after 24 hours'
      );

      // Fail-closed: once expired, canOffline returns FALSE for all permissions
      assert.equal(
        await canOffline(userId, 'wbs.view', undefined, expiredTime),
        false,
        'Fail-closed: expired snapshot must deny global permission'
      );
      assert.equal(
        await canOffline(userId, 'stage.request', 'proj-sumatera', expiredTime),
        false,
        'Fail-closed: expired snapshot must deny project permission'
      );

      // Clear permission snapshot
      await clearPermissionSnapshot(userId);
      assert.equal(await getCachedPermissionSnapshot(userId), null);
      assert.equal(await canOffline(userId, 'wbs.view', undefined, now), false);
    });
  });

  describe('5. WBS Offline Store Persistensi Attempts & Drafts', () => {
    test('WBS attempt dan stage draft tersimpan di IndexedDB dan bertahan lintas reload', async () => {
      const attempt: InspectionAttempt = {
        id: 'att-offline-101',
        stageId: 'stg-pier14-rebar',
        attemptNumber: 1,
        submitterId: 'usr-eng-1',
        submittedAt: new Date().toISOString(),
        status: 'submitted',
        answers: { bar_diameter: 'D25', spacing_mm: 150 },
        signatureCanvasUrl: 'data:image/png;base64,canvas-sig-1',
        createdAt: new Date().toISOString(),
      };

      // 1. Save and retrieve attempt
      await saveOfflineWbsAttempt(attempt, 'proj-1');
      const retrieved = await getOfflineWbsAttempts('stg-pier14-rebar');
      assert.equal(retrieved.length, 1);
      assert.equal(retrieved[0].id, 'att-offline-101');
      assert.equal(retrieved[0].answers?.bar_diameter, 'D25');

      // 2. Save and retrieve draft
      await saveOfflineStageDraft({
        stageId: 'stg-pier14-rebar',
        projectId: 'proj-1',
        answers: { partial_check: true },
        signatureCanvasUrl: 'data:image/png;base64,draft-sig',
        notes: 'Form draft inspection in progress',
        updatedAt: new Date().toISOString(),
      });

      const draft = await getOfflineStageDraft('stg-pier14-rebar');
      assert.notEqual(draft, null);
      assert.equal(draft?.answers?.partial_check, true);
      assert.equal(draft?.notes, 'Form draft inspection in progress');

      // 3. Delete draft on final submission
      await deleteOfflineStageDraft('stg-pier14-rebar');
      assert.equal(await getOfflineStageDraft('stg-pier14-rebar'), null);

      // 4. Clear all WBS offline data
      await clearAllOfflineWbsData();
      assert.equal((await getOfflineWbsAttempts()).length, 0);
    });
  });
});
