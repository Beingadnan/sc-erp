import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withContext, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import { parentPasswordSchema } from '@school-erp/validation';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';
import { DB_HANDLE } from '../database/database.module.js';
import { FixedWindowLimiter } from '../common/rate-limiter.js';
import { randomToken, sha256 } from '../common/crypto.js';
import type { TenantAccess } from '../auth/access.js';
import type { ClientInfo } from '../auth/decorators.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { NewSession } from '../auth/session.service.js';
import { AuditService } from '../tenancy/audit.service.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { DemandsService } from '../fees/demands.service.js';
import { PaymentsService } from '../fees/payments.service.js';
import { PayToSchoolService } from '../fees/pay-to-school.service.js';
import { ClassroomService } from '../classroom/classroom.service.js';
import { ExamsService } from '../exams/exams.service.js';
import { NoticesService } from '../classroom/notices.service.js';
import { todayIn } from '../attendance/attendance.service.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const ACTIVATE_DAYS = 7;
const RESET_DAYS = 2;
const pi = schema.portalInvites;
type Rows = Array<Record<string, unknown>>;

const maskPhone = (p: string) => `${p.slice(0, 3)} ••••• ${p.slice(-4)}`;
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/**
 * The parent portal. Staff give a guardian access with a one-time link (shared on WhatsApp);
 * the parent then signs in with their mobile number and sees only the children they are a
 * guardian of. Every family query starts from guardians.user_id = the signed-in user.
 */
@Injectable()
export class PortalService {
  private readonly limiter: FixedWindowLimiter;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly demands: DemandsService,
    private readonly payments: PaymentsService,
    private readonly payToSchool: PayToSchoolService,
    private readonly classroom: ClassroomService,
    private readonly notices: NoticesService,
    private readonly exams: ExamsService,
  ) {
    this.limiter = new FixedWindowLimiter(config.NODE_ENV === 'test' ? 50 : 1);
  }

  /* ------------------------------------ staff side ------------------------------------ */

  private async studentCampus(tx: Transaction, studentId: string) {
    const [s] = await tx
      .select({ campusId: schema.students.campusId })
      .from(schema.students)
      .where(eq(schema.students.id, studentId));
    if (!s) throw notFound('Student');
    return s.campusId;
  }

  /** Guardians of a student and whether each can use the portal. */
  guardianAccess(access: TenantAccess, studentId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const campusId = await this.studentCampus(tx, studentId);
        const canManage = access.has('portal.manage', campusId);
        if (!canManage && !access.has('students.view', campusId)) throw notFound('Student');
        const rows = (
          await tx.execute(sql`
            select g.id, g.full_name as "fullName", g.phone, sg.relationship, sg.is_primary as "isPrimary",
              g.user_id as "userId", u.last_login_at as "lastLoginAt", u.login_phone as "loginPhone",
              (select max(i.expires_at) from portal_invites i
                 where i.tenant_id = g.tenant_id and i.guardian_id = g.id and i.consumed_at is null
                   and i.revoked_at is null and i.expires_at > now()) as "openInviteExpiresAt"
            from student_guardians sg
            join guardians g on g.tenant_id = sg.tenant_id and g.id = sg.guardian_id
            left join users u on u.id = g.user_id
            where sg.student_id = ${studentId}
            order by sg.is_primary desc, g.full_name`)
        ).rows as Rows;
        return {
          canManage,
          guardians: rows.map((r) => ({
            id: r.id,
            fullName: r.fullName,
            phone: r.phone,
            relationship: r.relationship,
            isPrimary: r.isPrimary,
            status: r.userId ? 'active' : r.openInviteExpiresAt ? 'invited' : 'none',
            loginPhone: r.loginPhone ?? null,
            lastLoginAt: r.lastLoginAt ?? null,
            inviteExpiresAt: r.openInviteExpiresAt ?? null,
          })),
        };
      },
      { readOnly: true },
    );
  }

  /** The guardian's campuses must include one where the caller may manage portal access. */
  private async guardianFor(tx: Transaction, access: TenantAccess, guardianId: string) {
    const [g] = (
      await tx.execute(sql`
        select g.id, g.full_name as "fullName", g.phone, g.user_id as "userId",
          array_agg(distinct s.campus_id::text) as campuses,
          (array_agg(s.first_name order by sg.is_primary desc))[1] as "childName"
        from guardians g
        join student_guardians sg on sg.tenant_id = g.tenant_id and sg.guardian_id = g.id
        join students s on s.tenant_id = sg.tenant_id and s.id = sg.student_id
        where g.id = ${guardianId}
        group by g.id`)
    ).rows as Array<{
      id: string;
      fullName: string;
      phone: string;
      userId: string | null;
      campuses: string[];
      childName: string;
    }>;
    if (
      !g ||
      !g.campuses.some((c) => access.has('students.view', c) || access.has('portal.manage', c))
    ) {
      throw notFound('Guardian');
    }
    const campusId = g.campuses.find((c) => access.has('portal.manage', c));
    if (!campusId) throw new AppError('FORBIDDEN', 'You cannot give portal access at this campus');
    return { ...g, campusId };
  }

  createInvite(access: TenantAccess, guardianId: string, purpose: 'activate' | 'reset') {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const g = await this.guardianFor(tx, access, guardianId);
      if (purpose === 'reset') {
        if (!g.userId)
          throw new AppError('CONFLICT', 'This parent has not activated the portal yet');
        const [{ ok }] = (await tx.execute(sql`select app.portal_reset_allowed(${g.userId}) as ok`))
          .rows as [{ ok: boolean }];
        if (!ok) {
          throw new AppError(
            'CONFLICT',
            'This account is also used elsewhere, so the school cannot reset its password. The parent can sign in with their current password.',
          );
        }
      } else if (g.userId) {
        throw new AppError('CONFLICT', 'This parent already has portal access');
      }
      await tx
        .update(pi)
        .set({ revokedAt: new Date() })
        .where(
          sql`${pi.guardianId} = ${guardianId} and ${pi.consumedAt} is null and ${pi.revokedAt} is null`,
        );
      const token = randomToken();
      const expiresAt = new Date(
        Date.now() + (purpose === 'reset' ? RESET_DAYS : ACTIVATE_DAYS) * DAY,
      );
      const [row] = await tx
        .insert(pi)
        .values({
          tenantId: access.tenantId,
          guardianId,
          purpose,
          tokenHash: sha256(token),
          phone: g.phone,
          expiresAt,
          createdBy: access.userId,
        })
        .returning({ id: pi.id });
      await this.audit.record(tx, access, {
        action: purpose === 'reset' ? 'portal.reset_link_created' : 'portal.invite_created',
        entity: 'guardian',
        entityId: guardianId,
        campusId: g.campusId,
        diff: { expiresAt: expiresAt.toISOString() },
      });
      const [t] = await tx
        .select({ name: schema.tenants.name })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, access.tenantId));
      const url = `${this.config.APP_URL}/portal/activate?token=${token}`;
      const message =
        purpose === 'reset'
          ? `Dear ${g.fullName}, use this link to set a new password for the ${t?.name ?? 'school'} parent app (valid ${RESET_DAYS} days): ${url}`
          : `Dear ${g.fullName}, see ${g.childName}'s attendance, fees and receipts on the ${t?.name ?? 'school'} parent app. Open this link to set your password (valid ${ACTIVATE_DAYS} days): ${url} — then sign in with this mobile number.`;
      return { id: row!.id, url, expiresAt, phone: g.phone, message, purpose };
    });
  }

  revoke(access: TenantAccess, guardianId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const g = await this.guardianFor(tx, access, guardianId);
      await tx.execute(sql`select app.portal_unlink_guardian(${guardianId})`);
      await this.audit.record(tx, access, {
        action: 'portal.access_removed',
        entity: 'guardian',
        entityId: guardianId,
        campusId: g.campusId,
      });
      return { id: guardianId, status: 'none' };
    });
  }

  /* ---------------------------------- activation (public) ---------------------------------- */

  private async peekRow(tx: Transaction, token: string) {
    const r = await tx.execute<{
      tenant_id: string;
      invite_id: string;
      purpose: 'activate' | 'reset';
      status: 'open' | 'expired' | 'used';
      school_name: string;
      guardian_name: string;
      phone: string;
      has_account: boolean;
    }>(sql`select * from app.portal_invite_peek(${sha256(token)})`);
    return r.rows[0] ?? null;
  }

  async peek(token: string, client: ClientInfo) {
    this.limiter.consume(`portal-peek:${client.ip ?? 'unknown'}`, 60, MINUTE);
    const row = await withContext(this.handle.db, { requestId: client.requestId }, (tx) =>
      this.peekRow(tx, token),
    );
    if (!row) throw notFound('Link');
    return {
      status: row.status,
      purpose: row.purpose,
      schoolName: row.school_name,
      guardianFirstName: firstName(row.guardian_name),
      phone: maskPhone(row.phone),
      hasAccount: row.has_account,
    };
  }

  async accept(token: string, password: string, client: ClientInfo): Promise<NewSession> {
    this.limiter.consume(`portal-accept:${client.ip ?? 'unknown'}`, 10, 15 * MINUTE);
    return withContext(this.handle.db, { requestId: client.requestId }, async (tx) => {
      const row = await this.peekRow(tx, token);
      if (!row || row.status !== 'open') {
        throw new AppError(
          'VALIDATION_FAILED',
          'This link is invalid or has expired. Ask the school for a new one.',
        );
      }
      let existing: string | null = null;
      let hash: string | null = null;
      if (row.purpose === 'activate' && row.has_account) {
        // The number already has an account (e.g. a child at another school): prove it is yours.
        this.limiter.consume(`portal-existing:${row.phone}`, 10, 15 * MINUTE);
        const u = (
          await tx.execute<{ user_id: string; password_hash: string | null; status: string }>(
            sql`select user_id, password_hash, status from app.auth_user_for_login_phone(${row.phone})`,
          )
        ).rows[0];
        const ok = await this.passwords.verify(u?.password_hash, password);
        if (!u || !ok || u.status !== 'active') {
          throw new AppError(
            'UNAUTHENTICATED',
            'That is not the password of this mobile number’s account',
          );
        }
        existing = u.user_id;
      } else {
        const check = parentPasswordSchema.safeParse(password);
        if (!check.success) {
          throw new AppError('VALIDATION_FAILED', check.error.issues[0]!.message, {
            fields: { password: check.error.issues[0]!.message },
          });
        }
        hash = await this.passwords.hash(password);
      }
      const done = (
        await tx.execute<{ user_id: string; tenant_id: string }>(
          sql`select * from app.portal_accept_invite(${sha256(token)}, ${hash}, ${existing})`,
        )
      ).rows[0];
      if (!done) {
        throw new AppError(
          'VALIDATION_FAILED',
          'This link is invalid or has expired. Ask the school for a new one.',
        );
      }
      return this.sessions.create(tx, {
        userId: done.user_id,
        activeTenantId: done.tenant_id,
        mfaPending: false,
        ip: client.ip,
        userAgent: client.userAgent,
      });
    });
  }

  /* ------------------------------------- family side ------------------------------------- */

  /** The children the signed-in user is a guardian of, in this school. */
  private async children(tx: Transaction, access: TenantAccess) {
    return (
      await tx.execute(sql`
        select s.id, s.first_name as "firstName", s.last_name as "lastName",
          s.admission_number as "admissionNumber", s.status, s.campus_id as "campusId",
          c.name as "campusName", sg.relationship,
          e.id as "enrollmentId", e.section_id as "sectionId", e.academic_year_id as "academicYearId",
          gl.name as "className", sec.name as "sectionName"
        from guardians g
        join student_guardians sg on sg.tenant_id = g.tenant_id and sg.guardian_id = g.id
        join students s on s.tenant_id = sg.tenant_id and s.id = sg.student_id
        join campuses c on c.tenant_id = s.tenant_id and c.id = s.campus_id
        left join lateral (
          select e.* from student_enrollments e
          join academic_years y on y.tenant_id = e.tenant_id and y.id = e.academic_year_id
          where e.tenant_id = s.tenant_id and e.student_id = s.id
          order by y.starts_on desc limit 1) e on true
        left join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
        left join grade_levels gl on gl.tenant_id = sec.tenant_id and gl.id = sec.grade_level_id
        where g.user_id = ${access.userId}
        order by s.first_name`)
    ).rows as Array<{
      id: string;
      firstName: string;
      lastName: string;
      admissionNumber: string;
      status: string;
      campusId: string;
      campusName: string;
      relationship: string;
      enrollmentId: string | null;
      sectionId: string | null;
      academicYearId: string | null;
      className: string | null;
      sectionName: string | null;
    }>;
  }

  private async child(tx: Transaction, access: TenantAccess, studentId: string) {
    const c = (await this.children(tx, access)).find((x) => x.id === studentId);
    if (!c) throw notFound('Student');
    return c;
  }

  home(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const kids = await this.children(tx, access);
        const [t] = await tx
          .select({ name: schema.tenants.name })
          .from(schema.tenants)
          .where(eq(schema.tenants.id, access.tenantId));
        const ids = kids.map((k) => k.id);
        const dues = ids.length
          ? ((
              await tx.execute(sql`
                select v.student_id as "studentId",
                  sum(l.amount - coalesce(adj.amt, 0) - coalesce(al.amt, 0))::bigint as outstanding,
                  sum(case when v.due_on <= (now() at time zone c.timezone)::date
                      then l.amount - coalesce(adj.amt, 0) - coalesce(al.amt, 0) else 0 end)::bigint as due
                from fee_invoices v
                join campuses c on c.tenant_id = v.tenant_id and c.id = v.campus_id
                join fee_invoice_lines l on l.tenant_id = v.tenant_id and l.invoice_id = v.id
                left join lateral (select sum(a.amount) amt from fee_adjustments a
                  where a.tenant_id = l.tenant_id and a.line_id = l.id and a.status = 'approved') adj on true
                left join lateral (select sum(x.amount) amt from fee_allocations x
                  join fee_payments p on p.tenant_id = x.tenant_id and p.id = x.payment_id
                  where x.tenant_id = l.tenant_id and x.line_id = l.id and x.released_at is null
                    and p.status in ('cleared', 'pending')) al on true
                where v.status = 'active' and v.student_id in (${sql.join(
                  ids.map((i) => sql`${i}`),
                  sql`, `,
                )})
                group by v.student_id`)
            ).rows as Rows)
          : [];
        const today = ids.length
          ? ((
              await tx.execute(sql`
                select r.student_id as "studentId", r.status from student_attendance r
                join attendance_sessions s on s.tenant_id = r.tenant_id and s.id = r.session_id
                join campuses c on c.tenant_id = s.tenant_id and c.id = s.campus_id
                where r.on_date = (now() at time zone c.timezone)::date and s.period in (0, 1)
                  and r.student_id in (${sql.join(
                    ids.map((i) => sql`${i}`),
                    sql`, `,
                  )})`)
            ).rows as Rows)
          : [];
        return {
          school: t?.name ?? '',
          children: kids.map((k) => {
            const d = dues.find((x) => x.studentId === k.id);
            return {
              ...k,
              outstanding: Number(d?.outstanding ?? 0),
              due: Number(d?.due ?? 0),
              todayAttendance: (today.find((x) => x.studentId === k.id)?.status as string) ?? null,
            };
          }),
        };
      },
      { readOnly: true },
    );
  }

  async childAttendance(access: TenantAccess, studentId: string, academicYearId?: string) {
    await withTenant(this.handle.db, access.ctx, (tx) => this.child(tx, access, studentId), {
      readOnly: true,
    });
    const s = await this.attendance.studentSummary(access, studentId, academicYearId, {
      trusted: true,
    });
    return {
      enrollment: s.enrollment,
      years: s.years,
      totals: s.totals,
      low: s.low,
      lowThreshold: s.settings.lowThreshold,
      months: s.months,
      records: s.records,
      leaves: s.leaves,
    };
  }

  async childFees(access: TenantAccess, studentId: string, academicYearId?: string) {
    const c = await withTenant(
      this.handle.db,
      access.ctx,
      (tx) => this.child(tx, access, studentId),
      {
        readOnly: true,
      },
    );
    const a = await this.demands.studentAccount(access, studentId, academicYearId, {
      trusted: true,
    });
    const proofs = await withTenant(
      this.handle.db,
      access.ctx,
      async (tx) =>
        (
          await tx.execute(sql`
            select p.id, p.amount::bigint as amount, p.reference, p.paid_on::text as "paidOn",
              p.status, case when p.status = 'rejected' then p.decision_note else '' end as note,
              p.created_at as "submittedAt"
            from fee_payment_proofs p where p.student_id = ${studentId}
            order by p.created_at desc limit 20`)
        ).rows as Rows,
      { readOnly: true },
    );
    const online = await withTenant(
      this.handle.db,
      access.ctx,
      async (tx) =>
        (
          await tx
            .select({ enabled: schema.feePaymentSettings.enabled })
            .from(schema.feePaymentSettings)
            .where(eq(schema.feePaymentSettings.campusId, c.campusId))
        )[0]?.enabled ?? false,
      { readOnly: true },
    );
    return {
      enrollment: {
        className: a.enrollment.className,
        sectionName: a.enrollment.sectionName,
        yearName: a.enrollment.yearName,
      },
      years: a.years,
      today: a.today,
      totals: a.totals,
      canPayOnline: online,
      demands: a.invoices
        .filter((v) => v.status === 'active')
        .map((v) => ({
          id: v.id,
          label: [v.structureName, v.installmentLabel].filter(Boolean).join(' · '),
          dueOn: v.dueOn,
          state: v.state,
          billed: v.billed,
          reduced: v.reduced,
          paid: v.paid,
          balance: v.balance,
          lines: v.lines.map((l) => ({
            headName: l.headName,
            amount: l.amount,
            reduced: l.reduced,
            paid: l.paid,
          })),
        })),
      receipts: a.payments
        .filter((p) => p.status !== 'cancelled')
        .map((p) => ({
          id: p.id,
          receiptNumber: p.receiptNumber,
          receivedOn: p.receivedOn,
          mode: p.mode,
          amount: p.amount,
          status: p.status,
        })),
      proofs: proofs.map((p) => ({ ...p, amount: Number(p.amount) })),
    };
  }

  async receiptPdf(access: TenantAccess, paymentId: string) {
    this.limiter.consume(`family-pdf:${access.userId}`, 60, MINUTE);
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const [p] = await tx
          .select({ studentId: schema.feePayments.studentId, status: schema.feePayments.status })
          .from(schema.feePayments)
          .where(eq(schema.feePayments.id, paymentId));
        if (!p || p.status === 'cancelled') throw notFound('Receipt');
        await this.child(tx, access, p.studentId);
        return this.payments.receiptPdfInTx(tx, paymentId);
      },
      { readOnly: true },
    );
  }

  /** A parent asks to pay: a payment link they open themselves (bank / UPI + upload). */
  payLink(access: TenantAccess, studentId: string, amount?: number) {
    this.limiter.consume(`family-pay:${access.userId}`, 20, 60 * MINUTE);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const c = await this.child(tx, access, studentId);
      if (!c.enrollmentId || c.status !== 'active') {
        throw new AppError(
          'CONFLICT',
          'Fees for this student cannot be paid online; please contact the school',
        );
      }
      const r = await this.payToSchool.createLinkInTx(
        tx,
        access,
        { studentId, amount, expiresInDays: 3, note: 'Requested by parent' },
        { id: c.enrollmentId, campusId: c.campusId },
        true,
      );
      return { token: r.token, amount: r.amount, expiresAt: r.expiresAt };
    });
  }

  /* ------------------------------ homework, notices, leave ------------------------------ */

  async childHomework(access: TenantAccess, studentId: string) {
    const c = await withTenant(
      this.handle.db,
      access.ctx,
      (tx) => this.child(tx, access, studentId),
      {
        readOnly: true,
      },
    );
    if (!c.sectionId) return { items: [] };
    const items = await this.classroom.homeworkForSectionTrusted(access, c.sectionId);
    return { items: items.map(({ createdBy: _c, ...i }) => i) };
  }

  async childResults(access: TenantAccess, studentId: string) {
    const c = await withTenant(
      this.handle.db,
      access.ctx,
      (tx) => this.child(tx, access, studentId),
      {
        readOnly: true,
      },
    );
    if (!c.enrollmentId) return { items: [] };
    return this.exams.familyResults(access, c.enrollmentId);
  }

  async childReportCard(access: TenantAccess, studentId: string, examId: string) {
    this.limiter.consume(`family-pdf:${access.userId}`, 60, MINUTE);
    const c = await withTenant(
      this.handle.db,
      access.ctx,
      (tx) => this.child(tx, access, studentId),
      {
        readOnly: true,
      },
    );
    if (!c.enrollmentId) throw notFound('Report card');
    return this.exams.familyReportCard(access, examId, c.enrollmentId);
  }

  familyNotices(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => ({ items: (await this.notices.familyFeedInTx(tx, access.userId)).rows }),
      { readOnly: true },
    );
  }

  /** A parent asks for leave; the class teacher approves it in Attendance → Leave. */
  requestLeave(
    access: TenantAccess,
    studentId: string,
    input: { fromDate: string; toDate: string; reason: string },
  ) {
    this.limiter.consume(`family-leave:${access.userId}`, 20, 60 * MINUTE);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const c = await this.child(tx, access, studentId);
      if (!c.enrollmentId || !c.academicYearId || c.status !== 'active') {
        throw new AppError(
          'CONFLICT',
          'Leave cannot be requested for this student; please contact the school',
        );
      }
      const [y] = (
        await tx.execute(sql`
          select y.ends_on::text as "endsOn", cp.timezone from academic_years y
          join campuses cp on cp.tenant_id = y.tenant_id and cp.id = y.campus_id where y.id = ${c.academicYearId}`)
      ).rows as Array<{ endsOn: string; timezone: string }>;
      const today = todayIn(y!.timezone);
      const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * DAY)
        .toISOString()
        .slice(0, 10);
      if (input.fromDate < weekAgo) {
        throw new AppError('VALIDATION_FAILED', 'Leave can start at most 7 days ago', {
          fields: { fromDate: 'Too old' },
        });
      }
      if (input.toDate > y!.endsOn) {
        throw new AppError('VALIDATION_FAILED', 'Leave must end within the school year', {
          fields: { toDate: 'Too late' },
        });
      }
      if (Date.parse(input.toDate) - Date.parse(input.fromDate) > 30 * DAY) {
        throw new AppError(
          'VALIDATION_FAILED',
          'For more than 30 days, please speak to the school',
        );
      }
      await this.attendance.assertNoOverlap(tx, studentId, input.fromDate, input.toDate);
      const [row] = await tx
        .insert(schema.leaveRequests)
        .values({
          tenantId: access.tenantId,
          studentId,
          academicYearId: c.academicYearId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          reason: input.reason,
          requestedVia: 'parent_app',
          recordedBy: access.userId,
        })
        .returning({ id: schema.leaveRequests.id, status: schema.leaveRequests.status });
      await this.audit.record(tx, access, {
        action: 'attendance.leave_requested_by_parent',
        entity: 'leave_request',
        entityId: row!.id,
        campusId: c.campusId,
        diff: { studentId, fromDate: input.fromDate, toDate: input.toDate },
      });
      return row!;
    });
  }

  cancelLeave(access: TenantAccess, leaveId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [l] = await tx
        .select()
        .from(schema.leaveRequests)
        .where(eq(schema.leaveRequests.id, leaveId));
      if (!l) throw notFound('Leave');
      await this.child(tx, access, l.studentId);
      if (l.status !== 'pending')
        throw new AppError('CONFLICT', `This request is already ${l.status}`);
      if (l.recordedBy !== access.userId)
        throw new AppError('FORBIDDEN', 'Only the parent who asked can cancel it');
      await tx
        .update(schema.leaveRequests)
        .set({ status: 'cancelled' })
        .where(eq(schema.leaveRequests.id, leaveId));
      return { id: leaveId, status: 'cancelled' };
    });
  }
}
