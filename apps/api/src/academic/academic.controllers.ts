import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  academicYearCreateSchema,
  academicYearStatusSchema,
  academicYearUpdateSchema,
  calendarEventCreateSchema,
  calendarEventUpdateSchema,
  calendarQuerySchema,
  campusQuerySchema,
  classSubjectsSchema,
  gradeLevelCreateSchema,
  gradeLevelUpdateSchema,
  gradingScaleCreateSchema,
  gradingScaleUpdateSchema,
  sectionCreateSchema,
  sectionListQuerySchema,
  sectionUpdateSchema,
  structureTemplateSchema,
  subjectCreateSchema,
  subjectUpdateSchema,
  termCreateSchema,
  termUpdateSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission } from '../auth/decorators.js';
import { AcademicYearsService } from './academic-years.service.js';
import { CalendarService } from './calendar.service.js';
import { GradingService } from './grading.service.js';
import { AcademicSetupService } from './setup.service.js';
import { StructureService } from './structure.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;

@ApiTags('academics')
@Controller({ version: '1' })
export class AcademicYearsController {
  constructor(private readonly years: AcademicYearsService) {}

  @Get('academic-years')
  @RequirePermission('academic.view')
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuerySchema)) q: Of<typeof campusQuerySchema>,
  ) {
    return this.years.list(access, q.campusId);
  }

  @Post('academic-years')
  @RequirePermission('academic.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(academicYearCreateSchema)) body: Of<typeof academicYearCreateSchema>,
  ) {
    return this.years.create(access, body);
  }

  @Patch('academic-years/:id')
  @RequirePermission('academic.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(academicYearUpdateSchema)) body: Of<typeof academicYearUpdateSchema>,
  ) {
    return this.years.update(access, id, body);
  }

  @Post('academic-years/:id/make-current')
  @HttpCode(200)
  @RequirePermission('academic.manage')
  makeCurrent(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.years.makeCurrent(access, id);
  }

  @Post('academic-years/:id/status')
  @HttpCode(200)
  @RequirePermission('academic.manage')
  setStatus(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(academicYearStatusSchema)) body: Of<typeof academicYearStatusSchema>,
  ) {
    return this.years.setStatus(access, id, body.status);
  }

  @Delete('academic-years/:id')
  @HttpCode(204)
  @RequirePermission('academic.manage')
  async remove(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.years.remove(access, id);
  }

  @Get('academic-years/:id/terms')
  @RequirePermission('academic.view')
  terms(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.years.listTerms(access, id);
  }

  @Post('academic-years/:id/terms')
  @RequirePermission('academic.manage')
  createTerm(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(termCreateSchema)) body: Of<typeof termCreateSchema>,
  ) {
    return this.years.createTerm(access, id, body);
  }

  @Patch('terms/:id')
  @RequirePermission('academic.manage')
  updateTerm(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(termUpdateSchema)) body: Of<typeof termUpdateSchema>,
  ) {
    return this.years.updateTerm(access, id, body);
  }

  @Delete('terms/:id')
  @HttpCode(204)
  @RequirePermission('academic.manage')
  async removeTerm(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.years.removeTerm(access, id);
  }
}

@ApiTags('academics')
@Controller({ version: '1' })
export class StructureController {
  constructor(
    private readonly structure: StructureService,
    private readonly setup: AcademicSetupService,
  ) {}

  @Get('classes')
  @RequirePermission('academic.view')
  classes(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuerySchema)) q: Of<typeof campusQuerySchema>,
  ) {
    return this.structure.listClasses(access, q.campusId);
  }

  @Post('classes')
  @RequirePermission('academic.manage')
  createClass(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(gradeLevelCreateSchema)) body: Of<typeof gradeLevelCreateSchema>,
  ) {
    return this.structure.createClass(access, body);
  }

  @Patch('classes/:id')
  @RequirePermission('academic.manage')
  updateClass(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(gradeLevelUpdateSchema)) body: Of<typeof gradeLevelUpdateSchema>,
  ) {
    return this.structure.updateClass(access, id, body);
  }

  @Get('classes/:id/subjects')
  @RequirePermission('academic.view')
  classSubjects(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.structure.listClassSubjects(access, id);
  }

  @Put('classes/:id/subjects')
  @RequirePermission('academic.manage')
  setClassSubjects(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(classSubjectsSchema)) body: Of<typeof classSubjectsSchema>,
  ) {
    return this.structure.setClassSubjects(access, id, body);
  }

  @Get('sections')
  @RequirePermission('academic.view')
  sections(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(sectionListQuerySchema)) q: Of<typeof sectionListQuerySchema>,
  ) {
    return this.structure.listSections(access, q.academicYearId, q.gradeLevelId);
  }

  @Post('sections')
  @RequirePermission('academic.manage')
  createSection(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(sectionCreateSchema)) body: Of<typeof sectionCreateSchema>,
  ) {
    return this.structure.createSection(access, body);
  }

  @Patch('sections/:id')
  @RequirePermission('academic.manage')
  updateSection(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(sectionUpdateSchema)) body: Of<typeof sectionUpdateSchema>,
  ) {
    return this.structure.updateSection(access, id, body);
  }

  @Delete('sections/:id')
  @HttpCode(204)
  @RequirePermission('academic.manage')
  async removeSection(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.structure.removeSection(access, id);
  }

  @Get('subjects')
  @RequirePermission('academic.view')
  subjects(@CurrentAccess() access: TenantAccess) {
    return this.structure.listSubjects(access);
  }

  @Post('subjects')
  @RequirePermission('academic.manage')
  createSubject(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(subjectCreateSchema)) body: Of<typeof subjectCreateSchema>,
  ) {
    return this.structure.createSubject(access, body);
  }

  @Patch('subjects/:id')
  @RequirePermission('academic.manage')
  updateSubject(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(subjectUpdateSchema)) body: Of<typeof subjectUpdateSchema>,
  ) {
    return this.structure.updateSubject(access, id, body);
  }

  @Post('academic/setup-template')
  @HttpCode(200)
  @RequirePermission('academic.manage')
  applyTemplate(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(structureTemplateSchema)) body: Of<typeof structureTemplateSchema>,
  ) {
    return this.setup.applyTemplate(access, body);
  }
}

@ApiTags('academics')
@Controller({ version: '1' })
export class GradingController {
  constructor(private readonly grading: GradingService) {}

  @Get('grading-scales')
  @RequirePermission('academic.view')
  list(@CurrentAccess() access: TenantAccess) {
    return this.grading.list(access);
  }

  @Post('grading-scales')
  @RequirePermission('academic.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(gradingScaleCreateSchema)) body: Of<typeof gradingScaleCreateSchema>,
  ) {
    return this.grading.create(access, body);
  }

  @Patch('grading-scales/:id')
  @RequirePermission('academic.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(gradingScaleUpdateSchema)) body: Of<typeof gradingScaleUpdateSchema>,
  ) {
    return this.grading.update(access, id, body);
  }

  @Delete('grading-scales/:id')
  @HttpCode(204)
  @RequirePermission('academic.manage')
  async remove(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.grading.remove(access, id);
  }
}

@ApiTags('academics')
@Controller({ path: 'calendar', version: '1' })
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermission('academic.view')
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(calendarQuerySchema)) q: Of<typeof calendarQuerySchema>,
  ) {
    return this.calendar.list(access, q.campusId, q.from, q.to);
  }

  @Get('working-days')
  @RequirePermission('academic.view')
  workingDays(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(calendarQuerySchema)) q: Of<typeof calendarQuerySchema>,
  ) {
    return this.calendar.workingDays(access, q.campusId, q.from, q.to);
  }

  @Post()
  @RequirePermission('calendar.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(calendarEventCreateSchema)) body: Of<typeof calendarEventCreateSchema>,
  ) {
    return this.calendar.create(access, body);
  }

  @Patch(':id')
  @RequirePermission('calendar.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(calendarEventUpdateSchema)) body: Of<typeof calendarEventUpdateSchema>,
  ) {
    return this.calendar.update(access, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('calendar.manage')
  async remove(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.calendar.remove(access, id);
  }
}
