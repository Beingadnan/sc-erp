import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap.js';
import { loadApiConfig } from './config/api-config.js';

loadDotenv({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

const main = async (): Promise<void> => {
  const config = loadApiConfig();
  const app = await createApp(config);
  await app.listen(config.API_PORT);
  new Logger('Bootstrap').log(`API listening on :${config.API_PORT} (docs at /api/docs)`);
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
