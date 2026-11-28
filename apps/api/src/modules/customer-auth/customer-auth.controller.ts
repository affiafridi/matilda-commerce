import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { APP_ENV, type Env } from '../../config/env';
import { PublicRoute } from '../iam/authorization/decorators';
import { TenantResolver } from '../tenancy/tenant-resolver.service';
import { TenantGuard } from '../tenancy/tenant.guard';
import { clearCartCookie, readCartToken } from '../carts/cart-cookie';
import { CartService } from '../carts/carts.service';
import { CustomerAuthService } from './customer-auth.service';
import {
  type RequestWithTenant,
  assertSameBrandOrigin,
  clearCustomerCookie,
  requireTenant,
  setCustomerCookie,
} from './customer-request-security';
import { CustomerSessionGuard } from './customer-session.guard';
import type { CustomerSessionInfo } from './customer-session.service';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(1).max(256);
const token = z.string().min(20).max(200);

const registerBody = z.object({
  email,
  password,
  fullName: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).optional(),
  marketingConsent: z.boolean().optional(),
});
const loginBody = z.object({ email, password });
const tokenBody = z.object({ token });
const forgotBody = z.object({ email });
const resetBody = z.object({ token, password });
const changeBody = z.object({ currentPassword: password, newPassword: password });
const profileBody = z
  .object({
    fullName: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).nullable(),
    preferredLanguage: z.string().trim().min(2).max(10).nullable(),
    marketingConsent: z.boolean(),
  })
  .partial();
const deletionBody = z.object({ password });

const AUTH_LIMIT = { default: { limit: 10, ttl: 60_000 } };

const session = (req: RequestWithTenant): CustomerSessionInfo =>
  req.customerSession as CustomerSessionInfo;

/** Unauthenticated customer entry points. Brand comes from the host only. */
@PublicRoute() // Authenticated by TenantGuard (brand) and the handlers themselves; never staff-authenticated.
@ApiTags('customer-auth')
@UseGuards(TenantGuard)
@Controller({ path: 'customer/auth', version: '1' })
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly resolver: TenantResolver,
    private readonly carts: CartService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}
  private readonly log = new Logger(CustomerAuthController.name);

  @Post('register')
  @HttpCode(202)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({
    summary: 'Create an account on this brand',
    description: 'Always answers 202, whether or not the email already has an account here.',
  })
  async register(
    @Req() req: RequestWithTenant,
    @Body(new ZodValidationPipe(registerBody)) body: z.infer<typeof registerBody>,
  ): Promise<{ accepted: true }> {
    await assertSameBrandOrigin(req, this.resolver);
    await this.auth.register(requireTenant(req), body);
    return { accepted: true };
  }

  @Post('verify-email')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  async verifyEmail(
    @Req() req: RequestWithTenant,
    @Body(new ZodValidationPipe(tokenBody)) body: z.infer<typeof tokenBody>,
  ): Promise<void> {
    await assertSameBrandOrigin(req, this.resolver);
    await this.auth.verifyEmail(requireTenant(req), body.token);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({ summary: 'Sign in; sets the session cookie and returns the CSRF token' })
  async login(
    @Req() req: RequestWithTenant,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(loginBody)) body: z.infer<typeof loginBody>,
  ) {
    await assertSameBrandOrigin(req, this.resolver);
    const issued = await this.auth.login(requireTenant(req), body.email, body.password);
    setCustomerCookie(res, this.env, issued);
    await this.mergeGuestCart(req, res, issued.customerId);
    return { csrfToken: issued.csrfToken };
  }

  /** The guest cart joins the customer's cart at sign-in (D5-02); a failure never blocks the login. */
  private async mergeGuestCart(
    req: RequestWithTenant,
    res: Response,
    customerId: string,
  ): Promise<void> {
    const token = readCartToken(req, this.env);
    if (!token) return;
    try {
      await this.carts.mergeGuestCart(requireTenant(req).brand.id, customerId, token);
      clearCartCookie(res, this.env);
    } catch (err) {
      this.log.error(
        `Guest cart merge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Always answers 202, whether or not the account exists' })
  async forgot(
    @Req() req: RequestWithTenant,
    @Body(new ZodValidationPipe(forgotBody)) body: z.infer<typeof forgotBody>,
  ): Promise<{ accepted: true }> {
    await assertSameBrandOrigin(req, this.resolver);
    await this.auth.forgotPassword(requireTenant(req), body.email);
    return { accepted: true };
  }

  @Post('reset-password')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  async reset(
    @Req() req: RequestWithTenant,
    @Body(new ZodValidationPipe(resetBody)) body: z.infer<typeof resetBody>,
  ): Promise<void> {
    await assertSameBrandOrigin(req, this.resolver);
    await this.auth.resetPassword(requireTenant(req), body.token, body.password);
  }
}

/** Signed-in customer routes: brand from the host, session cookie of that brand, CSRF token. */
@PublicRoute() // Not a staff route; CustomerSessionGuard authenticates and fails closed with 401.
@ApiTags('customer')
@UseGuards(TenantGuard, CustomerSessionGuard)
@Controller({ path: 'customer', version: '1' })
export class CustomerController {
  constructor(
    private readonly auth: CustomerAuthService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Get('me')
  me(@Req() req: RequestWithTenant) {
    return this.auth.me(session(req));
  }

  @Patch('me')
  updateMe(
    @Req() req: RequestWithTenant,
    @Body(new ZodValidationPipe(profileBody)) body: z.infer<typeof profileBody>,
  ) {
    return this.auth.updateMe(session(req), body);
  }

  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @Req() req: RequestWithTenant,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(session(req));
    clearCustomerCookie(res, this.env);
  }

  @Post('me/verification-email')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resend(@Req() req: RequestWithTenant): Promise<{ accepted: true }> {
    await this.auth.resendVerification(requireTenant(req), session(req));
    return { accepted: true };
  }

  @Post('me/password')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  async changePassword(
    @Req() req: RequestWithTenant,
    @Body(new ZodValidationPipe(changeBody)) body: z.infer<typeof changeBody>,
  ): Promise<void> {
    await this.auth.changePassword(session(req), body.currentPassword, body.newPassword);
  }

  @Post('me/deletion-request')
  @HttpCode(202)
  @Throttle(AUTH_LIMIT)
  @ApiOperation({
    summary: 'Request account deletion (confirm with the password); ends all sessions',
  })
  async deletion(
    @Req() req: RequestWithTenant,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(deletionBody)) body: z.infer<typeof deletionBody>,
  ): Promise<{ accepted: true }> {
    await this.auth.requestDeletion(session(req), body.password);
    clearCustomerCookie(res, this.env);
    return { accepted: true };
  }
}
