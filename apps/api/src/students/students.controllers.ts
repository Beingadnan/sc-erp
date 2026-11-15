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
  admissionNumberSettingsSchema,
  enrollmentUpdateSchema,
  guardianInputSchema,
  guardianLinkUpdateSchema,
  guardianLookupQuerySchema,
  guardianUpdateSchema,
  privacyAckSchema,
  renumberSchema,
  studentAdmitSchema,
  studentListQuerySchema,
  studentUpdateSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission } from '../auth/decorators.js';
import { AdmissionNumbersService } from './admission-numbers.service.js';
import { StudentsService } from './students.service.js';
import { eq, and } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import type { DatabaseHandle } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { notFound } from '@school-erp/shared';
import { DB_HANDLE } from '../database/database.module.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;
const VIEW = ['students.view', 'students.view_assigned'];

@ApiTags('students')
@Controller({ path: 'students', version: '1' })
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @RequirePermission(VIEW)
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(studentListQuerySchema)) q: Of<typeof studentListQuerySchema>,
  ) {
    return this.students.list(access, q);
  }

  @Post()
  @RequirePermission('students.manage')
  admit(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(studentAdmitSchema)) body: Of<typeof studentAdmitSchema>,
  ) {
    return this.students.admit(access, body);
  }

  @Get(':id')
  @RequirePermission(VIEW)
  get(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.students.get(access, id);
  }

  /** POST so the reveal is never cached or prefetched; it is audited. */
  @Post(':id/aadhaar/reveal')
  @HttpCode(200)
  @RequirePermission('students.sensitive.view')
  reveal(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.students.revealAadhaar(access, id);
  }

  @Patch(':id')
  @RequirePermission('students.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(studentUpdateSchema)) body: Of<typeof studentUpdateSchema>,
  ) {
    return this.students.update(access, id, body);
  }

  @Post(':id/guardians')
  @RequirePermission('students.manage')
  addGuardian(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(guardianInputSchema)) body: Of<typeof guardianInputSchema>,
  ) {
    return this.students.addGuardian(access, id, body);
  }

  @Patch(':id/guardians/:guardianId')
  @HttpCode(204)
  @RequirePermission('students.manage')
  async updateLink(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Param('guardianId', uuid) guardianId: string,
    @Body(zod(guardianLinkUpdateSchema)) body: Of<typeof guardianLinkUpdateSchema>,
  ) {
    await this.students.updateGuardianLink(access, id, guardianId, body);
  }

  @Delete(':id/guardians/:guardianId')
  @HttpCode(204)
  @RequirePermission('students.manage')
  async removeGuardian(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Param('guardianId', uuid) guardianId: string,
  ) {
    await this.students.removeGuardian(access, id, guardianId);
  }

  @Post(':id/guardians/:guardianId/privacy-acknowledgements')
  @HttpCode(204)
  @RequirePermission('students.manage')
  async acknowledge(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Param('guardianId', uuid) guardianId: string,
    @Body(zod(privacyAckSchema)) body: Of<typeof privacyAckSchema>,
  ) {
    await this.students.recordAcknowledgement(access, id, guardianId, body);
  }
}

@ApiTags('students')
@Controller({ version: '1' })
export class GuardiansController {
  constructor(private readonly students: StudentsService) {}

  @Get('guardians')
  @RequirePermission('students.manage')
  find(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(guardianLookupQuerySchema)) q: Of<typeof guardianLookupQuerySchema>,
  ) {
    return this.students.findGuardians(access, q.phone);
  }

  @Patch('guardians/:id')
  @HttpCode(204)
  @RequirePermission('students.manage')
  async update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(guardianUpdateSchema)) body: Of<typeof guardianUpdateSchema>,
  ) {
    await this.students.updateGuardian(access, id, body);
  }

  @Patch('enrollments/:id')
  @RequirePermission('students.manage')
  updateEnrollment(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(enrollmentUpdateSchema)) body: Of<typeof enrollmentUpdateSchema>,
  ) {
    return this.students.updateEnrollment(access, id, body);
  }

  @Post('sections/:id/renumber')
  @HttpCode(200)
  @RequirePermission('students.manage')
  renumber(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(renumberSchema)) body: Of<typeof renumberSchema>,
  ) {
    return this.students.renumber(access, id, body.order);
  }
}

@ApiTags('students')
@Controller({ path: 'settings/admission-numbers', version: '1' })
export class AdmissionNumbersController {
  constructor(
    private readonly numbers: AdmissionNumbersService,
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
  ) {}

  /** Current pattern, plus the next number for a section's campus and year if given. */
  @Get()
  @RequirePermission('students.manage')
  async get(@CurrentAccess() access: TenantAccess, @Query('sectionId') sectionId?: string) {
    let ctx = null;
    if (sectionId && /^[0-9a-f-]{36}$/.test(sectionId)) {
      ctx = await withTenant(
        this.handle.db,
        access.ctx,
        async (tx) => {
          const [row] = await tx
            .select({
              campusId: schema.sections.campusId,
              campusCode: schema.campuses.code,
              startsOn: schema.academicYears.startsOn,
            })
            .from(schema.sections)
            .innerJoin(
              schema.campuses,
              and(
                eq(schema.campuses.tenantId, schema.sections.tenantId),
                eq(schema.campuses.id, schema.sections.campusId),
              ),
            )
            .innerJoin(
              schema.academicYears,
              and(
                eq(schema.academicYears.tenantId, schema.sections.tenantId),
                eq(schema.academicYears.id, schema.sections.academicYearId),
              ),
            )
            .where(eq(schema.sections.id, sectionId));
          if (!row || !access.has('students.manage', row.campusId)) throw notFound('Section');
          return {
            campusId: row.campusId,
            campusCode: row.campusCode,
            year: Number(row.startsOn.slice(0, 4)),
          };
        },
        { readOnly: true },
      );
    }
    return this.numbers.get(access, ctx);
  }

  @Put()
  @RequirePermission('settings.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(admissionNumberSettingsSchema)) body: Of<typeof admissionNumberSettingsSchema>,
  ) {
    return this.numbers.update(access, body);
  }
}
