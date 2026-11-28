import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  type AddCartLineInput,
  type CartContactInput,
  type UpdateCartLineInput,
  addCartLineSchema,
  cartContactSchema,
  couponCodeSchema,
  updateCartLineSchema,
  z,
} from '@matilda/validation';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { APP_ENV, type Env } from '../../config/env';
import { PublicRoute } from '../iam/authorization/decorators';
import { requireTenant } from '../customer-auth/customer-request-security';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CartAccessGuard, type CartRequest } from './cart-access.guard';
import { setCartCookie } from './cart-cookie';
import { CartService } from './carts.service';

const marketQuery = z.object({
  /** Only for brand-wide domains that are not tied to one market. */
  market: z.string().trim().min(1).max(40).optional(),
});
const lineIdParam = z.uuid();
const couponBody = z.object({ code: couponCodeSchema });

const identityOf = (req: CartRequest) => req.cartIdentity ?? {};

/** Cart responses are private to the visitor: never stored by a shared cache. */
function privateHeaders(res: Response): void {
  res.set({ 'Cache-Control': 'no-store', Vary: 'Cookie, Host, X-Forwarded-Host' });
}

/**
 * The shopper's cart (Phase 5 step 5.4). Brand and market come from the request host; the cart is
 * found through the signed-in customer's session or the guest cart cookie, never through an id
 * the client sends. Prices are always computed by the backend.
 */
@ApiTags('cart')
@PublicRoute()
@UseGuards(TenantGuard, CartAccessGuard)
@Controller({ path: 'cart', version: '1' })
export class CartsController {
  constructor(
    private readonly carts: CartService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The current cart with a freshly computed quote (null if none yet)' })
  async get(
    @Req() req: CartRequest,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(marketQuery)) query: z.infer<typeof marketQuery>,
  ) {
    privateHeaders(res);
    return { cart: await this.carts.get(requireTenant(req), identityOf(req), query.market) };
  }

  @Post('lines')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add an item; the same configuration raises the quantity of its line',
    description: 'Creates the cart on first use and, for a guest, sets the cart cookie.',
  })
  async addLine(
    @Req() req: CartRequest,
    @Res({ passthrough: true }) res: Response,
    @Query(new ZodValidationPipe(marketQuery)) query: z.infer<typeof marketQuery>,
    @Body(new ZodValidationPipe(addCartLineSchema)) body: AddCartLineInput,
  ) {
    privateHeaders(res);
    const { cart, guestToken } = await this.carts.addLine(
      requireTenant(req),
      identityOf(req),
      body,
      query.market,
    );
    if (guestToken) setCartCookie(res, this.env, guestToken);
    return { cart };
  }

  @Patch('lines/:lineId')
  @ApiOperation({ summary: 'Change the quantity or note of one line' })
  async updateLine(
    @Req() req: CartRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('lineId', new ZodValidationPipe(lineIdParam)) lineId: string,
    @Body(new ZodValidationPipe(updateCartLineSchema)) body: UpdateCartLineInput,
  ) {
    privateHeaders(res);
    return { cart: await this.carts.updateLine(requireTenant(req), identityOf(req), lineId, body) };
  }

  @Delete('lines/:lineId')
  @ApiOperation({ summary: 'Remove one line' })
  async removeLine(
    @Req() req: CartRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('lineId', new ZodValidationPipe(lineIdParam)) lineId: string,
  ) {
    privateHeaders(res);
    return { cart: await this.carts.removeLine(requireTenant(req), identityOf(req), lineId) };
  }

  @Put('coupon')
  @ApiOperation({ summary: 'Apply a coupon code (one per cart); 422 COUPON_INVALID says why not' })
  async applyCoupon(
    @Req() req: CartRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(couponBody)) body: z.infer<typeof couponBody>,
  ) {
    privateHeaders(res);
    return { cart: await this.carts.setCoupon(requireTenant(req), identityOf(req), body.code) };
  }

  @Delete('coupon')
  @ApiOperation({ summary: 'Remove the coupon from the cart' })
  async removeCoupon(@Req() req: CartRequest, @Res({ passthrough: true }) res: Response) {
    privateHeaders(res);
    return { cart: await this.carts.removeCoupon(requireTenant(req), identityOf(req)) };
  }

  @Patch('contact')
  @ApiOperation({
    summary: 'Capture email or phone early (abandoned-cart tracking only; no message is sent)',
  })
  async contact(
    @Req() req: CartRequest,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(cartContactSchema)) body: CartContactInput,
  ) {
    privateHeaders(res);
    return { cart: await this.carts.setContact(requireTenant(req), identityOf(req), body) };
  }
}
