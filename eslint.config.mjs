// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Tenant-isolation guard rails:
 * - Only packages/db may import the raw Postgres driver or create Drizzle clients.
 *   Everything else must go through `withTenant` / `withPlatformAccess` from @school-erp/db.
 */
const RAW_DB_IMPORTS = {
  paths: [
    {
      name: 'pg',
      message: 'Use @school-erp/db (withTenant) instead of the raw pg driver.',
      allowTypeImports: true,
    },
    {
      name: 'drizzle-orm/node-postgres',
      message: 'Use @school-erp/db (withTenant) instead of creating a Drizzle client.',
    },
    {
      name: '@neondatabase/serverless',
      message: 'Use @school-erp/db (withTenant) instead of the raw Neon driver.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'packages/db/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': ['error', RAW_DB_IMPORTS],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The data-access package is the only place allowed to touch the driver.
    files: ['packages/db/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // NestJS relies on runtime type metadata for dependency injection, so constructor
    // parameter types must stay value imports.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['**/scripts/**/*.ts', '**/test/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
