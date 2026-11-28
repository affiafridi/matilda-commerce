import { Injectable } from '@nestjs/common';
import {
  CART_LINE_MAX_QUANTITY,
  CART_MAX_LINES,
  type AddCartLineInput,
  type CartContactInput,
  type CartLineInput,
  type QuoteLine,
  type QuoteTotals,
  type UpdateCartLineInput,
} from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import { generateToken, hashToken } from '../../common/security/tokens';
import { PrismaService } from '../../database/prisma.service';
import { withScope } from '../../database/scope';
import type { Prisma } from '../../generated/prisma/client';
import type { Tx } from '../admin/brand-access';
import type { PricingInputLine } from '../pricing/pricing-engine';
import { QuoteSigner } from '../pricing/quote-signer.service';
import { type Quote, type QuoteContext, QuoteService } from '../pricing/quote.service';
import type { CouponReason } from '../promotions/promotion-evaluator.service';
import type { ResolvedTenant } from '../tenancy/tenant-resolver.service';
import { lineSignature } from './cart-signature';

/** Who is asking: a signed-in customer, or a guest holding the secret cart token (or neither yet). */
export interface CartIdentity {
  customerId?: string;
  guestToken?: string;
}

export interface CartLineView {
  id: string;
  productId: string;
  variationId: string | null;
  quantity: number;
  note: string | null;
  options: CartLineInput['options'];
  addOns: CartLineInput['addOns'];
  bundleChoices: CartLineInput['bundleChoices'];
  /** Why this line cannot be bought right now (e.g. unpublished since it was added). */
  issues: { field: string; message: string }[];
}

export interface CartView {
  id: string;
  marketId: string;
  currency: string;
  contactEmail: string | null;
  contactPhone: string | null;
  couponCode: string | null;
  lines: CartLineView[];
  /** Every amount computed now by the backend; lines with issues are left out of the totals. */
  quote: {
    lines: QuoteLine[];
    totals: QuoteTotals;
    /** Offers applied, the coupon outcome (a stored code that stopped working is REJECTED) and free delivery. */
    promotions: Quote['promotions'];
    /** Fee for the chosen area and method (null until both are chosen) and why it may be zero or refused. */
    delivery: Quote['delivery'];
    tax: Quote['tax'];
    /** HMAC over the amounts and when it stops being offered (D5-01); the order step recomputes regardless. */
    expiresAt: Date;
    signature: string;
  };
}

export interface CartResult {
  cart: CartView;
  /** Set only when a guest cart was just created; the controller puts it in the cookie. */
  guestToken?: string;
}

const cartInclude = {
  lines: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { options: true, addOns: true, bundles: true },
  },
} as const satisfies Prisma.CartInclude;
type CartRow = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
type LineRow = CartRow['lines'][number];

/** What the shopper is told when a coupon cannot be applied. */
const COUPON_MESSAGES: Record<CouponReason, string> = {
  NOT_FOUND: 'That code is not valid',
  NOT_ACTIVE: 'That code is not active',
  EXHAUSTED: 'That code has been fully used',
  NOT_APPLICABLE: 'That code does not apply to your cart',
  NOT_COMBINABLE: 'That code cannot be combined with the offers already applied',
  BELOW_MINIMUM: 'Your cart is below the minimum for that code',
  CURRENCY_MISMATCH: 'That code does not apply to this currency',
  GIFT_UNAVAILABLE: 'The gift for that code is not available right now',
  NO_DISCOUNT: 'That code gives no discount on this cart',
};

const notFound = (code: string, message: string) => new ApiException(404, code, message);

/** Turns a stored line back into the input shape the pricing engine and the signature use. */
function toInput(line: LineRow): CartLineInput {
  const options = new Map<string, { optionId: string; valueIds: string[]; text?: string }>();
  for (const o of line.options) {
    const entry = options.get(o.optionGroupId) ?? {
      optionId: o.optionGroupId,
      valueIds: [],
    };
    if (o.choiceId) entry.valueIds.push(o.choiceId);
    if (o.text !== null) entry.text = o.text;
    options.set(o.optionGroupId, entry);
  }
  return {
    productId: line.productId,
    variationId: line.variationId ?? undefined,
    quantity: line.quantity,
    options: [...options.values()],
    addOns: line.addOns.map((a) => ({ addOnId: a.addonItemId, quantity: a.quantity })),
    bundleChoices: line.bundles.map((b) => ({
      bundleItemId: b.bundleItemId,
      variationId: b.variationId ?? undefined,
    })),
  };
}

/** Rows to store for one line's customization (the cart line row itself is written by the caller). */
function selectionRows(input: CartLineInput) {
  return {
    options: {
      create: input.options.flatMap((o) => [
        ...o.valueIds.map((choiceId) => ({ optionGroupId: o.optionId, choiceId })),
        ...(o.text ? [{ optionGroupId: o.optionId, text: o.text }] : []),
      ]),
    },
    addOns: {
      create: input.addOns.map((a) => ({ addonItemId: a.addOnId, quantity: a.quantity })),
    },
    bundles: {
      create: input.bundleChoices.map((b) => ({
        bundleItemId: b.bundleItemId,
        variationId: b.variationId ?? null,
      })),
    },
  };
}

/**
 * Cart (Phase 5 step 5.4, D5-02, D5-17). One open cart per customer per brand, or one per guest
 * token; brand and market come from the trusted host. A cart line stores only the product and the
 * shopper's choices: every price is computed by the pricing engine on each read, so a stale or
 * tampered client can never carry a price.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: QuoteService,
    private readonly signer: QuoteSigner,
  ) {}

  private scoped<T>(brandId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withScope(this.prisma.client, { brandIds: [brandId] }, fn);
  }

  /** The current cart, or null when the visitor has none yet (reading never creates one). */
  async get(
    tenant: ResolvedTenant,
    identity: CartIdentity,
    marketCode?: string,
  ): Promise<CartView | null> {
    return this.scoped(tenant.brand.id, async (tx) => {
      const found = await this.find(tx, tenant.brand.id, identity);
      if (!found) return null;
      const market = await this.resolveMarket(tx, tenant, marketCode, found.marketId);
      if (found.marketId !== market.id) {
        if (found.lines.length === 0) return null;
        throw this.marketMismatch();
      }
      return this.view(tx, tenant.brand.id, found);
    });
  }

  async addLine(
    tenant: ResolvedTenant,
    identity: CartIdentity,
    body: AddCartLineInput,
    marketCode?: string,
  ): Promise<CartResult> {
    const { note, ...input } = body;
    return this.scoped(tenant.brand.id, async (tx) => {
      const brandId = tenant.brand.id;
      let guestToken: string | undefined;
      let cart: CartRow;
      const existing = await this.find(tx, brandId, identity);
      const market = await this.resolveMarket(tx, tenant, marketCode, existing?.marketId);
      if (!existing) {
        guestToken = identity.customerId ? undefined : generateToken();
        const created = await tx.cart.create({
          data: {
            brandId,
            marketId: market.id,
            currencyCode: market.currency,
            customerId: identity.customerId ?? null,
            guestTokenHash: guestToken ? hashToken(guestToken) : null,
          },
        });
        cart = { ...created, lines: [] };
      } else {
        cart = await this.lock(tx, existing.id);
        if (cart.marketId !== market.id) {
          if (cart.lines.length > 0) throw this.marketMismatch();
          // An empty cart simply follows the shopper to the market they are now in.
          await tx.cart.update({
            where: { id: cart.id },
            data: { marketId: market.id, currencyCode: market.currency },
          });
          cart = { ...cart, marketId: market.id, currencyCode: market.currency };
        }
      }

      const ctx = this.context(cart);
      const signature = lineSignature(input);
      const same = cart.lines.find((l) => lineSignature(toInput(l)) === signature);
      if (same) {
        const quantity = same.quantity + input.quantity;
        if (quantity > CART_LINE_MAX_QUANTITY) {
          throw new ApiException(422, 'CART_LINE_INVALID', 'That quantity is not allowed', [
            { path: 'quantity', message: `At most ${CART_LINE_MAX_QUANTITY} of one item` },
          ]);
        }
        await this.validateLine(tx, ctx, { ...input, quantity });
        await tx.cartLine.update({ where: { id: same.id }, data: { quantity } });
      } else {
        if (cart.lines.length >= CART_MAX_LINES) {
          throw new ApiException(422, 'CART_FULL', `A cart holds at most ${CART_MAX_LINES} lines`);
        }
        await this.validateLine(tx, ctx, input);
        await tx.cartLine.create({
          data: {
            brandId,
            cartId: cart.id,
            productId: input.productId,
            variationId: input.variationId ?? null,
            quantity: input.quantity,
            note: note ?? null,
            ...selectionRows(input),
          },
        });
      }
      await this.touch(tx, cart);
      return { cart: await this.reloadView(tx, brandId, cart.id), guestToken };
    });
  }

  async updateLine(
    tenant: ResolvedTenant,
    identity: CartIdentity,
    lineId: string,
    body: UpdateCartLineInput,
  ): Promise<CartView> {
    return this.scoped(tenant.brand.id, async (tx) => {
      const cart = await this.existingLocked(tx, tenant.brand.id, identity);
      const line = cart.lines.find((l) => l.id === lineId);
      if (!line) throw notFound('CART_LINE_NOT_FOUND', 'That item is not in your cart');
      if (body.quantity !== undefined) {
        await this.validateLine(tx, this.context(cart), {
          ...toInput(line),
          quantity: body.quantity,
        });
      }
      await tx.cartLine.update({
        where: { id: line.id },
        data: {
          ...(body.quantity === undefined ? {} : { quantity: body.quantity }),
          ...(body.note === undefined ? {} : { note: body.note }),
        },
      });
      await this.touch(tx, cart);
      return this.reloadView(tx, tenant.brand.id, cart.id);
    });
  }

  async removeLine(
    tenant: ResolvedTenant,
    identity: CartIdentity,
    lineId: string,
  ): Promise<CartView> {
    return this.scoped(tenant.brand.id, async (tx) => {
      const cart = await this.existingLocked(tx, tenant.brand.id, identity);
      if (!cart.lines.some((l) => l.id === lineId)) {
        throw notFound('CART_LINE_NOT_FOUND', 'That item is not in your cart');
      }
      await tx.cartLine.delete({ where: { id: lineId } });
      await this.touch(tx, cart);
      return this.reloadView(tx, tenant.brand.id, cart.id);
    });
  }

  /**
   * Applies a coupon code to the cart (D5-11: at most one). The code must work for this cart right
   * now; it is kept on the cart and checked again on every read and at checkout, so a code that
   * later expires or runs out simply stops discounting.
   */
  async setCoupon(tenant: ResolvedTenant, identity: CartIdentity, code: string): Promise<CartView> {
    return this.scoped(tenant.brand.id, async (tx) => {
      const brandId = tenant.brand.id;
      const cart = await this.existingLocked(tx, brandId, identity);
      const { quote } = await this.quotes.quote(
        tx,
        { ...this.context(cart), customerId: cart.customerId, couponCode: code },
        cart.lines.map((l) => ({ ...toInput(l), id: l.id })),
      );
      const state = quote.promotions.coupon;
      if (state?.status !== 'APPLIED') {
        const reason = state?.status === 'REJECTED' ? state.reason : 'NOT_FOUND';
        throw new ApiException(422, 'COUPON_INVALID', COUPON_MESSAGES[reason], [
          { path: 'code', message: COUPON_MESSAGES[reason] },
        ]);
      }
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: code } });
      await this.touch(tx, cart);
      return this.reloadView(tx, brandId, cart.id);
    });
  }

  async removeCoupon(tenant: ResolvedTenant, identity: CartIdentity): Promise<CartView> {
    return this.scoped(tenant.brand.id, async (tx) => {
      const cart = await this.existingLocked(tx, tenant.brand.id, identity);
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
      await this.touch(tx, cart);
      return this.reloadView(tx, tenant.brand.id, cart.id);
    });
  }

  async setContact(
    tenant: ResolvedTenant,
    identity: CartIdentity,
    body: CartContactInput,
  ): Promise<CartView> {
    return this.scoped(tenant.brand.id, async (tx) => {
      const cart = await this.existingLocked(tx, tenant.brand.id, identity);
      await tx.cart.update({
        where: { id: cart.id },
        data: {
          ...(body.contactEmail === undefined ? {} : { contactEmail: body.contactEmail }),
          ...(body.contactPhone === undefined ? {} : { contactPhone: body.contactPhone }),
        },
      });
      await this.touch(tx, cart);
      return this.reloadView(tx, tenant.brand.id, cart.id);
    });
  }

  /**
   * After sign-in: the guest cart joins the customer's cart (D5-02). The same configuration adds
   * its quantity to the existing line, other lines move over, and the guest cart ends `MERGED`.
   * Lines are re-validated on the next read, so anything that is no longer buyable shows as an
   * issue instead of being silently dropped. Carts of different markets are never mixed: an empty
   * customer cart adopts the guest cart's market, a non-empty one is left alone.
   */
  async mergeGuestCart(
    brandId: string,
    customerId: string,
    guestToken: string | undefined,
  ): Promise<{ merged: boolean }> {
    if (!guestToken) return { merged: false };
    return this.scoped(brandId, async (tx) => {
      const guestRef = await this.find(tx, brandId, { guestToken });
      if (!guestRef) return { merged: false };
      const customerRef = await this.find(tx, brandId, { customerId });

      if (!customerRef) {
        // The guest cart simply becomes the customer's cart.
        await this.lock(tx, guestRef.id);
        await tx.cart.update({
          where: { id: guestRef.id },
          data: {
            customerId,
            guestTokenHash: null,
            lastActivityAt: new Date(),
            ...(guestRef.status === 'ABANDONED' ? { status: 'OPEN', abandonedAt: null } : {}),
          },
        });
        return { merged: true };
      }

      // Lock in id order so two merges can never wait on each other.
      const [first, second] = [guestRef.id, customerRef.id].sort();
      await this.lock(tx, first as string);
      await this.lock(tx, second as string);
      const guest = await this.load(tx, guestRef.id);
      let target = await this.load(tx, customerRef.id);

      if (guest.marketId !== target.marketId) {
        if (target.lines.length > 0) return { merged: false };
        await tx.cart.update({
          where: { id: target.id },
          data: { marketId: guest.marketId, currencyCode: guest.currencyCode },
        });
        target = { ...target, marketId: guest.marketId, currencyCode: guest.currencyCode };
      }

      const bySignature = new Map(target.lines.map((l) => [lineSignature(toInput(l)), l]));
      let lineCount = target.lines.length;
      for (const line of guest.lines) {
        const match = bySignature.get(lineSignature(toInput(line)));
        if (match) {
          await tx.cartLine.update({
            where: { id: match.id },
            data: { quantity: Math.min(match.quantity + line.quantity, CART_LINE_MAX_QUANTITY) },
          });
          await tx.cartLine.delete({ where: { id: line.id } });
        } else if (lineCount < CART_MAX_LINES) {
          await tx.cartLine.update({ where: { id: line.id }, data: { cartId: target.id } });
          lineCount += 1;
        } else {
          await tx.cartLine.delete({ where: { id: line.id } });
        }
      }
      await tx.cart.update({
        where: { id: target.id },
        data: {
          lastActivityAt: new Date(),
          contactEmail: target.contactEmail ?? guest.contactEmail,
          contactPhone: target.contactPhone ?? guest.contactPhone,
          couponCode: target.couponCode ?? guest.couponCode,
        },
      });
      await tx.cart.update({ where: { id: guest.id }, data: { status: 'MERGED' } });
      return { merged: true };
    });
  }

  // ---- internals ----

  private marketMismatch(): ApiException {
    return new ApiException(
      409,
      'CART_MARKET_MISMATCH',
      'Your cart belongs to another market; empty it or return to that market to continue',
    );
  }

  private context(cart: Pick<CartRow, 'brandId' | 'marketId' | 'currencyCode'>): QuoteContext {
    return {
      brandId: cart.brandId,
      marketId: cart.marketId,
      currency: cart.currencyCode,
      at: new Date(),
    };
  }

  /** The visitor's live cart: an open one, or (for reopening) the newest abandoned one. */
  private async find(tx: Tx, brandId: string, identity: CartIdentity) {
    if (identity.customerId) {
      const where = { brandId, customerId: identity.customerId };
      return (
        (await tx.cart.findFirst({ where: { ...where, status: 'OPEN' }, include: cartInclude })) ??
        (await tx.cart.findFirst({
          where: { ...where, status: 'ABANDONED' },
          orderBy: { lastActivityAt: 'desc' },
          include: cartInclude,
        }))
      );
    }
    if (!identity.guestToken) return null;
    return tx.cart.findFirst({
      where: {
        brandId,
        guestTokenHash: hashToken(identity.guestToken),
        status: { in: ['OPEN', 'ABANDONED'] },
      },
      include: cartInclude,
    });
  }

  /** Serializes writers of one cart, then reads it fresh. */
  private async lock(tx: Tx, cartId: string): Promise<CartRow> {
    await tx.$queryRaw`SELECT id FROM cart WHERE id = ${cartId}::uuid FOR UPDATE`;
    return this.load(tx, cartId);
  }

  private async existingLocked(tx: Tx, brandId: string, identity: CartIdentity): Promise<CartRow> {
    const found = await this.find(tx, brandId, identity);
    if (!found) throw notFound('CART_NOT_FOUND', 'You do not have a cart yet');
    return this.lock(tx, found.id);
  }

  private load(tx: Tx, cartId: string): Promise<CartRow> {
    return tx.cart.findUniqueOrThrow({ where: { id: cartId }, include: cartInclude });
  }

  private async reloadView(tx: Tx, brandId: string, cartId: string): Promise<CartView> {
    return this.view(tx, brandId, await this.load(tx, cartId));
  }

  private async touch(tx: Tx, cart: CartRow): Promise<void> {
    await tx.cart.update({
      where: { id: cart.id },
      data: {
        lastActivityAt: new Date(),
        ...(cart.status === 'ABANDONED' ? { status: 'OPEN', abandonedAt: null } : {}),
      },
    });
  }

  /** Active market of the brand, with its default currency (D5-17: one currency per cart). */
  private async resolveMarket(
    tx: Tx,
    tenant: ResolvedTenant,
    marketCode: string | undefined,
    cartMarketId?: string,
  ): Promise<{ id: string; currency: string }> {
    const brandId = tenant.brand.id;
    const where = tenant.market
      ? { id: tenant.market.id }
      : marketCode
        ? { code: marketCode }
        : cartMarketId
          ? { id: cartMarketId }
          : null;
    if (!where) {
      throw new ApiException(404, 'MARKET_REQUIRED', 'Choose a market with the "market" parameter');
    }
    const market = await tx.market.findFirst({
      where: { brandId, status: 'ACTIVE', ...where },
      select: {
        id: true,
        currencies: {
          select: { isDefault: true, currencyCode: true },
          orderBy: { currencyCode: 'asc' },
        },
      },
    });
    const currency = market?.currencies.find((c) => c.isDefault) ?? market?.currencies[0];
    if (!market || !currency) {
      throw notFound('MARKET_NOT_FOUND', 'This market is not available');
    }
    return { id: market.id, currency: currency.currencyCode };
  }

  /** Prices one line alone so the shopper gets precise errors; paths are relative to the line. */
  private async validateLine(tx: Tx, ctx: QuoteContext, input: CartLineInput): Promise<void> {
    try {
      await this.quotes.price(tx, { ...ctx, skipPromotions: true }, [input]);
    } catch (err) {
      if (err instanceof ApiException && err.code === 'CART_INVALID') {
        throw new ApiException(
          422,
          'CART_LINE_INVALID',
          'That item cannot be added as chosen',
          err.errors?.map((e) => ({ ...e, path: e.path.replace(/^lines\.0\./, '') })),
        );
      }
      throw err;
    }
  }

  private async view(tx: Tx, brandId: string, cart: CartRow): Promise<CartView> {
    const inputs: PricingInputLine[] = cart.lines.map((l) => ({ ...toInput(l), id: l.id }));
    const { quote, errors } = await this.quotes.quote(
      tx,
      {
        ...this.context(cart),
        brandId,
        customerId: cart.customerId,
        couponCode: cart.couponCode,
        delivery: { areaId: cart.deliveryAreaId, methodId: cart.deliveryMethodId },
      },
      inputs,
    );
    const signed = this.signer.sign(brandId, quote);
    return {
      id: cart.id,
      marketId: cart.marketId,
      currency: cart.currencyCode,
      contactEmail: cart.contactEmail,
      contactPhone: cart.contactPhone,
      couponCode: cart.couponCode,
      lines: cart.lines.map((l, index) => {
        const input = toInput(l);
        return {
          id: l.id,
          productId: l.productId,
          variationId: l.variationId,
          quantity: l.quantity,
          note: l.note,
          options: input.options,
          addOns: input.addOns,
          bundleChoices: input.bundleChoices,
          issues: errors
            .filter((e) => e.index === index)
            .map((e) => ({ field: e.field, message: e.message })),
        };
      }),
      quote: {
        lines: quote.lines,
        totals: quote.totals,
        promotions: quote.promotions,
        delivery: quote.delivery,
        tax: quote.tax,
        ...signed,
      },
    };
  }
}
