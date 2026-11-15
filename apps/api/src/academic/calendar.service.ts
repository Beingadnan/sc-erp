import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { CalendarEventCreateInput, CalendarEventUpdateInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { assertCampus } from './campus-check.js';
import { describeRange } from './working-days.js';

const e = schema.calendarEvents;
const y = schema.academicYears;

const eventColumns = {
  id: e.id,
  campusId: e.campusId,
  title: e.title,
  kind: e.kind,
  startsOn: e.startsOn,
  endsOn: e.endsOn,
  description: e.description,
};

@Injectable()
export class CalendarService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  /** campusId null = every campus, which needs school-wide rights. */
  private assertCanManage(access: TenantAccess, campusId: string | null) {
    if (campusId === null) {
      if (!access.hasTenantWide('calendar.manage')) {
        throw new AppError('FORBIDDEN', 'Only school-wide staff can add entries for every campus');
      }
    } else if (!access.has('calendar.manage', campusId)) {
      throw notFound('Campus');
    }
  }

  private eventsFor(tx: Transaction, campusId: string, from: string, to: string) {
    return tx
      .select(eventColumns)
      .from(e)
      .where(
        and(
          or(eq(e.campusId, campusId), isNull(e.campusId)),
          lte(e.startsOn, to),
          gte(e.endsOn, from),
        ),
      )
      .orderBy(asc(e.startsOn), asc(e.title));
  }

  list(access: TenantAccess, campusId: string, from: string, to: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await assertCampus(tx, access, campusId, 'academic.view');
        return this.eventsFor(tx, campusId, from, to);
      },
      { readOnly: true },
    );
  }

  /** Day-by-day working/non-working breakdown, used by attendance and reports. */
  workingDays(access: TenantAccess, campusId: string, from: string, to: string) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        await assertCampus(tx, access, campusId, 'academic.view');
        const years = await tx
          .select({
            id: y.id,
            name: y.name,
            startsOn: y.startsOn,
            endsOn: y.endsOn,
            weeklyOffDays: y.weeklyOffDays,
            saturdayOffWeeks: y.saturdayOffWeeks,
          })
          .from(y)
          .where(and(eq(y.campusId, campusId), lte(y.startsOn, to), gte(y.endsOn, from)));
        const events = await this.eventsFor(tx, campusId, from, to);
        return describeRange(from, to, years, events);
      },
      { readOnly: true },
    );
  }

  create(access: TenantAccess, input: CalendarEventCreateInput) {
    this.assertCanManage(access, input.campusId);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      if (input.campusId) await assertCampus(tx, access, input.campusId, 'calendar.manage');
      const [row] = await tx
        .insert(e)
        .values({ tenantId: access.tenantId, ...input })
        .returning(eventColumns);
      await this.audit.record(tx, access, {
        action: 'calendar.created',
        entity: 'calendar_event',
        entityId: row!.id,
        campusId: row!.campusId,
        diff: input,
      });
      return row!;
    });
  }

  private async load(tx: Transaction, access: TenantAccess, id: string) {
    const [row] = await tx.select(eventColumns).from(e).where(eq(e.id, id));
    if (!row) throw notFound('Calendar entry');
    // Hide entries of campuses the caller cannot see at all.
    if (row.campusId !== null && !access.has('academic.view', row.campusId)) {
      throw notFound('Calendar entry');
    }
    this.assertCanManage(access, row.campusId);
    return row;
  }

  update(access: TenantAccess, id: string, input: CalendarEventUpdateInput) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const current = await this.load(tx, access, id);
      if (input.campusId !== undefined) this.assertCanManage(access, input.campusId);
      if (input.campusId) await assertCampus(tx, access, input.campusId, 'calendar.manage');
      const startsOn = input.startsOn ?? current.startsOn;
      const endsOn = input.endsOn ?? current.endsOn;
      if (endsOn < startsOn) {
        throw new AppError('VALIDATION_FAILED', 'End date must be on or after the start date');
      }
      if (Date.parse(endsOn) - Date.parse(startsOn) > 120 * 86_400_000) {
        throw new AppError('VALIDATION_FAILED', 'A calendar entry can span at most 120 days');
      }
      const [row] = await tx
        .update(e)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(e.id, id))
        .returning(eventColumns);
      await this.audit.record(tx, access, {
        action: 'calendar.updated',
        entity: 'calendar_event',
        entityId: id,
        campusId: row!.campusId,
        diff: input,
      });
      return row!;
    });
  }

  remove(access: TenantAccess, id: string) {
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const current = await this.load(tx, access, id);
      await tx.delete(e).where(eq(e.id, id));
      await this.audit.record(tx, access, {
        action: 'calendar.deleted',
        entity: 'calendar_event',
        entityId: id,
        campusId: current.campusId,
        diff: { title: current.title, startsOn: current.startsOn },
      });
    });
  }
}
