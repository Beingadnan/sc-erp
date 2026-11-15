import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type {
  InviteMemberInput,
  RoleAssignmentInput,
  StaffProfileInput,
} from '@school-erp/validation';
import { rethrowConflicts } from '../common/pg-errors.js';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';
import { DB_HANDLE } from '../database/database.module.js';
import { randomToken, sha256 } from '../common/crypto.js';
import type { TenantAccess } from '../auth/access.js';
import { MAILER } from '../auth/mailer.js';
import type { Mailer } from '../auth/mailer.js';
import { AuditService } from './audit.service.js';
import { OutboxService } from './outbox.service.js';

const m = schema.tenantMemberships;
const mr = schema.membershipRoles;
const u = schema.users;

export interface PendingMail {
  to: string;
  subject: string;
  text: string;
  kind: string;
}

@Injectable()
export class MembersService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  list(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const members = await tx
          .select({
            id: m.id,
            userId: m.userId,
            status: m.status,
            createdAt: m.createdAt,
            email: u.email,
            loginPhone: u.loginPhone,
            fullName: u.fullName,
            lastLoginAt: u.lastLoginAt,
            designation: schema.staffProfiles.designation,
            employeeCode: schema.staffProfiles.employeeCode,
            mfaEnabledAt: u.mfaEnabledAt,
          })
          .from(m)
          .innerJoin(u, eq(u.id, m.userId))
          .leftJoin(
            schema.staffProfiles,
            and(
              eq(schema.staffProfiles.tenantId, m.tenantId),
              eq(schema.staffProfiles.membershipId, m.id),
            ),
          )
          .orderBy(asc(u.fullName));
        const assignments = await tx
          .select({
            membershipId: mr.membershipId,
            roleId: mr.roleId,
            roleName: schema.roles.name,
            roleKey: schema.roles.key,
            campusId: mr.campusId,
          })
          .from(mr)
          .innerJoin(
            schema.roles,
            and(eq(schema.roles.id, mr.roleId), eq(schema.roles.tenantId, mr.tenantId)),
          );

        const scope = access.scopeOf('members.view');
        return (
          members
            .map(({ mfaEnabledAt, ...member }) => ({
              ...member,
              mfaEnabled: Boolean(mfaEnabledAt),
              assignments: assignments
                .filter((a) => a.membershipId === member.id)
                .map(({ membershipId: _, ...a }) => a),
            }))
            // Parents are managed from the student page, not as staff.
            .filter((member) => !member.assignments.every((a) => a.roleKey === 'parent'))
            .filter(
              (member) =>
                scope === null ||
                member.assignments.some((a) => a.campusId !== null && scope.has(a.campusId)),
            )
        );
      },
      { readOnly: true },
    );
  }

  async invite(access: TenantAccess, input: InviteMemberInput) {
    const mails: PendingMail[] = [];
    const result = await withTenant(this.handle.db, access.ctx, (tx) =>
      this.inviteInTx(tx, access, input, mails),
    );
    for (const mail of mails) await this.mailer.send(mail);
    return result;
  }

  async sendMails(mails: PendingMail[]) {
    for (const mail of mails) await this.mailer.send(mail);
  }

  /** Adds a staff member inside the caller's transaction; mails are queued for after commit. */
  async inviteInTx(
    tx: Transaction,
    access: TenantAccess,
    input: InviteMemberInput,
    mails: PendingMail[],
  ) {
    {
      await this.assertAssignable(tx, access, input.assignments);

      const existing = await tx.execute<{
        user_id: string;
        password_hash: string | null;
        status: string;
      }>(
        input.phone
          ? sql`select user_id, password_hash, status from app.auth_user_for_login_phone(${input.phone})`
          : sql`select user_id, password_hash, status from app.auth_user_for_login(${input.email ?? ''})`,
      );
      let userId = existing.rows[0]?.user_id ?? null;
      const hasPassword = Boolean(existing.rows[0]?.password_hash);
      if (existing.rows[0] && existing.rows[0].status !== 'active') {
        throw new AppError('CONFLICT', 'This account is disabled');
      }
      if (!userId) {
        const created = await tx.execute<{ id: string }>(
          input.phone
            ? sql`select app.auth_create_phone_user(${input.phone}, ${input.fullName}) as id`
            : sql`select app.auth_create_user(${input.email ?? ''}, ${input.fullName}, null) as id`,
        );
        userId = created.rows[0]!.id;
      }

      const [already] = await tx
        .select({ id: m.id, status: m.status })
        .from(m)
        .where(eq(m.userId, userId));
      if (already) {
        // A parent of this school joining the staff keeps one account: add the staff roles.
        const keys = (
          await tx
            .select({ key: schema.roles.key })
            .from(mr)
            .innerJoin(
              schema.roles,
              and(eq(schema.roles.id, mr.roleId), eq(schema.roles.tenantId, mr.tenantId)),
            )
            .where(eq(mr.membershipId, already.id))
        ).map((r) => r.key);
        if (!keys.length || keys.some((k) => k !== 'parent') || already.status === 'suspended') {
          throw new AppError('CONFLICT', 'This person is already a member of the school');
        }
        await this.insertAssignments(tx, access, already.id, input.assignments);
        await tx
          .insert(schema.staffProfiles)
          .values({
            tenantId: access.tenantId,
            membershipId: already.id,
            designation: input.designation,
            employeeCode: input.employeeCode || null,
            phone: input.phone ?? null,
          })
          .onConflictDoNothing();
        await this.audit.record(tx, access, {
          action: 'member.invited',
          entity: 'membership',
          entityId: already.id,
          diff: { parentBecameStaff: true, assignments: input.assignments },
        });
        return { id: already.id, userId, status: already.status, link: null };
      }

      const status = hasPassword ? 'active' : 'invited';
      const [membership] = await tx
        .insert(m)
        .values({ tenantId: access.tenantId, userId, status, invitedBy: access.userId })
        .returning({ id: m.id });
      await this.insertAssignments(tx, access, membership!.id, input.assignments);
      await tx.insert(schema.staffProfiles).values({
        tenantId: access.tenantId,
        membershipId: membership!.id,
        designation: input.designation,
        employeeCode: input.employeeCode || null,
        phone: input.phone ?? null,
      });
      let link: { url: string; message: string; phone: string } | null = null;

      const [tenant] = await tx
        .select({ name: schema.tenants.name })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, access.tenantId));
      if (input.phone) {
        // No email: the school sends the link on WhatsApp (an existing account just gets access).
        if (!hasPassword) {
          const token = randomToken();
          await tx.execute(sql`
            select app.auth_token_create(${userId}, 'invite', ${sha256(token)}, '7 days'::interval, ${access.tenantId})`);
          const url = `${this.config.APP_URL}/accept-invite?token=${token}`;
          link = {
            url,
            phone: input.phone,
            message: `Namaste ${input.fullName}, you have been added to ${tenant?.name} on the school app. Open this link to set your password (valid 7 days): ${url} — then sign in with this mobile number.`,
          };
        }
      } else if (hasPassword) {
        mails.push({
          to: input.email!,
          kind: 'member_added',
          subject: `You now have access to ${tenant?.name}`,
          text: `You were added to ${tenant?.name}. Sign in: ${this.config.APP_URL}/login`,
        });
      } else {
        const token = randomToken();
        await tx.execute(sql`
          select app.auth_token_create(${userId}, 'invite', ${sha256(token)}, '7 days'::interval, ${access.tenantId})`);
        mails.push({
          to: input.email!,
          kind: 'invite',
          subject: `You are invited to ${tenant?.name}`,
          text: `You have been invited to ${tenant?.name}. Set your password (valid 7 days): ${this.config.APP_URL}/accept-invite?token=${token}`,
        });
      }

      await this.audit.record(tx, access, {
        action: 'member.invited',
        entity: 'membership',
        entityId: membership!.id,
        diff: {
          email: input.email ?? null,
          phone: input.phone ? `••••${input.phone.slice(-4)}` : null,
          status,
          assignments: input.assignments,
        },
      });
      await this.outbox.emit(tx, access, 'member.invited', {
        membershipId: membership!.id,
        status,
      });
      return { id: membership!.id, userId, status, link };
    }
  }

  async setRoles(access: TenantAccess, membershipId: string, assignments: RoleAssignmentInput[]) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const target = await this.membership(tx, membershipId);
      const current = await tx
        .select({ roleId: mr.roleId, campusId: mr.campusId })
        .from(mr)
        .where(eq(mr.membershipId, target.id));
      const key = (a: { roleId: string; campusId: string | null }) => `${a.roleId}:${a.campusId}`;
      const next = new Set(assignments.map(key));
      const removed = current.filter((a) => !next.has(key(a)));
      const added = assignments.filter((a) => !current.some((c) => key(c) === key(a)));

      // You must be able to grant a role to add it — and to take it away.
      await this.assertAssignable(tx, access, [...added, ...removed]);
      await tx.delete(mr).where(eq(mr.membershipId, target.id));
      await this.insertAssignments(tx, access, target.id, assignments);
      await this.assertOwnerRemains(tx);
      await this.audit.record(tx, access, {
        action: 'member.roles_changed',
        entity: 'membership',
        entityId: target.id,
        diff: { added, removed },
      });
    });
  }

  async setStatus(access: TenantAccess, membershipId: string, status: 'active' | 'suspended') {
    if (!access.hasTenantWide('members.manage')) {
      throw new AppError(
        'FORBIDDEN',
        'Only school-wide administrators can suspend or restore access',
      );
    }
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const target = await this.membership(tx, membershipId);
      if (target.userId === access.userId)
        throw new AppError('CONFLICT', 'You cannot change your own access');
      if (target.status === 'invited')
        throw new AppError('CONFLICT', 'This invitation has not been accepted yet');
      const roles = await tx
        .select({ roleId: mr.roleId, campusId: mr.campusId })
        .from(mr)
        .where(eq(mr.membershipId, target.id));
      await this.assertAssignable(tx, access, roles);
      await tx.update(m).set({ status }).where(eq(m.id, target.id));
      await this.assertOwnerRemains(tx);
      await this.audit.record(tx, access, {
        action: status === 'suspended' ? 'member.suspended' : 'member.restored',
        entity: 'membership',
        entityId: target.id,
      });
    });
  }

  // -----------------------------------------------------------------------------

  /** School-side details (designation, employee code, mobile, joining date). */
  saveProfile(access: TenantAccess, membershipId: string, input: StaffProfileInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const target = await this.membership(tx, membershipId);
      const values = {
        designation: input.designation,
        employeeCode: input.employeeCode || null,
        phone: input.phone,
        joinedOn: input.joinedOn,
      };
      try {
        await tx
          .insert(schema.staffProfiles)
          .values({ tenantId: access.tenantId, membershipId: target.id, ...values })
          .onConflictDoUpdate({
            target: [schema.staffProfiles.tenantId, schema.staffProfiles.membershipId],
            set: { ...values, updatedAt: new Date() },
          });
      } catch (err) {
        return rethrowConflicts(err, {
          staff_profiles_code_uq: 'Another staff member already has this employee code',
        });
      }
      await this.audit.record(tx, access, {
        action: 'member.profile_updated',
        entity: 'membership',
        entityId: target.id,
        diff: { designation: input.designation, employeeCode: input.employeeCode },
      });
      return { id: target.id, ...values };
    });
  }

  private async membership(tx: Transaction, id: string) {
    const [row] = await tx
      .select({ id: m.id, userId: m.userId, status: m.status })
      .from(m)
      .where(eq(m.id, id));
    if (!row) throw notFound('Member');
    return row;
  }

  /**
   * Every role/campus pair must exist in this tenant, and the actor must be able to grant
   * each of the role's permissions for that campus (no privilege escalation).
   */
  private async assertAssignable(
    tx: Transaction,
    access: TenantAccess,
    assignments: ReadonlyArray<{ roleId: string; campusId: string | null }>,
  ) {
    if (assignments.length === 0) return;
    const roleIds = [...new Set(assignments.map((a) => a.roleId))];
    const campusIds = [
      ...new Set(assignments.map((a) => a.campusId).filter((x): x is string => x !== null)),
    ];
    const roles = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(inArray(schema.roles.id, roleIds));
    if (roles.length !== roleIds.length) throw notFound('Role');
    if (campusIds.length) {
      const campuses = await tx
        .select({ id: schema.campuses.id })
        .from(schema.campuses)
        .where(inArray(schema.campuses.id, campusIds));
      if (campuses.length !== campusIds.length) throw notFound('Campus');
    }
    const perms = await tx
      .select({ roleId: schema.rolePermissions.roleId, key: schema.rolePermissions.permissionKey })
      .from(schema.rolePermissions)
      .where(inArray(schema.rolePermissions.roleId, roleIds));
    for (const a of assignments) {
      if (!access.canGrant('members.manage', a.campusId)) {
        throw new AppError('FORBIDDEN', 'You cannot manage members for this campus');
      }
      const missing = perms.filter(
        (p) => p.roleId === a.roleId && !access.canGrant(p.key, a.campusId),
      );
      if (missing.length) {
        throw new AppError(
          'FORBIDDEN',
          'You can only assign roles whose permissions you hold yourself',
          {
            permissions: [...new Set(missing.map((p) => p.key))],
          },
        );
      }
    }
  }

  private async insertAssignments(
    tx: Transaction,
    access: TenantAccess,
    membershipId: string,
    assignments: RoleAssignmentInput[],
  ) {
    const unique = [...new Map(assignments.map((a) => [`${a.roleId}:${a.campusId}`, a])).values()];
    if (unique.length === 0) return;
    await tx.insert(mr).values(
      unique.map((a) => ({
        tenantId: access.tenantId,
        membershipId,
        roleId: a.roleId,
        campusId: a.campusId,
      })),
    );
  }

  /** A school must always keep at least one active, school-wide owner. */
  private async assertOwnerRemains(tx: Transaction) {
    const [row] = await tx
      .select({ n: sql<number>`count(distinct ${m.id})::int` })
      .from(m)
      .innerJoin(mr, and(eq(mr.membershipId, m.id), eq(mr.tenantId, m.tenantId)))
      .innerJoin(
        schema.roles,
        and(eq(schema.roles.id, mr.roleId), eq(schema.roles.tenantId, mr.tenantId)),
      )
      .where(
        and(
          eq(m.status, 'active'),
          eq(schema.roles.key, 'owner'),
          sql`${mr.campusId} is null`,
          ne(m.status, 'invited'),
        ),
      );
    if (!row || row.n < 1) {
      throw new AppError('CONFLICT', 'The school must keep at least one active owner');
    }
  }
}
