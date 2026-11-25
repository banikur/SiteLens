import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface OfflinePermissionSnapshot {
  userId: string;
  globalPermissions: string[];
  projectPermissions: Record<string, string[]>; // projectId -> permission keys
  cachedAt: string; // ISO string
  expiresAt: string; // ISO string: cachedAt + 24 hours
}

export interface SiteLensAuthOfflineDB extends DBSchema {
  cached_permissions: {
    key: string;
    value: OfflinePermissionSnapshot;
  };
}

export const AUTH_OFFLINE_DB_NAME = 'sitelens_auth_offline_v1';
export const AUTH_OFFLINE_DB_VERSION = 1;
export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000; // 24 Hours TTL

let customAuthDbInstance: IDBPDatabase<SiteLensAuthOfflineDB> | null = null;

/**
 * Allows injection of a custom DB instance (useful for unit tests and environments without global indexedDB).
 */
export function setCustomAuthOfflineDb(db: IDBPDatabase<SiteLensAuthOfflineDB> | null): void {
  customAuthDbInstance = db;
}

export function getAuthOfflineDb(): Promise<IDBPDatabase<SiteLensAuthOfflineDB>> {
  if (customAuthDbInstance) {
    return Promise.resolve(customAuthDbInstance);
  }
  return openDB<SiteLensAuthOfflineDB>(AUTH_OFFLINE_DB_NAME, AUTH_OFFLINE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('cached_permissions')) {
        db.createObjectStore('cached_permissions', { keyPath: 'userId' });
      }
    },
  });
}

/**
 * Saves a 24-hour TTL permission snapshot for offline authorization.
 */
export async function savePermissionSnapshot(
  userId: string,
  globalPermissions: string[],
  projectScope?: { projectId: string; permissions: string[] } | Record<string, string[]>
): Promise<OfflinePermissionSnapshot> {
  const db = await getAuthOfflineDb();
  const existing = await db.get('cached_permissions', userId);
  const now = new Date();
  const cachedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SNAPSHOT_TTL_MS).toISOString();

  let projectPermissions: Record<string, string[]> = existing?.projectPermissions ?? {};
  if (projectScope) {
    if ('projectId' in projectScope) {
      const scope = projectScope as { projectId: string; permissions: string[] };
      projectPermissions = {
        ...projectPermissions,
        [scope.projectId]: scope.permissions,
      };
    } else {
      projectPermissions = {
        ...projectPermissions,
        ...projectScope,
      };
    }
  }

  const snapshot: OfflinePermissionSnapshot = {
    userId,
    globalPermissions: Array.from(new Set(globalPermissions)),
    projectPermissions,
    cachedAt,
    expiresAt,
  };

  await db.put('cached_permissions', snapshot);
  return snapshot;
}

/**
 * Retrieves the cached offline permission snapshot for a user.
 */
export async function getCachedPermissionSnapshot(
  userId: string
): Promise<OfflinePermissionSnapshot | null> {
  const db = await getAuthOfflineDb();
  const snapshot = await db.get('cached_permissions', userId);
  return snapshot ?? null;
}

/**
 * Checks whether an offline permission snapshot is still valid (not expired past 24 hours).
 */
export function isSnapshotValid(
  snapshot: OfflinePermissionSnapshot | null,
  referenceTime?: number
): boolean {
  if (!snapshot) return false;
  const nowTime = referenceTime ?? Date.now();
  const expiresTime = new Date(snapshot.expiresAt).getTime();
  return expiresTime > nowTime;
}

/**
 * Evaluates whether an offline user has a permission.
 * Fail-Closed: returns false if offline snapshot is missing or older than 24 hours.
 */
export async function canOffline(
  userId: string,
  permissionKey: string,
  projectId?: string,
  referenceTime?: number
): Promise<boolean> {
  const snapshot = await getCachedPermissionSnapshot(userId);
  if (!isSnapshotValid(snapshot, referenceTime) || !snapshot) {
    return false;
  }

  // 1. Check Global / Organization permissions
  if (snapshot.globalPermissions.includes(permissionKey)) {
    return true;
  }

  // 2. Check Project specific permissions
  if (projectId && snapshot.projectPermissions[projectId]?.includes(permissionKey)) {
    return true;
  }

  return false;
}

/**
 * Clears the permission snapshot (e.g. on logout or session invalidation).
 */
export async function clearPermissionSnapshot(userId: string): Promise<void> {
  const db = await getAuthOfflineDb();
  await db.delete('cached_permissions', userId);
}
