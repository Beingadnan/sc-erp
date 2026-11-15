import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import type { DatabaseHandle } from '@school-erp/db';
import { AppError } from '@school-erp/shared';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';
import { DB_HANDLE } from '../database/database.module.js';
import { constantTimeEqual, sha256 } from '../common/crypto.js';
import { PRIVILEGED_PERMISSIONS, TenantAccess, buildGrants } from './access.js';
import type { AccessRow } from './access.js';
import {
  ALLOW_MFA_PENDING_KEY,
  PERMISSION_KEY,
  PLATFORM_KEY,
  PUBLIC_KEY,
  TENANT_ROUTE_KEY,
} from './decorators.js';
import type { AuthedRequest } from './decorators.js';
import { SessionService } from './session.service.js';
import type { ResolvedSession } from './session.service.js';

type AuthorizeRow = ResolvedSession & {
  mfa_enabled: boolean;
  platform_role: string | null;
  access: AccessRow[] | null;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Single entry point for authentication and authorization on every route.
 *
 * 1. Rejects cross-site state-changing requests (Origin allow-list).
 * 2. Resolves the session cookie (one transaction with the access lookup).
 * 3. Verifies the CSRF header for state-changing requests.
 * 4. Blocks sessions still waiting for the second factor.
 * 5. For tenant routes: active tenant + active membership + tenant not suspended,
 *    then loads roles/permissions/campus scope into a TenantAccess.
 * 6. Checks the route permission (and MFA for privileged permissions).
 * 7. For platform routes: requires a platform role, otherwise 404.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(DB_HANDLE) private readonly db: DatabaseHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, targets);
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const requestId = req.requestId ?? 'unknown';
    const unsafe = !SAFE_METHODS.has(req.method);

    if (unsafe) this.assertAllowedOrigin(req);
    if (meta<boolean>(PUBLIC_KEY)) return true;

    const token = req.cookies?.[this.sessions.sessionCookie] as string | undefined;
    if (!token || token.length > 100) throw new AppError('UNAUTHENTICATED', 'Sign in required');

    const permission = meta<string | string[]>(PERMISSION_KEY);
    const tenantRoute = Boolean(permission) || Boolean(meta<boolean>(TENANT_ROUTE_KEY));
    const platformRoles = meta<string[]>(PLATFORM_KEY);

    // One round trip: session + permissions + platform role (app.session_authorize).
    const r = await this.db.db.execute<AuthorizeRow>(sql`
      select * from app.session_authorize(
        ${sha256(token)}, ${this.sessions.idleInterval}::interval,
        ${tenantRoute}, ${Boolean(platformRoles)})`);
    const row = r.rows[0];
    const result = row
      ? {
          session: row,
          accessRows: row.access ?? [],
          mfaEnabled: row.mfa_enabled,
          platformRole: row.platform_role,
        }
      : null;

    if (!result)
      throw new AppError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
    const { session, accessRows, mfaEnabled, platformRole } = result;

    if (unsafe) {
      const header = req.header('x-csrf-token');
      if (!header || header.length > 100 || !constantTimeEqual(sha256(header), session.csrf_hash)) {
        throw new AppError('FORBIDDEN', 'Security check failed. Refresh the page and try again.', {
          reason: 'csrf',
        });
      }
    }

    if (session.mfa_pending && !meta<boolean>(ALLOW_MFA_PENDING_KEY)) {
      throw new AppError('MFA_REQUIRED', 'Enter the code from your authenticator app');
    }

    req.auth = {
      sessionId: session.session_id,
      userId: session.user_id,
      activeTenantId: session.active_tenant_id,
      mfaPending: session.mfa_pending,
      requestId,
      platformRole,
    };

    if (platformRoles) {
      if (!platformRole || !platformRoles.includes(platformRole)) {
        throw new AppError('NOT_FOUND', 'Not found');
      }
      return true;
    }

    if (!tenantRoute) return true;

    if (!session.active_tenant_id) {
      throw new AppError('TENANT_CONTEXT_MISSING', 'Choose a school first');
    }
    const first = accessRows[0];
    if (!first) {
      throw new AppError('FORBIDDEN', 'You do not have access to this school', {
        reason: 'no_membership',
      });
    }
    if (first.tenant_status !== 'active') {
      throw new AppError('FORBIDDEN', 'This school account is suspended. Contact support.', {
        reason: 'tenant_suspended',
      });
    }

    const { grants, campusScope } = buildGrants(accessRows);
    const access = new TenantAccess(
      session.active_tenant_id,
      session.user_id,
      first.membership_id,
      requestId,
      session.session_id,
      mfaEnabled,
      grants,
      campusScope,
      req.ip ?? null,
    );
    req.access = access;

    if (permission) {
      // A list means "any of these" (e.g. all students, or only the caller's sections).
      const anyOf = Array.isArray(permission) ? permission : [permission];
      const held = anyOf.filter((p) => access.has(p));
      if (!held.length) {
        throw new AppError('FORBIDDEN', 'You do not have permission to do this', {
          permission: anyOf.join(' | '),
        });
      }
      if (
        this.config.MFA_ENFORCEMENT === 'on' &&
        held.every((p) => PRIVILEGED_PERMISSIONS.has(p)) &&
        !mfaEnabled
      ) {
        throw new AppError(
          'MFA_SETUP_REQUIRED',
          'Turn on two-step verification to use this feature',
        );
      }
    }
    return true;
  }

  private assertAllowedOrigin(req: AuthedRequest): void {
    const origin = req.header('origin');
    if (origin && !this.config.API_CORS_ORIGINS.includes(origin)) {
      throw new AppError('FORBIDDEN', 'Cross-site request blocked', { reason: 'origin' });
    }
  }
}
