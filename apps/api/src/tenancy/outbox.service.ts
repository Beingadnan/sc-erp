import { Injectable } from '@nestjs/common';
import { schema } from '@school-erp/db';
import type { Transaction } from '@school-erp/db';

/**
 * Records a domain event in the same transaction as the change. The worker's relay
 * publishes it to the queue afterwards, so events are never lost or sent for changes
 * that rolled back. Payloads carry ids, not personal data.
 */
@Injectable()
export class OutboxService {
  async emit(
    tx: Transaction,
    ctx: { tenantId: string; requestId: string },
    eventType: string,
    payload: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await tx.insert(schema.outboxEvents).values({
      tenantId: ctx.tenantId,
      eventType,
      payload,
      requestId: ctx.requestId,
    });
  }

  /** Several events of one type in a single insert (e.g. one per absent student). */
  async emitMany(
    tx: Transaction,
    ctx: { tenantId: string; requestId: string },
    eventType: string,
    payloads: Record<string, string | number | boolean | null>[],
  ): Promise<void> {
    if (!payloads.length) return;
    await tx.insert(schema.outboxEvents).values(
      payloads.map((payload) => ({
        tenantId: ctx.tenantId,
        eventType,
        payload,
        requestId: ctx.requestId,
      })),
    );
  }
}
