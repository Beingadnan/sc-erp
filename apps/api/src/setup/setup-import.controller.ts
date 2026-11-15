import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  SETUP_MAX_BYTES,
  setupListQuerySchema,
  setupPreviewQuerySchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission } from '../auth/decorators.js';
import { SetupImportService } from './setup-import.service.js';

type Of<T extends z.ZodType> = z.infer<T>;

/** The school setup workbook: classes, subjects, staff and who teaches what. */
@ApiTags('setup')
@Controller({ path: 'setup-imports', version: '1' })
export class SetupImportController {
  constructor(private readonly setup: SetupImportService) {}

  @Get('template')
  @RequirePermission('academic.manage')
  @Header('Cache-Control', 'no-store')
  async template(@Res({ passthrough: true }) res: Response) {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="school-setup-workbook.xlsx"');
    return new StreamableFile(await this.setup.template());
  }

  @Post()
  @RequirePermission('academic.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SETUP_MAX_BYTES + 1, files: 1 } }))
  preview(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(setupPreviewQuerySchema)) q: Of<typeof setupPreviewQuerySchema>,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    return this.setup.preview(access, q.campusId, q.academicYearId, file);
  }

  @Get()
  @RequirePermission('academic.manage')
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(setupListQuerySchema)) q: Of<typeof setupListQuerySchema>,
  ) {
    return this.setup.list(access, q.campusId);
  }

  @Post(':id/apply')
  @HttpCode(200)
  @RequirePermission('academic.manage')
  apply(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.setup.apply(access, id);
  }

  @Post(':id/undo')
  @HttpCode(200)
  @RequirePermission('academic.manage')
  undo(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.setup.undo(access, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('academic.manage')
  cancel(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.setup.cancel(access, id);
  }
}
