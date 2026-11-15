import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  registerSchoolSchema,
  resetPasswordSchema,
  switchTenantSchema,
  verifyEmailSchema,
} from '@school-erp/validation';
import type { z } from 'zod';
import { zod } from '../common/zod.pipe.js';
import type { SessionAuth } from './access.js';
import { AuthService } from './auth.service.js';
import { AllowMfaPending, Client, CurrentSession, Public } from './decorators.js';
import type { ClientInfo } from './decorators.js';
import { SessionService } from './session.service.js';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('register-school')
  async registerSchool(
    @Body(zod(registerSchoolSchema)) body: z.infer<typeof registerSchoolSchema>,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.registerSchool(body, client);
    this.sessions.setCookies(res, session);
    return { status: 'ok' };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zod(loginSchema)) body: z.infer<typeof loginSchema>,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, mfaRequired } = await this.auth.login(body, client);
    this.sessions.setCookies(res, session);
    return { status: mfaRequired ? 'mfa_required' : 'ok' };
  }

  @AllowMfaPending()
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(
    @CurrentSession() session: SessionAuth,
    @Body(zod(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fresh = await this.auth.verifyMfa(session, body, client);
    this.sessions.setCookies(res, fresh);
    return { status: 'ok' };
  }

  @AllowMfaPending()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentSession() session: SessionAuth, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(session);
    this.sessions.clearCookies(res);
  }

  @Get('me')
  me(@CurrentSession() session: SessionAuth) {
    return this.auth.me(session);
  }

  @Post('switch-tenant')
  @HttpCode(204)
  async switchTenant(
    @CurrentSession() session: SessionAuth,
    @Body(zod(switchTenantSchema)) body: z.infer<typeof switchTenantSchema>,
  ) {
    await this.auth.switchTenant(session, body.tenantId);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(
    @Body(zod(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>,
    @Client() client: ClientInfo,
  ) {
    await this.auth.forgotPassword(body.email, client);
    return { status: 'accepted' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async reset(
    @Body(zod(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>,
    @Client() client: ClientInfo,
  ) {
    await this.auth.resetPassword(body.token, body.password, client);
  }

  @Post('password/change')
  @HttpCode(204)
  async changePassword(
    @CurrentSession() session: SessionAuth,
    @Body(zod(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(session, body.currentPassword, body.newPassword);
  }

  @Public()
  @Post('email/verify')
  @HttpCode(204)
  async verifyEmail(
    @Body(zod(verifyEmailSchema)) body: z.infer<typeof verifyEmailSchema>,
    @Client() client: ClientInfo,
  ) {
    await this.auth.verifyEmail(body.token, client);
  }

  @Post('email/resend')
  @HttpCode(202)
  async resendVerification(@CurrentSession() session: SessionAuth) {
    await this.auth.resendVerification(session);
    return { status: 'accepted' };
  }

  @Public()
  @Post('invite/accept')
  async acceptInvite(
    @Body(zod(acceptInviteSchema)) body: z.infer<typeof acceptInviteSchema>,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.acceptInvite(body.token, body.password, client);
    this.sessions.setCookies(res, session);
    return { status: 'ok' };
  }

  @Post('mfa/setup')
  startMfa(@CurrentSession() session: SessionAuth) {
    return this.auth.startMfaSetup(session);
  }

  @Post('mfa/enable')
  enableMfa(
    @CurrentSession() session: SessionAuth,
    @Body(zod(mfaEnableSchema)) body: z.infer<typeof mfaEnableSchema>,
  ) {
    return this.auth.enableMfa(session, body.code);
  }

  @Post('mfa/disable')
  @HttpCode(204)
  async disableMfa(
    @CurrentSession() session: SessionAuth,
    @Body(zod(mfaDisableSchema)) body: z.infer<typeof mfaDisableSchema>,
  ) {
    await this.auth.disableMfa(session, body.password, body.code);
  }

  @Get('sessions')
  listSessions(@CurrentSession() session: SessionAuth) {
    return this.auth.listSessions(session);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(
    @CurrentSession() session: SessionAuth,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.auth.revokeSession(session, id);
  }
}
