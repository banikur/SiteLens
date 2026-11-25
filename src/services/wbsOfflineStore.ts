import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { InspectionAttempt } from '../types';

export interface OfflineWbsAttemptItem {
  id: string;
  stageId: string;
  projectId?: string;
  attempt: InspectionAttempt;
  savedAt: string;
  synced: boolean;
}

export interface OfflineStageDraftItem {
  stageId: string;
  projectId?: string;
  answers: Record<string, any>;
  signatureCanvasUrl?: string | null;
  wetSignatureDocumentUrl?: string | null;
  notes?: string;
  updatedAt: string;
}

export interface SiteLensWbsOfflineDB extends DBSchema {
  wbs_attempts: {
    key: string;
    value: OfflineWbsAttemptItem;
    indexes: { 'by-stage': string; 'by-project': string };
  };
  wbs_drafts: {
    key: string;
    value: OfflineStageDraftItem;
    indexes: { 'by-project': string };
  };
}

export const WBS_OFFLINE_DB_NAME = 'sitelens_wbs_offline_v1';
export const WBS_OFFLINE_DB_VERSION = 1;

let customWbsDbInstance: IDBPDatabase<SiteLensWbsOfflineDB> | null = null;

/**
 * Allows injection of a custom DB instance (useful for unit tests and environments without global indexedDB).
 */
export function setCustomWbsOfflineDb(db: IDBPDatabase<SiteLensWbsOfflineDB> | null): void {
  customWbsDbInstance = db;
}

export function getWbsOfflineDb(): Promise<IDBPDatabase<SiteLensWbsOfflineDB>> {
  if (customWbsDbInstance) {
    return Promise.resolve(customWbsDbInstance);
  }
  return openDB<SiteLensWbsOfflineDB>(WBS_OFFLINE_DB_NAME, WBS_OFFLINE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('wbs_attempts')) {
        const attemptStore = db.createObjectStore('wbs_attempts', { keyPath: 'id' });
        attemptStore.createIndex('by-stage', 'stageId');
        attemptStore.createIndex('by-project', 'projectId');
      }
      if (!db.objectStoreNames.contains('wbs_drafts')) {
        const draftStore = db.createObjectStore('wbs_drafts', { keyPath: 'stageId' });
        draftStore.createIndex('by-project', 'projectId');
      }
    },
  });
}

/**
 * Persists an offline WBS attempt into IndexedDB.
 */
export async function saveOfflineWbsAttempt(
  attempt: InspectionAttempt,
  projectId?: string,
  synced = false
): Promise<void> {
  const db = await getWbsOfflineDb();
  await db.put('wbs_attempts', {
    id: attempt.id,
    stageId: attempt.stageId,
    projectId,
    attempt,
    savedAt: new Date().toISOString(),
    synced,
  });
}

/**
 * Retrieves offline attempts for a specific stage or all stages.
 */
export async function getOfflineWbsAttempts(stageId?: string): Promise<InspectionAttempt[]> {
  const db = await getWbsOfflineDb();
  if (stageId) {
    const items = await db.getAllFromIndex('wbs_attempts', 'by-stage', stageId);
    return items.map((i) => i.attempt);
  }
  const all = await db.getAll('wbs_attempts');
  return all.map((i) => i.attempt);
}

/**
 * Retrieves all offline WBS attempt records including sync status.
 */
export async function getAllOfflineWbsAttempts(): Promise<OfflineWbsAttemptItem[]> {
  const db = await getWbsOfflineDb();
  return db.getAll('wbs_attempts');
}

/**
 * Deletes an offline WBS attempt record.
 */
export async function deleteOfflineWbsAttempt(id: string): Promise<void> {
  const db = await getWbsOfflineDb();
  await db.delete('wbs_attempts', id);
}

/**
 * Saves a draft inspection attempt for a stage (before submission).
 */
export async function saveOfflineStageDraft(draft: OfflineStageDraftItem): Promise<void> {
  const db = await getWbsOfflineDb();
  await db.put('wbs_drafts', draft);
}

/**
 * Retrieves a draft inspection attempt for a stage.
 */
export async function getOfflineStageDraft(
  stageId: string
): Promise<OfflineStageDraftItem | null> {
  const db = await getWbsOfflineDb();
  const draft = await db.get('wbs_drafts', stageId);
  return draft ?? null;
}

/**
 * Deletes a draft inspection attempt for a stage.
 */
export async function deleteOfflineStageDraft(stageId: string): Promise<void> {
  const db = await getWbsOfflineDb();
  await db.delete('wbs_drafts', stageId);
}

/**
 * Clears all offline WBS data.
 */
export async function clearAllOfflineWbsData(): Promise<void> {
  const db = await getWbsOfflineDb();
  await db.clear('wbs_attempts');
  await db.clear('wbs_drafts');
}
