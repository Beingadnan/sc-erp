import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { del, issueSignedToken, presignUrl, put } from '@vercel/blob';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/**
 * Private object storage for documents. Objects are never public: the API checks
 * permissions, then hands out a short-lived signed link for one object.
 */
export interface FileStorage {
  readonly driver: 'local' | 'vercel-blob';
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Link that works for `ttlSeconds` and only for this object. */
  signedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

/** Keys we create look like "t/<uuid>/d/<uuid>/<safe-name>"; anything else is refused. */
export const assertSafeKey = (key: string): void => {
  if (
    !/^t\/[0-9a-f-]{36}\/d\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/.test(key) ||
    key.includes('..')
  ) {
    throw new Error('Unsafe storage key');
  }
};

/** Vercel Blob, private store. Use the Mumbai (bom1) region for Indian schools. */
export class VercelBlobStorage implements FileStorage {
  readonly driver = 'vercel-blob' as const;

  constructor(private readonly token: string) {}

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await put(key, bytes, {
      access: 'private',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      token: this.token,
    });
  }

  async signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const validUntil = Date.now() + ttlSeconds * 1000;
    const signed = await issueSignedToken({
      pathname: key,
      operations: ['get'],
      validUntil,
      token: this.token,
    });
    const { presignedUrl } = await presignUrl(signed, {
      operation: 'get',
      pathname: key,
      access: 'private',
      validUntil,
    });
    return presignedUrl;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await del(key, { token: this.token });
  }
}

/**
 * Development only: files on local disk, served by the API through an HMAC-signed,
 * expiring link (same behaviour as the real store).
 */
export class LocalDiskStorage implements FileStorage {
  readonly driver = 'local' as const;
  private readonly root: string;
  private readonly key: Buffer;

  constructor(
    dir: string,
    masterKeyBase64: string,
    private readonly apiBasePath = '/api/v1',
  ) {
    this.root = resolve(dir);
    this.key = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(masterKeyBase64, 'base64'),
        Buffer.alloc(0),
        'school-erp:local-files:v1',
        32,
      ),
    );
  }

  private path(key: string) {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Unsafe storage key');
    return full;
  }

  private sign(key: string, exp: number) {
    return createHmac('sha256', this.key).update(`${key}|${exp}`).digest('base64url');
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const full = this.path(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: 'wx' });
    await writeFile(`${full}.type`, contentType, { flag: 'wx' });
  }

  async signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    this.path(key);
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const q = new URLSearchParams({ key, exp: String(exp), sig: this.sign(key, exp) });
    return `${this.apiBasePath}/files/local?${q}`;
  }

  /** Verifies a signed link and returns the file, or null if invalid/expired/missing. */
  async read(
    key: string,
    exp: string,
    sig: string,
  ): Promise<{ bytes: Buffer; contentType: string } | null> {
    try {
      const full = this.path(key);
      const expiry = Number(exp);
      if (!Number.isInteger(expiry) || expiry < Date.now() / 1000) return null;
      const expected = Buffer.from(this.sign(key, expiry));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      return { bytes: await readFile(full), contentType: await readFile(`${full}.type`, 'utf8') };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.path(key);
    await unlink(full).catch(() => undefined);
    await unlink(`${full}.type`).catch(() => undefined);
  }
}

/* ------------------------------- file type detection ------------------------------- */

export const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
export type AllowedType = keyof typeof ALLOWED_TYPES;

/** Detects the real type from the file's first bytes (the browser's claim is ignored). */
export const sniffType = (b: Buffer): AllowedType | null => {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
};

/** "Birth Certificate (1).PDF" → "Birth-Certificate-1.pdf" with the detected extension. */
export const safeFileName = (original: string, type: AllowedType): string => {
  const base =
    (original.split(/[\\/]/).pop() ?? '')
      .replace(/\.[^.]*$/, '')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'document';
  return `${base}.${ALLOWED_TYPES[type]}`;
};

/** Picks the driver from configuration (see STORAGE_DRIVER in .env.example). */
export const storageFor = (config: {
  STORAGE_DRIVER: 'local' | 'vercel-blob';
  BLOB_READ_WRITE_TOKEN?: string;
  LOCAL_STORAGE_DIR: string;
  MFA_ENCRYPTION_KEY: string;
}): FileStorage =>
  config.STORAGE_DRIVER === 'vercel-blob'
    ? new VercelBlobStorage(config.BLOB_READ_WRITE_TOKEN!)
    : new LocalDiskStorage(config.LOCAL_STORAGE_DIR, config.MFA_ENCRYPTION_KEY);
