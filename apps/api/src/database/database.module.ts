import { Global, Inject, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { assertAppRoleIsSafe, createDatabase } from '@school-erp/db';
import type { DatabaseHandle } from '@school-erp/db';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';

export const DB_HANDLE = Symbol('DB_HANDLE');

/**
 * Provides the application database handle (erp_app role, pooled connection).
 * Services never use it directly for tenant data — they call withTenant(handle.db, ctx, …).
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): DatabaseHandle =>
        createDatabase({
          connectionString: config.DATABASE_URL_APP,
          max: config.DB_POOL_MAX,
          applicationName: 'school-erp-api',
        }),
    },
  ],
  exports: [DB_HANDLE],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(DB_HANDLE) private readonly handle: DatabaseHandle) {}

  async onModuleInit(): Promise<void> {
    await assertAppRoleIsSafe(this.handle.pool);
    this.logger.log('Database role verified: Row-Level Security cannot be bypassed.');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
