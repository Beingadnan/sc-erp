import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError } from '@school-erp/shared';
import { formatAdmissionNumber } from '@school-erp/validation';
import type { AdmissionNumberSettingsInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';

const s = schema.admissionNumberSettings;
const c = schema.numberCounters;

const DEFAULTS = { pattern: '{SEQ:4}', perCampus: false, yearlyReset: false };

export interface NumberContext {
  campusId: string;
  campusCode: string;
  /** Start year of the academic year the student joins. */
  year: number;
}

const counterKey = (settings: typeof DEFAULTS, ctx: NumberContext) =>
  ['admission', settings.perCampus ? ctx.campusId : null, settings.yearlyReset ? ctx.year : null]
    .filter((x) => x !== null)
    .join(':');

/**
 * Admission numbers are allocated from a counter row in the same transaction that creates
 * the student. The row lock serialises concurrent admissions and a rolled-back admission
 * also rolls back its counter increment, so numbers are gap-free.
 */
@Injectable()
export class AdmissionNumbersService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  async settings(tx: Transaction) {
    const [row] = await tx
      .select({ pattern: s.pattern, perCampus: s.perCampus, yearlyReset: s.yearlyReset })
      .from(s);
    return row ?? DEFAULTS;
  }

  async allocate(tx: Transaction, tenantId: string, ctx: NumberContext): Promise<string> {
    const settings = await this.settings(tx);
    const key = counterKey(settings, ctx);
    // After a pattern change a fresh counter can produce numbers issued under the old
    // pattern; skip those rather than failing the admission.
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const r = await tx.execute<{ last_value: number }>(sql`
        insert into number_counters (tenant_id, counter_key, last_value) values (${tenantId}, ${key}, 1)
        on conflict (tenant_id, counter_key) do update set last_value = number_counters.last_value + 1
        returning last_value`);
      const candidate = formatAdmissionNumber(settings.pattern, r.rows[0]!.last_value, ctx);
      const [taken] = await tx
        .select({ id: schema.students.id })
        .from(schema.students)
        .where(eq(schema.students.admissionNumber, candidate))
        .limit(1);
      if (!taken) return candidate;
    }
    throw new AppError('CONFLICT', 'Could not find a free admission number; check the pattern', {
      reason: 'admission_number_exhausted',
    });
  }

  private async peek(tx: Transaction, settings: typeof DEFAULTS, ctx: NumberContext) {
    const [row] = await tx
      .select({ last: c.lastValue })
      .from(c)
      .where(eq(c.counterKey, counterKey(settings, ctx)));
    return formatAdmissionNumber(settings.pattern, (row?.last ?? 0) + 1, ctx);
  }

  get(access: TenantAccess, ctx: NumberContext | null) {
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const settings = await this.settings(tx);
        return { ...settings, next: ctx ? await this.peek(tx, settings, ctx) : null };
      },
      { readOnly: true },
    );
  }

  update(access: TenantAccess, input: AdmissionNumberSettingsInput) {
    if (!access.hasTenantWide('settings.manage')) {
      throw new AppError(
        'FORBIDDEN',
        'Only school-wide administrators can change admission numbers',
      );
    }
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await tx
        .insert(s)
        .values({ tenantId: access.tenantId, ...input })
        .onConflictDoUpdate({ target: s.tenantId, set: { ...input, updatedAt: new Date() } });
      await this.audit.record(tx, access, {
        action: 'admission_numbers.updated',
        entity: 'tenant',
        entityId: access.tenantId,
        diff: input,
      });
      return input;
    });
  }
}
