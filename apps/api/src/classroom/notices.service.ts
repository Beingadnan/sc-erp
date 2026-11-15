import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { NoticeInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { OutboxService } from '../tenancy/outbox.service.js';

const nt = schema.notices;
type Rows = Array<Record<string, unknown>>;
/**
 * Notices: the circular that used to go home in the diary. To everyone, parents only or staff
 * only; optionally only some classes or sections. Published notices show in the parent app and
 * on staff Today screens, with read counts for the office.
 */
@Injectable()
export class NoticesService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private can(access: TenantAccess, campusId: string | null) {
    return campusId ? access.has('notices.manage', campusId) : access.has('notices.manage');
  }

  private async row(tx: Transaction, access: TenantAccess, id: string) {
    const [n] = await tx.select().from(nt).where(eq(nt.id, id));
    if (!n || !this.can(access, n.campusId)) throw notFound('Notice');
    return n;
  }

  create(access: TenantAccess, input: NoticeInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      if (!this.can(access, input.campusId))
        throw new AppError('FORBIDDEN', 'You cannot send notices here');
      const [n] = await tx
        .insert(nt)
        .values({ tenantId: access.tenantId, ...input, createdBy: access.userId })
        .returning();
      return n!;
    });
  }

  update(access: TenantAccess, id: string, input: NoticeInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const n = await this.row(tx, access, id);
      if (n.status === 'archived')
        throw new AppError('CONFLICT', 'An archived notice cannot be changed');
      if (input.campusId !== n.campusId)
        throw new AppError('VALIDATION_FAILED', 'The campus of a notice cannot change');
      const [u] = await tx
        .update(nt)
        .set({
          title: input.title,
          body: input.body,
          audience: input.audience,
          gradeLevelIds: input.gradeLevelIds,
          sectionIds: input.sectionIds,
          pinned: input.pinned,
          expiresOn: input.expiresOn,
          updatedAt: new Date(),
        })
        .where(eq(nt.id, id))
        .returning();
      return u!;
    });
  }

  setStatus(access: TenantAccess, id: string, status: 'published' | 'archived') {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const n = await this.row(tx, access, id);
      if (n.status === status) return { id, status };
      if (status === 'published' && n.status !== 'draft')
        throw new AppError('CONFLICT', 'Only drafts can be published');
      await tx
        .update(nt)
        .set({
          status,
          ...(status === 'published' ? { publishedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(nt.id, id));
      if (status === 'published') {
        // For SMS / WhatsApp / push once a provider is connected.
        await this.outbox.emit(
          tx,
          { tenantId: access.tenantId, requestId: access.requestId },
          'notice.published',
          {
            noticeId: id,
            audience: n.audience,
          },
        );
      }
      await this.audit.record(tx, access, {
        action: `notice.${status}`,
        entity: 'notice',
        entityId: id,
        campusId: n.campusId,
        diff: { title: n.title },
      });
      return { id, status };
    });
  }

  /** The office list: all notices with how many people have read each. */
  list(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        if (!access.has('notices.manage'))
          throw new AppError('FORBIDDEN', 'You cannot manage notices');
        const rows = (
          await tx.execute(sql`
            select n.id, n.campus_id as "campusId", n.title, n.body, n.audience, n.grade_level_ids as "gradeLevelIds",
              n.section_ids as "sectionIds", n.status, n.pinned, n.published_at as "publishedAt",
              n.expires_on::text as "expiresOn", n.created_at as "createdAt", u.full_name as "byName",
              (select count(*) from notice_reads r where r.tenant_id = n.tenant_id and r.notice_id = n.id)::int as reads
            from notices n left join users u on u.id = n.created_by
            order by (n.status = 'archived'), n.pinned desc, coalesce(n.published_at, n.created_at) desc limit 200`)
        ).rows as Rows;
        return { items: rows.filter((r) => this.can(access, r.campusId as string | null)) };
      },
      { readOnly: true },
    );
  }

  /** Live notices for staff (audience everyone or staff). */
  staffFeed(access: TenantAccess) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => ({
        items: (
          await tx.execute(sql`
            select n.id, n.title, n.body, n.pinned, n.published_at as "publishedAt",
              exists (select 1 from notice_reads r where r.tenant_id = n.tenant_id and r.notice_id = n.id
                        and r.user_id = ${access.userId}) as read
            from notices n
            where n.status = 'published' and n.audience in ('everyone', 'staff')
              and (n.expires_on is null or n.expires_on >= current_date)
            order by n.pinned desc, n.published_at desc limit 20`)
        ).rows,
      }),
      { readOnly: true },
    );
  }

  /** Live notices for a parent: audience everyone or parents, matching any of their children. */
  familyFeedInTx(tx: Transaction, userId: string) {
    return tx.execute(sql`
      with kids as (
        select s.campus_id, e.section_id, sec.grade_level_id
        from guardians g
        join student_guardians sg on sg.tenant_id = g.tenant_id and sg.guardian_id = g.id
        join students s on s.tenant_id = sg.tenant_id and s.id = sg.student_id
        left join lateral (select e.section_id from student_enrollments e
                           where e.tenant_id = s.tenant_id and e.student_id = s.id and e.status = 'active'
                           order by e.created_at desc limit 1) e on true
        left join sections sec on sec.tenant_id = s.tenant_id and sec.id = e.section_id
        where g.user_id = ${userId})
      select n.id, n.title, n.body, n.pinned, n.published_at as "publishedAt",
        exists (select 1 from notice_reads r where r.tenant_id = n.tenant_id and r.notice_id = n.id
                  and r.user_id = ${userId}) as read
      from notices n
      where n.status = 'published' and n.audience in ('everyone', 'parents')
        and (n.expires_on is null or n.expires_on >= current_date)
        and exists (select 1 from kids k
                    where (n.campus_id is null or n.campus_id = k.campus_id)
                      and (cardinality(n.grade_level_ids) = 0 and cardinality(n.section_ids) = 0
                           or k.grade_level_id = any (n.grade_level_ids) or k.section_id = any (n.section_ids)))
      order by n.pinned desc, n.published_at desc limit 30`);
  }

  markRead(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const [n] = await tx.select({ id: nt.id, status: nt.status }).from(nt).where(eq(nt.id, id));
      if (!n || n.status !== 'published') throw notFound('Notice');
      await tx.execute(sql`
        insert into notice_reads (tenant_id, notice_id, user_id) values (${access.tenantId}, ${id}, ${access.userId})
        on conflict (tenant_id, notice_id, user_id) do update set views = notice_reads.views + 1`);
      return { id, read: true };
    });
  }
}
