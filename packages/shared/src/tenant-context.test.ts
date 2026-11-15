import { describe, expect, it } from 'vitest';
import { tenantCacheKey, tenantStorageKey } from './tenant-context.js';

const A = '018f3a3e-0000-7000-8000-00000000000a';
const B = '018f3a3e-0000-7000-8000-00000000000b';

describe('tenant-scoped keys', () => {
  it('cache keys for the same logical key differ across tenants', () => {
    expect(tenantCacheKey(A, 'students', 1)).not.toBe(tenantCacheKey(B, 'students', 1));
    expect(tenantCacheKey(A, 'students', 1)).toBe(`t:${A}:students:1`);
  });

  it('requires a tenant id', () => {
    expect(() => tenantCacheKey('', 'x')).toThrow();
    expect(() => tenantStorageKey('', 'x')).toThrow();
  });

  it('storage keys are prefixed by tenant and reject path traversal', () => {
    expect(tenantStorageKey(A, 'students', 'photo.jpg')).toBe(`tenants/${A}/students/photo.jpg`);
    expect(() => tenantStorageKey(A, '..', B, 'secret.pdf')).toThrow();
    expect(() => tenantStorageKey(A, '/etc/passwd')).toThrow();
  });
});
