import { Injectable } from '@nestjs/common';
import { MAX_STOCK_QUANTITY, availableQuantity, z } from '@matilda/validation';
import { ApiException } from '../../common/errors/api-exception';
import type { DeliveryMethodKind } from '../../generated/prisma/client';
import { notFound, uuid } from '../admin/admin-common';
import type { Tx } from '../admin/brand-access';
import { BrandScopedAccess } from '../admin/brand-access';
import { fromTime } from '../delivery/delivery-common';
import {
  type LocalDate,
  type OpenRange,
  addDays,
  weekdayOf,
  localNow,
  nextOpen,
  toMinutes,
  zonedInstant,
} from './local-time';

/** Brand-scoped, read-only entry point of the availability calls (no staff actor: public). */
@Injectable()
export class AvailabilityAccess extends BrandScopedAccess {}

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD');

const lineSchema = z.object({
  productId: uuid,
  variationId: uuid.optional(),
  quantity: z.number().int().min(1).max(MAX_STOCK_QUANTITY),
});

export const availabilityBody = z.object({
  /** The delivery location, as a node of the location tree (usually an area). */
  areaId: uuid,
  lines: z.array(lineSchema).min(1).max(50),
  /** First day to look at (market-local); defaults to today. */
  from: localDate.optional(),
  /** How many days to look at, from `from`. */
  days: z.number().int().min(1).max(31).default(14),
});
export type AvailabilityInput = z.infer<typeof availabilityBody>;

export const stockStatusBody = z.object({ lines: z.array(lineSchema).min(1).max(50) });
export type StockStatusInput = z.infer<typeof stockStatusBody>;

export interface AvailableSlot {
  slotId: string;
  /** Branch that would prepare and deliver the order (kept off the public response). */
  branchId: string;
  start: string;
  end: string;
  method: { id: string; kind: DeliveryMethodKind };
  currencyCode: string;
  feeMinor: number;
  minimumOrderMinor: number;
  freeOverMinor: number | null;
}

export interface AvailabilityResult {
  deliverable: boolean;
  /** Why nothing is offered: AREA_NOT_COVERED, RESTRICTED, NO_BRANCH_CAN_SERVE or NO_SLOTS. */
  reason: string | null;
  zoneId: string | null;
  /** Branches that cover the area, can supply every line and are open to produce. */
  branchIds: string[];
  dates: Array<{ date: LocalDate; slots: AvailableSlot[] }>;
}

export type StockStatus = 'AVAILABLE' | 'LOW' | 'UNAVAILABLE';

interface Need {
  productId: string;
  variationId: string | null;
  quantity: number;
  madeToOrder: boolean;
}

const unavailable = (reason: string, zoneId: string | null = null): AvailabilityResult => ({
  deliverable: false,
  reason,
  zoneId,
  branchIds: [],
  dates: [],
});

/**
 * Delivery availability (Phase 4 step 4.10, docs/DELIVERY.md): for a cart, a delivery location and
 * a range of days, which dates and slots can be offered and which branches can serve them. The
 * answer is the intersection of zone coverage, restrictions, the stock at candidate branches, the
 * time the branch needs to have everything ready (preparation and lead time, within opening
 * hours), slot cutoffs, closures, and the places left in each slot. It only reads: Phase 5 calls
 * the same function to re-validate at checkout and then holds the place with the reservation
 * service. The result is never cached across customers (D4-16); the brand and market come from the
 * trusted host, never from the client.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly access: AvailabilityAccess) {}

  /** Time an item needs before it can leave the kitchen: preparation plus advance notice (D4-17). */
  private itemMinutes(p: { prepTimeMinutes: number | null; leadTimeMinutes: number | null }) {
    return (p.prepTimeMinutes ?? 0) + (p.leadTimeMinutes ?? 0);
  }

  /** Loads the cart's products, checks they are sold here, and expands bundles into components. */
  private async needs(
    tx: Tx,
    marketId: string,
    lines: ReadonlyArray<z.infer<typeof lineSchema>>,
    now: Date,
  ) {
    const ids = [...new Set(lines.map((l) => l.productId))];
    const products = await tx.product.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        status: 'PUBLISHED',
        AND: [
          { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
          { OR: [{ unpublishAt: null }, { unpublishAt: { gt: now } }] },
          { ProductMarketProductRel0: { some: { marketId } } },
        ],
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const needs: Need[] = [];
    const touched = new Map<string, (typeof products)[number]>();
    const bundles = lines.filter((l) => byId.get(l.productId)?.type === 'BUNDLE');
    const items = bundles.length
      ? await tx.bundleItem.findMany({
          where: { bundleProductId: { in: bundles.map((b) => b.productId) } },
        })
      : [];
    const componentIds = [...new Set(items.map((i) => i.componentProductId))];
    const components = componentIds.length
      ? await tx.product.findMany({ where: { id: { in: componentIds }, deletedAt: null } })
      : [];
    const componentById = new Map(components.map((c) => [c.id, c]));
    for (const line of lines) {
      const product = byId.get(line.productId);
      if (!product) throw notFound('Product');
      if (
        line.quantity < product.minQuantity ||
        (product.maxQuantity && line.quantity > product.maxQuantity)
      ) {
        throw new ApiException(
          422,
          'QUANTITY_OUT_OF_RANGE',
          'The quantity is outside what this product allows per order',
        );
      }
      touched.set(product.id, product);
      if (product.type === 'BUNDLE') {
        if (line.variationId) throw notFound('Variation');
        for (const item of items.filter((i) => i.bundleProductId === product.id)) {
          const c = componentById.get(item.componentProductId);
          if (!c) throw notFound('Product');
          touched.set(c.id, c);
          needs.push({
            productId: c.id,
            variationId: item.componentVariationId,
            quantity: item.quantity * line.quantity,
            madeToOrder: c.madeToOrder,
          });
        }
        continue;
      }
      const variationOk =
        product.type === 'VARIABLE'
          ? !!line.variationId &&
            !!(await tx.variation.findFirst({
              where: { id: line.variationId, productId: product.id, deletedAt: null },
            }))
          : !line.variationId;
      if (!variationOk) throw notFound('Variation');
      needs.push({
        productId: product.id,
        variationId: line.variationId ?? null,
        quantity: line.quantity,
        madeToOrder: product.madeToOrder,
      });
    }
    return { needs, products: [...touched.values()] };
  }

  /** Product, category and collection ids a restriction may name for the cart's products. */
  private async restrictionTargets(tx: Tx, productIds: readonly string[]) {
    const categoryLinks = await tx.productCategory.findMany({
      where: { productId: { in: [...productIds] } },
    });
    const categories = await tx.category.findMany({ select: { id: true, parentId: true } });
    const parent = new Map(categories.map((c) => [c.id, c.parentId]));
    const categoryIds = new Set<string>();
    for (const link of categoryLinks) {
      let id: string | null | undefined = link.categoryId;
      for (let depth = 0; id && depth < 10 && !categoryIds.has(id); depth++) {
        categoryIds.add(id);
        id = parent.get(id);
      }
    }
    const collectionIds = new Set(
      (await tx.productCollection.findMany({ where: { productId: { in: [...productIds] } } })).map(
        (c) => c.collectionId,
      ),
    );
    return { categoryIds, collectionIds };
  }

  /**
   * The market of a storefront request: the host's market, or for brand-wide hosts the market code
   * given by the shopper, which must be one of the brand's active markets.
   */
  async marketFor(brandId: string, tenantMarketId: string | null, code?: string) {
    return this.access.runPublic(brandId, async (tx) => {
      const market = await tx.market.findFirst({
        where: {
          status: 'ACTIVE',
          ...(tenantMarketId ? { id: tenantMarketId } : { code: code ?? '' }),
        },
        select: { id: true },
      });
      if (!market) {
        const named = !!tenantMarketId || !!code;
        throw new ApiException(
          named ? 404 : 400,
          named ? 'MARKET_NOT_FOUND' : 'MARKET_REQUIRED',
          named ? 'This market is not available' : 'Choose a market with the "market" parameter',
        );
      }
      return market.id;
    });
  }

  /**
   * The locations a shopper can pick: every location of the market's country that a zone of the
   * market covers, with the places above it, named in the requested language (English fallback).
   */
  async areas(brandId: string, marketId: string, language: string) {
    return this.access.runPublic(brandId, async (tx) => {
      const market = await tx.market.findFirst({ where: { id: marketId, status: 'ACTIVE' } });
      if (!market) throw notFound('Market');
      const covered = await tx.deliveryZoneArea.findMany({
        where: { marketId, zone: { status: 'ACTIVE' } },
        select: { areaId: true },
      });
      const coveredIds = new Set(covered.map((c) => c.areaId));
      const all = await tx.deliveryArea.findMany({
        where: { countryId: market.countryId, status: 'ACTIVE' },
        include: { translations: { where: { language: { in: [language, 'en'] } } } },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      const byId = new Map(all.map((a) => [a.id, a]));
      const keep = new Set<string>();
      for (const id of coveredIds) {
        let at: string | null | undefined = id;
        while (at && byId.has(at) && !keep.has(at)) {
          keep.add(at);
          at = byId.get(at)?.parentId;
        }
      }
      return all
        .filter((a) => keep.has(a.id))
        .map((a) => ({
          id: a.id,
          parentId: a.parentId,
          level: a.level,
          code: a.code,
          name:
            a.translations.find((t) => t.language === language)?.name ??
            a.translations.find((t) => t.language === 'en')?.name ??
            a.code,
          deliverable: coveredIds.has(a.id),
        }));
    });
  }

  async evaluate(
    brandId: string,
    marketId: string,
    input: AvailabilityInput,
    now = new Date(),
  ): Promise<AvailabilityResult> {
    return this.access.runPublic(brandId, async (tx) => {
      const market = await tx.market.findFirst({
        where: { id: marketId, status: 'ACTIVE' },
        include: { currencies: true },
      });
      if (!market) throw notFound('Market');
      const currency = (market.currencies.find((c) => c.isDefault) ?? market.currencies[0])
        ?.currencyCode;
      if (!currency) throw notFound('Market');

      // 1. Where: the area, and the zone that covers it (most specific location wins).
      const chain: string[] = [];
      for (let id: string | null = input.areaId; id && chain.length < 4;) {
        const area: { id: string; countryId: string; parentId: string | null } | null =
          await tx.deliveryArea.findFirst({
            where: { id, status: 'ACTIVE' },
            select: { id: true, countryId: true, parentId: true },
          });
        if (!area || area.countryId !== market.countryId) {
          if (chain.length === 0) throw notFound('Area');
          break;
        }
        chain.push(area.id);
        id = area.parentId;
      }
      // 2. What: sellable lines (checked first, so a bad cart is an error whatever the area),
      // bundle components, and the restrictions that apply to them.
      const { needs, products } = await this.needs(tx, marketId, input.lines, now);
      const productIds = products.map((p) => p.id);
      const { categoryIds, collectionIds } = await this.restrictionTargets(tx, productIds);
      const restrictions = (
        await tx.deliveryRestriction.findMany({ where: { marketId, status: 'ACTIVE' } })
      ).filter(
        (r) =>
          (r.target === 'PRODUCT' && r.productId && productIds.includes(r.productId)) ||
          (r.target === 'CATEGORY' && r.categoryId && categoryIds.has(r.categoryId)) ||
          (r.target === 'COLLECTION' && r.collectionId && collectionIds.has(r.collectionId)),
      );
      const links = await tx.deliveryZoneArea.findMany({
        where: { marketId, areaId: { in: chain }, zone: { status: 'ACTIVE' } },
      });
      const link = chain.map((id) => links.find((l) => l.areaId === id)).find(Boolean);
      if (!link) return unavailable('AREA_NOT_COVERED');
      const zoneId = link.zoneId;

      if (
        restrictions.some(
          (r) =>
            (r.condition === 'AREA' && r.areaId && chain.includes(r.areaId)) ||
            (r.condition === 'ZONE' && r.zoneId === zoneId),
        )
      ) {
        return unavailable('RESTRICTED', zoneId);
      }

      // 3. Who: branches that serve the zone, are allowed for every product and hold the stock.
      const serving = await tx.branchZone.findMany({
        where: { zoneId },
        orderBy: [{ priority: 'asc' }, { branchId: 'asc' }],
      });
      const branches = await tx.branch.findMany({
        where: {
          id: { in: serving.map((s) => s.branchId) },
          status: 'ACTIVE',
          markets: { some: { marketId } },
        },
      });
      const allowed = await tx.productBranch.findMany({ where: { productId: { in: productIds } } });
      const setting = await tx.inventorySetting.findFirst({ where: { brandId } });
      const backorderDefault = setting?.defaultOutOfStock === 'ALLOW_BACKORDER';
      const stock = await tx.stockLevel.findMany({
        where: { branchId: { in: branches.map((b) => b.id) }, productId: { in: productIds } },
      });
      const canSupply = (branchId: string) =>
        productIds.every((pid) => {
          const rows = allowed.filter((a) => a.productId === pid);
          return rows.length === 0 || rows.some((a) => a.branchId === branchId);
        }) &&
        needs.every((n) => {
          if (n.madeToOrder) return true;
          const row = stock.find(
            (s) =>
              s.branchId === branchId &&
              s.productId === n.productId &&
              (s.variationId ?? null) === n.variationId,
          );
          if (!row) return false;
          const backorder =
            (row.outOfStock ?? (backorderDefault ? 'ALLOW_BACKORDER' : null)) === 'ALLOW_BACKORDER';
          return backorder || availableQuantity(row.onHand, row.reserved) >= n.quantity;
        });
      const supplying = branches.filter((b) => canSupply(b.id));
      if (supplying.length === 0) return unavailable('NO_BRANCH_CAN_SERVE', zoneId);

      // 4. When ready: preparation and lead time, inside each branch's opening hours.
      const leadMinutes = Math.max(0, ...products.map((p) => this.itemMinutes(p)));
      const hours = await tx.branchHours.findMany({
        where: { branchId: { in: supplying.map((b) => b.id) } },
      });
      const ready = new Map<string, Date>();
      for (const b of supplying) {
        const ranges: OpenRange[] = hours
          .filter((h) => h.branchId === b.id)
          .map((h) => ({
            weekday: h.weekday,
            start: toMinutes(fromTime(h.startTime)),
            end: toMinutes(fromTime(h.endTime)),
          }));
        const start = nextOpen(now, ranges, b.timezone);
        if (!start) continue;
        const done = nextOpen(new Date(start.getTime() + leadMinutes * 60_000), ranges, b.timezone);
        if (done) ready.set(b.id, done);
      }
      const producing = supplying.filter((b) => ready.has(b.id));
      if (producing.length === 0) return unavailable('NO_BRANCH_CAN_SERVE', zoneId);

      // 5. Which days and slots.
      const today = localNow(now, market.timezone).date;
      const from = input.from && input.from >= today ? input.from : today;
      const dates = Array.from({ length: input.days }, (_, i) => addDays(from, i));
      const methods = await tx.deliveryMethod.findMany({
        where: { marketId, status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      const charges = await tx.zoneCharge.findMany({ where: { zoneId, currencyCode: currency } });
      const slots = await tx.deliverySlot.findMany({
        where: {
          marketId,
          status: 'ACTIVE',
          branchId: { in: producing.map((b) => b.id) },
          weekday: { in: [...new Set(dates.map(weekdayOf))] },
          OR: [{ zoneId: null }, { zoneId }],
        },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      });
      const days = slots.length
        ? await tx.slotDay.findMany({
            where: {
              slotId: { in: slots.map((s) => s.id) },
              deliveryDate: { in: dates.map((d) => new Date(`${d}T00:00:00.000Z`)) },
            },
          })
        : [];
      const closures = await tx.deliveryClosure.findMany({
        where: {
          closedOn: { in: dates.map((d) => new Date(`${d}T00:00:00.000Z`)) },
          OR: [
            { marketId: null, branchId: null },
            { marketId, branchId: null },
            { branchId: { in: producing.map((b) => b.id) } },
          ],
        },
      });
      const closedOn = (date: LocalDate, branchId: string) =>
        closures.some(
          (c) =>
            c.closedOn.toISOString().slice(0, 10) === date &&
            (c.branchId === null || c.branchId === branchId),
        );
      const blockedBy = (date: LocalDate, kind: DeliveryMethodKind) =>
        restrictions.some(
          (r) =>
            (r.condition === 'DATE_RANGE' &&
              !!r.dateFrom &&
              !!r.dateTo &&
              date >= r.dateFrom.toISOString().slice(0, 10) &&
              date <= r.dateTo.toISOString().slice(0, 10)) ||
            (r.condition === 'WEEKDAY' && r.weekday === weekdayOf(date)) ||
            (r.condition === 'METHOD' && r.methodKind === kind),
        );
      const kindsFor = (date: LocalDate): DeliveryMethodKind[] =>
        date === today
          ? ['SAME_DAY']
          : date === addDays(today, 1)
            ? ['NEXT_DAY', 'SCHEDULED']
            : ['SCHEDULED'];

      const out: AvailabilityResult['dates'] = [];
      for (const date of dates) {
        const offered: AvailableSlot[] = [];
        for (const slot of slots.filter((s) => s.weekday === weekdayOf(date))) {
          const branch = producing.find((b) => b.id === slot.branchId);
          if (!branch || closedOn(date, branch.id)) continue;
          const offer = (k: DeliveryMethodKind) => {
            if (!slot.methods.includes(k) || blockedBy(date, k)) return null;
            const method = methods.find(
              (m) => m.kind === k && charges.some((c) => c.methodId === m.id),
            );
            const charge = method && charges.find((c) => c.methodId === method.id);
            return method && charge ? { kind: k, method, charge } : null;
          };
          const chosen = kindsFor(date)
            .map(offer)
            .find((o) => o !== null);
          if (!chosen) continue;
          const { kind, method, charge } = chosen;
          const start = fromTime(slot.startTime);
          const startAt = zonedInstant(date, toMinutes(start), branch.timezone);
          const cutoffAt = zonedInstant(
            addDays(date, -slot.cutoffDaysBefore),
            toMinutes(fromTime(slot.cutoffTime)),
            branch.timezone,
          );
          if (startAt < (ready.get(branch.id) as Date) || cutoffAt < now) continue;
          const booked =
            days.find(
              (d) => d.slotId === slot.id && d.deliveryDate.toISOString().slice(0, 10) === date,
            )?.booked ?? 0;
          if (booked >= slot.capacity) continue;
          offered.push({
            slotId: slot.id,
            branchId: branch.id,
            start,
            end: fromTime(slot.endTime),
            method: { id: method.id, kind },
            currencyCode: currency,
            feeMinor: charge.feeMinor,
            minimumOrderMinor: charge.minimumOrderMinor,
            freeOverMinor: charge.freeOverMinor,
          });
        }
        if (offered.length) out.push({ date, slots: offered });
      }
      return {
        deliverable: out.length > 0,
        reason: out.length > 0 ? null : 'NO_SLOTS',
        zoneId,
        branchIds: producing.map((b) => b.id),
        dates: out,
      };
    });
  }

  /**
   * Whether each line can be bought at all in this market, as a flag and never a number (the
   * quantity on hand is not public): any branch of the market that holds the quantity counts.
   */
  async stockStatus(
    brandId: string,
    marketId: string,
    input: StockStatusInput,
    now = new Date(),
  ): Promise<Array<{ productId: string; variationId: string | null; status: StockStatus }>> {
    return this.access.runPublic(brandId, async (tx) => {
      const branches = await tx.branch.findMany({
        where: { status: 'ACTIVE', markets: { some: { marketId } } },
        select: { id: true },
      });
      const setting = await tx.inventorySetting.findFirst({ where: { brandId } });
      const backorderDefault = setting?.defaultOutOfStock === 'ALLOW_BACKORDER';
      const results: Array<{ productId: string; variationId: string | null; status: StockStatus }> =
        [];
      for (const line of input.lines) {
        const { needs } = await this.needs(tx, marketId, [line], now);
        const rows = await tx.stockLevel.findMany({
          where: {
            branchId: { in: branches.map((b) => b.id) },
            productId: { in: needs.map((n) => n.productId) },
          },
        });
        let worst: StockStatus = 'AVAILABLE';
        for (const n of needs) {
          if (n.madeToOrder) continue;
          const mine = rows.filter(
            (r) => r.productId === n.productId && (r.variationId ?? null) === n.variationId,
          );
          const fits = mine.filter(
            (r) =>
              (r.outOfStock ?? (backorderDefault ? 'ALLOW_BACKORDER' : null)) ===
                'ALLOW_BACKORDER' || availableQuantity(r.onHand, r.reserved) >= n.quantity,
          );
          const status: StockStatus =
            fits.length === 0
              ? 'UNAVAILABLE'
              : fits.some(
                    (r) =>
                      availableQuantity(r.onHand, r.reserved) - n.quantity > r.lowStockThreshold,
                  )
                ? 'AVAILABLE'
                : 'LOW';
          if (status === 'UNAVAILABLE') worst = 'UNAVAILABLE';
          else if (status === 'LOW' && worst === 'AVAILABLE') worst = 'LOW';
        }
        results.push({
          productId: line.productId,
          variationId: line.variationId ?? null,
          status: worst,
        });
      }
      return results;
    });
  }
}
