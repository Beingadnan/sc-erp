import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  put: vi.fn(async () => ({})),
  del: vi.fn(async () => undefined),
  issueSignedToken: vi.fn(async () => ({
    delegationToken: 'd',
    clientSigningToken: 'c',
    validUntil: 0,
  })),
  presignUrl: vi.fn(async () => ({
    presignedUrl: 'https://store.private.blob.vercel-storage.com/x?sig=1',
  })),
}));
vi.mock('@vercel/blob', () => sdk);

const { LocalDiskStorage, VercelBlobStorage, assertSafeKey, safeFileName, sniffType, storageFor } =
  await import('../src/storage/file-storage.js');

const KEY =
  't/01a1cb00-2dd1-7ccb-91e8-aac1e0ae003e/d/01a1cb00-2dd1-7ccb-91e8-aac1e0ae0040/birth.pdf';
const MASTER = Buffer.alloc(32, 7).toString('base64');

describe('Vercel Blob storage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads privately without overwriting', async () => {
    const s = new VercelBlobStorage('vercel_blob_rw_token_example_1234');
    await s.put(KEY, Buffer.from('%PDF-'), 'application/pdf');
    expect(sdk.put).toHaveBeenCalledWith(KEY, expect.any(Buffer), {
      access: 'private',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      allowOverwrite: false,
      token: 'vercel_blob_rw_token_example_1234',
    });
  });

  it('signs a GET-only link for one object that expires', async () => {
    const s = new VercelBlobStorage('vercel_blob_rw_token_example_1234');
    const before = Date.now();
    const url = await s.signedDownloadUrl(KEY, 300);
    expect(url).toMatch(/^https:\/\//);
    const tokenArgs = (sdk.issueSignedToken.mock.calls as unknown[][])[0]![0] as Record<
      string,
      unknown
    >;
    expect(tokenArgs).toMatchObject({ pathname: KEY, operations: ['get'] });
    expect(tokenArgs.validUntil as number).toBeGreaterThanOrEqual(before + 300_000);
    expect(tokenArgs.validUntil as number).toBeLessThan(before + 301_000);
    expect((sdk.presignUrl.mock.calls as unknown[][])[0]![1]).toMatchObject({
      operation: 'get',
      pathname: KEY,
      access: 'private',
    });
  });

  it('refuses keys it did not create', async () => {
    const s = new VercelBlobStorage('vercel_blob_rw_token_example_1234');
    await expect(s.signedDownloadUrl('../other-school/file.pdf', 60)).rejects.toThrow('Unsafe');
    expect(() => assertSafeKey('t/x/d/y/z.pdf')).toThrow();
    expect(sdk.issueSignedToken).not.toHaveBeenCalled();
  });

  it('is chosen when a token is configured', () => {
    const cfg = { LOCAL_STORAGE_DIR: '.storage', MFA_ENCRYPTION_KEY: MASTER };
    expect(
      storageFor({
        ...cfg,
        STORAGE_DRIVER: 'vercel-blob',
        BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_x_123456789',
      }).driver,
    ).toBe('vercel-blob');
    expect(storageFor({ ...cfg, STORAGE_DRIVER: 'local' }).driver).toBe('local');
  });
});

describe('local development storage', () => {
  it('round-trips through a signed, expiring link', async () => {
    const s = new LocalDiskStorage(await mkdtemp(join(tmpdir(), 'erp-')), MASTER);
    await s.put(KEY, Buffer.from('%PDF-1.4'), 'application/pdf');
    const q = new URL(await s.signedDownloadUrl(KEY, 60), 'http://x').searchParams;
    expect((await s.read(q.get('key')!, q.get('exp')!, q.get('sig')!))?.bytes.toString()).toBe(
      '%PDF-1.4',
    );
    expect(await s.read(q.get('key')!, q.get('exp')!, 'wrong')).toBeNull();
    await s.delete(KEY);
    expect(await s.read(q.get('key')!, q.get('exp')!, q.get('sig')!)).toBeNull();
  });
});

describe('file checks', () => {
  it('detects real types and makes safe names', () => {
    expect(sniffType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(sniffType(Buffer.from('GIF89a'))).toBeNull();
    expect(safeFileName('जन्म प्रमाण पत्र.pdf', 'application/pdf')).toBe('document.pdf');
    expect(safeFileName('../../etc/passwd', 'image/png')).toBe('passwd.png');
    expect(safeFileName('C:\\Users\\me\\TC scan.jpeg', 'image/jpeg')).toBe('TC-scan.jpg');
  });
});
