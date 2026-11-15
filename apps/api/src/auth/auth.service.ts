import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, setContext, withContext } from '@school-erp/db';
import { AppError } from '@school-erp/shared';
import type { LoginInput, MfaVerifyInput, RegisterSchoolInput } from '@school-erp/validation';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';
import { DB_HANDLE } from '../database/database.module.js';
import { FixedWindowLimiter } from '../common/rate-limiter.js';
import { randomToken, sha256, sha256Hex } from '../common/crypto.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { ClientInfo } from './decorators.js';
import type { SessionAuth } from './access.js';
import { MAILER } from './mailer.js';
import type { Mailer } from './mailer.js';
import { PasswordService } from './password.service.js';
import { SecretBox } from './secret-box.js';
import { SessionService } from './session.service.js';
import type { NewSession } from './session.service.js';
import { generateRecoveryCodes, generateTotpSecret, otpauthUrl, verifyTotp } from './totp.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT = '15 minutes';
const MINUTE = 60_000;

const INVALID_LOGIN = 'Incorrect email or password, or the account is temporarily locked.';

type UserSecrets = {
  password_hash: string | null;
  mfa_secret_enc: string | null;
  mfa_enabled: boolean;
  mfa_last_step: string | null;
  mfa_recovery_hashes: string[] | null;
};

@Injectable()
export class AuthService {
  private readonly limiter: FixedWindowLimiter;
  private readonly box: SecretBox;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {
    this.limiter = new FixedWindowLimiter(config.NODE_ENV === 'test' ? 50 : 1);
    this.box = new SecretBox(config.MFA_ENCRYPTION_KEY);
  }

  private get db() {
    return this.handle.db;
  }

  // ---------------------------------------------------------------- registration

  async registerSchool(input: RegisterSchoolInput, client: ClientInfo): Promise<NewSession> {
    this.limiter.consume(`register:${client.ip}`, 5, 60 * MINUTE);
    const passwordHash = await this.passwords.hash(input.password);
    const verifyToken = randomToken();

    const { userId, tenantId } = await withContext(
      this.db,
      { requestId: client.requestId },
      async (tx) => {
        try {
          const u = await tx.execute<{ id: string }>(
            sql`select app.auth_create_user(${input.email}, ${input.fullName}, ${passwordHash}) as id`,
          );
          const newUserId = u.rows[0]!.id;
          await tx.execute(
            sql`select app.auth_record_login(${newUserId}, true, ${MAX_FAILED_LOGINS}, ${LOCKOUT}::interval)`,
          );
          await setContext(tx, { userId: newUserId, requestId: client.requestId });
          const t = await tx.execute<{ id: string }>(sql`
          select app.tenant_provision(${newUserId}, ${input.slug}, ${input.schoolName}, 'MAIN',
            ${input.campusName}, ${input.board}, 'Asia/Kolkata', ${client.requestId}) as id`);
          const newTenantId = t.rows[0]!.id;
          await tx.execute(sql`
          select app.auth_token_create(${newUserId}, 'verify_email', ${sha256(verifyToken)},
            '3 days'::interval, null)`);
          return { userId: newUserId, tenantId: newTenantId };
        } catch (err) {
          return rethrowConflicts(err, {
            users_email_unique: 'An account with this email already exists. Sign in instead.',
            tenants_slug_unique: 'This school address is already taken. Choose another.',
          });
        }
      },
    );

    await this.mailer.send({
      to: input.email,
      kind: 'verify_email',
      subject: 'Confirm your email address',
      text: `Welcome to School ERP. Confirm your email: ${this.config.APP_URL}/verify-email?token=${verifyToken}`,
    });

    return this.sessions.createStandalone({
      userId,
      activeTenantId: tenantId,
      mfaPending: false,
      ip: client.ip,
      userAgent: client.userAgent,
      requestId: client.requestId,
    });
  }

  // ---------------------------------------------------------------- login / logout

  async login(
    input: LoginInput,
    client: ClientInfo,
  ): Promise<{ session: NewSession; mfaRequired: boolean }> {
    this.limiter.consume(`login-ip:${client.ip}`, 30, 5 * MINUTE);
    this.limiter.consume(`login-id:${input.email ?? input.phone}`, 10, 15 * MINUTE);

    return withContext(this.db, { requestId: client.requestId }, async (tx) => {
      const r = await tx.execute<{
        user_id: string;
        password_hash: string | null;
        status: string;
        locked_until: Date | null;
        mfa_enabled: boolean;
      }>(
        input.phone
          ? sql`select * from app.auth_user_for_login_phone(${input.phone})`
          : sql`select * from app.auth_user_for_login(${input.email ?? ''})`,
      );
      const user = r.rows[0];
      const passwordOk = await this.passwords.verify(user?.password_hash, input.password);
      const locked = Boolean(user?.locked_until && new Date(user.locked_until) > new Date());

      if (!user || user.status !== 'active' || locked || !passwordOk) {
        if (user && !locked) {
          await tx.execute(sql`
            select app.auth_record_login(${user.user_id}, false, ${MAX_FAILED_LOGINS}, ${LOCKOUT}::interval)`);
        }
        // The failure counter must persist even though we reject: commit, then throw.
        return { failure: true as const };
      }

      await tx.execute(
        sql`select app.auth_record_login(${user.user_id}, true, ${MAX_FAILED_LOGINS}, ${LOCKOUT}::interval)`,
      );
      await setContext(tx, { userId: user.user_id, requestId: client.requestId });
      const tenants = await this.userTenants(tx, user.user_id);
      let firstActive = tenants.find(
        (t) => t.membership_status === 'active' && t.tenant_status === 'active',
      );
      if (input.as) {
        // Staff and parents sign in on different pages and land in different apps.
        const kinds = (
          await tx.execute<{ tenant_id: string; is_parent: boolean; is_staff: boolean }>(
            sql`select * from app.user_tenant_kinds(${user.user_id})`,
          )
        ).rows;
        const fit = kinds.find((k) => (input.as === 'parent' ? k.is_parent : k.is_staff));
        if (!fit && input.as === 'parent') return { failure: 'not_parent' as const };
        if (!fit && kinds.length && kinds.every((k) => !k.is_staff)) {
          return { failure: 'not_staff' as const };
        }
        if (fit) firstActive = tenants.find((t) => t.tenant_id === fit.tenant_id);
      }
      const session = await this.sessions.create(tx, {
        userId: user.user_id,
        activeTenantId: firstActive?.tenant_id ?? null,
        mfaPending: user.mfa_enabled,
        ip: client.ip,
        userAgent: client.userAgent,
      });
      return { failure: false as const, session, mfaRequired: user.mfa_enabled };
    }).then((r) => {
      if (r.failure === 'not_parent') {
        throw new AppError(
          'FORBIDDEN',
          'This account is not a parent at any school. Staff: please use the staff sign-in.',
        );
      }
      if (r.failure === 'not_staff') {
        throw new AppError('FORBIDDEN', 'This is a parent account. Please use the parent sign-in.');
      }
      if (r.failure) throw new AppError('UNAUTHENTICATED', INVALID_LOGIN);
      return { session: r.session, mfaRequired: r.mfaRequired };
    });
  }

  async logout(auth: SessionAuth): Promise<void> {
    await withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, (tx) =>
      tx
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.id, auth.sessionId)),
    );
  }

  // ---------------------------------------------------------------- MFA at login

  async verifyMfa(
    auth: SessionAuth,
    input: MfaVerifyInput,
    client: ClientInfo,
  ): Promise<NewSession> {
    this.limiter.consume(`mfa:${auth.sessionId}`, 10, 15 * MINUTE);
    if (!auth.mfaPending) throw new AppError('CONFLICT', 'Two-step verification already completed');

    return withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, async (tx) => {
      const secrets = await this.secrets(tx, auth.userId);
      if (!secrets.mfa_enabled || !secrets.mfa_secret_enc) {
        throw new AppError('CONFLICT', 'Two-step verification is not enabled');
      }
      if ('code' in input) {
        const step = verifyTotp(
          this.box.open(secrets.mfa_secret_enc),
          input.code,
          secrets.mfa_last_step === null ? null : Number(secrets.mfa_last_step),
        );
        if (step === null)
          throw new AppError('UNAUTHENTICATED', 'That code is not valid. Try the newest code.');
        await tx
          .update(schema.users)
          .set({ mfaLastStep: step })
          .where(eq(schema.users.id, auth.userId));
      } else {
        const hash = sha256Hex(input.recoveryCode.toLowerCase());
        const remaining = (secrets.mfa_recovery_hashes ?? []).filter((h) => h !== hash);
        if (remaining.length === (secrets.mfa_recovery_hashes ?? []).length) {
          throw new AppError('UNAUTHENTICATED', 'That recovery code is not valid.');
        }
        await tx
          .update(schema.users)
          .set({ mfaRecoveryHashes: remaining })
          .where(eq(schema.users.id, auth.userId));
      }
      // Rotate: a fresh, fully authenticated session replaces the pending one.
      await tx
        .update(schema.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(schema.sessions.id, auth.sessionId));
      return this.sessions.create(tx, {
        userId: auth.userId,
        activeTenantId: auth.activeTenantId,
        mfaPending: false,
        ip: client.ip,
        userAgent: client.userAgent,
      });
    });
  }

  // ---------------------------------------------------------------- MFA management

  async startMfaSetup(auth: SessionAuth): Promise<{ secret: string; otpauthUrl: string }> {
    return withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, async (tx) => {
      const secrets = await this.secrets(tx, auth.userId);
      if (secrets.mfa_enabled)
        throw new AppError('CONFLICT', 'Two-step verification is already on');
      const me = await this.profile(tx, auth.userId);
      const secret = generateTotpSecret();
      await tx
        .update(schema.users)
        .set({ mfaSecretEnc: this.box.seal(secret), mfaLastStep: null })
        .where(eq(schema.users.id, auth.userId));
      return { secret, otpauthUrl: otpauthUrl('School ERP', me.email ?? me.loginPhone ?? 'account', secret) };
    });
  }

  async enableMfa(auth: SessionAuth, code: string): Promise<{ recoveryCodes: string[] }> {
    return withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, async (tx) => {
      const secrets = await this.secrets(tx, auth.userId);
      if (secrets.mfa_enabled)
        throw new AppError('CONFLICT', 'Two-step verification is already on');
      if (!secrets.mfa_secret_enc) throw new AppError('CONFLICT', 'Start setup first');
      const step = verifyTotp(this.box.open(secrets.mfa_secret_enc), code, null);
      if (step === null)
        throw new AppError('VALIDATION_FAILED', 'That code is not valid', {
          fields: { code: 'Invalid code' },
        });
      const recoveryCodes = generateRecoveryCodes();
      await tx
        .update(schema.users)
        .set({
          mfaEnabledAt: new Date(),
          mfaLastStep: step,
          mfaRecoveryHashes: recoveryCodes.map((c) => sha256Hex(c)),
        })
        .where(eq(schema.users.id, auth.userId));
      return { recoveryCodes };
    });
  }

  async disableMfa(auth: SessionAuth, password: string, code: string): Promise<void> {
    await withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, async (tx) => {
      const secrets = await this.secrets(tx, auth.userId);
      if (!secrets.mfa_enabled || !secrets.mfa_secret_enc) return;
      const passwordOk = await this.passwords.verify(secrets.password_hash, password);
      const step = verifyTotp(
        this.box.open(secrets.mfa_secret_enc),
        code,
        secrets.mfa_last_step === null ? null : Number(secrets.mfa_last_step),
      );
      if (!passwordOk || step === null)
        throw new AppError('UNAUTHENTICATED', 'Password or code is not valid');
      await tx
        .update(schema.users)
        .set({ mfaEnabledAt: null, mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryHashes: null })
        .where(eq(schema.users.id, auth.userId));
    });
  }

  // ---------------------------------------------------------------- passwords & email

  async changePassword(auth: SessionAuth, current: string, next: string): Promise<void> {
    const newHash = await this.passwords.hash(next);
    await withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, async (tx) => {
      const secrets = await this.secrets(tx, auth.userId);
      if (!(await this.passwords.verify(secrets.password_hash, current))) {
        throw new AppError('VALIDATION_FAILED', 'Current password is not correct', {
          fields: { currentPassword: 'Not correct' },
        });
      }
      await tx
        .update(schema.users)
        .set({ passwordHash: newHash })
        .where(eq(schema.users.id, auth.userId));
      await tx.execute(sql`select app.session_revoke_others(${auth.sessionId})`);
    });
  }

  /** Always succeeds from the caller's point of view, so it cannot reveal accounts. */
  async forgotPassword(email: string, client: ClientInfo): Promise<void> {
    this.limiter.consume(`forgot-ip:${client.ip}`, 10, 15 * MINUTE);
    this.limiter.consume(`forgot-email:${email}`, 3, 60 * MINUTE);
    const token = randomToken();
    const found = await withContext(this.db, { requestId: client.requestId }, async (tx) => {
      const r = await tx.execute<{ user_id: string; status: string }>(
        sql`select user_id, status from app.auth_user_for_login(${email})`,
      );
      const u = r.rows[0];
      if (!u || u.status !== 'active') return false;
      await tx.execute(sql`
        select app.auth_token_create(${u.user_id}, 'reset_password', ${sha256(token)}, '1 hour'::interval, null)`);
      return true;
    });
    if (found) {
      await this.mailer.send({
        to: email,
        kind: 'password_reset',
        subject: 'Reset your password',
        text: `Reset your password (valid for 1 hour): ${this.config.APP_URL}/reset-password?token=${token}\nIf you did not ask for this, ignore this email.`,
      });
    }
  }

  async resetPassword(token: string, password: string, client: ClientInfo): Promise<void> {
    this.limiter.consume(`reset-ip:${client.ip}`, 10, 15 * MINUTE);
    const hash = await this.passwords.hash(password);
    const userId = await withContext(this.db, { requestId: client.requestId }, async (tx) => {
      const r = await tx.execute<{ id: string | null }>(
        sql`select app.auth_reset_password(${sha256(token)}, ${hash}) as id`,
      );
      return r.rows[0]?.id ?? null;
    });
    if (!userId)
      throw new AppError('VALIDATION_FAILED', 'This reset link is invalid or has expired');
  }

  async verifyEmail(token: string, client: ClientInfo): Promise<void> {
    const userId = await withContext(this.db, { requestId: client.requestId }, async (tx) => {
      const r = await tx.execute<{ id: string | null }>(
        sql`select app.auth_verify_email(${sha256(token)}) as id`,
      );
      return r.rows[0]?.id ?? null;
    });
    if (!userId) throw new AppError('VALIDATION_FAILED', 'This link is invalid or has expired');
  }

  async resendVerification(auth: SessionAuth): Promise<void> {
    this.limiter.consume(`verify-resend:${auth.userId}`, 3, 60 * MINUTE);
    const token = randomToken();
    const email = await withContext(
      this.db,
      { userId: auth.userId, requestId: auth.requestId },
      async (tx) => {
        const me = await this.profile(tx, auth.userId);
        if (me.emailVerifiedAt || !me.email) return null;
        await tx.execute(sql`
        select app.auth_token_create(${auth.userId}, 'verify_email', ${sha256(token)}, '3 days'::interval, null)`);
        return me.email;
      },
    );
    if (email) {
      await this.mailer.send({
        to: email,
        kind: 'verify_email',
        subject: 'Confirm your email address',
        text: `Confirm your email: ${this.config.APP_URL}/verify-email?token=${token}`,
      });
    }
  }

  async acceptInvite(token: string, password: string, client: ClientInfo): Promise<NewSession> {
    this.limiter.consume(`invite-ip:${client.ip}`, 10, 15 * MINUTE);
    const hash = await this.passwords.hash(password);
    return withContext(this.db, { requestId: client.requestId }, async (tx) => {
      const r = await tx
        .execute<{ user_id: string; tenant_id: string }>(
          sql`select * from app.auth_accept_invite(${sha256(token)}, ${hash})`,
        )
        .catch((err: unknown) => {
          if (/already active/.test(String((err as { cause?: unknown }).cause ?? err))) {
            throw new AppError(
              'CONFLICT',
              'This mobile number already has an account. Sign in with your mobile number and password.',
            );
          }
          throw err;
        });
      const accepted = r.rows[0];
      if (!accepted)
        throw new AppError('VALIDATION_FAILED', 'This invitation is invalid or has expired');
      return this.sessions.create(tx, {
        userId: accepted.user_id,
        activeTenantId: accepted.tenant_id,
        mfaPending: false,
        ip: client.ip,
        userAgent: client.userAgent,
      });
    });
  }

  // ---------------------------------------------------------------- me / tenants / sessions

  async me(auth: SessionAuth) {
    return withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, async (tx) => {
      const user = await this.profile(tx, auth.userId);
      const tenants = await this.userTenants(tx, auth.userId);
      const role = await tx.execute<{ role: string | null }>(
        sql`select app.platform_role(${auth.userId}) as role`,
      );
      return {
        user: {
          id: user.id,
          email: user.email,
          loginPhone: user.loginPhone,
          fullName: user.fullName,
          emailVerified: Boolean(user.emailVerifiedAt),
          mfaEnabled: Boolean(user.mfaEnabledAt),
        },
        activeTenantId: auth.activeTenantId,
        tenants: tenants.map((t) => ({
          id: t.tenant_id,
          slug: t.slug,
          name: t.name,
          tenantStatus: t.tenant_status,
          membershipStatus: t.membership_status,
        })),
        platformRole: role.rows[0]?.role ?? null,
        mfaEnforced: this.config.MFA_ENFORCEMENT === 'on',
      };
    });
  }

  async switchTenant(auth: SessionAuth, tenantId: string): Promise<void> {
    await withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, async (tx) => {
      const tenants = await this.userTenants(tx, auth.userId);
      const target = tenants.find((t) => t.tenant_id === tenantId);
      if (!target || target.membership_status !== 'active') {
        throw new AppError('NOT_FOUND', 'School not found');
      }
      await tx
        .update(schema.sessions)
        .set({ activeTenantId: tenantId })
        .where(eq(schema.sessions.id, auth.sessionId));
    });
  }

  async listSessions(auth: SessionAuth) {
    return withContext(this.db, { userId: auth.userId, requestId: auth.requestId }, async (tx) => {
      const rows = await tx
        .select({
          id: schema.sessions.id,
          createdAt: schema.sessions.createdAt,
          lastSeenAt: schema.sessions.lastSeenAt,
          expiresAt: schema.sessions.expiresAt,
          ip: schema.sessions.ip,
          userAgent: schema.sessions.userAgent,
        })
        .from(schema.sessions)
        .where(and(isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())))
        .orderBy(schema.sessions.lastSeenAt);
      return rows.map((r) => ({ ...r, current: r.id === auth.sessionId }));
    });
  }

  async revokeSession(auth: SessionAuth, sessionId: string): Promise<void> {
    const n = await withContext(
      this.db,
      { userId: auth.userId, requestId: auth.requestId },
      async (tx) => {
        const r = await tx
          .update(schema.sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
        return r.rowCount ?? 0;
      },
    );
    if (n === 0) throw new AppError('NOT_FOUND', 'Session not found');
  }

  // ---------------------------------------------------------------- helpers

  private async secrets(tx: Transaction, userId: string): Promise<UserSecrets> {
    const r = await tx.execute<UserSecrets>(sql`select * from app.auth_user_secrets(${userId})`);
    const row = r.rows[0];
    if (!row) throw new AppError('UNAUTHENTICATED', 'Sign in required');
    return row;
  }

  private async profile(tx: Transaction, userId: string) {
    const [row] = await tx
      .select({
        id: schema.users.id,
        email: schema.users.email,
        loginPhone: schema.users.loginPhone,
        fullName: schema.users.fullName,
        emailVerifiedAt: schema.users.emailVerifiedAt,
        mfaEnabledAt: schema.users.mfaEnabledAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!row) throw new AppError('UNAUTHENTICATED', 'Sign in required');
    return row;
  }

  private async userTenants(tx: Transaction, userId: string) {
    const r = await tx.execute<{
      tenant_id: string;
      slug: string;
      name: string;
      tenant_status: string;
      membership_status: string;
    }>(sql`select * from app.user_tenants(${userId})`);
    return r.rows;
  }
}
