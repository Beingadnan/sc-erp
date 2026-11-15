import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  MAX_DOCUMENT_BYTES,
  campusDayQuerySchema,
  dayQuerySchema,
  homeworkListQuerySchema,
  homeworkSchema,
  noticeSchema,
  periodSlotsSchema,
  substitutionSchema,
  timetableCellSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission, TenantRoute } from '../auth/decorators.js';
import { ClassroomService } from './classroom.service.js';
import { NoticesService } from './notices.service.js';

type Of<T extends z.ZodType> = z.infer<T>;
const campusQuery = z.object({ campusId: z.uuid() });

@ApiTags('classroom')
@Controller({ version: '1' })
export class ClassroomController {
  constructor(private readonly classroom: ClassroomService) {}

  @Get('timetable/slots')
  @TenantRoute()
  slots(@CurrentAccess() access: TenantAccess, @Query(zod(campusQuery)) q: Of<typeof campusQuery>) {
    return this.classroom.slots(access, q.campusId);
  }

  @Put('timetable/slots')
  @RequirePermission('timetable.manage')
  saveSlots(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(periodSlotsSchema)) body: Of<typeof periodSlotsSchema>,
  ) {
    return this.classroom.saveSlots(access, body);
  }

  @Get('timetable/sections/:id')
  @TenantRoute()
  section(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.classroom.sectionTimetable(access, id);
  }

  @Put('timetable/sections/:id/cell')
  @RequirePermission('timetable.manage')
  cell(
    @CurrentAccess() access: TenantAccess,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(zod(timetableCellSchema)) body: Of<typeof timetableCellSchema>,
  ) {
    return this.classroom.setCell(access, id, body);
  }

  @Get('timetable/mine')
  @TenantRoute()
  mine(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(dayQuerySchema)) q: Of<typeof dayQuerySchema>,
  ) {
    return this.classroom.mine(access, q.date);
  }

  @Get('timetable/teachers/:membershipId/day')
  @RequirePermission('timetable.manage')
  teacherDay(
    @CurrentAccess() access: TenantAccess,
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Query(zod(campusDayQuerySchema)) q: Of<typeof campusDayQuerySchema>,
  ) {
    return this.classroom.teacherDay(access, q.campusId, membershipId, q.date);
  }

  @Put('timetable/substitutions')
  @RequirePermission('timetable.manage')
  substitute(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(substitutionSchema)) body: Of<typeof substitutionSchema>,
  ) {
    return this.classroom.setSubstitution(access, body);
  }

  @Post('homework')
  @TenantRoute()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1 } }),
  )
  addHomework(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(homeworkSchema)) body: Of<typeof homeworkSchema>,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ) {
    return this.classroom.addHomework(access, body, file);
  }

  @Get('homework')
  @TenantRoute()
  homework(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(homeworkListQuerySchema)) q: Of<typeof homeworkListQuerySchema>,
  ) {
    return this.classroom.homeworkFor(access, q.sectionId);
  }

  @Delete('homework/:id')
  @TenantRoute()
  removeHomework(
    @CurrentAccess() access: TenantAccess,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.classroom.removeHomework(access, id);
  }
}

@ApiTags('notices')
@Controller({ path: 'notices', version: '1' })
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @RequirePermission('notices.manage')
  list(@CurrentAccess() access: TenantAccess) {
    return this.notices.list(access);
  }

  @Get('feed')
  @TenantRoute()
  feed(@CurrentAccess() access: TenantAccess) {
    return this.notices.staffFeed(access);
  }

  @Post()
  @RequirePermission('notices.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(noticeSchema)) body: Of<typeof noticeSchema>,
  ) {
    return this.notices.create(access, body);
  }

  @Put(':id')
  @RequirePermission('notices.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(zod(noticeSchema)) body: Of<typeof noticeSchema>,
  ) {
    return this.notices.update(access, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('notices.manage')
  publish(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notices.setStatus(access, id, 'published');
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('notices.manage')
  archive(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notices.setStatus(access, id, 'archived');
  }

  @Post(':id/read')
  @HttpCode(200)
  @TenantRoute()
  read(@CurrentAccess() access: TenantAccess, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notices.markRead(access, id);
  }
}
