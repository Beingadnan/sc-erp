import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { DatabaseHandle } from '@school-erp/db';
import { withContext } from '@school-erp/db';
import { platformTenantStatusSchema, platformTenantsQuerySchema } from '@school-erp/validation';
import { AppError } from '@school-erp/shared';
import { DB_HANDLE } from '../database/database.module.js';
import { zod } from '../common/zod.pipe.js';
import { pgErrorOf } from '../common/pg-errors.js';
import type { SessionAuth } from '../auth/access.js';
import { CurrentSession, PlatformRoute } from '../auth/decorators.js';

/**
 * Platform staff: list schools and suspend/restore them. Everything goes through
 * SECURITY DEFINER functions that re-check the platform role, and status changes are
 * written to the affected school's own audit log.
 */
@ApiTags('platform')
@Controller({ path: 'platform', version: '1' })
export class PlatformController {
  constructor(@Inject(DB_HANDLE) private readonly handle: DatabaseHandle) {}

  @Get('tenants')
  @PlatformRoute()
  tenants(
    @CurrentSession() s: SessionAuth,
    @Query(zod(platformTenantsQuerySchema)) q: z.infer<typeof platformTenantsQuerySchema>,
  ) {
    return withContext(
      this.handle.db,
      { userId: s.userId, requestId: s.requestId },
      async (tx) => {
        const r = await tx.execute(
          sql`select * from app.platform_list_tenants(${q.search ?? null}, ${q.limit})`,
        );
        return r.rows;
      },
      { readOnly: true },
    );
  }

  @Post('tenants/:id/status')
  @PlatformRoute('super_admin', 'operations')
  @HttpCode(204)
  async setStatus(
    @CurrentSession() s: SessionAuth,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(zod(platformTenantStatusSchema)) body: z.infer<typeof platformTenantStatusSchema>,
  ) {
    try {
      await withContext(this.handle.db, { userId: s.userId, requestId: s.requestId }, (tx) =>
        tx.execute(
          sql`select app.platform_set_tenant_status(${id}, ${body.status}, ${body.reason}, ${s.requestId})`,
        ),
      );
    } catch (err) {
      if (pgErrorOf(err)?.code === 'P0002') throw new AppError('NOT_FOUND', 'School not found');
      throw err;
    }
  }
}
