import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { withContext } from '@school-erp/db';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';
import { DB_HANDLE } from '../database/database.module.js';
import { randomToken, sha256 } from '../common/crypto.js';

export type ResolvedSession = {
  session_id: string;
  user_id: string;
  active_tenant_id: string | null;
  csrf_hash: Buffer;
  mfa_pending: boolean;
  expires_at: Date;
};

export interface NewSession {
  token: string;
  csrf: string;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Opaque server-side sessions. The browser holds a random token in an HttpOnly cookie;
 * the database stores only its SHA-256. A second, readable cookie carries a CSRF token
 * that must be echoed in the X-CSRF-Token header on state-changing requests.
 */
@Injectable()
export class SessionService {
  readonly sessionCookie: string;
  readonly csrfCookie: string;

  constructor(
    @Inject(DB_HANDLE) private readonly db: DatabaseHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {
    // __Host- cookies must be Secure, host-only and Path=/ — the strictest browser scoping.
    this.sessionCookie = config.COOKIE_SECURE ? '__Host-sid' : 'sid';
    this.csrfCookie = config.COOKIE_SECURE ? '__Host-csrf' : 'csrf';
  }

  get idleInterval(): string {
    return `${this.config.SESSION_IDLE_HOURS} hours`;
  }

  async create(
    tx: Transaction,
    args: {
      userId: string;
      activeTenantId: string | null;
      mfaPending: boolean;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<NewSession> {
    const token = randomToken();
    const csrf = randomToken();
    const ttl = args.mfaPending ? '10 minutes' : `${this.config.SESSION_TTL_HOURS} hours`;
    const r = await tx.execute<{ id: string }>(sql`
      select app.session_create(${args.userId}, ${sha256(token)}, ${sha256(csrf)}, ${ttl}::interval,
        ${args.ip}::inet, ${args.userAgent}, ${args.activeTenantId}, ${args.mfaPending}) as id`);
    const hours = args.mfaPending ? 1 / 6 : this.config.SESSION_TTL_HOURS;
    return {
      token,
      csrf,
      sessionId: r.rows[0]!.id,
      expiresAt: new Date(Date.now() + hours * 3_600_000),
    };
  }

  async resolve(tx: Transaction, token: string): Promise<ResolvedSession | null> {
    const r = await tx.execute<ResolvedSession>(
      sql`select * from app.session_resolve(${sha256(token)}, ${this.idleInterval}::interval)`,
    );
    return r.rows[0] ?? null;
  }

  async createStandalone(
    args: Parameters<SessionService['create']>[1] & { requestId: string },
  ): Promise<NewSession> {
    return withContext(this.db.db, { requestId: args.requestId }, (tx) => this.create(tx, args));
  }

  setCookies(res: Response, s: NewSession): void {
    const common = {
      secure: this.config.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
      expires: s.expiresAt,
    };
    res.cookie(this.sessionCookie, s.token, { ...common, httpOnly: true });
    res.cookie(this.csrfCookie, s.csrf, { ...common, httpOnly: false });
  }

  clearCookies(res: Response): void {
    const common = { secure: this.config.COOKIE_SECURE, sameSite: 'lax' as const, path: '/' };
    res.clearCookie(this.sessionCookie, { ...common, httpOnly: true });
    res.clearCookie(this.csrfCookie, common);
  }
}
