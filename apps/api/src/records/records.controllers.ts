import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
  IMPORT_MAX_BYTES,
  customFieldCreateSchema,
  customFieldUpdateSchema,
  exportQuerySchema,
  importConfirmSchema,
  importPreviewFieldsSchema,
  promotionPreviewQuerySchema,
  promotionSchema,
  tcCancelSchema,
  withdrawSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission, TenantRoute } from '../auth/decorators.js';
import { CustomFieldsService } from './custom-fields.service.js';
import { ImportExportService } from './import-export.service.js';
import { LifecycleService } from './lifecycle.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;

@ApiTags('students')
@Controller({ version: '1' })
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get('promotions/preview')
  @RequirePermission('students.promote')
  preview(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(promotionPreviewQuerySchema)) q: Of<typeof promotionPreviewQuerySchema>,
  ) {
    return this.lifecycle.preview(access, q.fromSectionId, q.toAcademicYearId);
  }

  @Post('promotions')
  @HttpCode(200)
  @RequirePermission('students.promote')
  promote(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(promotionSchema)) body: Of<typeof promotionSchema>,
  ) {
    return this.lifecycle.promote(access, body);
  }

  @Post('students/:id/withdraw')
  @HttpCode(200)
  @RequirePermission('students.withdraw')
  withdraw(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(withdrawSchema)) body: Of<typeof withdrawSchema>,
  ) {
    return this.lifecycle.withdraw(access, id, body);
  }

  @Post('students/:id/transfer-certificates')
  @RequirePermission('students.withdraw')
  issue(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(withdrawSchema)) body: Of<typeof withdrawSchema>,
  ) {
    return this.lifecycle.issue(access, id, body);
  }

  @Get('students/:id/transfer-certificates')
  @RequirePermission('students.view')
  list(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.lifecycle.list(access, id);
  }

  @Post('transfer-certificates/:id/cancel')
  @HttpCode(204)
  @RequirePermission('students.withdraw')
  async cancel(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(tcCancelSchema)) body: Of<typeof tcCancelSchema>,
  ) {
    await this.lifecycle.cancel(access, id, body.reason);
  }

  @Get('transfer-certificates/:id/pdf')
  @RequirePermission('students.view')
  @Header('Cache-Control', 'private, no-store')
  async pdf(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { bytes, fileName } = await this.lifecycle.pdf(access, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return new StreamableFile(Buffer.from(bytes));
  }
}

@ApiTags('students')
@Controller({ version: '1' })
export class ImportExportController {
  constructor(private readonly io: ImportExportService) {}

  @Get('students/export')
  @RequirePermission('students.export')
  @Header('Cache-Control', 'private, no-store')
  async export(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(exportQuerySchema)) q: Of<typeof exportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv } = await this.io.exportCsv(access, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="students-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  @Get('students/import/template')
  @RequirePermission('students.import')
  async template(@CurrentAccess() access: TenantAccess, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="student-import-template.csv"');
    return this.io.template(access);
  }

  /** multipart/form-data: file (.csv or .xlsx), campusId, academicYearId. */
  @Post('imports/students')
  @RequirePermission('students.import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES + 1, files: 1, fields: 4 } }),
  )
  preview(
    @CurrentAccess() access: TenantAccess,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined,
    @Body(zod(importPreviewFieldsSchema)) body: Of<typeof importPreviewFieldsSchema>,
  ) {
    return this.io.preview(access, body.campusId, body.academicYearId, file);
  }

  @Get('imports')
  @RequirePermission('students.import')
  list(@CurrentAccess() access: TenantAccess) {
    return this.io.list(access);
  }

  @Get('imports/:id')
  @RequirePermission('students.import')
  get(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.io.get(access, id);
  }

  @Post('imports/:id/confirm')
  @HttpCode(202)
  @RequirePermission('students.import')
  confirm(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(importConfirmSchema)) _body: Of<typeof importConfirmSchema>,
  ) {
    return this.io.confirm(access, id);
  }

  @Post('imports/:id/cancel')
  @HttpCode(204)
  @RequirePermission('students.import')
  async cancel(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.io.cancel(access, id);
  }
}

@ApiTags('settings')
@Controller({ path: 'custom-fields', version: '1' })
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  /** Any signed-in member of the school: the forms need the definitions. */
  @Get()
  @TenantRoute()
  list(@CurrentAccess() access: TenantAccess) {
    return this.fields.list(access);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(customFieldCreateSchema)) body: Of<typeof customFieldCreateSchema>,
  ) {
    return this.fields.create(access, body);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(customFieldUpdateSchema)) body: Of<typeof customFieldUpdateSchema>,
  ) {
    return this.fields.update(access, id, body);
  }
}
