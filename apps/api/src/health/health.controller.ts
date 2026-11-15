import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { DatabaseHandle } from '@school-erp/db';
import { DB_HANDLE } from '../database/database.module.js';

/** Liveness and readiness probes. Contain no tenant data and need no auth. */
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(@Inject(DB_HANDLE) private readonly db: DatabaseHandle) {}

  @Get()
  @ApiOkResponse({ description: 'Process is alive' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Database reachable' })
  async ready(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.db.pool.query('select 1');
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
    return { status: 'ok', database: 'ok' };
  }
}
