import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

/** Folder with committed SQL migrations (works from src/ and dist/). */
export const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '../drizzle');

/**
 * Applies pending migrations as the OWNER role over the DIRECT connection.
 * Refuses Neon pooler hosts: DDL and advisory locks need a real session.
 */
export const runMigrations = async (ownerUrl: string): Promise<void> => {
  if (new URL(ownerUrl).hostname.includes('-pooler')) {
    throw new Error('Run migrations over the DIRECT connection, not the -pooler host.');
  }
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
};

/**
 * Gives the erp_app role (created NOLOGIN by migration 0000) a password and LOGIN.
 *
 * Why not create the role in the Neon console? Console-created roles join
 * neon_superuser, which can bypass Row-Level Security. Roles created with SQL do not.
 */
export const setupAppRole = async (ownerUrl: string, password: string): Promise<void> => {
  if (password.length < 16 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error('ERP_APP_PASSWORD must be at least 16 characters with letters and digits.');
  }
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const { rows } = await client.query(`select 1 from pg_roles where rolname = 'erp_app'`);
    if (rows.length === 0) {
      throw new Error('Role erp_app does not exist. Run `pnpm db:migrate` first.');
    }
    // Only superusers may change BYPASSRLS (even to false), so it is not touched here;
    // the role was created NOBYPASSRLS and is verified below.
    await client.query(`alter role erp_app with login password ${client.escapeLiteral(password)}`);
    const { rows: check } = await client.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `select rolbypassrls, rolsuper from pg_roles where rolname = 'erp_app'`,
    );
    if (check[0]?.rolbypassrls || check[0]?.rolsuper) {
      throw new Error('erp_app can bypass RLS — refusing to continue.');
    }
  } finally {
    await client.end();
  }
};
