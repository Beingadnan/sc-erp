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
  auditQuerySchema,
  campusCreateSchema,
  campusUpdateSchema,
  inviteMemberSchema,
  staffProfileSchema,
  memberRolesSchema,
  memberStatusSchema,
  roleCreateSchema,
  rolePermissionsSchema,
  roleUpdateSchema,
  tenantUpdateSchema,
} from '@school-erp/validation';
import { zod } from '../common/zod.pipe.js';
import type { TenantAccess } from '../auth/access.js';
import { CurrentAccess, RequirePermission, TenantRoute } from '../auth/decorators.js';
import { AuditQueryService } from './audit-query.service.js';
import { CampusesService } from './campuses.service.js';
import { MembersService } from './members.service.js';
import { RolesService } from './roles.service.js';
import { TenantService } from './tenant.service.js';

const uuid = new ParseUUIDPipe();

@ApiTags('school')
@Controller({ path: 'tenant', version: '1' })
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  @TenantRoute()
  get(@CurrentAccess() access: TenantAccess) {
    return this.tenants.get(access);
  }

  @Patch()
  @RequirePermission('settings.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(tenantUpdateSchema)) body: z.infer<typeof tenantUpdateSchema>,
  ) {
    return this.tenants.update(access, body);
  }
}

@ApiTags('school')
@Controller({ path: 'campuses', version: '1' })
export class CampusesController {
  constructor(private readonly campuses: CampusesService) {}

  @Get()
  @TenantRoute()
  list(@CurrentAccess() access: TenantAccess) {
    return this.campuses.list(access);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(campusCreateSchema)) body: z.infer<typeof campusCreateSchema>,
  ) {
    return this.campuses.create(access, body);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(campusUpdateSchema)) body: z.infer<typeof campusUpdateSchema>,
  ) {
    return this.campuses.update(access, id, body);
  }
}

@ApiTags('people')
@Controller({ version: '1' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('roles.manage')
  catalogue(@CurrentAccess() access: TenantAccess) {
    return this.roles.catalogue(access);
  }

  @Get('roles')
  @RequirePermission('members.view')
  list(@CurrentAccess() access: TenantAccess) {
    return this.roles.list(access);
  }

  @Post('roles')
  @RequirePermission('roles.manage')
  create(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(roleCreateSchema)) body: z.infer<typeof roleCreateSchema>,
  ) {
    return this.roles.create(access, body);
  }

  @Patch('roles/:id')
  @RequirePermission('roles.manage')
  @HttpCode(204)
  async update(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(roleUpdateSchema)) body: z.infer<typeof roleUpdateSchema>,
  ) {
    await this.roles.update(access, id, body);
  }

  @Put('roles/:id/permissions')
  @RequirePermission('roles.manage')
  @HttpCode(204)
  async setPermissions(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(rolePermissionsSchema)) body: z.infer<typeof rolePermissionsSchema>,
  ) {
    await this.roles.setPermissions(access, id, body.permissions);
  }

  @Delete('roles/:id')
  @RequirePermission('roles.manage')
  @HttpCode(204)
  async remove(@CurrentAccess() access: TenantAccess, @Param('id', uuid) id: string) {
    await this.roles.remove(access, id);
  }
}

@ApiTags('people')
@Controller({ path: 'members', version: '1' })
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermission('members.view')
  list(@CurrentAccess() access: TenantAccess) {
    return this.members.list(access);
  }

  @Post('invite')
  @RequirePermission('members.manage')
  invite(
    @CurrentAccess() access: TenantAccess,
    @Body(zod(inviteMemberSchema)) body: z.infer<typeof inviteMemberSchema>,
  ) {
    return this.members.invite(access, body);
  }

  @Put(':id/roles')
  @RequirePermission('members.manage')
  @HttpCode(204)
  async setRoles(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(memberRolesSchema)) body: z.infer<typeof memberRolesSchema>,
  ) {
    await this.members.setRoles(access, id, body.assignments);
  }

  @Put(':id/profile')
  @RequirePermission('members.manage')
  saveProfile(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(staffProfileSchema)) body: z.infer<typeof staffProfileSchema>,
  ) {
    return this.members.saveProfile(access, id, body);
  }

  @Patch(':id')
  @RequirePermission('members.manage')
  @HttpCode(204)
  async setStatus(
    @CurrentAccess() access: TenantAccess,
    @Param('id', uuid) id: string,
    @Body(zod(memberStatusSchema)) body: z.infer<typeof memberStatusSchema>,
  ) {
    await this.members.setStatus(access, id, body.status);
  }
}

@ApiTags('school')
@Controller({ path: 'audit-logs', version: '1' })
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('audit.view')
  list(
    @CurrentAccess() access: TenantAccess,
    @Query(zod(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>,
  ) {
    return this.audit.list(access, query);
  }
}
