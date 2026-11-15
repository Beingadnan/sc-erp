import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { Queue, Worker } from 'bullmq';
import { assertAppRoleIsSafe, createDatabase } from '@school-erp/db';
import { parseEnv, workerEnvSchema } from '@school-erp/validation';
import { JOB_REGISTRY, TENANT_QUEUE } from './jobs/index.js';
import { relayOutboxOnce } from './outbox-relay.js';
import type { EventPublisher } from './outbox-relay.js';
import { redisConnectionFromUrl } from './redis.js';
import { runTenantJob } from './tenant-job.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

export const DOMAIN_EVENTS_QUEUE = 'domain-events';
const RELAY_INTERVAL_MS = 2_000;

const main = async (): Promise<void> => {
  const env = parseEnv(workerEnvSchema, process.env);
  const database = createDatabase({
    connectionString: env.DATABASE_URL_APP,
    max: env.DB_POOL_MAX,
    applicationName: 'school-erp-worker',
  });
  await assertAppRoleIsSafe(database.pool);
  const connection = redisConnectionFromUrl(env.REDIS_URL);

  // Tenant jobs (each runs inside withTenant via runTenantJob).
  const tenantWorker = new Worker(
    TENANT_QUEUE,
    async (job) => {
      const def = JOB_REGISTRY.get(job.name);
      if (!def) throw new Error(`Unknown job ${job.name}`);
      return runTenantJob(database.db, def, job.data);
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );

  // Outbox relay → domain-events queue. jobId = event id makes publishing idempotent.
  const events = new Queue(DOMAIN_EVENTS_QUEUE, { connection });
  const publisher: EventPublisher = {
    publish: async (batch) => {
      await events.addBulk(
        batch.map((e) => ({
          name: e.eventType,
          data: {
            tenantId: e.tenantId,
            userId: null,
            requestId: e.requestId ?? `event-${e.id}`,
            payload: { eventId: e.id, ...e.payload },
          },
          opts: {
            jobId: e.id,
            attempts: 5,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
          },
        })),
      );
    },
  };

  // Domain-event consumers are registered by later modules (notifications, reports…).
  // Until then events are acknowledged without action.
  const eventWorker = new Worker(DOMAIN_EVENTS_QUEUE, async () => undefined, { connection });

  let relaying = false;
  const timer = setInterval(() => {
    if (relaying) return;
    relaying = true;
    relayOutboxOnce(database.db, publisher)
      .catch((err: unknown) =>
        console.error(`outbox relay failed: ${err instanceof Error ? err.message : err}`),
      )
      .finally(() => {
        relaying = false;
      });
  }, RELAY_INTERVAL_MS);

  // Log ids only — job payloads may contain personal data.
  tenantWorker.on('failed', (job, err) =>
    console.error(`job ${job?.name}#${job?.id} failed: ${err.message}`),
  );
  console.warn(
    `Worker ready: "${TENANT_QUEUE}" (${JOB_REGISTRY.size} job types), outbox relay every ${RELAY_INTERVAL_MS}ms.`,
  );

  const shutdown = async (): Promise<void> => {
    clearInterval(timer);
    await Promise.all([tenantWorker.close(), eventWorker.close(), events.close()]);
    await database.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
