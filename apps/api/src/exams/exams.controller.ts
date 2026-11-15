import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  examCreateSchema,
  examPapersSchema,
  examRemarkSchema,
  examStatusSchema,
  examUpdateSchema,
  marksEntrySchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, TenantRoute } from '../auth/decorators.js';
import { ExamsService } from './exams.service.js';

type Of<T extends z.ZodType> = z.infer<T>;
const campusQuery = z.object({ campusId: z.uuid() });
const id = () => new ParseUUIDPipe();

/** Permissions are checked in the service: exams.manage, or the teacher of that subject/class. */
@ApiTags('exams')
@Controller({ path: 'exams', version: '1' })
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Get()
  @TenantRoute()
  list(@CurrentAccess() access: TenantAccess, @Query(zod(campusQuery)) q: Of<typeof campusQuery>) {
    return this.exams.list(access, q.campusId);
  }

  @Post()
  @TenantRoute()
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(examCreateSchema)) body: Of<typeof examCreateSchema>,
  ) {
    return this.exams.create(access, body);
  }

  @Get('marks/mine')
  @TenantRoute()
  mine(@CurrentAccess() access: TenantAccess) {
    return this.exams.mine(access);
  }

  @Get('papers/:paperId/sections/:sectionId')
  @TenantRoute()
  sheet(
    @CurrentAccess() access: TenantAccess,
    @Param('paperId', id()) paperId: string,
    @Param('sectionId', id()) sectionId: string,
  ) {
    return this.exams.sheet(access, paperId, sectionId);
  }

  @Put('papers/:paperId/sections/:sectionId')
  @TenantRoute()
  save(
    @CurrentAccess() access: TenantAccess,
    @Param('paperId', id()) paperId: string,
    @Param('sectionId', id()) sectionId: string,
    @Body(zod(marksEntrySchema)) body: Of<typeof marksEntrySchema>,
  ) {
    return this.exams.saveMarks(access, paperId, sectionId, body);
  }

  @Post('papers/:paperId/sections/:sectionId/submit')
  @TenantRoute()
  submit(
    @CurrentAccess() access: TenantAccess,
    @Param('paperId', id()) paperId: string,
    @Param('sectionId', id()) sectionId: string,
  ) {
    return this.exams.submit(access, paperId, sectionId);
  }

  @Post('papers/:paperId/sections/:sectionId/reopen')
  @TenantRoute()
  reopen(
    @CurrentAccess() access: TenantAccess,
    @Param('paperId', id()) paperId: string,
    @Param('sectionId', id()) sectionId: string,
  ) {
    return this.exams.reopen(access, paperId, sectionId);
  }

  @Get(':id')
  @TenantRoute()
  detail(@CurrentAccess() access: TenantAccess, @Param('id', id()) examId: string) {
    return this.exams.detail(access, examId);
  }

  @Patch(':id')
  @TenantRoute()
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', id()) examId: string,
    @Body(zod(examUpdateSchema)) body: Of<typeof examUpdateSchema>,
  ) {
    return this.exams.update(access, examId, body);
  }

  @Delete(':id')
  @TenantRoute()
  remove(@CurrentAccess() access: TenantAccess, @Param('id', id()) examId: string) {
    return this.exams.remove(access, examId);
  }

  @Post(':id/status')
  @HttpCode(200)
  @TenantRoute()
  status(
    @CurrentAccess() access: TenantAccess,
    @Param('id', id()) examId: string,
    @Body(zod(examStatusSchema)) body: Of<typeof examStatusSchema>,
  ) {
    return this.exams.setStatus(access, examId, body.status);
  }

  @Put(':id/papers')
  @TenantRoute()
  papers(
    @CurrentAccess() access: TenantAccess,
    @Param('id', id()) examId: string,
    @Body(zod(examPapersSchema)) body: Of<typeof examPapersSchema>,
  ) {
    return this.exams.setPapers(access, examId, body);
  }

  @Get(':id/sections/:sectionId/results')
  @TenantRoute()
  results(
    @CurrentAccess() access: TenantAccess,
    @Param('id', id()) examId: string,
    @Param('sectionId', id()) sectionId: string,
  ) {
    return this.exams.sectionResults(access, examId, sectionId);
  }

  @Put(':id/sections/:sectionId/remarks')
  @TenantRoute()
  remarks(
    @CurrentAccess() access: TenantAccess,
    @Param('id', id()) examId: string,
    @Param('sectionId', id()) sectionId: string,
    @Body(zod(examRemarkSchema)) body: Of<typeof examRemarkSchema>,
  ) {
    return this.exams.saveRemarks(access, examId, sectionId, body.remarks);
  }

  @Get(':id/students/:studentId/report-card.pdf')
  @TenantRoute()
  @Header('Cache-Control', 'private, no-store')
  async card(
    @CurrentAccess() access: TenantAccess,
    @Param('id', id()) examId: string,
    @Param('studentId', id()) studentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { bytes, fileName } = await this.exams.reportCardPdf(access, examId, studentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return new StreamableFile(Buffer.from(bytes));
  }
}
