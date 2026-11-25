import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiGetMyProjectPermissions } from '../services/api';
import {
  fetchCurrentUserWithPermissions,
  type AuthenticatedUser,
} from '../services/authClient';
import {
  savePermissionSnapshot,
  getCachedPermissionSnapshot,
  isSnapshotValid,
} from '../services/authOffline';

export interface AuthContextType {
  user: AuthenticatedUser | null;
  setUser: (user: AuthenticatedUser | null) => void;
  globalPermissions: string[];
  activeProjectPermissions: string[];
  activeProjectId: string | null;
  setActiveProjectId: (projectId: string | null) => void;
  isLoadingPermissions: boolean;
  refreshPermissions: (projectId?: string) => Promise<void>;
  can: (permissionKey: string, scopeProjectId?: string) => boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  initialUser?: AuthenticatedUser | null;
  initialProjectId?: string | null;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  children,
  initialUser = null,
  initialProjectId = null,
}) => {
  const [user, setUser] = useState<AuthenticatedUser | null>(initialUser);
  const [globalPermissions, setGlobalPermissions] = useState<string[]>(
    initialUser?.globalPermissions || []
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialProjectId);
  const [activeProjectPermissions, setActiveProjectPermissions] = useState<string[]>([]);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState<boolean>(true);

  // Load global permissions on mount or when user changes
  const loadGlobalPermissions = useCallback(async () => {
    try {
      setIsLoadingPermissions(true);
      const res = await fetchCurrentUserWithPermissions();
      if (res) {
        setUser(res.user);
        setGlobalPermissions(res.globalPermissions);
        // Persist snapshot to IndexedDB for offline resilience
        savePermissionSnapshot(res.user.id, res.globalPermissions).catch((e) =>
          console.warn('[AuthContext] Failed to cache offline permission snapshot:', e)
        );
      } else {
        setGlobalPermissions([]);
      }
    } catch (err) {
      console.warn('[AuthContext] Failed to load global permissions from network:', err);
      // Fallback: check 24-hour TTL offline permission snapshot in IndexedDB
      const currentUserId = user?.id || initialUser?.id;
      if (currentUserId) {
        try {
          const snapshot = await getCachedPermissionSnapshot(currentUserId);
          if (snapshot && isSnapshotValid(snapshot)) {
            console.info(
              `[AuthContext] Using valid offline permission snapshot (expires at ${snapshot.expiresAt})`
            );
            setGlobalPermissions(snapshot.globalPermissions);
            if (activeProjectId && snapshot.projectPermissions[activeProjectId]) {
              setActiveProjectPermissions(snapshot.projectPermissions[activeProjectId]);
            }
            return;
          } else if (snapshot) {
            console.warn('[AuthContext] Offline permission snapshot expired (>24h). Denying access.');
          }
        } catch (snapErr) {
          console.warn('[AuthContext] Error reading offline permission snapshot:', snapErr);
        }
      }
      setGlobalPermissions([]);
    } finally {
      setIsLoadingPermissions(false);
    }
  }, [user?.id, initialUser?.id, activeProjectId]);

  // Load project-specific permissions whenever activeProjectId changes
  const loadProjectPermissions = useCallback(async (projectId: string | null) => {
    if (!projectId) {
      setActiveProjectPermissions([]);
      return;
    }
    try {
      setIsLoadingPermissions(true);
      const perms = await apiGetMyProjectPermissions(projectId);
      setActiveProjectPermissions(perms);
      // Cache project permissions into offline snapshot
      const currentUserId = user?.id || initialUser?.id;
      if (currentUserId) {
        savePermissionSnapshot(currentUserId, globalPermissions, {
          projectId,
          permissions: perms,
        }).catch((e) =>
          console.warn('[AuthContext] Failed to update project offline permission snapshot:', e)
        );
      }
    } catch (err) {
      console.warn(`[AuthContext] Failed to load permissions for project ${projectId} from network:`, err);
      // Fallback: read cached project permissions from IndexedDB snapshot
      const currentUserId = user?.id || initialUser?.id;
      if (currentUserId) {
        try {
          const snapshot = await getCachedPermissionSnapshot(currentUserId);
          if (snapshot && isSnapshotValid(snapshot) && snapshot.projectPermissions[projectId]) {
            console.info(`[AuthContext] Using cached offline permissions for project ${projectId}`);
            setActiveProjectPermissions(snapshot.projectPermissions[projectId]);
            return;
          }
        } catch (snapErr) {
          console.warn('[AuthContext] Error reading project permissions snapshot:', snapErr);
        }
      }
      setActiveProjectPermissions([]);
    } finally {
      setIsLoadingPermissions(false);
    }
  }, [user?.id, initialUser?.id, globalPermissions]);

  useEffect(() => {
    loadGlobalPermissions();
  }, [loadGlobalPermissions]);

  useEffect(() => {
    if (activeProjectId) {
      loadProjectPermissions(activeProjectId);
    }
  }, [activeProjectId, loadProjectPermissions]);

  const refreshPermissions = useCallback(
    async (projectId?: string) => {
      setIsLoadingPermissions(true);
      try {
        const targetProj = projectId || activeProjectId;
        await Promise.all([
          loadGlobalPermissions(),
          targetProj ? loadProjectPermissions(targetProj) : Promise.resolve(),
        ]);
      } finally {
        setIsLoadingPermissions(false);
      }
    },
    [activeProjectId, loadGlobalPermissions, loadProjectPermissions]
  );

  /**
   * Evaluates if current user holds the required permission.
   * Fail-Closed: returns false when permissions are loading.
   */
  const can = useCallback(
    (permissionKey: string, scopeProjectId?: string): boolean => {
      if (isLoadingPermissions) return false;

      // 1. Organization / Global scope: universal grant
      if (globalPermissions.includes(permissionKey)) return true;

      // 2. Project scope: valid if held on active project
      if (scopeProjectId && activeProjectId && scopeProjectId !== activeProjectId) {
        // Target project differs from currently loaded project scope
        return false;
      }

      if (activeProjectPermissions.includes(permissionKey)) return true;

      return false;
    },
    [globalPermissions, activeProjectPermissions, activeProjectId, isLoadingPermissions]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        globalPermissions,
        activeProjectPermissions,
        activeProjectId,
        setActiveProjectId,
        isLoadingPermissions,
        refreshPermissions,
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
