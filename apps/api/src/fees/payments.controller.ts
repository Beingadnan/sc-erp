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
import { z } from 'zod';
import {
  bounceChequeSchema,
  cancelReceiptSchema,
  clearChequeSchema,
  dayCloseQuerySchema,
  dayCloseSchema,
  paymentListQuerySchema,
  paymentSchema,
  reportQuerySchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import { toCsv, toXlsx } from '../common/tabular.js';
import type { Table } from '../common/tabular.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission } from '../auth/decorators.js';
import { PaymentsService } from './payments.service.js';
import { FeeReportsService } from './fee-reports.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;
const ANY = ['fees.view', 'fees.configure', 'fees.collect', 'fees.concession.approve'];
const closingsQuery = z.object({
  campusId: z.uuid(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

@ApiTags('fees')
@Controller({ path: 'fees', version: '1' })
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly reports: FeeReportsService,
  ) {}

  @Post('payments')
  @RequirePermission('fees.collect')
  collect(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(paymentSchema)) body: Of<typeof paymentSchema>,
  ) {
    return this.payments.collect(access, body);
  }

  @Get('payments')
  @RequirePermission(ANY)
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(paymentListQuerySchema)) q: Of<typeof paymentListQuerySchema>,
  ) {
    return this.payments.list(access, q);
  }

  @Get('payments/:id')
  @RequirePermission(ANY)
  get(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.payments.get(access, id);
  }

  @Get('payments/:id/receipt.pdf')
  @RequirePermission(ANY)
  @Header('Cache-Control', 'private, no-store')
  async pdf(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { bytes, fileName } = await this.payments.receiptPdf(access, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    return new StreamableFile(Buffer.from(bytes));
  }

  @Post('payments/:id/clear')
  @HttpCode(200)
  @RequirePermission('fees.collect')
  clear(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(clearChequeSchema)) body: Of<typeof clearChequeSchema>,
  ) {
    return this.payments.clearCheque(access, id, body.clearedOn);
  }

  @Post('payments/:id/bounce')
  @HttpCode(200)
  @RequirePermission('fees.collect')
  bounce(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(bounceChequeSchema)) body: Of<typeof bounceChequeSchema>,
  ) {
    return this.payments.bounceCheque(access, id, body.reason, body.bouncedOn);
  }

  @Post('payments/:id/cancel')
  @HttpCode(200)
  @RequirePermission('fees.cancel_receipt')
  cancel(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(cancelReceiptSchema)) body: Of<typeof cancelReceiptSchema>,
  ) {
    return this.payments.cancel(access, id, body.reason);
  }

  @Post('students/:studentId/apply-advance')
  @HttpCode(200)
  @RequirePermission('fees.collect')
  applyAdvance(@CurrentAccess() access: TenantAccess, @Param('studentId', uuid) studentId: string) {
    return this.payments.applyAdvance(access, studentId);
  }

  @Get('day-close')
  @RequirePermission('fees.collect')
  myDay(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(dayCloseQuerySchema)) q: Of<typeof dayCloseQuerySchema>,
  ) {
    return this.payments.myDay(access, q.campusId, q.date);
  }

  @Post('day-close')
  @RequirePermission('fees.collect')
  closeDay(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(dayCloseSchema)) body: Of<typeof dayCloseSchema>,
  ) {
    return this.payments.closeDay(access, body);
  }

  @Get('day-closings')
  @RequirePermission(ANY)
  closings(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(closingsQuery)) q: Of<typeof closingsQuery>,
  ) {
    return this.payments.closings(access, q.campusId, q.from, q.to);
  }

  private async send<T>(
    res: Response,
    q: Of<typeof reportQuerySchema>,
    name: string,
    out: { data: T; table: Table },
  ) {
    const stamp = `${name}-${new Date().toISOString().slice(0, 10)}`;
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${stamp}.csv"`);
      return toCsv(out.table);
    }
    if (q.format === 'xlsx') {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${stamp}.xlsx"`);
      return new StreamableFile(await toXlsx(out.table));
    }
    return out.data;
  }

  @Get('reports/collection')
  @RequirePermission(ANY)
  @Header('Cache-Control', 'private, no-store')
  async collection(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(reportQuerySchema)) q: Of<typeof reportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, q, 'fee-collection', await this.reports.collection(access, q));
  }

  @Get('reports/outstanding')
  @RequirePermission(ANY)
  @Header('Cache-Control', 'private, no-store')
  async outstanding(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(reportQuerySchema)) q: Of<typeof reportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, q, 'fees-outstanding', await this.reports.outstanding(access, q));
  }

  @Get('reports/concessions')
  @RequirePermission(ANY)
  @Header('Cache-Control', 'private, no-store')
  async concessions(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(reportQuerySchema)) q: Of<typeof reportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, q, 'fee-concessions', await this.reports.concessions(access, q));
  }
}
