import { AppError } from '@school-erp/shared';

/**
 * In-process fixed-window limiter for authentication endpoints.
 * Limitation: per process. Before running more than one API instance, move the counters
 * to Redis (tracked in docs/security/threat-model.md, T23).
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly scale = 1) {}

  /** Throws RATE_LIMITED when `key` exceeded `limit` hits within `windowMs`. */
  consume(key: string, limit: number, windowMs: number, now = Date.now()): void {
    this.sweep(now);
    const max = Math.max(1, Math.floor(limit * this.scale));
    const w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    w.count += 1;
    if (w.count > max) {
      throw new AppError('RATE_LIMITED', 'Too many attempts. Please wait and try again.', {
        retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000),
      });
    }
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, w] of this.windows) if (w.resetAt <= now) this.windows.delete(k);
  }
}
