import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  ChecklistTemplate,
  CorrectiveAction,
  InspectionRecord,
  Project,
} from '../types';
import {
  apiSaveAction,
  apiSubmitInspection,
  uploadEvidencePhotoDetailed,
  type UploadedEvidence,
} from './api';

export interface PendingInspectionItem {
  id: string;
  clientMutationId: string;
  record: InspectionRecord;
  failedItemsCount: number;
  createdAt: string;
}

export interface PendingPhotoItem {
  id: string;
  blob: Blob;
  filename: string;
}

export interface RejectedDraftItem {
  id: string;
  clientMutationId: string;
  record: InspectionRecord;
  failedItemsCount: number;
  createdAt: string;
  rejectedAt: string;
  rejectionReason: string;
  statusCode?: number;
}

export interface SiteLensOfflineDB extends DBSchema {
  cache: {
    key: string;
    value: {
      key: string;
      templates?: ChecklistTemplate[];
      projects?: Project[];
      updatedAt: string;
    };
  };
  pending_photos: {
    key: string;
    value: PendingPhotoItem;
  };
  pending_inspections: {
    key: string;
    value: PendingInspectionItem;
  };
  rejected_drafts: {
    key: string;
    value: RejectedDraftItem;
  };
}

export const DB_NAME = 'sitelens_offline_v1';
export const DB_VERSION = 2;
export const OFFLINE_PHOTO_PREFIX = 'offline-photo://';

export interface OfflineQueueApiHandlers {
  uploadPhoto: (blob: Blob, filename: string) => Promise<UploadedEvidence>;
  submitInspection: (record: InspectionRecord) => Promise<InspectionRecord>;
  saveAction: (action: CorrectiveAction) => Promise<CorrectiveAction>;
}

let defaultApiHandlers: OfflineQueueApiHandlers = {
  uploadPhoto: uploadEvidencePhotoDetailed,
  submitInspection: apiSubmitInspection,
  saveAction: apiSaveAction,
};

let activeApiHandlers: OfflineQueueApiHandlers = { ...defaultApiHandlers };

/**
 * Allows overriding API handlers for tests or specialized environments.
 */
export function setOfflineQueueApiHandlers(handlers: Partial<OfflineQueueApiHandlers> | null): void {
  if (!handlers) {
    activeApiHandlers = { ...defaultApiHandlers };
  } else {
    activeApiHandlers = {
      ...activeApiHandlers,
      ...handlers,
    };
  }
}

let customDbInstance: IDBPDatabase<SiteLensOfflineDB> | null = null;

/**
 * Allows injection of a custom DB instance (useful for unit tests and environments without global indexedDB).
 */
export function setCustomOfflineDb(db: IDBPDatabase<SiteLensOfflineDB> | null): void {
  customDbInstance = db;
}

export function getOfflineDb(): Promise<IDBPDatabase<SiteLensOfflineDB>> {
  if (customDbInstance) {
    return Promise.resolve(customDbInstance);
  }
  return openDB<SiteLensOfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('pending_photos')) {
        db.createObjectStore('pending_photos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pending_inspections')) {
        db.createObjectStore('pending_inspections', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('rejected_drafts')) {
        db.createObjectStore('rejected_drafts', { keyPath: 'id' });
      }
    },
  });
}

export async function cacheReferenceData(
  templates: ChecklistTemplate[],
  projects: Project[]
): Promise<void> {
  const db = await getOfflineDb();
  await db.put('cache', {
    key: 'reference',
    templates,
    projects,
    updatedAt: new Date().toISOString(),
  });
}

export async function getCachedReferenceData(): Promise<{
  templates: ChecklistTemplate[];
  projects: Project[];
}> {
  const db = await getOfflineDb();
  const item = await db.get('cache', 'reference');
  return {
    templates: item?.templates ?? [],
    projects: item?.projects ?? [],
  };
}

export async function queueOfflinePhoto(blob: Blob, filename: string): Promise<string> {
  const db = await getOfflineDb();
  const id = crypto.randomUUID();
  await db.put('pending_photos', { id, blob, filename });
  return `${OFFLINE_PHOTO_PREFIX}${id}`;
}

export async function getPendingPhotos(): Promise<PendingPhotoItem[]> {
  const db = await getOfflineDb();
  return db.getAll('pending_photos');
}

export async function queueOfflineInspection(
  record: InspectionRecord,
  failedItemsCount: number
): Promise<InspectionRecord> {
  const db = await getOfflineDb();
  const clientMutationId = record.clientMutationId || crypto.randomUUID();
  const enrichedRecord: InspectionRecord = {
    ...record,
    clientMutationId,
  };
  await db.put('pending_inspections', {
    id: enrichedRecord.id,
    clientMutationId,
    record: enrichedRecord,
    failedItemsCount,
    createdAt: new Date().toISOString(),
  });
  return enrichedRecord;
}

export async function getPendingInspections(): Promise<PendingInspectionItem[]> {
  const db = await getOfflineDb();
  return db.getAll('pending_inspections');
}

export async function getPendingSyncCount(): Promise<number> {
  const db = await getOfflineDb();
  return db.count('pending_inspections');
}

/**
 * Manages rejected / orphaned drafts (due to 401/403 permission revocation)
 */
export async function getRejectedDrafts(): Promise<RejectedDraftItem[]> {
  const db = await getOfflineDb();
  return db.getAll('rejected_drafts');
}

export async function retryRejectedDraft(id: string): Promise<boolean> {
  const db = await getOfflineDb();
  const item = await db.get('rejected_drafts', id);
  if (!item) return false;

  await db.put('pending_inspections', {
    id: item.id,
    clientMutationId: item.clientMutationId,
    record: item.record,
    failedItemsCount: item.failedItemsCount,
    createdAt: item.createdAt,
  });
  await db.delete('rejected_drafts', id);
  return true;
}

export async function deleteRejectedDraft(id: string): Promise<void> {
  const db = await getOfflineDb();
  await db.delete('rejected_drafts', id);
}

export async function exportRejectedDraftsAsJson(): Promise<string> {
  const drafts = await getRejectedDrafts();
  return JSON.stringify(drafts, null, 2);
}

/**
 * Synchronizes offline inspections and photos with the server.
 * Guarantees:
 * 1. Zero Photo Data Loss: pending photos are NEVER deleted until server submission succeeds.
 * 2. UUID v4 standard for corrective actions.
 * 3. 401/403 Isolation: drafts rejected due to revoked permissions are moved to 'rejected_drafts'
 *    without blocking subsequent items in the queue.
 */
export async function syncOfflineQueue(): Promise<{ synced: number; failed: number }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { synced: 0, failed: 0 };
  }

  const db = await getOfflineDb();
  const pending = await db.getAll('pending_inspections');
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    const uploadedPhotoIds: string[] = [];

    try {
      const urlMap = new Map<string, string>();
      const integrityMap = new Map<string, UploadedEvidence['integrity']>();
      const updatedAnswers = { ...item.record.answers };
      const updatedPhotos = [...item.record.evidencePhotos];

      // 1. Upload any queued offline photos referenced by this inspection
      for (let i = 0; i < updatedPhotos.length; i++) {
        const photo = updatedPhotos[i];
        if (photo.url.startsWith(OFFLINE_PHOTO_PREFIX)) {
          const photoId = photo.url.slice(OFFLINE_PHOTO_PREFIX.length);
          let uploadedUrl = urlMap.get(photoId);
          if (!uploadedUrl) {
            const stored = await db.get('pending_photos', photoId);
            if (stored) {
              const uploaded = await activeApiHandlers.uploadPhoto(stored.blob, stored.filename);
              uploadedUrl = uploaded.url;
              urlMap.set(photoId, uploadedUrl);
              integrityMap.set(photoId, uploaded.integrity);
              uploadedPhotoIds.push(photoId); // Record ID for deferred deletion upon successful submit
            }
          }
          if (uploadedUrl) {
            const integrity = integrityMap.get(photoId);
            updatedPhotos[i] = {
              ...photo,
              url: uploadedUrl,
              ...(integrity
                ? {
                    sha256: integrity.sha256,
                    sizeBytes: integrity.size,
                    integrityVersion: 1,
                    gps: integrity.gps,
                    gpsSource: integrity.gpsSource,
                    capturedAt: integrity.capturedAt,
                    capturedAtSource: integrity.capturedAtSource,
                  }
                : {}),
            };
          }
        }
      }

      for (const [k, v] of Object.entries(updatedAnswers)) {
        if (typeof v === 'string' && v.startsWith(OFFLINE_PHOTO_PREFIX)) {
          const photoId = v.slice(OFFLINE_PHOTO_PREFIX.length);
          const mapped = urlMap.get(photoId);
          if (mapped) {
            updatedAnswers[k] = mapped;
          }
        }
      }

      const payload: InspectionRecord = {
        ...item.record,
        clientMutationId: item.clientMutationId,
        answers: updatedAnswers,
        evidencePhotos: updatedPhotos,
      };

      const savedRecord = await activeApiHandlers.submitInspection(payload);

      if (item.failedItemsCount > 0) {
        const newAction: CorrectiveAction = {
          id: crypto.randomUUID(), // Standard UUID v4
          inspectionId: savedRecord.id,
          inspectionTitle: savedRecord.templateTitle,
          projectId: savedRecord.projectId,
          projectName: savedRecord.projectName,
          siteZone: savedRecord.siteZone,
          fieldLabel: `Non-conformance flagged in ${savedRecord.templateTitle}`,
          issueDescription:
            savedRecord.notes ||
            `${item.failedItemsCount} checkpoint(s) marked as FAIL during offline field inspection.`,
          severity: item.failedItemsCount >= 3 ? 'critical' : 'high',
          assignedToName: 'Assigned Site Trade Lead',
          assignedToRole: 'Subcontractor Foreman',
          dueDate: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0],
          status: 'OPEN',
          createdAt: new Date().toISOString(),
          evidencePhotoUrl: savedRecord.evidencePhotos[0]?.url,
        };
        await activeApiHandlers.saveAction(newAction);
      }

      // 2. Submission succeeded 100%: now safe to delete uploaded photos from pending_photos
      for (const photoId of uploadedPhotoIds) {
        await db.delete('pending_photos', photoId);
      }

      await db.delete('pending_inspections', item.id);
      synced += 1;
    } catch (err: any) {
      const statusCode =
        err?.status ??
        err?.statusCode ??
        err?.response?.status ??
        (err?.message?.includes('401') ? 401 : err?.message?.includes('403') ? 403 : undefined);

      const isAuthError =
        statusCode === 401 ||
        statusCode === 403 ||
        /401|403|unauthorized|forbidden/i.test(err?.message || '');

      if (isAuthError) {
        console.warn(
          `[offlineQueue] Inspection ${item.id} rejected with auth error (${statusCode}). Isolating to rejected_drafts.`
        );
        const rejectedItem: RejectedDraftItem = {
          id: item.id,
          clientMutationId: item.clientMutationId,
          record: item.record,
          failedItemsCount: item.failedItemsCount,
          createdAt: item.createdAt,
          rejectedAt: new Date().toISOString(),
          rejectionReason:
            err?.message ||
            (statusCode === 403 ? 'Forbidden: Permission revoked' : 'Unauthorized: Session expired'),
          statusCode: statusCode,
        };
        await db.put('rejected_drafts', rejectedItem);
        await db.delete('pending_inspections', item.id);
      } else {
        console.error('Failed to sync offline inspection:', item.id, err);
      }

      failed += 1;
    }
  }

  return { synced, failed };
}
