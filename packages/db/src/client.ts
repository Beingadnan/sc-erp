import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { PoolConfig } from 'pg';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DatabaseHandle {
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  connectionString: string;
  /** Max connections in this process. Neon's pooler multiplexes these further. */
  max?: number;
  applicationName?: string;
}

/**
 * Creates the application database handle. Use the APP role's POOLED connection string.
 * Never pass the owner connection here outside migrations and tests.
 */
export const createDatabase = (options: CreateDatabaseOptions): DatabaseHandle => {
  const config: PoolConfig = {
    connectionString: options.connectionString,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: options.applicationName ?? 'school-erp',
  };
  const pool = new Pool(config);
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
};
