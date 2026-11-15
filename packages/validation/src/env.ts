import { z } from 'zod';

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// URL');

const appDatabaseUrl = postgresUrl.refine((v) => {
  try {
    return new URL(v).username !== 'neondb_owner';
  } catch {
    return false;
  }
}, 'the application must not connect as the Neon owner role; use erp_app');

const commonEnv = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL_APP: appDatabaseUrl,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
};

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

export const apiEnvSchema = z
  .object({
    ...commonEnv,
    /** Public URL of the web app, used in emailed links. */
    APP_URL: z.url().default('http://localhost:3000'),
    /** Key for encrypting MFA secrets at rest. Generate: openssl rand -base64 32 */
    MFA_ENCRYPTION_KEY: base64Key32,
    /** Require MFA before privileged actions. Defaults on in production. */
    MFA_ENFORCEMENT: z.enum(['on', 'off']).optional(),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
    SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(168).default(8),
    /** Number of reverse-proxy hops to trust for client IPs (0 = none). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /**
     * Where uploaded documents are kept. "vercel-blob" needs a PRIVATE Vercel Blob store
     * (create it in the Mumbai region, bom1) and its BLOB_READ_WRITE_TOKEN. "local" keeps
     * files on this machine's disk (development only). Defaults to vercel-blob when a token
     * is set, otherwise local.
     */
    STORAGE_DRIVER: z.enum(['local', 'vercel-blob']).optional(),
    BLOB_READ_WRITE_TOKEN: z.string().min(20).optional(),
    LOCAL_STORAGE_DIR: z.string().default('.storage'),
    API_CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
  })
  .refine((env) => env.STORAGE_DRIVER !== 'vercel-blob' || env.BLOB_READ_WRITE_TOKEN, {
    message: 'STORAGE_DRIVER=vercel-blob needs BLOB_READ_WRITE_TOKEN',
    path: ['BLOB_READ_WRITE_TOKEN'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (env.STORAGE_DRIVER ?? (env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'local')) !== 'local',
    {
      message: 'Local file storage is for development only; set BLOB_READ_WRITE_TOKEN',
      path: ['STORAGE_DRIVER'],
    },
  )
  .transform((env) => ({
    ...env,
    MFA_ENFORCEMENT: env.MFA_ENFORCEMENT ?? (env.NODE_ENV === 'production' ? 'on' : 'off'),
    STORAGE_DRIVER: env.STORAGE_DRIVER ?? (env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'local'),
    COOKIE_SECURE: env.NODE_ENV === 'production',
  }));
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const workerEnvSchema = z.object({
  ...commonEnv,
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Parses env and throws one readable error listing every problem (never echoes secrets). */
export const parseEnv = <S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv): z.infer<S> => {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
};
