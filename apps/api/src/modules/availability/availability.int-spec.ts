import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { seed } from '../../cli/seed';
import { loadEnv } from '../../config/env';
import { withScope } from '../../database/scope';
import { type Prisma, PrismaClient } from '../../generated/prisma/client';
import { ReservationsService } from '../inventory/reservations.service';
import { TenantResolver } from '../tenancy/tenant-resolver.service';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import {
  type AvailabilityResult,
  AvailabilityService,
  type AvailabilityInput,
} from './availability.service';

/**
 * Delivery availability and the storefront stock flag (Phase 4 step 4.10): every rule of the
 * evaluation order in docs/DELIVERY.md, the reasons for "nothing available", and the public routes.
 * Times are fixed with an explicit "now": Tuesday 2026-12-01 10:00 in Dubai.
 */

const NIL = '00000000-0000-4000-8000-000000000001';
const platform = { brandIds: [], platform: true } as const;
const NOW = new Date('2026-12-01T06:00:00Z');
const TUE = '2026-12-01';
const WED = '2026-12-02';
const THU = '2026-12-03';
const FRI = '2026-12-04';
const at = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);

describe('delivery availability', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let svc: AvailabilityService;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let marketB = '';
  let kitchen = '';
  let kitchen2 = '';
  let zone = '';
  let x1 = '';
  let x2 = '';
  let city = '';
  let outside = '';
  let product = '';
  let methods: Record<'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED', string>;
  let slotNoon = ''; // Tuesday's 14:00 slot
  let slotEve = ''; // Tuesday's 18:00 slot
  let slotsByDay: Record<string, { noon: string; eve: string }>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    process.env.DATABASE_URL = testAppUrl();
    owner = createPool(testOwnerUrl());
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testOwnerUrl() }) });
    await seed(db, 'reference');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: () =>
          Promise.resolve({
            totalHits: 1,
            timeToExpire: 0,
            isBlocked: false,
            timeToBlockExpire: 0,
          }),
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, loadEnv());
    await app.init();
    svc = app.get(AvailabilityService);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
    await owner.end();
  });

  const inScope = <T>(fn: (tx: Parameters<Parameters<typeof withScope>[2]>[0]) => Promise<T>) =>
    withScope(db, platform, fn);

  beforeEach(async () => {
    await owner.query(
      'TRUNCATE staff_user, brand, branch, role, auth_attempt, delivery_area CASCADE',
    );
    await resetAuditLog(owner);
    await seed(db, 'reference');
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    const emirate = await db.deliveryArea.findFirstOrThrow({
      where: { countryId: ae.id, level: 'EMIRATE' },
      orderBy: { code: 'asc' },
    });
    city = (
      await db.deliveryArea.create({
        data: {
          countryId: ae.id,
          level: 'CITY',
          code: 't-city',
          parentId: emirate.id,
          translations: { create: [{ language: 'en', name: 'Test City' }] },
        },
      })
    ).id;
    const area = async (code: string, name: string, ar?: string) =>
      (
        await db.deliveryArea.create({
          data: {
            countryId: ae.id,
            level: 'AREA',
            code,
            parentId: city,
            translations: {
              create: [{ language: 'en', name }, ...(ar ? [{ language: 'ar', name: ar }] : [])],
            },
          },
        })
      ).id;
    x1 = await area('t-x1', 'Alpha Area', 'منطقة ألفا');
    x2 = await area('t-x2', 'Beta Area');
    outside = await area('t-out', 'Outside Area');

    await inScope(async (tx) => {
      brandA = (await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } })).id;
      brandB = (await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } })).id;
      const mk = async (brandId: string) => {
        const m = await tx.market.create({
          data: { brandId, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai', status: 'ACTIVE' },
        });
        await tx.marketCurrency.create({
          data: { marketId: m.id, currencyCode: 'AED', isDefault: true },
        });
        await tx.marketLanguage.createMany({
          data: [
            { marketId: m.id, languageCode: 'en', isDefault: true, sortOrder: 0 },
            { marketId: m.id, languageCode: 'ar', isDefault: false, sortOrder: 1 },
          ],
        });
        return m.id;
      };
      marketA = await mk(brandA);
      marketB = await mk(brandB);
      await tx.brandDomain.createMany({
        data: [
          { brandId: brandA, hostname: 'alpha.test', marketId: marketA, isPrimary: true },
          { brandId: brandA, hostname: 'alpha-all.test', isPrimary: false },
          { brandId: brandB, hostname: 'beta.test', marketId: marketB, isPrimary: true },
        ],
      });
      const br = async (code: string) =>
        (
          await tx.branch.create({
            data: {
              code,
              name: code,
              countryId: ae.id,
              timezone: 'Asia/Dubai',
              markets: { create: [{ marketId: marketA }] },
            },
          })
        ).id;
      kitchen = await br('kitchen');
      kitchen2 = await br('kitchen-2');
      zone = (
        await tx.deliveryZone.create({
          data: { brandId: brandA, marketId: marketA, code: 'zone-a' },
        })
      ).id;
      for (const areaId of [x1, x2]) {
        await tx.deliveryZoneArea.create({
          data: { zoneId: zone, brandId: brandA, marketId: marketA, areaId },
        });
      }
      await tx.branchZone.create({ data: { brandId: brandA, branchId: kitchen, zoneId: zone } });
      methods = { SAME_DAY: '', NEXT_DAY: '', SCHEDULED: '' };
      const fees = { SAME_DAY: 2500, NEXT_DAY: 1500, SCHEDULED: 1000 } as const;
      for (const kind of ['SAME_DAY', 'NEXT_DAY', 'SCHEDULED'] as const) {
        const m = await tx.deliveryMethod.create({
          data: {
            brandId: brandA,
            marketId: marketA,
            kind,
            code: kind.toLowerCase().replace('_', '-'),
          },
        });
        methods[kind] = m.id;
        await tx.zoneCharge.create({
          data: {
            brandId: brandA,
            marketId: marketA,
            zoneId: zone,
            methodId: m.id,
            currencyCode: 'AED',
            feeMinor: fees[kind],
            freeOverMinor: kind === 'SAME_DAY' ? 30000 : null,
          },
        });
      }
      for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
        await tx.branchHours.create({
          data: {
            brandId: brandA,
            branchId: kitchen,
            weekday,
            startTime: at('08:00'),
            endTime: at('20:00'),
          },
        });
      }
      const slot = (
        weekday: number,
        start: string,
        end: string,
        cutoff: string,
        capacity: number,
        kinds: Array<'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED'>,
        extra: object = {},
      ) =>
        tx.deliverySlot.create({
          data: {
            brandId: brandA,
            marketId: marketA,
            branchId: kitchen,
            weekday,
            startTime: at(start),
            endTime: at(end),
            cutoffTime: at(cutoff),
            capacity,
            methods: kinds,
            ...extra,
          },
        });
      slotsByDay = {};
      const dates = [TUE, WED, THU, FRI, '2026-12-05', '2026-12-06', '2026-12-07'];
      for (const [i, date] of dates.entries()) {
        const weekday = (i + 2) % 7; // Tue=2 ... Sat=6, Sun=0, Mon=1
        const noon = await slot(weekday, '14:00', '16:00', '12:00', 2, [
          'SAME_DAY',
          'NEXT_DAY',
          'SCHEDULED',
        ]);
        const eve = await slot(weekday, '18:00', '20:00', '15:00', 1, ['SAME_DAY', 'SCHEDULED']);
        slotsByDay[date] = { noon: noon.id, eve: eve.id };
      }
      slotNoon = slotsByDay[TUE]!.noon;
      slotEve = slotsByDay[TUE]!.eve;
      product = (
        await tx.product.create({
          data: { brandId: brandA, type: 'SIMPLE', status: 'PUBLISHED', prepTimeMinutes: 60 },
        })
      ).id;
      await tx.productMarket.create({
        data: { brandId: brandA, productId: product, marketId: marketA },
      });
      await tx.stockLevel.create({
        data: { brandId: brandA, branchId: kitchen, productId: product, onHand: 10 },
      });
    });
    app.get(TenantResolver).invalidateAll();
  });

  const lines = (...l: Array<{ productId?: string; variationId?: string; quantity?: number }>) =>
    l.map((x) => ({
      productId: x.productId ?? product,
      variationId: x.variationId,
      quantity: x.quantity ?? 1,
    }));
  const ask = (
    over: Partial<AvailabilityInput> = {},
    now = NOW,
    areaId = x1,
  ): Promise<AvailabilityResult> =>
    svc.evaluate(brandA, marketA, { areaId, lines: lines({}), days: 14, ...over }, now);
  const on = (r: AvailabilityResult, date: string) =>
    r.dates.find((d) => d.date === date)?.slots ?? [];
  const days = (r: AvailabilityResult) => r.dates.map((d) => d.date);
  const code = async (p: Promise<unknown>) =>
    p.then(
      () => 'OK',
      (e: { code?: string }) => e.code ?? 'ERROR',
    );
  const newProduct = (data: Record<string, unknown> = {}, sold = true) =>
    inScope(async (tx) => {
      const p = await tx.product.create({
        data: { brandId: brandA, type: 'SIMPLE', status: 'PUBLISHED', ...data },
      });
      if (sold)
        await tx.productMarket.create({
          data: { brandId: brandA, productId: p.id, marketId: marketA },
        });
      return p.id;
    });
  const stockFor = (productId: string, onHand: number, branchId = kitchen, extra: object = {}) =>
    inScope((tx) =>
      tx.stockLevel.create({ data: { brandId: brandA, branchId, productId, onHand, ...extra } }),
    );
  const restrict = (
    data: Partial<Prisma.DeliveryRestrictionUncheckedCreateInput> &
      Pick<Prisma.DeliveryRestrictionUncheckedCreateInput, 'condition'>,
  ) =>
    inScope((tx) =>
      tx.deliveryRestriction.create({
        data: {
          brandId: brandA,
          marketId: marketA,
          target: 'PRODUCT',
          productId: product,
          ...data,
        },
      }),
    );
  const close = (closedOn: string, scope: { marketId?: string; branchId?: string } = {}) =>
    inScope((tx) =>
      tx.deliveryClosure.create({
        data: { brandId: brandA, closedOn: new Date(`${closedOn}T00:00:00Z`), ...scope },
      }),
    );

  describe('slots, methods and fees', () => {
    it('offers slots by method: same day, next day, then scheduled', async () => {
      const r = await ask();
      expect(r).toMatchObject({
        deliverable: true,
        reason: null,
        zoneId: zone,
        branchIds: [kitchen],
      });
      expect(days(r)).toHaveLength(14);
      expect(days(r)[0]).toBe(TUE);
      expect(on(r, TUE).map((s) => [s.start, s.method.kind, s.feeMinor])).toEqual([
        ['14:00', 'SAME_DAY', 2500],
        ['18:00', 'SAME_DAY', 2500],
      ]);
      expect(on(r, WED).map((s) => [s.start, s.method.kind, s.feeMinor])).toEqual([
        ['14:00', 'NEXT_DAY', 1500],
        ['18:00', 'SCHEDULED', 1000],
      ]);
      expect(on(r, THU).map((s) => s.method.kind)).toEqual(['SCHEDULED', 'SCHEDULED']);
      const first = on(r, TUE)[0]!;
      expect(first).toMatchObject({
        slotId: slotNoon,
        branchId: kitchen,
        end: '16:00',
        currencyCode: 'AED',
        minimumOrderMinor: 0,
        freeOverMinor: 30000,
      });
      expect(on(r, TUE)[1]!.slotId).toBe(slotEve);
    });

    it('honours the requested range and never goes into the past', async () => {
      const r = await ask({ from: THU, days: 2 });
      expect(days(r)).toEqual([THU, FRI]);
      const past = await ask({ from: '2026-11-01', days: 2 });
      expect(days(past)).toEqual([TUE, WED]);
    });

    it('drops a method that has no charge for the zone, or is switched off', async () => {
      await inScope((tx) => tx.zoneCharge.deleteMany({ where: { methodId: methods.NEXT_DAY } }));
      let r = await ask();
      expect(on(r, WED).map((s) => s.method.kind)).toEqual(['SCHEDULED', 'SCHEDULED']);
      await inScope((tx) =>
        tx.deliveryMethod.update({
          where: { id: methods.SCHEDULED },
          data: { status: 'INACTIVE' },
        }),
      );
      r = await ask();
      expect(on(r, WED)).toEqual([]);
      expect(on(r, THU)).toEqual([]);
      expect(on(r, TUE)).toHaveLength(2);
    });

    it('reports NO_SLOTS when no slot survives', async () => {
      await inScope((tx) => tx.deliverySlot.updateMany({ data: { status: 'INACTIVE' } }));
      expect(await ask()).toMatchObject({ deliverable: false, reason: 'NO_SLOTS', dates: [] });
    });

    it('ignores slots of another zone but uses branch-wide ones', async () => {
      const other = await inScope((tx) =>
        tx.deliveryZone.create({ data: { brandId: brandA, marketId: marketA, code: 'zone-b' } }),
      );
      await inScope((tx) => tx.deliverySlot.updateMany({ data: { zoneId: other.id } }));
      expect(await ask()).toMatchObject({ reason: 'NO_SLOTS' });
      await inScope((tx) => tx.deliverySlot.updateMany({ data: { zoneId: zone } }));
      expect((await ask()).deliverable).toBe(true);
    });

    it('applies the cutoff of the slot, including days before', async () => {
      const lateMorning = new Date('2026-12-01T08:30:00Z'); // Tuesday 12:30
      const r = await ask({}, lateMorning);
      expect(on(r, TUE).map((s) => s.start)).toEqual(['18:00']);
      const afternoon = new Date('2026-12-01T12:00:00Z'); // Tuesday 16:00
      expect(on(await ask({}, afternoon), TUE)).toEqual([]);
      await inScope((tx) =>
        tx.deliverySlot.update({
          where: { id: slotsByDay[THU]!.noon },
          data: { cutoffDaysBefore: 1, cutoffTime: at('10:00') },
        }),
      );
      const wedNoon = new Date('2026-12-02T07:00:00Z'); // Wednesday 11:00, past Thursday's cutoff
      expect(on(await ask({}, wedNoon), THU).map((s) => s.start)).toEqual(['18:00']);
    });
  });

  describe('ready time and opening hours', () => {
    it('waits for the longest preparation and lead time in the cart', async () => {
      const cake = await newProduct({ madeToOrder: true, leadTimeMinutes: 24 * 60 });
      const r = await ask({ lines: lines({}, { productId: cake }) });
      expect(days(r)[0]).toBe(WED); // ready Wednesday 10:00
      expect(on(r, WED).map((s) => s.start)).toEqual(['14:00', '18:00']);
      const quick = await ask({ lines: lines({}) });
      expect(days(quick)[0]).toBe(TUE);
    });

    it('a slot cannot start before the order is ready', async () => {
      const slow = await newProduct({ madeToOrder: true, prepTimeMinutes: 5 * 60 });
      const r = await ask({ lines: lines({ productId: slow }) }); // ready 15:00 Tuesday
      expect(on(r, TUE).map((s) => s.start)).toEqual(['18:00']);
    });

    it('counts preparation from the next opening when ordered while closed', async () => {
      const night = new Date('2026-12-01T17:00:00Z'); // Tuesday 21:00, closed
      const r = await ask({}, night); // production starts Wednesday 08:00, ready 09:00
      expect(days(r)[0]).toBe(WED);
      expect(on(r, WED)).toHaveLength(2);
    });

    it('pushes work that would finish after closing to the next day', async () => {
      const late = new Date('2026-12-01T14:30:00Z'); // Tuesday 18:30
      const heavy = await newProduct({ madeToOrder: true, prepTimeMinutes: 3 * 60 });
      const r = await ask({ lines: lines({ productId: heavy }) }, late);
      expect(days(r)[0]).toBe(WED); // ready Wednesday 08:00 when the branch opens again
    });

    it('a branch without opening hours cannot produce', async () => {
      await inScope((tx) => tx.branchHours.deleteMany({}));
      expect(await ask()).toMatchObject({ deliverable: false, reason: 'NO_BRANCH_CAN_SERVE' });
    });
  });

  describe('closures and capacity', () => {
    it('skips closed days at branch, market and brand level', async () => {
      await close(WED, { branchId: kitchen });
      await close(THU, { marketId: marketA });
      await close(FRI);
      const r = await ask();
      expect(days(r)).not.toContain(WED);
      expect(days(r)).not.toContain(THU);
      expect(days(r)).not.toContain(FRI);
      expect(days(r)).toContain(TUE);
    });

    it('ignores the closure of a branch that is not serving', async () => {
      await close(WED, { branchId: kitchen2 });
      expect(days(await ask())).toContain(WED);
    });

    it('stops offering a slot once the places are taken by reservations', async () => {
      const reservations = app.get(ReservationsService);
      const book = (ref: string) =>
        reservations.hold({
          brandId: brandA,
          marketId: marketA,
          checkoutRef: ref,
          slot: { slotId: slotsByDay[WED]!.eve, date: WED },
        });
      let r = await ask();
      expect(on(r, WED).map((s) => s.start)).toContain('18:00');
      await book('one'); // capacity 1
      r = await ask();
      expect(on(r, WED).map((s) => s.start)).toEqual(['14:00']);
      await reservations.release(brandA, 'one');
      r = await ask();
      expect(on(r, WED).map((s) => s.start)).toEqual(['14:00', '18:00']);
    });
  });

  describe('coverage', () => {
    it('refuses an area no zone covers, and unknown areas', async () => {
      expect(await ask({}, NOW, outside)).toMatchObject({
        deliverable: false,
        reason: 'AREA_NOT_COVERED',
      });
      expect(await code(ask({}, NOW, NIL))).toBe('AREA_NOT_FOUND');
    });

    it('uses a zone that covers a place above the chosen area', async () => {
      await inScope(async (tx) => {
        await tx.deliveryZoneArea.deleteMany({});
        await tx.deliveryZoneArea.create({
          data: { zoneId: zone, brandId: brandA, marketId: marketA, areaId: city },
        });
      });
      expect((await ask({}, NOW, outside)).deliverable).toBe(true);
    });

    it('ignores an inactive zone and an inactive or foreign branch', async () => {
      await inScope((tx) =>
        tx.branch.update({ where: { id: kitchen }, data: { status: 'INACTIVE' } }),
      );
      expect(await ask()).toMatchObject({ reason: 'NO_BRANCH_CAN_SERVE' });
      await inScope((tx) =>
        tx.branch.update({ where: { id: kitchen }, data: { status: 'ACTIVE' } }),
      );
      await inScope((tx) =>
        tx.deliveryZone.update({ where: { id: zone }, data: { status: 'INACTIVE' } }),
      );
      expect(await ask()).toMatchObject({ reason: 'AREA_NOT_COVERED' });
    });

    it('does not serve another brand from the same areas', async () => {
      const cake = await inScope((tx) =>
        tx.product.create({ data: { brandId: brandB, type: 'SIMPLE', status: 'PUBLISHED' } }),
      );
      await inScope((tx) =>
        tx.productMarket.create({
          data: { brandId: brandB, productId: cake.id, marketId: marketB },
        }),
      );
      const r = await svc.evaluate(
        brandB,
        marketB,
        { areaId: x1, lines: lines({ productId: cake.id }), days: 3 },
        NOW,
      );
      expect(r).toMatchObject({ deliverable: false, reason: 'AREA_NOT_COVERED' });
    });
  });

  describe('restrictions', () => {
    it('blocks an area or a zone entirely', async () => {
      await restrict({ condition: 'AREA', areaId: x1 });
      expect(await ask()).toMatchObject({ deliverable: false, reason: 'RESTRICTED' });
      expect((await ask({}, NOW, x2)).deliverable).toBe(true);
      await inScope((tx) => tx.deliveryRestriction.deleteMany({}));
      await restrict({ condition: 'AREA', areaId: city });
      expect(await ask()).toMatchObject({ reason: 'RESTRICTED' });
      await inScope((tx) => tx.deliveryRestriction.deleteMany({}));
      await restrict({ condition: 'ZONE', zoneId: zone });
      expect(await ask({}, NOW, x2)).toMatchObject({ reason: 'RESTRICTED' });
    });

    it('blocks dates, weekdays and methods', async () => {
      await restrict({
        condition: 'DATE_RANGE',
        dateFrom: new Date(`${WED}T00:00:00Z`),
        dateTo: new Date(`${THU}T00:00:00Z`),
      });
      await restrict({ condition: 'WEEKDAY', weekday: 5 });
      await restrict({ condition: 'METHOD', methodKind: 'SAME_DAY' });
      const r = await ask();
      for (const d of [TUE, WED, THU, FRI]) expect(days(r)).not.toContain(d);
      expect(days(r)[0]).toBe('2026-12-05');
    });

    it('a blocked method falls back to another the slot allows', async () => {
      await restrict({ condition: 'METHOD', methodKind: 'NEXT_DAY' });
      expect(on(await ask(), WED).map((s) => s.method.kind)).toEqual(['SCHEDULED', 'SCHEDULED']);
    });

    it('applies through category, collection and bundle components, not to other products', async () => {
      const parent = await inScope((tx) => tx.category.create({ data: { brandId: brandA } }));
      const child = await inScope((tx) =>
        tx.category.create({ data: { brandId: brandA, parentId: parent.id } }),
      );
      await inScope((tx) =>
        tx.productCategory.create({
          data: { brandId: brandA, productId: product, categoryId: child.id },
        }),
      );
      await restrict({
        target: 'CATEGORY',
        productId: null,
        categoryId: parent.id,
        condition: 'WEEKDAY',
        weekday: 3,
      });
      expect(days(await ask())).not.toContain(WED);
      await inScope((tx) => tx.deliveryRestriction.deleteMany({}));
      const collection = await inScope((tx) => tx.collection.create({ data: { brandId: brandA } }));
      await inScope((tx) =>
        tx.productCollection.create({
          data: { brandId: brandA, productId: product, collectionId: collection.id },
        }),
      );
      await restrict({
        target: 'COLLECTION',
        productId: null,
        collectionId: collection.id,
        condition: 'WEEKDAY',
        weekday: 3,
      });
      expect(days(await ask())).not.toContain(WED);
      const other = await newProduct();
      await stockFor(other, 5);
      expect(days(await ask({ lines: lines({ productId: other }) }))).toContain(WED);
      const bundle = await newProduct({ type: 'BUNDLE' });
      await inScope((tx) =>
        tx.bundleItem.create({
          data: { brandId: brandA, bundleProductId: bundle, componentProductId: product },
        }),
      );
      expect(days(await ask({ lines: lines({ productId: bundle }) }))).not.toContain(WED);
    });

    it('ignores inactive restrictions', async () => {
      await restrict({ condition: 'AREA', areaId: x1, status: 'INACTIVE' });
      expect((await ask()).deliverable).toBe(true);
    });
  });

  describe('stock at the branches', () => {
    it('needs enough free stock at a branch', async () => {
      expect((await ask({ lines: lines({ quantity: 10 }) })).deliverable).toBe(true);
      expect(await ask({ lines: lines({ quantity: 11 }) })).toMatchObject({
        reason: 'NO_BRANCH_CAN_SERVE',
      });
      await inScope((tx) => tx.stockLevel.updateMany({ data: { reserved: 6 } }));
      expect(await ask({ lines: lines({ quantity: 5 }) })).toMatchObject({
        reason: 'NO_BRANCH_CAN_SERVE',
      });
      expect((await ask({ lines: lines({ quantity: 4 }) })).deliverable).toBe(true);
    });

    it('treats a missing stock row as no stock, unless the product is made to order', async () => {
      const bare = await newProduct();
      expect(await ask({ lines: lines({ productId: bare }) })).toMatchObject({
        reason: 'NO_BRANCH_CAN_SERVE',
      });
      const cake = await newProduct({ madeToOrder: true });
      expect((await ask({ lines: lines({ productId: cake }) })).deliverable).toBe(true);
    });

    it('allows backorder rows and the brand backorder default', async () => {
      const back = await newProduct();
      await stockFor(back, 0, kitchen, { outOfStock: 'ALLOW_BACKORDER' });
      expect((await ask({ lines: lines({ productId: back, quantity: 3 }) })).deliverable).toBe(
        true,
      );
      const plain = await newProduct();
      await stockFor(plain, 0);
      expect((await ask({ lines: lines({ productId: plain }) })).deliverable).toBe(false);
      await inScope((tx) =>
        tx.inventorySetting.create({
          data: { brandId: brandA, defaultOutOfStock: 'ALLOW_BACKORDER' },
        }),
      );
      expect((await ask({ lines: lines({ productId: plain }) })).deliverable).toBe(true);
    });

    it('checks variations and bundle components', async () => {
      const variable = await newProduct({ type: 'VARIABLE' });
      const v = await inScope((tx) =>
        tx.variation.create({
          data: { brandId: brandA, productId: variable, sku: 'V-1', combinationKey: 'k1' },
        }),
      );
      await inScope((tx) =>
        tx.stockLevel.create({
          data: {
            brandId: brandA,
            branchId: kitchen,
            productId: variable,
            variationId: v.id,
            onHand: 2,
          },
        }),
      );
      expect(
        (await ask({ lines: lines({ productId: variable, variationId: v.id, quantity: 2 }) }))
          .deliverable,
      ).toBe(true);
      expect(
        await ask({ lines: lines({ productId: variable, variationId: v.id, quantity: 3 }) }),
      ).toMatchObject({ reason: 'NO_BRANCH_CAN_SERVE' });
      const bundle = await newProduct({ type: 'BUNDLE' });
      await inScope((tx) =>
        tx.bundleItem.create({
          data: {
            brandId: brandA,
            bundleProductId: bundle,
            componentProductId: product,
            quantity: 3,
          },
        }),
      );
      expect((await ask({ lines: lines({ productId: bundle, quantity: 3 }) })).deliverable).toBe(
        true,
      ); // 9 of 10
      expect((await ask({ lines: lines({ productId: bundle, quantity: 4 }) })).deliverable).toBe(
        false,
      ); // 12 of 10
    });

    it('limits a product to the branches it is allowed at', async () => {
      await inScope((tx) =>
        tx.productBranch.create({
          data: { brandId: brandA, productId: product, branchId: kitchen2 },
        }),
      );
      expect(await ask()).toMatchObject({ reason: 'NO_BRANCH_CAN_SERVE' });
    });

    it('falls back to another branch of the zone when the first lacks stock', async () => {
      await inScope(async (tx) => {
        await tx.branchZone.create({
          data: { brandId: brandA, branchId: kitchen2, zoneId: zone, priority: 1 },
        });
        for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
          await tx.branchHours.create({
            data: {
              brandId: brandA,
              branchId: kitchen2,
              weekday,
              startTime: at('08:00'),
              endTime: at('20:00'),
            },
          });
        }
        await tx.deliverySlot.create({
          data: {
            brandId: brandA,
            marketId: marketA,
            branchId: kitchen2,
            weekday: 3,
            startTime: at('10:00'),
            endTime: at('12:00'),
            cutoffTime: at('08:00'),
            capacity: 1,
            methods: ['NEXT_DAY'],
          },
        });
      });
      await inScope((tx) => tx.stockLevel.updateMany({ data: { onHand: 0 } }));
      await stockFor(product, 5, kitchen2);
      const r = await ask();
      expect(r.branchIds).toEqual([kitchen2]);
      expect(on(r, WED).map((s) => [s.branchId, s.start])).toEqual([[kitchen2, '10:00']]);
      expect(on(r, TUE)).toEqual([]);
    });
  });

  describe('cart validation', () => {
    it('refuses products that are not sold here and bad quantities or variations', async () => {
      const draft = await newProduct({ status: 'DRAFT' });
      const unlisted = await newProduct({}, false);
      const expired = await newProduct({ unpublishAt: new Date('2026-01-01T00:00:00Z') });
      const scheduled = await newProduct({ publishAt: new Date('2027-01-01T00:00:00Z') });
      for (const id of [draft, unlisted, expired, scheduled, NIL]) {
        expect(await code(ask({ lines: lines({ productId: id }) }))).toBe('PRODUCT_NOT_FOUND');
      }
      const limited = await newProduct({ minQuantity: 2, maxQuantity: 4 });
      await stockFor(limited, 50);
      expect(await code(ask({ lines: lines({ productId: limited, quantity: 1 }) }))).toBe(
        'QUANTITY_OUT_OF_RANGE',
      );
      expect(await code(ask({ lines: lines({ productId: limited, quantity: 5 }) }))).toBe(
        'QUANTITY_OUT_OF_RANGE',
      );
      expect(await code(ask({ lines: lines({ productId: limited, quantity: 3 }) }))).toBe('OK');
      const variable = await newProduct({ type: 'VARIABLE' });
      expect(await code(ask({ lines: lines({ productId: variable }) }))).toBe(
        'VARIATION_NOT_FOUND',
      );
      expect(await code(ask({ lines: lines({ productId: product, variationId: NIL }) }))).toBe(
        'VARIATION_NOT_FOUND',
      );
    });

    it('never offers another brand its products', async () => {
      expect(
        await code(svc.evaluate(brandB, marketB, { areaId: x1, lines: lines({}), days: 3 }, NOW)),
      ).toBe('PRODUCT_NOT_FOUND');
    });
  });

  describe('stock flag', () => {
    it('says available, low or unavailable without numbers', async () => {
      const status = async (q: number, productId = product) =>
        (
          await svc.stockStatus(brandA, marketA, { lines: lines({ productId, quantity: q }) }, NOW)
        )[0]!.status;
      expect(await status(1)).toBe('AVAILABLE');
      await inScope((tx) => tx.stockLevel.updateMany({ data: { lowStockThreshold: 5 } }));
      expect(await status(1)).toBe('AVAILABLE'); // 9 left, above the threshold
      expect(await status(6)).toBe('LOW'); // 4 left, at or below the threshold
      expect(await status(11)).toBe('UNAVAILABLE');
      const cake = await newProduct({ madeToOrder: true });
      expect(await status(1, cake)).toBe('AVAILABLE');
      const none = await newProduct();
      expect(await status(1, none)).toBe('UNAVAILABLE');
      const back = await newProduct();
      await stockFor(back, 0, kitchen, { outOfStock: 'ALLOW_BACKORDER' });
      expect(await status(2, back)).toBe('LOW');
    });
  });

  describe('public routes', () => {
    const post = (path: string, body: object, host = 'alpha.test', query = '') =>
      request(app.getHttpServer())
        .post(`/api/v1/delivery/${path}${query}`)
        .set('Host', host)
        .send(body);

    it('answers from the host: slots, fees, no branch or quantities, never cached', async () => {
      const res = await post('availability', {
        areaId: x1,
        lines: [{ productId: product, quantity: 2 }],
        days: 10,
      });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.deliverable).toBe(true);
      expect(res.body.dates.length).toBeGreaterThan(0);
      const slot = res.body.dates[0].slots[0];
      expect(Object.keys(slot).sort()).toEqual([
        'currencyCode',
        'end',
        'feeMinor',
        'freeOverMinor',
        'method',
        'minimumOrderMinor',
        'slotId',
        'start',
      ]);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(kitchen);
      expect(text).not.toContain('onHand');
    });

    it('uses the market code on brand-wide hosts and refuses missing or foreign ones', async () => {
      const body = { areaId: x1, lines: [{ productId: product, quantity: 1 }], days: 5 };
      expect((await post('availability', body, 'alpha-all.test')).status).toBe(400);
      expect((await post('availability', body, 'alpha-all.test', '?market=ae')).status).toBe(200);
      expect((await post('availability', body, 'alpha-all.test', '?market=zz')).status).toBe(404);
    });

    it('keeps brands apart and rejects bad input', async () => {
      const body = { areaId: x1, lines: [{ productId: product, quantity: 1 }], days: 5 };
      const foreign = await post('availability', body, 'beta.test');
      expect(foreign.status).toBe(404); // brand A's product is not sold by brand B
      expect((await post('availability', body, 'unknown.test')).status).toBe(404);
      expect((await post('availability', { ...body, days: 99 })).status).toBe(400);
      expect((await post('availability', { ...body, lines: [] })).status).toBe(400);
      expect((await post('availability', { ...body, areaId: 'not-a-uuid' })).status).toBe(400);
      expect((await post('availability', { ...body, from: '01/12/2026' })).status).toBe(400);
      // A brand sent by the client is ignored: the host decides.
      const spoofed = await post('availability', { ...body, brandId: brandB });
      expect(spoofed.status).toBe(200);
      expect(spoofed.body.deliverable).toBe(true);
    });

    it('answers "not deliverable" with a reason for an area outside the zones', async () => {
      const res = await post('availability', {
        areaId: outside,
        lines: [{ productId: product, quantity: 1 }],
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deliverable: false, reason: 'AREA_NOT_COVERED', dates: [] });
    });

    it('gives the stock flag only', async () => {
      const res = await post('stock-status', { lines: [{ productId: product, quantity: 1 }] });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        { productId: product, variationId: null, status: 'AVAILABLE' },
      ]);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(
        (await post('stock-status', { lines: [{ productId: product, quantity: 1 }] }, 'beta.test'))
          .status,
      ).toBe(404);
    });

    it('lists the places the market delivers to, named in the language asked', async () => {
      const get = (q = '', host = 'alpha.test') =>
        request(app.getHttpServer()).get(`/api/v1/delivery/areas${q}`).set('Host', host);
      const en = await get();
      expect(en.status).toBe(200);
      const names = Object.fromEntries(
        en.body.items.map((a: { code: string; name: string }) => [a.code, a.name]),
      );
      expect(names['t-x1']).toBe('Alpha Area');
      expect(names['t-city']).toBe('Test City');
      expect(names['t-out']).toBeUndefined();
      const x = en.body.items.find((a: { code: string }) => a.code === 't-x1');
      expect(x).toMatchObject({ level: 'AREA', parentId: city, deliverable: true });
      expect(en.body.items.find((a: { code: string }) => a.code === 't-city').deliverable).toBe(
        false,
      );
      const ar = await get('?language=ar');
      const arNames = Object.fromEntries(
        ar.body.items.map((a: { code: string; name: string }) => [a.code, a.name]),
      );
      expect(arNames['t-x1']).toBe('منطقة ألفا');
      expect(arNames['t-x2']).toBe('Beta Area');
      expect(ar.headers['content-language']).toBe('ar');
      expect((await get('', 'beta.test')).body.items).toEqual([]);
    });
  });
});
