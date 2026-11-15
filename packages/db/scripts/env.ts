import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load the repo-root .env (scripts run from packages/db via pnpm --filter).
config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
config({ quiet: true });

export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
};

/** Hostname only — never print credentials. */
export const describeUrl = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}/${u.pathname.slice(1)}`;
  } catch {
    return '(unparseable url)';
  }
};
