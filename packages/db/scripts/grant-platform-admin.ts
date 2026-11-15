import pg from 'pg';
import { describeUrl, requireEnv } from './env.js';

/**
 * Grants a platform role to an existing user:
 *   pnpm --filter @school-erp/db grant-platform-admin you@example.com super_admin
 * Runs as the owner role; platform roles cannot be granted through the application.
 */
const [email, role = 'super_admin'] = process.argv.slice(2);
if (!email || !['super_admin', 'support', 'operations'].includes(role)) {
  console.error('Usage: grant-platform-admin <email> [super_admin|support|operations]');
  process.exit(1);
}
const url = requireEnv('DATABASE_URL_OWNER');
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query<{ id: string }>('select id from users where email = $1', [
    email,
  ]);
  const user = rows[0];
  if (!user) {
    console.error(`No user with that email on ${describeUrl(url)}. Register first.`);
    process.exitCode = 1;
  } else {
    await client.query(
      `insert into platform_admins (user_id, role) values ($1, $2)
       on conflict (user_id) do update set role = excluded.role`,
      [user.id, role],
    );
    console.log(`Granted ${role} on ${describeUrl(url)}.`);
  }
} finally {
  await client.end();
}
