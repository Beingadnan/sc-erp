import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import {
  cmsPageCreateSchema,
  cmsPageUpdateSchema,
  cmsPublishSchema,
  inquiryCreateSchema,
  inquiryListQuerySchema,
  inquiryStatusSchema,
  pageSlugSchema,
  publicInquirySchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import type { ClientInfo } from '../auth/decorators.js';
import { Client, CurrentAccess, Public, RequirePermission } from '../auth/decorators.js';
import { TenantService } from '../tenancy/tenant.service.js';
import { CmsService } from './cms.service.js';
import { InquiriesService } from './inquiries.service.js';
import { PublicSiteService } from './public-site.service.js';

const uuid = new ParseUUIDPipe();
type Of<T extends z.ZodType> = z.infer<T>;

@ApiTags('website')
@Controller({ path: 'website/pages', version: '1' })
export class CmsController {
  constructor(
    private readonly cms: CmsService,
    private readonly tenants: TenantService,
  ) {}

  @Get()
  @RequirePermission('cms.manage')
  list(@CurrentAccess() access: TenantAccess) {
    return this.cms.list(access);
  }

  @Post()
  @RequirePermission('cms.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(cmsPageCreateSchema)) body: Of<typeof cmsPageCreateSchema>,
  ) {
    return this.cms.create(access, body);
  }

  @Post('starter')
  @HttpCode(200)
  @RequirePermission('cms.manage')
  async starter(@CurrentAccess() access: TenantAccess) {
    const tenant = await this.tenants.get(access);
    return this.cms.createStarterPages(access, tenant.name);
  }

  @Get(':id')
  @RequirePermission('cms.manage')
  get(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    return this.cms.get(access, id);
  }

  @Get(':id/versions/:version')
  @RequirePermission('cms.manage')
  version(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.cms.getVersion(access, id, version);
  }

  @Patch(':id')
  @RequirePermission('cms.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(cmsPageUpdateSchema)) body: Of<typeof cmsPageUpdateSchema>,
  ) {
    return this.cms.update(access, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('cms.manage')
  publish(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(cmsPublishSchema)) body: Of<typeof cmsPublishSchema>,
  ) {
    return this.cms.publish(access, id, body.version);
  }

  @Post(':id/unpublish')
  @HttpCode(204)
  @RequirePermission('cms.manage')
  async unpublish(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.cms.unpublish(access, id);
  }

  @Post(':id/versions/:version/restore')
  @HttpCode(200)
  @RequirePermission('cms.manage')
  restore(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.cms.restore(access, id, version);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('cms.manage')
  async remove(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.cms.remove(access, id);
  }
}

@ApiTags('admissions')
@Controller({ path: 'inquiries', version: '1' })
export class InquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Get()
  @RequirePermission('admissions.view')
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(inquiryListQuerySchema)) q: Of<typeof inquiryListQuerySchema>,
  ) {
    return this.inquiries.list(access, q);
  }

  @Post()
  @RequirePermission('admissions.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(inquiryCreateSchema)) body: Of<typeof inquiryCreateSchema>,
  ) {
    return this.inquiries.create(access, body);
  }

  @Patch(':id')
  @RequirePermission('admissions.manage')
  setStatus(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(inquiryStatusSchema)) body: Of<typeof inquiryStatusSchema>,
  ) {
    return this.inquiries.setStatus(access, id, body.status);
  }
}

/** Anonymous: a school's public website. */
@ApiTags('public')
@Controller({ path: 'public/schools/:school', version: '1' })
export class PublicSiteController {
  constructor(private readonly site: PublicSiteService) {}

  @Public()
  @Get()
  get(@Param('school') school: string, @Client() client: ClientInfo) {
    return this.site.site(school.toLowerCase().slice(0, 40), client);
  }

  @Public()
  @Get('pages/:page')
  page(
    @Param('school') school: string,
    @Param('page', zod(pageSlugSchema.catch('-'))) page: string,
    @Client() client: ClientInfo,
  ) {
    return this.site.page(school.toLowerCase().slice(0, 40), page, client);
  }

  @Public()
  @Post('inquiries')
  @HttpCode(202)
  inquiry(
    @Param('school') school: string,
    @Body(zod(publicInquirySchema)) body: Of<typeof publicInquirySchema>,
    @Client() client: ClientInfo,
  ) {
    return this.site.inquiry(school.toLowerCase().slice(0, 40), body, client);
  }
}
