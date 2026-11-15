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
import { z } from 'zod';
import {
  assignmentSchema,
  cancelDemandSchema,
  concessionListQuerySchema,
  concessionTypeSchema,
  concessionTypeUpdateSchema,
  decisionSchema,
  demandListQuerySchema,
  feeHeadSchema,
  feeHeadUpdateSchema,
  generateDemandsSchema,
  lateFeeRunSchema,
  revokeSchema,
  structureCreateSchema,
  structurePlanSchema,
  structureStatusSchema,
  structureUpdateSchema,
  studentConcessionSchema,
  waiverSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission } from '../auth/decorators.js';
import { FeeSetupService } from './fee-setup.service.js';
import { DemandsService } from './demands.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;
/** Any fee right; services narrow it to campuses. */
const ANY = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];

const campusQuery = z.object({ campusId: z.uuid(), academicYearId: z.uuid().optional() });
const yearQuery = z.object({ academicYearId: z.uuid().optional() });

@ApiTags('fees')
@Controller({ path: 'fees', version: '1' })
export class FeeSetupController {
  constructor(private readonly setup: FeeSetupService) {}

  @Get('heads')
  @RequirePermission(ANY)
  heads(@CurrentAccess() access: TenantAccess) {
    return this.setup.listHeads(access);
  }

  @Post('heads')
  @RequirePermission('fees.configure')
  createHead(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(feeHeadSchema)) body: Of<typeof feeHeadSchema>,
  ) {
    return this.setup.createHead(access, body);
  }

  @Patch('heads/:id')
  @RequirePermission('fees.configure')
  updateHead(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(feeHeadUpdateSchema)) body: Of<typeof feeHeadUpdateSchema>,
  ) {
    return this.setup.updateHead(access, id, body);
  }

  @Get('structures')
  @RequirePermission(ANY)
  structures(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuery)) q: Of<typeof campusQuery>,
  ) {
    return this.setup.listStructures(access, q.campusId, q.academicYearId);
  }

  @Post('structures')
  @RequirePermission('fees.configure')
  createStructure(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(structureCreateSchema)) body: Of<typeof structureCreateSchema>,
  ) {
    return this.setup.createStructure(access, body);
  }

  @Get('structures/:id')
  @RequirePermission(ANY)
  structure(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.setup.getStructure(access, id);
  }

  @Patch('structures/:id')
  @RequirePermission('fees.configure')
  updateStructure(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(structureUpdateSchema)) body: Of<typeof structureUpdateSchema>,
  ) {
    return this.setup.updateStructure(access, id, body);
  }

  @Put('structures/:id/plan')
  @RequirePermission('fees.configure')
  plan(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(structurePlanSchema)) body: Of<typeof structurePlanSchema>,
  ) {
    return this.setup.setPlan(access, id, body);
  }

  @Post('structures/:id/status')
  @HttpCode(200)
  @RequirePermission('fees.configure')
  status(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(structureStatusSchema)) body: Of<typeof structureStatusSchema>,
  ) {
    return this.setup.setStatus(access, id, body.status);
  }

  @Delete('structures/:id')
  @HttpCode(204)
  @RequirePermission('fees.configure')
  async remove(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.setup.deleteStructure(access, id);
  }

  @Get('structures/:id/students')
  @RequirePermission(ANY)
  assigned(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.setup.listAssigned(access, id);
  }

  @Post('structures/:id/students')
  @RequirePermission('fees.configure')
  assign(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(assignmentSchema)) body: Of<typeof assignmentSchema>,
  ) {
    return this.setup.assign(access, id, body.studentId);
  }

  @Delete('structures/:id/students/:assignmentId')
  @HttpCode(204)
  @RequirePermission('fees.configure')
  async unassign(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
  ) {
    await this.setup.unassign(access, id, assignmentId);
  }

  @Get('concession-types')
  @RequirePermission(ANY)
  concessionTypes(@CurrentAccess() access: TenantAccess) {
    return this.setup.listConcessionTypes(access);
  }

  @Post('concession-types')
  @RequirePermission('fees.configure')
  createConcessionType(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(concessionTypeSchema)) body: Of<typeof concessionTypeSchema>,
  ) {
    return this.setup.createConcessionType(access, body);
  }

  @Patch('concession-types/:id')
  @RequirePermission('fees.configure')
  updateConcessionType(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(concessionTypeUpdateSchema)) body: Of<typeof concessionTypeUpdateSchema>,
  ) {
    return this.setup.updateConcessionType(access, id, body);
  }
}

@ApiTags('fees')
@Controller({ path: 'fees', version: '1' })
export class DemandsController {
  constructor(private readonly demands: DemandsService) {}

  @Post('demands/generate')
  @HttpCode(200)
  @RequirePermission('fees.configure')
  generate(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(generateDemandsSchema)) body: Of<typeof generateDemandsSchema>,
  ) {
    return this.demands.generate(access, body);
  }

  @Post('demands/late-fees')
  @HttpCode(200)
  @RequirePermission('fees.configure')
  lateFees(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(lateFeeRunSchema)) body: Of<typeof lateFeeRunSchema>,
  ) {
    return this.demands.applyLateFees(access, body.campusId, body.asOf);
  }

  @Get('demands')
  @RequirePermission(ANY)
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(demandListQuerySchema)) q: Of<typeof demandListQuerySchema>,
  ) {
    return this.demands.listDemands(access, q);
  }

  @Get('structures/:id/demands')
  @RequirePermission(ANY)
  structureDemands(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.demands.structureDemands(access, id);
  }

  @Post('demands/:id/cancel')
  @HttpCode(200)
  @RequirePermission('fees.configure')
  cancel(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(cancelDemandSchema)) body: Of<typeof cancelDemandSchema>,
  ) {
    return this.demands.cancelDemand(access, id, body.reason);
  }

  @Post('demands/:id/waivers')
  @RequirePermission(['fees.configure', 'fees.collect', 'fees.concession.approve'])
  waive(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(waiverSchema)) body: Of<typeof waiverSchema>,
  ) {
    return this.demands.requestWaiver(access, id, body);
  }

  @Post('waivers/:id/decision')
  @HttpCode(200)
  @RequirePermission('fees.concession.approve')
  decideWaiver(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(decisionSchema)) body: Of<typeof decisionSchema>,
  ) {
    return this.demands.decideWaiver(access, id, body);
  }

  @Get('concessions')
  @RequirePermission(ANY)
  concessions(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(concessionListQuerySchema)) q: Of<typeof concessionListQuerySchema>,
  ) {
    return this.demands.listConcessions(access, q.campusId, q.status);
  }

  @Post('concessions')
  @RequirePermission(['fees.configure', 'fees.concession.approve'])
  requestConcession(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(studentConcessionSchema)) body: Of<typeof studentConcessionSchema>,
  ) {
    return this.demands.requestConcession(access, body);
  }

  @Post('concessions/:id/decision')
  @HttpCode(200)
  @RequirePermission('fees.concession.approve')
  decideConcession(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(decisionSchema)) body: Of<typeof decisionSchema>,
  ) {
    return this.demands.decideConcession(access, id, body);
  }

  @Post('concessions/:id/revoke')
  @HttpCode(200)
  @RequirePermission('fees.concession.approve')
  revoke(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(revokeSchema)) body: Of<typeof revokeSchema>,
  ) {
    return this.demands.revokeConcession(access, id, body.note);
  }

  @Get('students/:studentId')
  @RequirePermission(ANY)
  student(
    @CurrentAccess() access: TenantAccess,
    @Param('studentId', uuid) studentId: string,
    @Query(zod(yearQuery)) q: Of<typeof yearQuery>,
  ) {
    return this.demands.studentAccount(access, studentId, q.academicYearId);
  }

  @Get('accounts')
  @RequirePermission(ANY)
  accounts(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuery)) q: Of<typeof campusQuery>,
  ) {
    return this.demands.accounts(access, q.campusId);
  }
}
