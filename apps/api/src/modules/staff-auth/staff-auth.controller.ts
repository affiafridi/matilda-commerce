import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { APP_ENV, type Env } from '../../config/env';
import { PublicRoute } from '../iam/authorization/decorators';
import type { SessionInfo } from './session.service';
import { StaffSessionService } from './session.service';
import { StaffAuthService } from './staff-auth.service';
import {
  assertAllowedOrigin,
  assertCsrf,
  clearStaffCookie,
  readStaffToken,
  setStaffCookie,
} from './request-security';

const email = z.string().trim().toLowerCase().email().max(254);
const code = z.string().trim().min(6).max(32);
const password = z.string().min(1).max(256);
const token = z.string().min(20).max(200);

const loginBody = z.object({ email, password, skipMfa: z.boolean().optional() });
const codeBody = z.object({ code });
const forgotBody = z.object({ email });
const resetBody = z.object({ token, password });
const changeBody = z.object({ currentPassword: password, newPassword: password });

/** Tight per-route limits on top of the database lockouts (plan 3.6). */
const AUTH_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@PublicRoute() // These routes authenticate themselves; see `pending()` / `verified()` below.
@ApiTags('admin-auth')
@Controller({ path: 'admin/auth', version: '1' })
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    private readonly sessions: StaffSessionService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Get('options')
  @ApiOperation({
    summary: 'What the sign-in page may offer',
    description:
      'devSkipMfa is true only on a local development API started with DEV_SKIP_MFA=true.',
  })
  options() {
    return { devSkipMfa: this.env.DEV_SKIP_MFA };
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({
    summary: 'Step 1: email and password',
    description:
      'Creates a pending session (cookie). The pending session grants no admin access until 2FA completes. ' +
      'Unknown accounts, wrong passwords and inactive accounts return the same error.',
  })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(loginBody)) body: z.infer<typeof loginBody>,
  ) {
    assertAllowedOrigin(req, this.env);
    const issued = await this.auth.login(body.email, body.password, body.skipMfa === true);
    setStaffCookie(res, this.env, issued);
    return { next: issued.next, csrfToken: issued.csrfToken };
  }

  @Post('mfa/enroll/start')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  async enrollStart(@Req() req: Request) {
    return this.auth.enrollStart(await this.pending(req));
  }

  @Post('mfa/enroll/confirm')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  async enrollConfirm(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(codeBody)) body: z.infer<typeof codeBody>,
  ) {
    const { recoveryCodes, ...issued } = await this.auth.enrollConfirm(
      await this.pending(req),
      body.code,
    );
    setStaffCookie(res, this.env, issued);
    return { csrfToken: issued.csrfToken, recoveryCodes };
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  async mfaVerify(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(codeBody)) body: z.infer<typeof codeBody>,
  ) {
    const issued = await this.auth.mfaVerify(await this.pending(req), body.code);
    setStaffCookie(res, this.env, issued);
    return { csrfToken: issued.csrfToken };
  }

  @Post('mfa/recovery')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  async recovery(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(codeBody)) body: z.infer<typeof codeBody>,
  ) {
    const { remainingCodes, ...issued } = await this.auth.recover(
      await this.pending(req),
      body.code,
    );
    setStaffCookie(res, this.env, issued);
    return { csrfToken: issued.csrfToken, remainingCodes };
  }

  @Post('step-up')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Re-confirm 2FA to unlock sensitive actions for 10 minutes' })
  async stepUp(
    @Req() req: Request,
    @Body(new ZodValidationPipe(codeBody)) body: z.infer<typeof codeBody>,
  ) {
    const result = await this.auth.stepUp(await this.verified(req), body.code);
    return { stepUpUntil: result.stepUpUntil.toISOString() };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(await this.pending(req));
    clearStaffCookie(res, this.env);
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const revoked = await this.auth.logoutAll(await this.verified(req));
    clearStaffCookie(res, this.env);
    return { revoked };
  }

  @Post('password/change')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  async changePassword(
    @Req() req: Request,
    @Body(new ZodValidationPipe(changeBody)) body: z.infer<typeof changeBody>,
  ): Promise<void> {
    await this.auth.changePassword(
      await this.verified(req),
      body.currentPassword,
      body.newPassword,
    );
  }

  @Post('password/forgot')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Always answers 202, whether or not the account exists' })
  async forgot(
    @Req() req: Request,
    @Body(new ZodValidationPipe(forgotBody)) body: z.infer<typeof forgotBody>,
  ): Promise<{ accepted: true }> {
    assertAllowedOrigin(req, this.env);
    await this.auth.forgotPassword(body.email);
    return { accepted: true };
  }

  @Post('password/reset')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  async reset(
    @Req() req: Request,
    @Body(new ZodValidationPipe(resetBody)) body: z.infer<typeof resetBody>,
  ): Promise<void> {
    assertAllowedOrigin(req, this.env);
    await this.auth.resetPassword(body.token, body.password);
  }

  @Post('invite/accept')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  async acceptInvite(
    @Req() req: Request,
    @Body(new ZodValidationPipe(resetBody)) body: z.infer<typeof resetBody>,
  ): Promise<void> {
    assertAllowedOrigin(req, this.env);
    await this.auth.acceptInvite(body.token, body.password);
  }

  @Get('session')
  @ApiOperation({ summary: 'State of the current session (pending, verified, or none)' })
  async session(@Req() req: Request) {
    const info = await this.sessions.authenticate(readStaffToken(req, this.env), {
      verifiedOnly: false,
    });
    if (!info) throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
    return { stage: info.mfaVerified ? 'VERIFIED' : 'PENDING', ...(await this.auth.me(info)) };
  }

  @Post('csrf')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Issue a fresh CSRF token for the current session',
    description:
      'Needed after a page reload, because the token is held in browser memory only. ' +
      'Requires the session cookie and an allowed Origin; the response is unreadable cross-site.',
  })
  async csrf(@Req() req: Request): Promise<{ csrfToken: string }> {
    assertAllowedOrigin(req, this.env);
    const session = await this.sessions.authenticate(readStaffToken(req, this.env), {
      verifiedOnly: false,
    });
    if (!session) throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
    return { csrfToken: await this.sessions.rotateCsrf(session.id) };
  }

  /** A live session in any stage (pending allowed), with origin and CSRF checks. */
  private async pending(req: Request): Promise<SessionInfo> {
    return this.resolve(req, false);
  }

  /** A live session that has completed 2FA. */
  private async verified(req: Request): Promise<SessionInfo> {
    return this.resolve(req, true);
  }

  private async resolve(req: Request, verifiedOnly: boolean): Promise<SessionInfo> {
    assertAllowedOrigin(req, this.env);
    const session = await this.sessions.authenticate(readStaffToken(req, this.env), {
      verifiedOnly,
    });
    if (!session) throw new ApiException(401, 'UNAUTHENTICATED', 'Authentication required');
    assertCsrf(req, session);
    return session;
  }
}
