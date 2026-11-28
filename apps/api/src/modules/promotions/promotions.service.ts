import { Injectable } from '@nestjs/common';
import { couponCodeSchema, languageCodeSchema, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { ApiFieldError } from '@matilda/types';
import type { Prisma } from '../../generated/prisma/client';
import { type AdminActor, isUniqueViolation, notFound } from '../admin/admin-common';
import { BrandScopedAccess } from '../admin/brand-access';

type Tx = Prisma.TransactionClient;

/** Promotions are managed through the brand scope; the markets they apply to are data on the row. */
@Injectable()
export class PromotionsAccess extends BrandScopedAccess {}

const REQUIRED_LANGUAGE = 'en';
const KINDS = ['PERCENT_OFF', 'FIXED_OFF', 'FREE_DELIVERY', 'FREE_GIFT'] as const;
const SCOPES = ['ORDER', 'PRODUCT', 'CATEGORY', 'COLLECTION'] as const;
const AUDIENCES = ['EVERYONE', 'CUSTOMERS', 'FIRST_ORDER'] as const;
const STATUSES = ['ACTIVE', 'INACTIVE'] as const;

/** Whole minor units (fils for AED); the cap keeps every value inside the column. */
const minor = z.number().int().min(1).max(1_000_000_000);
const limit = z.number().int().min(1).max(1_000_000_000);
const id = z.string().uuid();
const when = z.iso.datetime({ offset: true });

const translationBody = z.object({
  language: languageCodeSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullish(),
});

const targetsBody = z.object({
  productIds: z.array(id).max(200).default([]),
  categoryIds: z.array(id).max(200).default([]),
  collectionIds: z.array(id).max(200).default([]),
});

const fields = {
  code: z.string().trim().min(2).max(64),
  kind: z.enum(KINDS),
  scope: z.enum(SCOPES),
  percentBps: z.number().int().min(1).max(10_000).nullish(),
  fixedMinor: minor.nullish(),
  currencyCode: z
    .string()
    .length(3)
    .transform((c) => c.toUpperCase())
    .nullish(),
  giftProductId: id.nullish(),
  giftVariationId: id.nullish(),
  maxDiscountMinor: minor.nullish(),
  minSubtotalMinor: z.number().int().min(0).max(1_000_000_000),
  audience: z.enum(AUDIENCES),
  /** Lower numbers apply first. */
  priority: z.number().int().min(0).max(10_000),
  /** False: applies only when nothing else applies, and blocks everything after it (D5-11). */
  combinable: z.boolean(),
  startsAt: when.nullish(),
  endsAt: when.nullish(),
  usageLimit: limit.nullish(),
  perCustomerLimit: limit.nullish(),
  requiresCoupon: z.boolean(),
  status: z.enum(STATUSES),
  /** Empty means every market of the brand. */
  marketIds: z.array(id).max(50),
  targets: targetsBody,
  translations: z.array(translationBody).min(1).max(20),
};

/**
 * Defaults belong to creating only. The update schema is the same fields, all optional and with
 * no defaults, so a patch can never reset a field it did not mention.
 */
export const createPromotionBody = z.object({
  ...fields,
  scope: fields.scope.default('ORDER'),
  minSubtotalMinor: fields.minSubtotalMinor.default(0),
  audience: fields.audience.default('EVERYONE'),
  priority: fields.priority.default(100),
  combinable: fields.combinable.default(false),
  requiresCoupon: fields.requiresCoupon.default(false),
  status: fields.status.default('ACTIVE'),
  marketIds: fields.marketIds.default([]),
  targets: fields.targets.default({ productIds: [], categoryIds: [], collectionIds: [] }),
});
export const updatePromotionBody = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

export const promotionListQuery = z.object({
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createCouponBody = z.object({
  code: couponCodeSchema,
  usageLimit: limit.nullish(),
});
export const updateCouponBody = z
  .object({ status: z.enum(STATUSES), usageLimit: limit.nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field to change.');

const INCLUDE = {
  translations: { orderBy: { language: 'asc' } },
  markets: { select: { marketId: true } },
  targets: true,
  _count: { select: { coupons: true, usages: true } },
} satisfies Prisma.PromotionInclude;
type PromotionRow = Prisma.PromotionGetPayload<{ include: typeof INCLUDE }>;

const promotionView = (p: PromotionRow) => ({
  id: p.id,
  code: p.code,
  kind: p.kind,
  scope: p.scope,
  percentBps: p.percentBps,
  fixedMinor: p.fixedMinor,
  currencyCode: p.currencyCode,
  giftProductId: p.giftProductId,
  giftVariationId: p.giftVariationId,
  maxDiscountMinor: p.maxDiscountMinor,
  minSubtotalMinor: p.minSubtotalMinor,
  audience: p.audience,
  priority: p.priority,
  combinable: p.combinable,
  startsAt: p.startsAt?.toISOString() ?? null,
  endsAt: p.endsAt?.toISOString() ?? null,
  usageLimit: p.usageLimit,
  perCustomerLimit: p.perCustomerLimit,
  usedCount: p.usedCount,
  requiresCoupon: p.requiresCoupon,
  status: p.status,
  marketIds: p.markets.map((m) => m.marketId).sort(),
  targets: {
    productIds: p.targets.flatMap((t) => (t.productId ? [t.productId] : [])).sort(),
    categoryIds: p.targets.flatMap((t) => (t.categoryId ? [t.categoryId] : [])).sort(),
    collectionIds: p.targets.flatMap((t) => (t.collectionId ? [t.collectionId] : [])).sort(),
  },
  translations: p.translations.map((t) => ({
    language: t.language,
    name: t.name,
    description: t.description,
  })),
  couponCount: p._count.coupons,
  usageCount: p._count.usages,
});
type PromotionView = ReturnType<typeof promotionView>;

const couponView = (c: Prisma.CouponGetPayload<object>) => ({
  id: c.id,
  promotionId: c.promotionId,
  code: c.code,
  usageLimit: c.usageLimit,
  usedCount: c.usedCount,
  status: c.status,
});

/** The editable part of a promotion: what the shape rules look at. */
type Shape = Omit<PromotionView, 'id' | 'usedCount' | 'couponCount' | 'usageCount'>;

/**
 * The rules the database also enforces, checked first so staff get a message for the exact field
 * (422 `PROMOTION_INVALID`) instead of a database error.
 */
export function assertPromotionShape(p: Shape): void {
  const errors: ApiFieldError[] = [];
  const bad = (path: string, message: string) => errors.push({ path, message });
  const has = (v: unknown) => v !== null && v !== undefined;

  if (p.kind === 'PERCENT_OFF') {
    if (!has(p.percentBps)) bad('percentBps', 'Enter the percentage off.');
    if (has(p.fixedMinor)) bad('fixedMinor', 'A percentage promotion has no fixed amount.');
  } else if (p.maxDiscountMinor !== null) {
    bad('maxDiscountMinor', 'A maximum discount only applies to a percentage promotion.');
  }
  if (p.kind !== 'PERCENT_OFF' && has(p.percentBps)) {
    bad('percentBps', 'Only a percentage promotion has a percentage.');
  }
  if (p.kind === 'FIXED_OFF') {
    if (!has(p.fixedMinor)) bad('fixedMinor', 'Enter the amount off.');
    if (!has(p.currencyCode)) bad('currencyCode', 'Choose the currency of the amount.');
  } else {
    if (has(p.fixedMinor)) bad('fixedMinor', 'Only a fixed-amount promotion has an amount.');
    if (has(p.currencyCode)) bad('currencyCode', 'Only a fixed-amount promotion has a currency.');
  }
  if (p.kind === 'FREE_GIFT') {
    if (!has(p.giftProductId)) bad('giftProductId', 'Choose the gift product.');
  } else if (has(p.giftProductId) || has(p.giftVariationId)) {
    bad('giftProductId', 'Only a free-gift promotion has a gift.');
  }
  if (has(p.giftVariationId) && !has(p.giftProductId)) {
    bad('giftVariationId', 'A gift variation needs its product.');
  }
  if (p.kind === 'FREE_DELIVERY' && p.scope !== 'ORDER') {
    bad('scope', 'Free delivery applies to the whole order.');
  }
  const wanted: Record<string, keyof PromotionView['targets'] | null> = {
    ORDER: null,
    PRODUCT: 'productIds',
    CATEGORY: 'categoryIds',
    COLLECTION: 'collectionIds',
  };
  const key = wanted[p.scope] ?? null;
  for (const k of ['productIds', 'categoryIds', 'collectionIds'] as const) {
    if (k !== key && p.targets[k].length > 0) {
      bad(`targets.${k}`, 'These targets do not match the scope.');
    }
  }
  if (key && p.targets[key].length === 0) {
    bad(`targets.${key}`, 'Choose at least one target for this scope.');
  }
  if (p.startsAt && p.endsAt && new Date(p.endsAt) <= new Date(p.startsAt)) {
    bad('endsAt', 'The end must be after the start.');
  }
  if (p.usageLimit !== null && p.usageLimit < 1) bad('usageLimit', 'The limit must be at least 1.');
  const languages = p.translations.map((t) => t.language);
  if (!languages.includes(REQUIRED_LANGUAGE)) bad('translations', 'An English name is required.');
  if (new Set(languages).size !== languages.length) {
    bad('translations', 'Each language can appear only once.');
  }
  if (errors.length > 0) {
    throw new ApiException(
      422,
      'PROMOTION_INVALID',
      'This promotion cannot be saved as entered',
      errors,
    );
  }
}

/** Database errors that mean "the caller asked for something invalid" become API errors. */
function mapPromotionError(err: unknown, uniqueCode: string, uniqueMessage: string): Error {
  if (err instanceof ApiException) return err;
  if (isUniqueViolation(err)) return new ApiException(409, uniqueCode, uniqueMessage);
  const text = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : '';
  if (/foreign key|23503/i.test(text)) {
    return new ApiException(
      422,
      'REFERENCE_INVALID',
      'A market, product, category or collection does not exist in this brand',
    );
  }
  if (/_check|violates check|23514|at least one target/i.test(text)) {
    return new ApiException(422, 'PROMOTION_INVALID', 'This promotion cannot be saved as entered');
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Promotions and coupons (Phase 5 step 5.5, D5-11). Staff define what a promotion does, who and
 * what it applies to, and when; the quote applies it. A promotion that has been used or has
 * coupons is never deleted, only deactivated, so past orders keep their history.
 */
@Injectable()
export class PromotionsService {
  constructor(private readonly access: PromotionsAccess) {}

  list(actor: AdminActor, brandId: string, query: z.infer<typeof promotionListQuery>) {
    return this.access.run(actor, brandId, 'promotions.view', async (tx) => {
      const where: Prisma.PromotionWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' } },
                { translations: { some: { name: { contains: query.q, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.promotion.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ priority: 'asc' }, { code: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.promotion.count({ where }),
      ]);
      return { items: rows.map(promotionView), total, page: query.page, limit: query.limit };
    });
  }

  get(actor: AdminActor, brandId: string, promotionId: string) {
    return this.access.run(actor, brandId, 'promotions.view', async (tx) =>
      promotionView(await this.load(tx, promotionId)),
    );
  }

  async create(actor: AdminActor, brandId: string, input: z.infer<typeof createPromotionBody>) {
    const shape = this.shapeOf(input);
    assertPromotionShape(shape);
    try {
      return await this.access.run(actor, brandId, 'promotions.manage', async (tx) => {
        const created = await tx.promotion.create({
          data: { brandId, ...this.columns(shape) },
        });
        await this.writeChildren(tx, brandId, created.id, shape);
        const view = promotionView(await this.load(tx, created.id));
        await this.access.record(
          tx,
          actor,
          brandId,
          'promotion.create',
          'promotion',
          created.id,
          undefined,
          view,
        );
        return view;
      });
    } catch (err) {
      throw mapPromotionError(
        err,
        'PROMOTION_CODE_TAKEN',
        'That code is already used by another promotion',
      );
    }
  }

  async update(
    actor: AdminActor,
    brandId: string,
    promotionId: string,
    patch: z.infer<typeof updatePromotionBody>,
  ) {
    try {
      return await this.access.run(actor, brandId, 'promotions.manage', async (tx) => {
        const before = promotionView(await this.load(tx, promotionId));
        // The stored values with the patch laid over them (explicit nulls clear a field).
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the stored view is a complete body
        const whole = { ...this.toInput(before), ...patch } as z.infer<typeof createPromotionBody>;
        const merged: Shape = this.shapeOf(whole);
        assertPromotionShape(merged);
        await tx.promotion.update({ where: { id: promotionId }, data: this.columns(merged) });
        if (patch.marketIds || patch.targets || patch.translations) {
          await this.writeChildren(tx, brandId, promotionId, merged, true);
        }
        const after = promotionView(await this.load(tx, promotionId));
        await this.access.record(
          tx,
          actor,
          brandId,
          'promotion.update',
          'promotion',
          promotionId,
          before,
          after,
        );
        return after;
      });
    } catch (err) {
      throw mapPromotionError(
        err,
        'PROMOTION_CODE_TAKEN',
        'That code is already used by another promotion',
      );
    }
  }

  async remove(actor: AdminActor, brandId: string, promotionId: string): Promise<void> {
    try {
      await this.access.run(actor, brandId, 'promotions.manage', async (tx) => {
        const before = promotionView(await this.load(tx, promotionId));
        if (before.couponCount > 0 || before.usageCount > 0 || before.usedCount > 0) {
          throw new ApiException(
            409,
            'PROMOTION_IN_USE',
            'This promotion has coupons or orders; deactivate it instead',
          );
        }
        await tx.promotion.delete({ where: { id: promotionId } });
        await this.access.record(
          tx,
          actor,
          brandId,
          'promotion.delete',
          'promotion',
          promotionId,
          before,
          undefined,
        );
      });
    } catch (err) {
      throw mapPromotionError(err, 'CONFLICT', 'That value is already in use');
    }
  }

  // ---- coupons ----

  listCoupons(actor: AdminActor, brandId: string, promotionId: string) {
    return this.access.run(actor, brandId, 'promotions.view', async (tx) => {
      await this.load(tx, promotionId);
      const rows = await tx.coupon.findMany({
        where: { promotionId },
        orderBy: { code: 'asc' },
      });
      return rows.map(couponView);
    });
  }

  async createCoupon(
    actor: AdminActor,
    brandId: string,
    promotionId: string,
    input: z.infer<typeof createCouponBody>,
  ) {
    try {
      return await this.access.run(actor, brandId, 'promotions.manage', async (tx) => {
        await this.load(tx, promotionId);
        const created = await tx.coupon.create({
          data: { brandId, promotionId, code: input.code, usageLimit: input.usageLimit ?? null },
        });
        const view = couponView(created);
        await this.access.record(
          tx,
          actor,
          brandId,
          'coupon.create',
          'coupon',
          created.id,
          undefined,
          view,
        );
        return view;
      });
    } catch (err) {
      throw mapPromotionError(err, 'COUPON_CODE_TAKEN', 'That coupon code is already in use');
    }
  }

  async updateCoupon(
    actor: AdminActor,
    brandId: string,
    promotionId: string,
    couponId: string,
    patch: z.infer<typeof updateCouponBody>,
  ) {
    try {
      return await this.access.run(actor, brandId, 'promotions.manage', async (tx) => {
        const before = await this.loadCoupon(tx, promotionId, couponId);
        if (patch.usageLimit != null && patch.usageLimit < before.usedCount) {
          throw new ApiException(
            422,
            'COUPON_LIMIT_BELOW_USE',
            'The limit cannot be below the times it was already used',
            [{ path: 'usageLimit', message: `Already used ${before.usedCount} times.` }],
          );
        }
        const after = couponView(await tx.coupon.update({ where: { id: couponId }, data: patch }));
        await this.access.record(
          tx,
          actor,
          brandId,
          'coupon.update',
          'coupon',
          couponId,
          couponView(before),
          after,
        );
        return after;
      });
    } catch (err) {
      throw mapPromotionError(err, 'CONFLICT', 'That value is already in use');
    }
  }

  async removeCoupon(
    actor: AdminActor,
    brandId: string,
    promotionId: string,
    couponId: string,
  ): Promise<void> {
    try {
      await this.access.run(actor, brandId, 'promotions.manage', async (tx) => {
        const before = await this.loadCoupon(tx, promotionId, couponId);
        const usages = await tx.promotionUsage.count({ where: { couponId } });
        if (before.usedCount > 0 || usages > 0) {
          throw new ApiException(
            409,
            'COUPON_IN_USE',
            'This coupon was used on orders; deactivate it instead',
          );
        }
        await tx.coupon.delete({ where: { id: couponId } });
        await this.access.record(
          tx,
          actor,
          brandId,
          'coupon.delete',
          'coupon',
          couponId,
          couponView(before),
          undefined,
        );
      });
    } catch (err) {
      throw mapPromotionError(err, 'CONFLICT', 'That value is already in use');
    }
  }

  // ---- internals ----

  private async load(tx: Tx, promotionId: string): Promise<PromotionRow> {
    const row = await tx.promotion.findFirst({ where: { id: promotionId }, include: INCLUDE });
    if (!row) throw notFound('Promotion');
    return row;
  }

  private async loadCoupon(tx: Tx, promotionId: string, couponId: string) {
    const row = await tx.coupon.findFirst({ where: { id: couponId, promotionId } });
    if (!row) throw notFound('Coupon');
    return row;
  }

  private shapeOf(input: z.infer<typeof createPromotionBody>): Shape {
    return {
      code: input.code,
      kind: input.kind,
      scope: input.scope,
      percentBps: input.percentBps ?? null,
      fixedMinor: input.fixedMinor ?? null,
      currencyCode: input.currencyCode ?? null,
      giftProductId: input.giftProductId ?? null,
      giftVariationId: input.giftVariationId ?? null,
      maxDiscountMinor: input.maxDiscountMinor ?? null,
      minSubtotalMinor: input.minSubtotalMinor,
      audience: input.audience,
      priority: input.priority,
      combinable: input.combinable,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      usageLimit: input.usageLimit ?? null,
      perCustomerLimit: input.perCustomerLimit ?? null,
      requiresCoupon: input.requiresCoupon,
      status: input.status,
      marketIds: [...new Set(input.marketIds)].sort(),
      targets: {
        productIds: [...new Set(input.targets.productIds)].sort(),
        categoryIds: [...new Set(input.targets.categoryIds)].sort(),
        collectionIds: [...new Set(input.targets.collectionIds)].sort(),
      },
      translations: input.translations.map((t) => ({
        language: t.language,
        name: t.name,
        description: t.description ?? null,
      })),
    };
  }

  /** The stored promotion in the shape of a create body, so a patch can be laid over it. */
  private toInput(view: PromotionView): z.infer<typeof createPromotionBody> {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- a stored promotion has every field of a complete body
    return { ...view } as z.infer<typeof createPromotionBody>;
  }

  private columns(s: Shape) {
    return {
      code: s.code,
      kind: s.kind,
      scope: s.scope,
      percentBps: s.percentBps,
      fixedMinor: s.fixedMinor,
      currencyCode: s.currencyCode,
      giftProductId: s.giftProductId,
      giftVariationId: s.giftVariationId,
      maxDiscountMinor: s.maxDiscountMinor,
      minSubtotalMinor: s.minSubtotalMinor,
      audience: s.audience,
      priority: s.priority,
      combinable: s.combinable,
      startsAt: s.startsAt ? new Date(s.startsAt) : null,
      endsAt: s.endsAt ? new Date(s.endsAt) : null,
      usageLimit: s.usageLimit,
      perCustomerLimit: s.perCustomerLimit,
      requiresCoupon: s.requiresCoupon,
      status: s.status,
    };
  }

  /** Markets, targets and names are replaced as whole sets, in the promotion's transaction. */
  private async writeChildren(
    tx: Tx,
    brandId: string,
    promotionId: string,
    s: Shape,
    replace = false,
  ): Promise<void> {
    if (replace) {
      await tx.promotionTranslation.deleteMany({ where: { promotionId } });
      await tx.promotionMarket.deleteMany({ where: { promotionId } });
      await tx.promotionTarget.deleteMany({ where: { promotionId } });
    }
    await tx.promotionTranslation.createMany({
      data: s.translations.map((t) => ({ promotionId, brandId, ...t })),
    });
    if (s.marketIds.length > 0) {
      await tx.promotionMarket.createMany({
        data: s.marketIds.map((marketId) => ({ promotionId, brandId, marketId })),
      });
    }
    const targets = [
      ...s.targets.productIds.map((productId) => ({ productId })),
      ...s.targets.categoryIds.map((categoryId) => ({ categoryId })),
      ...s.targets.collectionIds.map((collectionId) => ({ collectionId })),
    ];
    if (targets.length > 0) {
      await tx.promotionTarget.createMany({
        data: targets.map((t) => ({ promotionId, brandId, ...t })),
      });
    }
  }
}
