import type { TenantContext } from '@school-erp/shared';

/** Permissions that change who can do what; they need MFA when enforcement is on. */
export const PRIVILEGED_PERMISSIONS = new Set([
  'settings.manage',
  'members.manage',
  'roles.manage',
]);

/**
 * Narrow permissions covered by broader ones, for granting purposes: someone who can see
 * every student of a campus may hand out "see students of my own sections" there.
 */
export const IMPLIED_BY: Readonly<Record<string, readonly string[]>> = {
  'students.view_assigned': ['students.view'],
  // Correcting any register covers taking one's own.
  'attendance.mark': ['attendance.correct'],
  // Whoever sets up fees may let staff collect them; whoever may cancel receipts may let
  // staff refund (so owners and school admins can invite accountants).
  'fees.collect': ['fees.configure'],
  'fees.refund': ['fees.cancel_receipt'],
};

/** The authenticated session attached to every non-public request. */
export interface SessionAuth {
  readonly sessionId: string;
  readonly userId: string;
  readonly activeTenantId: string | null;
  readonly mfaPending: boolean;
  readonly requestId: string;
  readonly platformRole: string | null;
}

/**
 * What the current user may do in the current tenant. Built by AccessGuard from the
 * database on every request; never cached across requests.
 * A grant of `null` means all campuses; otherwise the set of campus ids.
 */
export class TenantAccess {
  constructor(
    readonly tenantId: string,
    readonly userId: string,
    readonly membershipId: string,
    readonly requestId: string,
    readonly sessionId: string,
    readonly mfaEnabled: boolean,
    private readonly grants: ReadonlyMap<string, ReadonlySet<string> | null>,
    /** Campuses where the user holds any role (null = all). */
    readonly campusScope: ReadonlySet<string> | null,
    readonly ip: string | null,
  ) {}

  get ctx(): TenantContext {
    return { tenantId: this.tenantId, userId: this.userId, requestId: this.requestId };
  }

  /** Has the permission at any scope, or for a specific campus when given. */
  has(permission: string, campusId?: string | null): boolean {
    if (!this.grants.has(permission)) return false;
    const scope = this.grants.get(permission);
    if (scope === null || scope === undefined) return true;
    if (campusId === undefined) return true;
    return campusId !== null && scope.has(campusId);
  }

  /** Has the permission for every campus of the tenant. */
  hasTenantWide(permission: string): boolean {
    return this.grants.has(permission) && this.grants.get(permission) === null;
  }

  /** null = all campuses; otherwise the campus ids this permission covers. */
  scopeOf(permission: string): ReadonlySet<string> | null {
    const scope = this.grants.get(permission);
    if (scope === undefined) return new Set();
    return scope;
  }

  permissions(): string[] {
    return [...this.grants.keys()].sort();
  }

  /** permission → campus ids it is limited to, or null when it applies school-wide. */
  scopes(): Record<string, string[] | null> {
    return Object.fromEntries(
      [...this.grants].map(([k, v]) => [k, v === null ? null : [...v].sort()]),
    );
  }

  /** Can grant `permission` for `campusId` (null = all campuses) to someone else. */
  canGrant(permission: string, campusId: string | null): boolean {
    const holds = (p: string) =>
      campusId === null ? this.hasTenantWide(p) : this.has(p, campusId);
    return holds(permission) || (IMPLIED_BY[permission] ?? []).some(holds);
  }
}

export type AccessRow = {
  membership_id: string;
  tenant_status: string;
  campus_id: string | null;
  role_id: string | null;
  permission_key: string | null;
};

export const buildGrants = (
  rows: readonly AccessRow[],
): { grants: Map<string, Set<string> | null>; campusScope: Set<string> | null } => {
  const grants = new Map<string, Set<string> | null>();
  let campusScope: Set<string> | null = new Set();
  for (const r of rows) {
    if (r.role_id) {
      if (r.campus_id === null) campusScope = null;
      else campusScope?.add(r.campus_id);
    }
    if (!r.permission_key) continue;
    const current = grants.get(r.permission_key);
    if (r.campus_id === null) {
      grants.set(r.permission_key, null);
    } else if (current === undefined) {
      grants.set(r.permission_key, new Set([r.campus_id]));
    } else if (current !== null) {
      current.add(r.campus_id);
    }
  }
  return { grants, campusScope };
};
