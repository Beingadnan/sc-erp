import { inArray, sql } from 'drizzle-orm';
import type { Database } from '@school-erp/db';
import { schema, withContext, withTenant } from '@school-erp/db';
import { newId } from '@school-erp/shared';

export interface DomainEvent {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  requestId: string | null;
}

export interface EventPublisher {
  /** Must be idempotent per event id (BullMQ: jobId = event id). */
  publish(events: DomainEvent[]): Promise<void>;
}

/**
 * Moves undispatched outbox events to the queue, one tenant at a time, each inside that
 * tenant's RLS context. Rows are locked (SKIP LOCKED) so several relays can run safely.
 * If publishing fails the transaction rolls back and the events stay pending.
 */
export const relayOutboxOnce = async (
  db: Database,
  publisher: EventPublisher,
  options: { tenantBatch?: number; eventBatch?: number } = {},
): Promise<number> => {
  const tenantBatch = options.tenantBatch ?? 50;
  const eventBatch = options.eventBatch ?? 100;
  const tenants = await withContext(db, { requestId: `outbox-${newId()}` }, async (tx) => {
    const r = await tx.execute<{ t: string }>(sql`select app.outbox_pending(${tenantBatch}) as t`);
    return r.rows.map((row) => row.t);
  });

  let total = 0;
  for (const tenantId of tenants) {
    total += await withTenant(
      db,
      { tenantId, userId: null, requestId: `outbox-${newId()}` },
      async (tx) => {
        const r = await tx.execute<{
          id: string;
          event_type: string;
          payload: Record<string, unknown>;
          request_id: string | null;
        }>(sql`
          select id, event_type, payload, request_id from outbox_events
           where dispatched_at is null
           order by id
           limit ${eventBatch}
           for update skip locked`);
        if (r.rows.length === 0) return 0;
        await publisher.publish(
          r.rows.map((e) => ({
            id: e.id,
            tenantId,
            eventType: e.event_type,
            payload: e.payload,
            requestId: e.request_id,
          })),
        );
        const ids = r.rows.map((e) => e.id);
        await tx
          .update(schema.outboxEvents)
          .set({ dispatchedAt: new Date(), attempts: sql`${schema.outboxEvents.attempts} + 1` })
          .where(inArray(schema.outboxEvents.id, ids));
        await tx.execute(sql`select app.outbox_ack(${ids.length})`);
        return ids.length;
      },
    );
  }
  return total;
};
