import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withContext, withTenant } from '@school-erp/db';
import { AppError, newId, notFound } from '@school-erp/shared';
import { MAX_DOCUMENT_BYTES, upiPayUri } from '@school-erp/validation';
import type {
  PaymentLinkInput,
  PaymentSettingsInput,
  ProofSubmitInput,
} from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';
import type { TenantAccess } from '../auth/access.js';
import type { ClientInfo } from '../auth/decorators.js';
import { AuditService } from '../tenancy/audit.service.js';
import { OutboxService } from '../tenancy/outbox.service.js';
import { FixedWindowLimiter } from '../common/rate-limiter.js';
import { FILE_STORAGE, safeFileName, sniffType } from '../storage/file-storage.js';
import type { FileStorage } from '../storage/file-storage.js';
import { todayIn } from '../attendance/attendance.service.js';
import { PaymentsService } from './payments.service.js';

const st = schema.feePaymentSettings;
const rq = schema.feePaymentRequests;
const pf = schema.feePaymentProofs;
const cp = schema.campuses;

const VIEW = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];
const DAY = 86_400_000;
const MINUTE = 60_000;
const LINK_TTL = 600;
const MAX_PENDING_PER_LINK = 3;

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const maskAccount = (n: string) => (n ? `••••${n.slice(-4)}` : '');
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

type Rows = Array<Record<string, unknown>>;

/**
 * Paying the school directly: the school's bank / UPI details, payment links sent to
 * parents, the screenshots and UTRs they upload, and staff checking those proofs.
 * A receipt is issued only when a staff member approves a proof.
 */
@Injectable()
export class PayToSchoolService {
  private readonly limiter: FixedWindowLimiter;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly payments: PaymentsService,
  ) {
    this.limiter = new FixedWindowLimiter(config.NODE_ENV === 'test' ? 50 : 1);
  }

  /* ----------------------------------- school details ----------------------------------- */

  private async campusFor(tx: Transaction, campusId: string) {
    const [c] = await tx
      .select({ id: cp.id, name: cp.name, code: cp.code, timezone: cp.timezone })
      .from(cp)
      .where(eq(cp.id, campusId));
    if (!c) throw notFound('Campus');
    return c;
  }

  private async settingsRow(tx: Transaction, campusId: string) {
    const [s] = await tx.select().from(st).where(eq(st.campusId, campusId));
    return s ?? null;
  }

  private async qrUrl(key: string | null) {
    return key ? this.storage.signedDownloadUrl(key, LINK_TTL) : null;
  }

  private settingsView(s: typeof st.$inferSelect | null, qrUrl: string | null) {
    if (!s) return null;
    return {
      id: s.id,
      campusId: s.campusId,
      enabled: s.enabled,
      payeeName: s.payeeName,
      upiId: s.upiId,
      bankAccountName: s.bankAccountName,
      bankAccountNumber: s.bankAccountNumber,
      ifsc: s.ifsc,
      bankName: s.bankName,
      branch: s.branch,
      instructions: s.instructions,
      hasQrImage: !!s.qrStorageKey,
      qrUrl,
      updatedAt: s.updatedAt,
    };
  }

  getSettings(access: TenantAccess, campusId: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (
          !access.has('settings.manage', campusId) &&
          !VIEW.some((p) => access.has(p, campusId))
        ) {
          throw notFound('Campus');
        }
        await this.campusFor(tx, campusId);
        const s = await this.settingsRow(tx, campusId);
        return { settings: this.settingsView(s, await this.qrUrl(s?.qrStorageKey ?? null)) };
      },
      { readOnly: true },
    );
  }

  /** Changing where parents send money is privileged (MFA) and always audited. */
  saveSettings(access: TenantAccess, input: PaymentSettingsInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      if (!access.has('settings.manage', input.campusId)) {
        throw new AppError('FORBIDDEN', 'Only school administrators can change payment details');
      }
      await this.campusFor(tx, input.campusId);
      const before = await this.settingsRow(tx, input.campusId);
      const values = {
        enabled: input.enabled,
        payeeName: input.payeeName,
        upiId: input.upiId,
        bankAccountName: input.bankAccountName,
        bankAccountNumber: input.bankAccountNumber,
        ifsc: input.ifsc,
        bankName: input.bankName,
        branch: input.branch,
        instructions: input.instructions,
        updatedBy: access.userId,
      };
      if (before) {
        await tx.update(st).set(values).where(eq(st.id, before.id));
      } else {
        await tx
          .insert(st)
          .values({ tenantId: access.tenantId, campusId: input.campusId, ...values });
      }
      const show = (
        s: Pick<
          typeof values,
          'enabled' | 'payeeName' | 'upiId' | 'bankAccountNumber' | 'ifsc'
        > | null,
      ) =>
        s && {
          enabled: s.enabled,
          payeeName: s.payeeName,
          upiId: s.upiId,
          account: maskAccount(s.bankAccountNumber),
          ifsc: s.ifsc,
        };
      await this.audit.record(tx, access, {
        action: 'fees.payment_details_changed',
        entity: 'fee_payment_settings',
        entityId: before?.id ?? null,
        campusId: input.campusId,
        diff: { before: show(before), after: show(values) },
      });
      const s = await this.settingsRow(tx, input.campusId);
      return { settings: this.settingsView(s, await this.qrUrl(s?.qrStorageKey ?? null)) };
    });
  }

  async uploadQr(access: TenantAccess, campusId: string, file: UploadedFile | undefined) {
    if (!access.has('settings.manage', campusId)) {
      throw new AppError('FORBIDDEN', 'Only school administrators can change payment details');
    }
    const type = this.checkFile(file, true);
    const id = newId();
    const key = `t/${access.tenantId}/d/${id}/${safeFileName(file!.originalname, type)}`;
    await withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await this.campusFor(tx, campusId);
        if (!(await this.settingsRow(tx, campusId))) {
          throw new AppError('CONFLICT', 'Save the account details before adding a QR code');
        }
      },
      { readOnly: true },
    );
    await this.storage.put(key, file!.buffer, type);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const s = (await this.settingsRow(tx, campusId))!;
      await tx
        .update(st)
        .set({ qrStorageKey: key, qrContentType: type, updatedBy: access.userId })
        .where(eq(st.id, s.id));
      await this.audit.record(tx, access, {
        action: 'fees.payment_qr_changed',
        entity: 'fee_payment_settings',
        entityId: s.id,
        campusId,
        diff: { qr: 'uploaded' },
      });
      return {
        settings: this.settingsView((await this.settingsRow(tx, campusId))!, await this.qrUrl(key)),
      };
    });
  }

  removeQr(access: TenantAccess, campusId: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      if (!access.has('settings.manage', campusId)) {
        throw new AppError('FORBIDDEN', 'Only school administrators can change payment details');
      }
      const s = await this.settingsRow(tx, campusId);
      if (!s) throw notFound('Payment details');
      await tx
        .update(st)
        .set({ qrStorageKey: null, qrContentType: null, updatedBy: access.userId })
        .where(eq(st.id, s.id));
      await this.audit.record(tx, access, {
        action: 'fees.payment_qr_changed',
        entity: 'fee_payment_settings',
        entityId: s.id,
        campusId,
        diff: { qr: 'removed' },
      });
      return { settings: this.settingsView((await this.settingsRow(tx, campusId))!, null) };
    });
  }

  private checkFile(file: UploadedFile | undefined, imageOnly: boolean) {
    if (!file?.buffer?.length) {
      throw new AppError('VALIDATION_FAILED', 'Choose a file to upload', {
        fields: { file: 'Required' },
      });
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw new AppError('VALIDATION_FAILED', 'Files can be at most 5 MB', {
        fields: { file: 'Too large' },
      });
    }
    const type = sniffType(file.buffer);
    if (!type || (imageOnly && type === 'application/pdf')) {
      throw new AppError(
        'VALIDATION_FAILED',
        imageOnly
          ? 'Upload a JPG, PNG or WebP image'
          : 'Upload a screenshot (JPG, PNG, WebP) or a PDF',
        { fields: { file: 'Unsupported file type' } },
      );
    }
    return type;
  }

  /* ------------------------------------ payment links ------------------------------------ */

  /** Everything due today (or, if nothing is due yet, everything outstanding). */
  private async dues(tx: Transaction, studentId: string, campusId: string, today: string) {
    const open = await this.payments.openLines(tx, studentId, campusId);
    const total = open.reduce((n, l) => n + l.outstanding, 0);
    const due = open.filter((l) => l.dueOn <= today).reduce((n, l) => n + l.outstanding, 0);
    return { total, due };
  }

  createLink(access: TenantAccess, input: PaymentLinkInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const e = await this.payments.enrollmentFor(tx, access, input.studentId, 'fees.collect');
      return this.createLinkInTx(tx, access, input, e, false);
    });
  }

  /** The caller has checked who may ask for this student's link (staff or the parent). */
  async createLinkInTx(
    tx: Transaction,
    access: TenantAccess,
    input: PaymentLinkInput,
    e: { id: string; campusId: string },
    byParent: boolean,
  ) {
    {
      const s = await this.settingsRow(tx, e.campusId);
      if (!s?.enabled) {
        throw new AppError(
          'CONFLICT',
          byParent
            ? 'The school is not taking payments online yet; please pay at the school office'
            : "Add the school's bank or UPI details (Settings → Payment details) before sending links",
        );
      }
      const campus = await this.campusFor(tx, e.campusId);
      const today = todayIn(campus.timezone);
      const { total, due } = await this.dues(tx, input.studentId, e.campusId, today);
      const amount = input.amount ?? (due || total);
      if (amount < 100) {
        throw new AppError('CONFLICT', 'Nothing is due from this student; enter an amount');
      }
      const token = randomBytes(32).toString('base64url');
      const id = newId();
      const expiresAt = new Date(Date.now() + input.expiresInDays * DAY);
      await tx.insert(rq).values({
        id,
        tenantId: access.tenantId,
        campusId: e.campusId,
        studentId: input.studentId,
        enrollmentId: e.id,
        amount,
        tokenHash: hashToken(token),
        expiresAt,
        note: input.note,
        createdBy: access.userId,
      });
      await this.audit.record(tx, access, {
        action: 'fees.payment_link_created',
        entity: 'fee_payment_request',
        entityId: id,
        campusId: e.campusId,
        diff: {
          studentId: input.studentId,
          amount,
          expiresAt: expiresAt.toISOString(),
          byParent,
        },
      });
      const [g] = (
        await tx.execute(sql`
          select s.first_name as "firstName", t.name as school, gu.full_name as guardian, gu.phone
          from students s join tenants t on t.id = s.tenant_id
          left join student_guardians sg on sg.tenant_id = s.tenant_id and sg.student_id = s.id and sg.is_primary
          left join guardians gu on gu.tenant_id = sg.tenant_id and gu.id = sg.guardian_id
          where s.id = ${input.studentId} limit 1`)
      ).rows as Rows;
      const url = `${this.config.APP_URL}/pay/${token}`;
      const message = `Dear ${g?.guardian ?? 'Parent'}, fees of Rs ${(amount / 100).toLocaleString('en-IN')} are due for ${g?.firstName ?? 'your ward'} at ${g?.school ?? 'school'}. Pay to the school account and upload the payment screenshot here: ${url}`;
      return {
        id,
        url,
        amount,
        expiresAt,
        guardianPhone: (g?.phone as string | null) ?? null,
        message,
        token,
      };
    }
  }

  listLinks(access: TenantAccess, q: { campusId: string; studentId?: string; status?: string }) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!VIEW.some((p) => access.has(p, q.campusId))) throw notFound('Campus');
        await this.campusFor(tx, q.campusId);
        const rows = (
          await tx.execute(sql`
            select r.id, r.student_id as "studentId", trim(s.first_name || ' ' || s.last_name) as "studentName",
              s.admission_number as "admissionNumber", r.amount::bigint as amount, r.note,
              case when r.status = 'open' and r.expires_at < now() then 'expired' else r.status end as status,
              r.expires_at as "expiresAt", r.created_at as "createdAt", r.paid_at as "paidAt",
              u.full_name as "createdByName",
              (select count(*) from fee_payment_proofs p where p.tenant_id = r.tenant_id and p.request_id = r.id)::int as proofs
            from fee_payment_requests r
            join students s on s.tenant_id = r.tenant_id and s.id = r.student_id
            left join users u on u.id = r.created_by
            where r.campus_id = ${q.campusId}
              ${q.studentId ? sql`and r.student_id = ${q.studentId}` : sql``}
              ${q.status ? sql`and r.status = ${q.status}` : sql``}
            order by r.created_at desc limit 200`)
        ).rows as Rows;
        return { items: rows.map((r) => ({ ...r, amount: Number(r.amount) })) };
      },
      { readOnly: true },
    );
  }

  cancelLink(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [r] = await tx.select().from(rq).where(eq(rq.id, id));
      if (!r || !VIEW.some((p) => access.has(p, r.campusId))) throw notFound('Payment link');
      if (!access.has('fees.collect', r.campusId)) {
        throw new AppError('FORBIDDEN', 'You cannot do this for this campus');
      }
      if (r.status !== 'open') throw new AppError('CONFLICT', `The link is already ${r.status}`);
      await tx
        .update(rq)
        .set({ status: 'cancelled', cancelledBy: access.userId, cancelledAt: new Date() })
        .where(eq(rq.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.payment_link_cancelled',
        entity: 'fee_payment_request',
        entityId: id,
        campusId: r.campusId,
      });
      return { id, status: 'cancelled' };
    });
  }

  /* --------------------------------- public (parent) side --------------------------------- */

  /** Finds the school from the token; then everything runs under that school's RLS. */
  private async withLink<T>(
    token: string,
    client: ClientInfo,
    fn: (tx: Transaction, tenantId: string, requestId: string) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw notFound('Payment link');
    const hash = hashToken(token);
    const found = await withContext(
      this.handle.db,
      { requestId: client.requestId },
      (tx) =>
        tx.execute<{ tenant_id: string; request_id: string }>(
          sql`select tenant_id::text, request_id::text from app.payment_request_lookup(${hash})`,
        ),
      { readOnly: true },
    );
    const row = found.rows[0];
    if (!row) throw notFound('Payment link');
    return withTenant(
      this.handle.db,
      { tenantId: row.tenant_id, userId: null, requestId: client.requestId },
      (tx) => fn(tx, row.tenant_id, row.request_id),
      { readOnly },
    );
  }

  async publicView(token: string, client: ClientInfo) {
    this.limiter.consume(`pay-view:${client.ip ?? 'unknown'}`, 60, MINUTE);
    return this.withLink(
      token,
      client,
      async (tx, _tenantId, requestId) => {
        const [r] = await tx.select().from(rq).where(eq(rq.id, requestId));
        if (!r) throw notFound('Payment link');
        const [info] = (
          await tx.execute(sql`
            select t.name as school, c.name as campus, c.timezone, s.first_name as "firstName",
              g.name || ' ' || sec.name as "className"
            from fee_payment_requests r
            join tenants t on t.id = r.tenant_id
            join campuses c on c.tenant_id = r.tenant_id and c.id = r.campus_id
            join students s on s.tenant_id = r.tenant_id and s.id = r.student_id
            join student_enrollments e on e.tenant_id = r.tenant_id and e.id = r.enrollment_id
            join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
            join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
            where r.id = ${requestId}`)
        ).rows as Rows;
        const expired = r.status === 'open' && r.expiresAt.getTime() < Date.now();
        const status = expired ? 'expired' : r.status;
        const s = await this.settingsRow(tx, r.campusId);
        const today = todayIn(info!.timezone as string);
        const { total } = await this.dues(tx, r.studentId, r.campusId, today);
        const proofs = await tx
          .select({
            id: pf.id,
            amount: pf.amount,
            reference: pf.reference,
            paidOn: pf.paidOn,
            status: pf.status,
            decisionNote: pf.decisionNote,
            createdAt: pf.createdAt,
            paymentId: pf.paymentId,
          })
          .from(pf)
          .where(eq(pf.requestId, requestId))
          .orderBy(pf.createdAt);
        const receipts = proofs
          .filter((p) => p.status === 'approved' && p.paymentId)
          .map((p) => p.paymentId!);
        const receiptRows = receipts.length
          ? ((
              await tx.execute(sql`
                select id, receipt_number as "receiptNumber", status from fee_payments
                where id in (${sql.join(
                  receipts.map((x) => sql`${x}`),
                  sql`, `,
                )})`)
            ).rows as Rows)
          : [];
        const open = status === 'open' && !!s?.enabled;
        return {
          status,
          school: info!.school,
          campus: info!.campus,
          studentFirstName: info!.firstName,
          className: info!.className,
          amount: r.amount,
          outstanding: total,
          note: r.note,
          expiresAt: r.expiresAt,
          today,
          payTo:
            open && s
              ? {
                  payeeName: s.payeeName,
                  upiId: s.upiId,
                  bankAccountName: s.bankAccountName,
                  bankAccountNumber: s.bankAccountNumber,
                  ifsc: s.ifsc,
                  bankName: s.bankName,
                  branch: s.branch,
                  instructions: s.instructions,
                  qrUrl: await this.qrUrl(s.qrStorageKey),
                  upiUri: s.upiId
                    ? upiPayUri({
                        upiId: s.upiId,
                        payeeName: s.payeeName,
                        amount: r.amount,
                        note: `Fees ${info!.firstName as string}`,
                      })
                    : null,
                }
              : null,
          proofs: proofs.map((p) => ({
            id: p.id,
            amount: p.amount,
            reference: p.reference,
            paidOn: p.paidOn,
            status: p.status,
            note: p.status === 'rejected' ? p.decisionNote : '',
            submittedAt: p.createdAt,
            receiptNumber:
              (receiptRows.find((x) => x.id === p.paymentId && x.status !== 'cancelled')
                ?.receiptNumber as string | undefined) ?? null,
          })),
        };
      },
      true,
    );
  }

  async submitProof(
    token: string,
    input: ProofSubmitInput,
    file: UploadedFile | undefined,
    client: ClientInfo,
  ) {
    this.limiter.consume(`pay-proof-ip:${client.ip ?? 'unknown'}`, 20, 60 * MINUTE);
    this.limiter.consume(`pay-proof:${hashToken(token)}`, 10, 60 * MINUTE);
    const type = this.checkFile(file, false);
    const proofId = newId();

    const check = async (tx: Transaction, tenantId: string, requestId: string) => {
      const [r] = await tx.select().from(rq).where(eq(rq.id, requestId));
      if (!r) throw notFound('Payment link');
      if (r.status !== 'open' || r.expiresAt.getTime() < Date.now()) {
        throw new AppError(
          'CONFLICT',
          r.status === 'paid'
            ? 'This link has already been paid'
            : 'This payment link is no longer active; ask the school for a new one',
        );
      }
      const s = await this.settingsRow(tx, r.campusId);
      if (!s?.enabled)
        throw new AppError('CONFLICT', 'The school is not taking payments online now');
      const campus = await this.campusFor(tx, r.campusId);
      const today = todayIn(campus.timezone);
      if (input.paidOn > today) {
        throw new AppError('VALIDATION_FAILED', 'The payment date cannot be in the future', {
          fields: { paidOn: 'In the future' },
        });
      }
      if (input.paidOn < shift(today, -30)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Payments older than 30 days must be shown at the school office',
          {
            fields: { paidOn: 'Too old' },
          },
        );
      }
      const [{ pending }] = (
        await tx.execute(sql`
          select count(*)::int as pending from fee_payment_proofs
          where request_id = ${requestId} and status = 'pending'`)
      ).rows as [{ pending: number }];
      if (pending >= MAX_PENDING_PER_LINK) {
        throw new AppError(
          'CONFLICT',
          'The school is still checking your earlier uploads; please wait',
        );
      }
      await this.assertNewReference(tx, input.reference);
      return { r, tenantId };
    };

    const { tenantId } = await this.withLink(token, client, check, true);
    const key = `t/${tenantId}/d/${proofId}/${safeFileName(file!.originalname || 'payment', type)}`;
    await this.storage.put(key, file!.buffer, type);
    return this.withLink(token, client, async (tx, tId, requestId) => {
      const { r } = await check(tx, tId, requestId);
      // Two uploads of the same UTR at once: the second waits here, then sees the first.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`utr:${tId}:${input.reference}`}, 0))`,
      );
      await this.assertNewReference(tx, input.reference);
      try {
        await tx.insert(pf).values({
          id: proofId,
          tenantId: tId,
          campusId: r.campusId,
          requestId,
          studentId: r.studentId,
          enrollmentId: r.enrollmentId,
          amount: input.amount,
          mode: input.mode,
          reference: input.reference,
          paidOn: input.paidOn,
          payerName: input.payerName,
          payerPhone: input.payerPhone,
          storageKey: key,
          contentType: type,
          sizeBytes: file!.size,
        });
      } catch (err) {
        if (
          /fee_payment_proofs_reference_uq/.test(String((err as { cause?: unknown }).cause ?? err))
        ) {
          throw this.duplicate();
        }
        throw err;
      }
      await this.outbox.emit(
        tx,
        { tenantId: tId, requestId: client.requestId },
        'fees.proof_submitted',
        {
          proofId,
          requestId,
          studentId: r.studentId,
          amount: input.amount,
        },
      );
      return { id: proofId, status: 'pending' };
    });
  }

  private duplicate() {
    return new AppError(
      'CONFLICT',
      'This transaction reference (UTR) has already been submitted or receipted',
      { fields: { reference: 'Already used' } },
    );
  }

  /** A UTR can back one receipt only: not another proof, nor a counter receipt. */
  private async assertNewReference(tx: Transaction, reference: string) {
    const res = await tx.execute(sql`
      select 1 from fee_payment_proofs where reference = ${reference} and status in ('pending', 'approved')
      union all
      select 1 from fee_payments where status <> 'cancelled' and mode in ('upi', 'bank_transfer', 'card')
        and upper(regexp_replace(reference, '[\\s-]+', '', 'g')) = ${reference}
      limit 1`);
    if (res.rows.length) throw this.duplicate();
  }

  async publicReceipt(token: string, proofId: string, client: ClientInfo) {
    this.limiter.consume(`pay-view:${client.ip ?? 'unknown'}`, 60, MINUTE);
    return this.withLink(
      token,
      client,
      async (tx, _t, requestId) => {
        const [p] = await tx
          .select({ paymentId: pf.paymentId, status: pf.status })
          .from(pf)
          .where(and(eq(pf.id, proofId), eq(pf.requestId, requestId)));
        if (!p?.paymentId || p.status !== 'approved') throw notFound('Receipt');
        const [pay] = await tx
          .select({ status: schema.feePayments.status })
          .from(schema.feePayments)
          .where(eq(schema.feePayments.id, p.paymentId));
        if (!pay || pay.status === 'cancelled') throw notFound('Receipt');
        return this.payments.receiptPdfInTx(tx, p.paymentId);
      },
      true,
    );
  }

  /* ------------------------------------ staff checking ------------------------------------ */

  listProofs(access: TenantAccess, q: { campusId: string; status: string; page: number }) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!VIEW.some((p) => access.has(p, q.campusId))) throw notFound('Campus');
        await this.campusFor(tx, q.campusId);
        const rows = (
          await tx.execute(sql`
            select p.id, p.student_id as "studentId", trim(s.first_name || ' ' || s.last_name) as "studentName",
              s.admission_number as "admissionNumber", g.name || ' ' || sec.name as "className",
              p.amount::bigint as amount, r.amount::bigint as "askedAmount", p.mode, p.reference,
              p.paid_on::text as "paidOn", p.payer_name as "payerName", p.payer_phone as "payerPhone",
              p.status, p.decision_note as "decisionNote", p.created_at as "createdAt", p.decided_at as "decidedAt",
              u.full_name as "decidedByName", fp.receipt_number as "receiptNumber", p.payment_id as "paymentId"
            from fee_payment_proofs p
            join fee_payment_requests r on r.tenant_id = p.tenant_id and r.id = p.request_id
            join students s on s.tenant_id = p.tenant_id and s.id = p.student_id
            join student_enrollments e on e.tenant_id = p.tenant_id and e.id = p.enrollment_id
            join sections sec on sec.tenant_id = e.tenant_id and sec.id = e.section_id
            join grade_levels g on g.tenant_id = sec.tenant_id and g.id = sec.grade_level_id
            left join users u on u.id = p.decided_by
            left join fee_payments fp on fp.tenant_id = p.tenant_id and fp.id = p.payment_id
            where p.campus_id = ${q.campusId} and p.status = ${q.status}
            order by p.created_at ${q.status === 'pending' ? sql`asc` : sql`desc`}
            limit 51 offset ${(q.page - 1) * 50}`)
        ).rows as Rows;
        const [{ pending }] = (
          await tx.execute(sql`
            select count(*)::int as pending from fee_payment_proofs
            where campus_id = ${q.campusId} and status = 'pending'`)
        ).rows as [{ pending: number }];
        return {
          items: rows
            .slice(0, 50)
            .map((r) => ({ ...r, amount: Number(r.amount), askedAmount: Number(r.askedAmount) })),
          hasMore: rows.length > 50,
          pending,
        };
      },
      { readOnly: true },
    );
  }

  private async proofRow(tx: Transaction, access: TenantAccess, id: string, need?: string) {
    const [p] = await tx.select().from(pf).where(eq(pf.id, id));
    if (!p || !VIEW.some((x) => access.has(x, p.campusId))) throw notFound('Payment proof');
    if (need && !access.has(need, p.campusId)) {
      throw new AppError('FORBIDDEN', 'You cannot do this for this campus');
    }
    return p;
  }

  getProof(access: TenantAccess, id: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const p = await this.proofRow(tx, access, id);
        const others = (
          await tx.execute(sql`
            select p.id, p.amount::bigint as amount, p.reference, p.status, p.created_at as "createdAt"
            from fee_payment_proofs p where p.request_id = ${p.requestId} and p.id <> ${id}
            order by p.created_at`)
        ).rows as Rows;
        const [r] = await tx.select().from(rq).where(eq(rq.id, p.requestId));
        await this.audit.record(tx, access, {
          action: 'fees.payment_proof_viewed',
          entity: 'fee_payment_proof',
          entityId: id,
          campusId: p.campusId,
        });
        return {
          id: p.id,
          studentId: p.studentId,
          amount: p.amount,
          askedAmount: r?.amount ?? null,
          mode: p.mode,
          reference: p.reference,
          paidOn: p.paidOn,
          payerName: p.payerName,
          payerPhone: p.payerPhone,
          status: p.status,
          decisionNote: p.decisionNote,
          paymentId: p.paymentId,
          createdAt: p.createdAt,
          contentType: p.contentType,
          fileUrl: await this.storage.signedDownloadUrl(p.storageKey, 300),
          otherProofs: others.map((o) => ({ ...o, amount: Number(o.amount) })),
        };
      },
      // Audit write.
      {},
    );
  }

  /** The money is in the school's account: issue the receipt. */
  approveProof(access: TenantAccess, id: string, input: { amount?: number; note: string }) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`proof:${id}`}, 0))`);
      const p = await this.proofRow(tx, access, id, 'fees.collect');
      if (p.status !== 'pending')
        throw new AppError('CONFLICT', `The proof is already ${p.status}`);
      const amount = input.amount ?? p.amount;
      const receipt = await this.payments.recordInTx(
        tx,
        access,
        {
          studentId: p.studentId,
          mode: p.mode as 'upi' | 'bank_transfer',
          amount,
          reference: p.reference,
          bankName: '',
          instrumentDate: p.paidOn,
          payerName: p.payerName,
          note: ['Paid to school account; proof checked', input.note].filter(Boolean).join('. '),
          idempotencyKey: `proof:${id}`,
        },
        { proofId: id, campusId: p.campusId },
      );
      await tx
        .update(pf)
        .set({
          status: 'approved',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionNote: input.note,
          paymentId: receipt.id as string,
        })
        .where(eq(pf.id, id));
      await tx
        .update(rq)
        .set({ status: 'paid', paidAt: new Date() })
        .where(and(eq(rq.id, p.requestId), eq(rq.status, 'open')));
      await this.audit.record(tx, access, {
        action: 'fees.payment_proof_approved',
        entity: 'fee_payment_proof',
        entityId: id,
        campusId: p.campusId,
        diff: {
          amount,
          claimed: p.amount,
          reference: p.reference,
          receiptNumber: receipt.receiptNumber,
        },
      });
      return { id, status: 'approved', receipt };
    });
  }

  rejectProof(access: TenantAccess, id: string, note: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`proof:${id}`}, 0))`);
      const p = await this.proofRow(tx, access, id, 'fees.collect');
      if (p.status !== 'pending')
        throw new AppError('CONFLICT', `The proof is already ${p.status}`);
      await tx
        .update(pf)
        .set({
          status: 'rejected',
          decidedBy: access.userId,
          decidedAt: new Date(),
          decisionNote: note,
        })
        .where(eq(pf.id, id));
      await this.audit.record(tx, access, {
        action: 'fees.payment_proof_rejected',
        entity: 'fee_payment_proof',
        entityId: id,
        campusId: p.campusId,
        diff: { amount: p.amount, reference: p.reference, note },
      });
      return { id, status: 'rejected' };
    });
  }
}
