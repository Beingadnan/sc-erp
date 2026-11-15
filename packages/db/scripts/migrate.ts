import { runMigrations } from '../src/admin.js';
import { describeUrl, requireEnv } from './env.js';

const url = requireEnv('DATABASE_URL_OWNER');
console.log(`Migrating ${describeUrl(url)} …`);
runMigrations(url)
  .then(() => console.log('Migrations applied.'))
  .catch((err: unknown) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
