import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (SHA-1, 30-second steps, 6 digits) — what authenticator apps use. */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Encode = (buf: Buffer): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

export const base32Decode = (input: string): Buffer => {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export const hotp = (secret: Buffer, counter: number, digits = DIGITS): string => {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
};

export const currentStep = (nowMs = Date.now()): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * Verifies a code within ±1 step of clock drift. Returns the matched step, or null.
 * Steps at or below `lastUsedStep` are rejected so a code cannot be replayed.
 */
export const verifyTotp = (
  secretBase32: string,
  code: string,
  lastUsedStep: number | null,
  nowMs = Date.now(),
): number | null => {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = currentStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
};

export const otpauthUrl = (issuer: string, account: string, secretBase32: string): string => {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};

/** Ten single-use recovery codes like "k3d9x-7pqa2". */
export const generateRecoveryCodes = (count = 10): string[] => {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const s = Array.from(bytes, (b) => chars[b % chars.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
};
