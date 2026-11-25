import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { PERMISSIONS, type PermissionKey } from '../types/permissions';

export { PERMISSIONS, type PermissionKey };

/**
 * Custom hook for permission-based authorization in SiteLens UI components.
 * Corresponds to Blueprint Tahap 2a-2 (Bagian 6.D).
 *
 * Example usage:
 *   const { can, isLoading } = usePermission();
 *   if (!can(PERMISSIONS.STAGE_EXECUTE)) return <DisabledButton />;
 */
export function usePermission() {
  const context = useContext(AuthContext);

  if (!context) {
    // If rendered outside AuthProvider (e.g. standalone test or uninitialized),
    // default to fail-closed safe fallback
    return {
      can: (_permKey: string, _projectId?: string) => false,
      isLoading: false,
      globalPermissions: [] as string[],
      activeProjectPermissions: [] as string[],
      activeProjectId: null,
      setActiveProjectId: (_id: string | null) => {},
      refreshPermissions: async () => {},
      user: null,
      enabledModules: [] as string[],
      focusMode: null as string | null,
    };
  }

  return {
    can: context.can,
    isLoading: context.isLoadingPermissions,
    globalPermissions: context.globalPermissions,
    activeProjectPermissions: context.activeProjectPermissions,
    activeProjectId: context.activeProjectId,
    setActiveProjectId: context.setActiveProjectId,
    refreshPermissions: context.refreshPermissions,
    user: context.user,
    enabledModules: context.enabledModules,
    focusMode: context.focusMode,
  };
}
