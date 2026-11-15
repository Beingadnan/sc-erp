import { Client } from 'pg';
import { findRlsViolations } from '../src/rls-check.js';
import { describeUrl, requireEnv } from './env.js';

const main = async (): Promise<void> => {
  const url = requireEnv('DATABASE_URL_OWNER');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const violations = await findRlsViolations(client);
    if (violations.length === 0) {
      console.log(`RLS check passed on ${describeUrl(url)}.`);
      return;
    }
    console.error(`RLS check FAILED on ${describeUrl(url)}:`);
    for (const v of violations) {
      console.error(`  [${v.kind}] ${v.table}: ${v.detail}`);
    }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
