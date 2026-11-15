import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, withTenant } from '@school-erp/db';
import type { DatabaseHandle } from '@school-erp/db';
import { APP_URL, createTestTenant, openOwnerPool, prepareDatabase } from '@school-erp/db/testing';
import { relayOutboxOnce } from '../src/outbox-relay.js';
import type { DomainEvent } from '../src/outbox-relay.js';

describe('outbox relay', () => {
  let app: DatabaseHandle;
  let owner: Pool;
  let A: { userId: string; tenantId: string };
  let B: { userId: string; tenantId: string };

  const emit = (tenantId: string, eventType: string) =>
    withTenant(app.db, { tenantId, userId: null, requestId: 'test' }, (tx) =>
      tx.execute(
        sql`insert into outbox_events (tenant_id, event_type, payload) values (${tenantId}, ${eventType}, '{"n":1}')`,
      ),
    );

  const pendingCount = async (tenantId: string) => {
    const { rows } = await owner.query(
      `select pending_count from outbox_pending_tenants where tenant_ref = $1`,
      [tenantId],
    );
    return rows[0]?.pending_count ?? 0;
  };

  beforeAll(async () => {
    const p = await prepareDatabase();
    await p.end();
    owner = openOwnerPool();
    app = createDatabase({ connectionString: APP_URL, max: 2 });
    A = await createTestTenant(app.db, 'relay-a');
    B = await createTestTenant(app.db, 'relay-b');
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  it('publishes each event once, tagged with the tenant it came from', async () => {
    await emit(A.tenantId, 'a.one');
    await emit(A.tenantId, 'a.two');
    await emit(B.tenantId, 'b.one');
    const published: DomainEvent[] = [];
    await relayOutboxOnce(app.db, { publish: async (events) => void published.push(...events) });

    const mine = published.filter((e) => [A.tenantId, B.tenantId].includes(e.tenantId));
    expect(
      mine.map((e) => `${e.tenantId === A.tenantId ? 'A' : 'B'}:${e.eventType}`).sort(),
    ).toEqual(['A:a.one', 'A:a.two', 'B:b.one']);
    expect(await pendingCount(A.tenantId)).toBe(0);
    expect(await pendingCount(B.tenantId)).toBe(0);

    const again: DomainEvent[] = [];
    await relayOutboxOnce(app.db, { publish: async (events) => void again.push(...events) });
    expect(again.filter((e) => [A.tenantId, B.tenantId].includes(e.tenantId))).toEqual([]);
  });

  it('keeps events pending when publishing fails', async () => {
    await emit(A.tenantId, 'a.retry');
    await expect(
      relayOutboxOnce(app.db, {
        publish: async () => {
          throw new Error('queue down');
        },
      }),
    ).rejects.toThrow('queue down');
    expect(await pendingCount(A.tenantId)).toBe(1);
    const published: DomainEvent[] = [];
    await relayOutboxOnce(app.db, { publish: async (events) => void published.push(...events) });
    expect(published.filter((e) => e.tenantId === A.tenantId).map((e) => e.eventType)).toEqual([
      'a.retry',
    ]);
    expect(await pendingCount(A.tenantId)).toBe(0);
  });
});
