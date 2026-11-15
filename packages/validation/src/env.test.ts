import { describe, expect, it } from 'vitest';
import { apiEnvSchema, parseEnv } from './env.js';

const base = {
  DATABASE_URL_APP: 'postgresql://erp_app:pw@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb',
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('apiEnvSchema', () => {
  it('applies defaults and splits CORS origins', () => {
    const env = parseEnv(apiEnvSchema, {
      ...base,
      API_CORS_ORIGINS: 'http://a.test, http://b.test',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.API_CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(env.MFA_ENFORCEMENT).toBe('off');
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('enforces MFA and secure cookies in production by default', () => {
    const env = parseEnv(apiEnvSchema, {
      ...base,
      NODE_ENV: 'production',
      BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_example_token_123',
    });
    expect(env.MFA_ENFORCEMENT).toBe('on');
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.STORAGE_DRIVER).toBe('vercel-blob');
  });

  it('uses local storage in development and refuses it in production', () => {
    expect(parseEnv(apiEnvSchema, base).STORAGE_DRIVER).toBe('local');
    expect(() => parseEnv(apiEnvSchema, { ...base, NODE_ENV: 'production' })).toThrow(
      /development only/,
    );
    expect(() => parseEnv(apiEnvSchema, { ...base, STORAGE_DRIVER: 'vercel-blob' })).toThrow(
      /BLOB_READ_WRITE_TOKEN/,
    );
  });

  it('rejects a short MFA encryption key', () => {
    expect(() => parseEnv(apiEnvSchema, { ...base, MFA_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /32 bytes/,
    );
  });

  it('refuses the Neon owner role for the application connection', () => {
    expect(() =>
      parseEnv(apiEnvSchema, {
        ...base,
        DATABASE_URL_APP: 'postgresql://neondb_owner:pw@ep-x.aws.neon.tech/neondb',
      }),
    ).toThrow(/must not connect as the Neon owner/);
  });

  it('reports missing variables without echoing values', () => {
    try {
      parseEnv(apiEnvSchema, {});
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('DATABASE_URL_APP');
    }
  });
});
