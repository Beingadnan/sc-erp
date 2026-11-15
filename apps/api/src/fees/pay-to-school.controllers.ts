import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  MAX_DOCUMENT_BYTES,
  paymentLinkListQuerySchema,
  paymentLinkSchema,
  paymentSettingsSchema,
  proofApproveSchema,
  proofListQuerySchema,
  proofRejectSchema,
  proofSubmitSchema,
  refundListQuerySchema,
  refundPaySchema,
  refundRejectSchema,
  refundRequestSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { Client, CurrentAccess, Public, RequirePermission } from '../auth/decorators.js';
import type { ClientInfo } from '../auth/decorators.js';
import { PayToSchoolService } from './pay-to-school.service.js';
import type { UploadedFile as Upload } from './pay-to-school.service.js';
import { RefundsService } from './refunds.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;
const ANY = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];
const campusQuery = z.object({ campusId: z.uuid() });
const upload = () =>
  UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES + 1, files: 1, fields: 10 } }),
  );

@ApiTags('fees')
@Controller({ path: 'fees', version: '1' })
export class PayToSchoolController {
  constructor(
    private readonly service: PayToSchoolService,
    private readonly refunds: RefundsService,
  ) {}

  /* school bank / UPI details */

  @Get('payment-settings')
  @RequirePermission([...ANY, 'settings.manage'])
  settings(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuery)) q: Of<typeof campusQuery>,
  ) {
    return this.service.getSettings(access, q.campusId);
  }

  @Put('payment-settings')
  @RequirePermission('settings.manage')
  save(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(paymentSettingsSchema)) body: Of<typeof paymentSettingsSchema>,
  ) {
    return this.service.saveSettings(access, body);
  }

  @Post('payment-settings/qr')
  @RequirePermission('settings.manage')
  @upload()
  qr(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuery)) q: Of<typeof campusQuery>,
    @UploadedFile() file: Upload | undefined,
  ) {
    return this.service.uploadQr(access, q.campusId, file);
  }

  @Delete('payment-settings/qr')
  @RequirePermission('settings.manage')
  removeQr(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(campusQuery)) q: Of<typeof campusQuery>,
  ) {
    return this.service.removeQr(access, q.campusId);
  }

  /* payment links */

  @Post('payment-links')
  @RequirePermission('fees.collect')
  createLink(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(paymentLinkSchema)) body: Of<typeof paymentLinkSchema>,
  ) {
    return this.service.createLink(access, body);
  }

  @Get('payment-links')
  @RequirePermission(ANY)
  links(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(paymentLinkListQuerySchema)) q: Of<typeof paymentLinkListQuerySchema>,
  ) {
    return this.service.listLinks(access, q);
  }

  @Post('payment-links/:id/cancel')
  @HttpCode(200)
  @RequirePermission('fees.collect')
  cancelLink(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.service.cancelLink(access, id);
  }

  /* proofs sent by parents */

  @Get('payment-proofs')
  @RequirePermission(ANY)
  proofs(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(proofListQuerySchema)) q: Of<typeof proofListQuerySchema>,
  ) {
    return this.service.listProofs(access, q);
  }

  @Get('payment-proofs/:id')
  @RequirePermission(ANY)
  proof(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.service.getProof(access, id);
  }

  @Post('payment-proofs/:id/approve')
  @HttpCode(200)
  @RequirePermission('fees.collect')
  approve(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(proofApproveSchema)) body: Of<typeof proofApproveSchema>,
  ) {
    return this.service.approveProof(access, id, body);
  }

  @Post('payment-proofs/:id/reject')
  @HttpCode(200)
  @RequirePermission('fees.collect')
  reject(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(proofRejectSchema)) body: Of<typeof proofRejectSchema>,
  ) {
    return this.service.rejectProof(access, id, body.note);
  }

  /* refunds */

  @Get('students/:studentId/refundable')
  @RequirePermission('fees.refund')
  refundable(@CurrentAccess() access: TenantAccess, @Param('studentId', uuid) studentId: string) {
    return this.refunds.refundable(access, studentId);
  }

  @Post('refunds')
  @RequirePermission('fees.refund')
  requestRefund(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(refundRequestSchema)) body: Of<typeof refundRequestSchema>,
  ) {
    return this.refunds.request(access, body);
  }

  @Get('refunds')
  @RequirePermission([...ANY, 'fees.refund'])
  listRefunds(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(refundListQuerySchema)) q: Of<typeof refundListQuerySchema>,
  ) {
    return this.refunds.list(access, q);
  }

  @Post('refunds/:id/pay')
  @HttpCode(200)
  @RequirePermission('fees.cancel_receipt')
  payRefund(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(refundPaySchema)) body: Of<typeof refundPaySchema>,
  ) {
    return this.refunds.pay(access, id, body);
  }

  @Post('refunds/:id/reject')
  @HttpCode(200)
  @RequirePermission('fees.cancel_receipt')
  rejectRefund(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(refundRejectSchema)) body: Of<typeof refundRejectSchema>,
  ) {
    return this.refunds.reject(access, id, body.note);
  }
}

/** The page a parent opens from a payment link. No sign-in; the token is the key. */
@ApiTags('public')
@Controller({ path: 'public/pay', version: '1' })
export class PublicPayController {
  constructor(private readonly service: PayToSchoolService) {}

  @Public()
  @Get(':token')
  @Header('Cache-Control', 'private, no-store')
  view(@Param('token') token: string, @Client() client: ClientInfo) {
    return this.service.publicView(token, client);
  }

  @Public()
  @Post(':token/proof')
  @upload()
  submit(
    @Param('token') token: string,
    @Body(zod(proofSubmitSchema)) body: Of<typeof proofSubmitSchema>,
    @UploadedFile() file: Upload | undefined,
    @Client() client: ClientInfo,
  ) {
    return this.service.submitProof(token, body, file, client);
  }

  @Public()
  @Get(':token/receipts/:proofId')
  @Header('Cache-Control', 'private, no-store')
  async receipt(
    @Param('token') token: string,
    @Param('proofId', uuid) proofId: string,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { bytes, fileName } = await this.service.publicReceipt(token, proofId, client);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return new StreamableFile(Buffer.from(bytes));
  }
}
