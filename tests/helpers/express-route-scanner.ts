/**
 * Express router stack scanner for Stage 2a route-registry test.
 * Extracted into its own module for reuse and readability.
 */

export interface DiscoveredRoute {
  method: string;
  fullPath: string;
  hasPermission: boolean;
  requiredPermission?: string;
}

export function scanAppRoutes(app: any): DiscoveredRoute[] {
  const discovered: DiscoveredRoute[] = [];

  function scanRouter(router: any, prefix: string) {
    if (!router?.stack) return;

    for (const layer of router.stack) {
      if (layer.route) {
        const route = layer.route;
        const routePath = prefix + (route.path === '/' ? '' : route.path);
        const methods = Object.keys(route.methods).map((m: string) => m.toUpperCase());

        for (const m of methods) {
          if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) continue;

          let hasPermission = false;
          let requiredPerm: string | undefined;

          for (const h of route.stack) {
            if (h.handle?._requiredPermission) {
              hasPermission = true;
              requiredPerm = h.handle._requiredPermission;
              break;
            }
          }
          if (!hasPermission && router._requiredPermission) {
            hasPermission = true;
            requiredPerm = router._requiredPermission;
          }

          discovered.push({ method: m, fullPath: routePath, hasPermission, requiredPermission: requiredPerm });
        }

      } else if (layer.name === 'router' && layer.handle) {
        let mountPrefix = prefix;
        if (layer.regexp) {
          const match = layer.regexp.source
            .replace('^\\', '')
            .replace('\\/?(?=\\/|$)', '')
            .replace(/\\\//g, '/')
            .replace(/\\/g, '');
          if (match && match !== '/') {
            mountPrefix = prefix + (match.startsWith('/') ? match : '/' + match);
          }
        }

        // Propagate router-level permission to sub-router
        let routerLevelPerm: string | undefined;
        if (layer.handle.stack) {
          for (const h of layer.handle.stack) {
            if (h.handle?._requiredPermission) {
              routerLevelPerm = h.handle._requiredPermission;
              break;
            }
          }
        }
        if (routerLevelPerm) {
          layer.handle._requiredPermission = routerLevelPerm;
        }

        scanRouter(layer.handle, mountPrefix);
      }
    }
  }

  scanRouter(app._router, '');
  return discovered;
}
