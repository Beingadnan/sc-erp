import { SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@school-erp/shared';
import type { SessionAuth, TenantAccess } from './access.js';

export const PUBLIC_KEY = 'access:public';
export const ALLOW_MFA_PENDING_KEY = 'access:allowMfaPending';
export const TENANT_ROUTE_KEY = 'access:tenant';
export const PERMISSION_KEY = 'access:permission';
export const PLATFORM_KEY = 'access:platform';

/** No session needed (login, sign-up, password reset). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Reachable with a session that still has to pass the second factor. */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING_KEY, true);

/** Requires an active tenant and an active membership in it. */
export const TenantRoute = () => SetMetadata(TENANT_ROUTE_KEY, true);

/** Requires a tenant permission (implies TenantRoute). */
/** One permission, or a list meaning "any of these" (the service then narrows what is visible). */
export const RequirePermission = (permission: string | string[]) =>
  SetMetadata(PERMISSION_KEY, permission);

/** Requires a platform staff role; hidden (404) from everyone else. */
export const PlatformRoute = (...roles: Array<'super_admin' | 'support' | 'operations'>) =>
  SetMetadata(PLATFORM_KEY, roles.length ? roles : ['super_admin', 'support', 'operations']);

export type AuthedRequest = Request & {
  requestId?: string;
  auth?: SessionAuth;
  access?: TenantAccess;
};

export const CurrentSession = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionAuth => {
    const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in required');
    return auth;
  },
);

export const CurrentAccess = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantAccess => {
    const access = ctx.switchToHttp().getRequest<AuthedRequest>().access;
    if (!access) throw new AppError('TENANT_CONTEXT_MISSING', 'Choose a school first');
    return access;
  },
);

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export const Client = createParamDecorator((_: unknown, ctx: ExecutionContext): ClientInfo => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent')?.slice(0, 300) ?? null,
    requestId: req.requestId ?? 'unknown',
  };
});
