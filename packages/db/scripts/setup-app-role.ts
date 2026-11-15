import { setupAppRole } from '../src/admin.js';
import { describeUrl, requireEnv } from './env.js';

const url = requireEnv('DATABASE_URL_OWNER');
const password = requireEnv('ERP_APP_PASSWORD');
console.log(`Configuring role erp_app on ${describeUrl(url)} …`);
setupAppRole(url, password)
  .then(() =>
    console.log(
      'erp_app can now log in. Build DATABASE_URL_APP from the POOLED host with user erp_app.',
    ),
  )
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
