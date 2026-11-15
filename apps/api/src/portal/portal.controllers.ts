import {
  Body,
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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  familyMonthQuerySchema,
  familyPayLinkSchema,
  parentLeaveSchema,
  portalAcceptSchema,
  portalInviteSchema,
  portalPeekSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { Client, CurrentAccess, Public, RequirePermission } from '../auth/decorators.js';
import type { ClientInfo } from '../auth/decorators.js';
import { SessionService } from '../auth/session.service.js';
import { PortalService } from './portal.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;

/** Staff: who among a student's guardians can use the parent portal. */
@ApiTags('portal')
@Controller({ version: '1' })
export class PortalAccessController {
  constructor(private readonly portal: PortalService) {}

  @Get('students/:id/portal-access')
  @RequirePermission(['portal.manage', 'students.view'])
  access(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.portal.guardianAccess(access, id);
  }

  @Post('portal/invites')
  @RequirePermission('portal.manage')
  invite(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(portalInviteSchema)) body: Of<typeof portalInviteSchema>,
  ) {
    return this.portal.createInvite(access, body.guardianId, body.purpose);
  }

  @Post('portal/guardians/:id/revoke')
  @HttpCode(200)
  @RequirePermission('portal.manage')
  revoke(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.portal.revoke(access, id);
  }
}

/** The activation link a parent opens (not signed in). */
@ApiTags('portal')
@Controller({ path: 'portal/activate', version: '1' })
export class PortalActivateController {
  constructor(
    private readonly portal: PortalService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('peek')
  @HttpCode(200)
  peek(
    @Body(zod(portalPeekSchema)) body: Of<typeof portalPeekSchema>,
    @Client() client: ClientInfo,
  ) {
    return this.portal.peek(body.token, client);
  }

  @Public()
  @Post()
  @HttpCode(200)
  async accept(
    @Body(zod(portalAcceptSchema)) body: Of<typeof portalAcceptSchema>,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.portal.accept(body.token, body.password, client);
    this.sessions.setCookies(res, session);
    return { status: 'ok' };
  }
}

/** The parent's own view. Everything is limited to their linked children. */
@ApiTags('family')
@Controller({ path: 'family', version: '1' })
export class FamilyController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @RequirePermission('family.portal')
  home(@CurrentAccess() access: TenantAccess) {
    return this.portal.home(access);
  }

  @Get('children/:id/attendance')
  @RequirePermission('family.portal')
  attendance(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Query(zod(familyMonthQuerySchema)) q: Of<typeof familyMonthQuerySchema>,
  ) {
    return this.portal.childAttendance(access, id, q.academicYearId);
  }

  @Get('children/:id/fees')
  @RequirePermission('family.portal')
  fees(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Query(zod(familyMonthQuerySchema)) q: Of<typeof familyMonthQuerySchema>,
  ) {
    return this.portal.childFees(access, id, q.academicYearId);
  }

  @Post('children/:id/pay')
  @RequirePermission('family.portal')
  pay(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(familyPayLinkSchema)) body: Of<typeof familyPayLinkSchema>,
  ) {
    return this.portal.payLink(access, id, body.amount);
  }

  @Get('children/:id/homework')
  @RequirePermission('family.portal')
  homework(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.portal.childHomework(access, id);
  }

  @Post('children/:id/leave')
  @RequirePermission('family.portal')
  leave(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(parentLeaveSchema)) body: Of<typeof parentLeaveSchema>,
  ) {
    return this.portal.requestLeave(access, id, body);
  }

  @Post('leave/:id/cancel')
  @HttpCode(200)
  @RequirePermission('family.portal')
  cancelLeave(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.portal.cancelLeave(access, id);
  }

  @Get('children/:id/results')
  @RequirePermission('family.portal')
  results(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.portal.childResults(access, id);
  }

  @Get('children/:id/results/:examId/report-card.pdf')
  @RequirePermission('family.portal')
  @Header('Cache-Control', 'private, no-store')
  async reportCard(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Param('examId', uuid) examId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { bytes, fileName } = await this.portal.childReportCard(access, id, examId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return new StreamableFile(Buffer.from(bytes));
  }

  @Get('notices')
  @RequirePermission('family.portal')
  notices(@CurrentAccess() access: TenantAccess) {
    return this.portal.familyNotices(access);
  }

  @Get('receipts/:id/receipt.pdf')
  @RequirePermission('family.portal')
  @Header('Cache-Control', 'private, no-store')
  async receipt(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { bytes, fileName } = await this.portal.receiptPdf(access, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return new StreamableFile(Buffer.from(bytes));
  }
}
