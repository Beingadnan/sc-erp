import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { teachingCellSchema, teachingGridQuerySchema } from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission, TenantRoute } from '../auth/decorators.js';
import { TeachingService } from './teaching.service.js';

type Of<T extends z.ZodType> = z.infer<T>;

@ApiTags('academics')
@Controller({ path: 'teaching', version: '1' })
export class TeachingController {
  constructor(private readonly teaching: TeachingService) {}

  @Get('grid')
  @RequirePermission(['academic.view', 'academic.manage'])
  grid(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(teachingGridQuerySchema)) q: Of<typeof teachingGridQuerySchema>,
  ) {
    return this.teaching.grid(access, q.campusId, q.academicYearId);
  }

  @Put('cell')
  @RequirePermission('academic.manage')
  setCell(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(teachingCellSchema)) body: Of<typeof teachingCellSchema>,
  ) {
    return this.teaching.setCell(access, body);
  }

  /** Any staff member: the classes they teach this year. */
  @Get('mine')
  @TenantRoute()
  mine(@CurrentAccess() access: TenantAccess) {
    return this.teaching.mine(access);
  }

  @Get('sections/:id/students')
  @TenantRoute()
  roster(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.teaching.roster(access, id);
  }
}
