import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  attendanceSettingsSchema,
  attendanceSlotSchema,
  leaveCreateSchema,
  leaveDecisionSchema,
  leaveListQuerySchema,
  lowAttendanceQuerySchema,
  markAttendanceSchema,
  monthQuerySchema,
  todayQuerySchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission } from '../auth/decorators.js';
import { AttendanceService } from './attendance.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;
/** Any attendance right; the service narrows it to campuses and own sections. */
const ANY = ['attendance.view', 'attendance.mark', 'attendance.correct'];

const campusQuery = z.object({ campusId: z.uuid() });
const monthPeriodQuery = monthQuerySchema.extend({
  period: z.coerce.number().int().min(0).max(12).optional(),
});
const summaryQuery = z.object({ academicYearId: z.uuid().optional() });

@ApiTags('attendance')
@Controller({ path: 'attendance', version: '1' })
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('settings')
  @RequirePermission(ANY)
  settings(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuery)) q: Of<typeof campusQuery>,
  ) {
    return this.attendance.getSettings(access, q.campusId);
  }

  @Put('settings')
  @RequirePermission('attendance.correct')
  putSettings(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuery)) q: Of<typeof campusQuery>,
    @Body(zod(attendanceSettingsSchema)) body: Of<typeof attendanceSettingsSchema>,
  ) {
    return this.attendance.putSettings(access, q.campusId, body);
  }

  @Get('today')
  @RequirePermission(ANY)
  today(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(todayQuerySchema)) q: Of<typeof todayQuerySchema>,
  ) {
    return this.attendance.today(access, q.campusId, q.date);
  }

  @Get('low')
  @RequirePermission(ANY)
  low(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(lowAttendanceQuerySchema)) q: Of<typeof lowAttendanceQuerySchema>,
  ) {
    return this.attendance.low(access, q);
  }

  @Get('sections/:sectionId/register')
  @RequirePermission(ANY)
  register(
    @CurrentAccess() access: TenantAccess,
    @Param('sectionId', uuid) sectionId: string,
    @Query(zod(attendanceSlotSchema)) q: Of<typeof attendanceSlotSchema>,
  ) {
    return this.attendance.register(access, sectionId, q.date, q.period);
  }

  @Put('sections/:sectionId/register')
  @RequirePermission(['attendance.mark', 'attendance.correct'])
  mark(
    @CurrentAccess() access: TenantAccess,
    @Param('sectionId', uuid) sectionId: string,
    @Query(zod(attendanceSlotSchema)) q: Of<typeof attendanceSlotSchema>,
    @Body(zod(markAttendanceSchema)) body: Of<typeof markAttendanceSchema>,
  ) {
    return this.attendance.mark(access, sectionId, q.date, q.period, body);
  }

  @Get('sections/:sectionId/history')
  @RequirePermission(ANY)
  history(
    @CurrentAccess() access: TenantAccess,
    @Param('sectionId', uuid) sectionId: string,
    @Query(zod(attendanceSlotSchema)) q: Of<typeof attendanceSlotSchema>,
  ) {
    return this.attendance.history(access, sectionId, q.date, q.period);
  }

  @Get('sections/:sectionId/month')
  @RequirePermission(ANY)
  month(
    @CurrentAccess() access: TenantAccess,
    @Param('sectionId', uuid) sectionId: string,
    @Query(zod(monthPeriodQuery)) q: Of<typeof monthPeriodQuery>,
  ) {
    return this.attendance.month(access, sectionId, q.month, q.period);
  }

  @Get('students/:studentId')
  @RequirePermission(ANY)
  student(
    @CurrentAccess() access: TenantAccess,
    @Param('studentId', uuid) studentId: string,
    @Query(zod(summaryQuery)) q: Of<typeof summaryQuery>,
  ) {
    return this.attendance.studentSummary(access, studentId, q.academicYearId);
  }

  @Get('leave')
  @RequirePermission(ANY)
  leave(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(leaveListQuerySchema)) q: Of<typeof leaveListQuerySchema>,
  ) {
    return this.attendance.listLeave(access, q);
  }

  @Post('leave')
  @RequirePermission(['attendance.mark', 'attendance.correct'])
  createLeave(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(leaveCreateSchema)) body: Of<typeof leaveCreateSchema>,
  ) {
    return this.attendance.createLeave(access, body);
  }

  @Post('leave/:id/decision')
  @HttpCode(200)
  @RequirePermission(['attendance.mark', 'attendance.correct'])
  decide(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(leaveDecisionSchema)) body: Of<typeof leaveDecisionSchema>,
  ) {
    return this.attendance.decideLeave(access, id, body);
  }
}
