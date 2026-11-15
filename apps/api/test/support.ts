import { tmpdir } from 'node:os';
import { join } from 'node:path';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';
import { APP_URL } from '@school-erp/db/testing';
import { newId } from '@school-erp/shared';
import { createApp } from '../src/bootstrap.js';
import { loadApiConfig } from '../src/config/api-config.js';
import { MAILER, tokenFromMail } from '../src/auth/mailer.js';
import type { CaptureMailer } from '../src/auth/mailer.js';
import { base32Decode, currentStep, hotp } from '../src/auth/totp.js';

export const TEST_KEY = Buffer.alloc(32, 7).toString('base64');
export const ORIGIN = 'http://localhost:3000';

export const startApp = async (
  overrides: Record<string, string> = {},
): Promise<INestApplication> => {
  const app = await createApp(
    loadApiConfig({
      NODE_ENV: 'test',
      DATABASE_URL_APP: APP_URL,
      API_CORS_ORIGINS: ORIGIN,
      MFA_ENCRYPTION_KEY: TEST_KEY,
      MFA_ENFORCEMENT: 'off',
      LOCAL_STORAGE_DIR: join(tmpdir(), 'school-erp-test-storage'),
      APP_URL: 'http://localhost:3000',
      ...overrides,
    }),
  );
  await app.init();
  return app;
};

export const mailer = (app: INestApplication): CaptureMailer => app.get(MAILER) as CaptureMailer;

export const unique = (prefix: string) => `${prefix}-${newId().slice(-8)}`;

/** A browser-like client: keeps cookies and echoes the CSRF token like the web app does. */
export class Browser {
  readonly agent: TestAgent;
  csrf = '';

  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  capture(res: request.Response): request.Response {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const c = cookies.find((x) => x.startsWith('csrf='));
    if (c) this.csrf = decodeURIComponent(c.split(';')[0]!.slice(5));
    return res;
  }

  get(path: string) {
    return this.agent.get(`/api/v1${path}`);
  }

  async send(method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: object) {
    const res = await this.agent[method](`/api/v1${path}`)
      .set('X-CSRF-Token', this.csrf)
      .set('Origin', ORIGIN)
      .send(body ?? {});
    return this.capture(res);
  }

  post(path: string, body?: object) {
    return this.send('post', path, body);
  }

  /** multipart/form-data upload, like a browser file input. */
  async upload(
    path: string,
    fields: Record<string, string>,
    file: { name: string; bytes: Buffer } | null,
  ) {
    let req = this.agent
      .post(`/api/v1${path}`)
      .set('X-CSRF-Token', this.csrf)
      .set('Origin', ORIGIN);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    if (file) req = req.attach('file', file.bytes, file.name);
    return this.capture(await req);
  }
  put(path: string, body?: object) {
    return this.send('put', path, body);
  }
  patch(path: string, body?: object) {
    return this.send('patch', path, body);
  }
  delete(path: string) {
    return this.send('delete', path);
  }
}

export interface School {
  browser: Browser;
  email: string;
  password: string;
  slug: string;
  tenantId: string;
  campusId: string;
}

export const registerSchool = async (app: INestApplication, name: string): Promise<School> => {
  const browser = new Browser(app);
  const slug = unique(name.toLowerCase());
  const email = `${slug}@example.test`;
  const password = 'a long school passphrase 1';
  const res = await browser.post('/auth/register-school', {
    schoolName: `${name} Public School`,
    slug,
    campusName: 'Main Campus',
    board: name === 'A' ? 'CBSE' : 'RBSE',
    fullName: `Owner ${name}`,
    email,
    password,
  });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const me = await browser.get('/auth/me');
  const campuses = await browser.get('/campuses');
  return {
    browser,
    email,
    password,
    slug,
    tenantId: me.body.activeTenantId,
    campusId: campuses.body[0].id,
  };
};

export const totpNow = (secret: string, offsetSteps = 0): string =>
  hotp(base32Decode(secret), currentStep() + offsetSteps);

export { tokenFromMail };
