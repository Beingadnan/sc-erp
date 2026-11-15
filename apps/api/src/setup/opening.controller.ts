import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { setupListQuerySchema, setupPreviewQuerySchema } from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission } from '../auth/decorators.js';
import { OpeningBalancesService } from './opening.service.js';

type Of<T extends z.ZodType> = z.infer<T>;

/** Old fee balances (previous dues and advance) from a CSV or Excel file. */
@ApiTags('fees')
@Controller({ path: 'opening-balances', version: '1' })
export class OpeningBalancesController {
  constructor(private readonly opening: OpeningBalancesService) {}

  @Get('template')
  @RequirePermission('fees.configure')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="old-fee-balances.csv"')
  template() {
    return this.opening.template();
  }

  @Post()
  @RequirePermission('fees.configure')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 + 1, files: 1 } }))
  preview(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(setupPreviewQuerySchema)) q: Of<typeof setupPreviewQuerySchema>,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    return this.opening.preview(access, q.campusId, q.academicYearId, file);
  }

  @Get()
  @RequirePermission('fees.configure')
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(setupListQuerySchema)) q: Of<typeof setupListQuerySchema>,
  ) {
    return this.opening.list(access, q.campusId);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @RequirePermission('fees.configure')
  apply(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.opening.apply(access, id);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @RequirePermission('fees.configure')
  undo(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.opening.undo(access, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('fees.configure')
  cancel(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.opening.cancel(access, id);
  }
}
