import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// Migrations always run as the OWNER role over the DIRECT (non-pooled) connection.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL_OWNER ?? '',
  },
  strict: true,
  verbose: true,
});
