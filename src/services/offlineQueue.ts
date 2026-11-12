import { openDB, type DBSchema } from 'idb';
import type {
  ChecklistTemplate,
  CorrectiveAction,
  InspectionRecord,
  Project,
} from '../types';
import { apiSaveAction, apiSubmitInspection, uploadEvidencePhoto } from './api';

interface PendingInspectionItem {
  id: string;
  clientMutationId: string;
  record: InspectionRecord;
  failedItemsCount: number;
  createdAt: string;
}

interface PendingPhotoItem {
  id: string;
  blob: Blob;
  filename: string;
}

interface SiteLensOfflineDB extends DBSchema {
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
}

const DB_NAME = 'sitelens_offline_v1';
const OFFLINE_PHOTO_PREFIX = 'offline-photo://';

function getOfflineDb() {
  return openDB<SiteLensOfflineDB>(DB_NAME, 1, {
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

export async function getPendingSyncCount(): Promise<number> {
  const db = await getOfflineDb();
  return db.count('pending_inspections');
}

export async function syncOfflineQueue(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  const db = await getOfflineDb();
  const pending = await db.getAll('pending_inspections');
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const urlMap = new Map<string, string>();
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
              uploadedUrl = await uploadEvidencePhoto(stored.blob, stored.filename);
              urlMap.set(photoId, uploadedUrl);
              await db.delete('pending_photos', photoId);
            }
          }
          if (uploadedUrl) {
            updatedPhotos[i] = { ...photo, url: uploadedUrl };
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

      const savedRecord = await apiSubmitInspection(payload);

      if (item.failedItemsCount > 0) {
        const newAction: CorrectiveAction = {
          id: `act-${Math.floor(100 + Math.random() * 900)}`,
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
          status: 'open',
          createdAt: new Date().toISOString(),
          evidencePhotoUrl: savedRecord.evidencePhotos[0]?.url,
        };
        await apiSaveAction(newAction);
      }

      await db.delete('pending_inspections', item.id);
      synced += 1;
    } catch (err) {
      console.error('Failed to sync offline inspection:', item.id, err);
      failed += 1;
    }
  }

  return { synced, failed };
}

