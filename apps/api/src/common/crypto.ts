import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, URL-safe. Used for sessions, CSRF, email links. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value, 'utf8').digest();

export const sha256Hex = (value: string): string => sha256(value).toString('hex');

export const constantTimeEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);
