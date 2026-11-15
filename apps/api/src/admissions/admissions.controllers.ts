import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  MAX_DOCUMENT_BYTES,
  applicationAdmitSchema,
  applicationCreateSchema,
  applicationListQuerySchema,
  applicationSummaryQuerySchema,
  applicationTransitionSchema,
  applicationUpdateSchema,
  documentUploadFieldsSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, Public, RequirePermission } from '../auth/decorators.js';
import { FILE_STORAGE, LocalDiskStorage } from '../storage/file-storage.js';
import type { FileStorage } from '../storage/file-storage.js';
import { ApplicationsService } from './applications.service.js';
import { DocumentsService } from './documents.service.js';
import type { UploadedFile as Upload } from './documents.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;

@ApiTags('admissions')
@Controller({ path: 'applications', version: '1' })
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly documents: DocumentsService,
  ) {}

  @Get()
  @RequirePermission('admissions.view')
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(applicationListQuerySchema)) q: Of<typeof applicationListQuerySchema>,
  ) {
    return this.applications.list(access, q);
  }

  @Get('summary')
  @RequirePermission('admissions.view')
  summary(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(applicationSummaryQuerySchema)) q: Of<typeof applicationSummaryQuerySchema>,
  ) {
    return this.applications.summary(access, q.campusId, q.academicYearId);
  }

  @Post()
  @RequirePermission('admissions.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(applicationCreateSchema)) body: Of<typeof applicationCreateSchema>,
  ) {
    return this.applications.create(access, body);
  }

  @Get(':id')
  @RequirePermission('admissions.view')
  get(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.applications.get(access, id);
  }

  @Patch(':id')
  @HttpCode(204)
  @RequirePermission('admissions.manage')
  async update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(applicationUpdateSchema)) body: Of<typeof applicationUpdateSchema>,
  ) {
    await this.applications.update(access, id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermission('admissions.manage')
  transition(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(applicationTransitionSchema)) body: Of<typeof applicationTransitionSchema>,
  ) {
    return this.applications.transition(access, id, body);
  }

  @Post(':id/admit')
  @HttpCode(200)
  @RequirePermission('admissions.manage')
  admit(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(applicationAdmitSchema)) body: Of<typeof applicationAdmitSchema>,
  ) {
    return this.applications.admit(access, id, body);
  }

  @Get(':id/documents')
  @RequirePermission('admissions.view')
  docs(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.documents.list(access, { applicationId: id });
  }
}

@ApiTags('documents')
@Controller({ version: '1' })
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** multipart/form-data: file, docType, and studentId or applicationId. */
  @Post('documents')
  @RequirePermission(['students.manage', 'admissions.manage'])
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1, fields: 5 } }),
  )
  upload(
    @CurrentAccess() access: TenantAccess,
    @UploadedFile() file: Upload | undefined,
    @Body(zod(documentUploadFieldsSchema)) body: Of<typeof documentUploadFieldsSchema>,
  ) {
    return this.documents.upload(
      access,
      { studentId: body.studentId, applicationId: body.applicationId },
      body.docType,
      file,
    );
  }

  @Get('students/:id/documents')
  @RequirePermission(['students.view', 'students.manage'])
  studentDocs(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.documents.list(access, { studentId: id });
  }

  /** POST: each link is logged, and must never be prefetched or cached. */
  @Post('documents/:id/link')
  @HttpCode(200)
  @RequirePermission(['students.view', 'students.manage', 'admissions.view'])
  link(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.documents.downloadUrl(access, id);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  @RequirePermission(['students.manage', 'admissions.manage'])
  async remove(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.documents.remove(access, id);
  }
}

/** Development storage only: serves files behind an expiring HMAC signature. */
@ApiTags('documents')
@Controller({ path: 'files', version: '1' })
export class LocalFilesController {
  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStorage) {}

  @Public()
  @Get('local')
  async get(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const file =
      this.storage instanceof LocalDiskStorage && typeof key === 'string'
        ? await this.storage.read(key, String(exp), String(sig))
        : null;
    if (!file) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Link expired or not found' } });
      return;
    }
    const name = key.split('/').at(-1)!;
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    );
    res.send(file.bytes);
  }
}
