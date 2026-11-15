import type { ConnectionOptions } from 'bullmq';

/** Converts REDIS_URL (redis:// or rediss://) into BullMQ connection options. */
export const redisConnectionFromUrl = (url: string): ConnectionOptions => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    // Required by BullMQ for blocking commands.
    maxRetriesPerRequest: null,
  };
};
