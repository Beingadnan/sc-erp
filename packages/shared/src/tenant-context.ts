/**
 * The verified context for one unit of work. It is built ONLY from an authenticated
 * session (API) or a validated job payload (worker) — never from raw client input.
 */
export interface TenantContext {
  readonly tenantId: string;
  /** The acting user. Null for system jobs. */
  readonly userId: string | null;
  /** Campuses the actor may access; undefined means all campuses of the tenant. */
  readonly campusIds?: readonly string[];
  /** Correlates logs, audit entries and jobs. */
  readonly requestId: string;
}

/** Cache keys are always namespaced by tenant. Build them only with this helper. */
export const tenantCacheKey = (tenantId: string, ...parts: Array<string | number>): string => {
  if (!tenantId) throw new Error('tenantCacheKey requires a tenantId');
  return ['t', tenantId, ...parts.map(String)].join(':');
};

/** Object-storage keys are always prefixed by tenant. Build them only with this helper. */
export const tenantStorageKey = (tenantId: string, ...segments: string[]): string => {
  if (!tenantId) throw new Error('tenantStorageKey requires a tenantId');
  for (const s of segments) {
    if (s.includes('..') || s.startsWith('/') || s.includes('\\')) {
      throw new Error(`Invalid storage key segment: ${s}`);
    }
  }
  return ['tenants', tenantId, ...segments].join('/');
};
