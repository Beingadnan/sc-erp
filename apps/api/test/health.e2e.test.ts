import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_URL, prepareDatabase } from '@school-erp/db/testing';
import { createApp } from '../src/bootstrap.js';
import { loadApiConfig } from '../src/config/api-config.js';

describe('API foundation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const owner = await prepareDatabase();
    await owner.end();
    app = await createApp(
      loadApiConfig({
        NODE_ENV: 'test',
        DATABASE_URL_APP: APP_URL,
        API_CORS_ORIGINS: 'http://localhost:3000',
        MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/v1/health returns ok with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('GET /api/v1/health/ready checks the database', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('echoes a safe incoming request id and replaces an unsafe one', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'abc_12345678');
    expect(ok.headers['x-request-id']).toBe('abc_12345678');
    const bad = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', '<script>alert(1)</script>');
    expect(bad.headers['x-request-id']).not.toContain('<');
  });

  it('unknown routes use the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('sends security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('refuses configuration that connects as the Neon owner', () => {
    expect(() =>
      loadApiConfig({
        DATABASE_URL_APP: 'postgresql://neondb_owner:x@ep-1.aws.neon.tech/neondb',
        MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      }),
    ).toThrow(/Neon owner/);
  });
});
