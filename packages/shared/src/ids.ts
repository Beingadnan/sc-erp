import { randomBytes } from 'node:crypto';

/**
 * Time-ordered UUIDv7 (RFC 9562) — index-friendly primary keys.
 * 48-bit unix ms timestamp, version 7, variant 10, 74 random bits.
 */
export const newId = (now: number = Date.now()): string => {
  const bytes = randomBytes(16);
  const ts = BigInt(now);
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ts >> BigInt(8 * (5 - i))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accepts v4 or v7 UUIDs (the only versions this system issues). */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value);
