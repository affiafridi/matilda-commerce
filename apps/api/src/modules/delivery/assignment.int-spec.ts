import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool, QueryResultRow } from 'pg';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { seed } from '../../cli/seed';
import { hashToken } from '../../common/security/tokens';
import { loadEnv } from '../../config/env';
import { withScope } from '../../database/scope';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import { AssignmentService } from './assignment.service';
import { addDays, localNow } from '../availability/local-time';

/**
 * Branch assignment rules, ranking, manual override and the availability tester (Phase 4 step 4.11).
 */

const ORIGIN = 'http://localhost:3001';
const NIL = '00000000-0000-4000-8000-000000000001';
const platformScope = { brandIds: [], platform: true } as const;

type Who = 'opsA' | 'viewerA' | 'managerB' | 'nobody';
interface Sess {
  token: string;
  csrf: string;
}

describe('branch assignment', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let marketB = '';
  let branchA = '';
  let branchA2 = '';
  let branchA3 = '';
  let sess: Record<Who, Sess>;
  let counter = 0;

  async function session(
    label: string,
    perms: string[],
    brandId: string | null,
    branchId: string | null = null,
  ): Promise<Sess> {
    const staff = await db.staffUser.create({
      data: {
        email: `${label}-${++counter}@example.test`,
        fullName: label,
        status: 'ACTIVE',
        passwordHash: 'fixture-no-login',
        mfaEnrolledAt: new Date(),
      },
    });
    if (perms.length) {
      const role = await db.role.create({
        data: {
          name: `${label} ${++counter}`,
          kind: 'CUSTOM',
          permissions: { create: perms.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await db.staffRoleAssignment.create({
        data: { staffUserId: staff.id, roleId: role.id, brandId, branchId },
      });
    }
    const token = randomBytes(24).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    await db.staffSession.create({
      data: {
        staffUserId: staff.id,
        tokenHash: hashToken(token),
        csrfHash: hashToken(csrf),
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 3_600_000),
        mfaVerifiedAt: new Date(),
        stepUpUntil: new Date(Date.now() + 3_600_000),
      },
    });
    return { token, csrf };
  }

  const call = (who: Who, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) => {
    const s = sess[who];
    return request(app.getHttpServer())
      [method](`/api/v1/admin/brands/${path}`)
      .set('Cookie', `matilda_staff=${s.token}`)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', ORIGIN);
  };

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
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.query(
      'TRUNCATE staff_user, brand, branch, role, auth_attempt, delivery_area CASCADE',
    );
    await resetAuditLog(owner);
    await seed(db, 'reference');
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    const om = await db.country.upsert({
      where: { iso2: 'OM' },
      create: { iso2: 'OM', iso3: 'OMN', name: 'Oman' },
      update: {},
    });
    await withScope(db, platformScope, async (tx) => {
      brandA = (await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } })).id;
      brandB = (await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } })).id;
      const mk = async (brandId: string, code: string, countryId = ae.id) => {
        const m = await tx.market.create({
          data: { brandId, countryId, code, timezone: 'Asia/Dubai', status: 'ACTIVE' },
        });
        await tx.marketCurrency.create({
          data: { marketId: m.id, currencyCode: 'AED', isDefault: true },
        });
        return m.id;
      };
      marketA = await mk(brandA, 'ae');
      await mk(brandA, 'om', om.id);
      marketB = await mk(brandB, 'ae');
      const br = async (code: string, marketId: string) =>
        (
          await tx.branch.create({
            data: {
              code,
              name: code,
              countryId: ae.id,
              timezone: 'Asia/Dubai',
              markets: { create: [{ marketId }] },
            },
          })
        ).id;
      branchA = await br('kitchen-a', marketA);
      branchA2 = await br('kitchen-a2', marketA);
      branchA3 = await br('kitchen-a3', marketA);
      await br('kitchen-b', marketB);
    });
    const ops = ['delivery.view', 'delivery.manage', 'delivery.assign'];
    sess = {
      opsA: await session('opsa', ops, brandA),
      viewerA: await session('viewera', ['delivery.view'], brandA),
      managerB: await session('managerb', ops, brandB),
      nobody: await session('nobody', [], null),
    };
  });

  const NOW = new Date('2026-12-01T06:00:00Z'); // Tuesday 10:00 in Dubai
  const WED = '2026-12-02';
  const at = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
  let svc: AssignmentService;
  let area = '';
  let zone = '';
  let product = '';
  const wedSlot: Record<'a' | 'a2', string> = { a: '', a2: '' };

  const asOwner = async <T extends QueryResultRow>(sql: string, params: unknown[] = []) => {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      return (await client.query<T>(sql, params)).rows;
    } finally {
      client.release();
    }
  };

  beforeAll(() => {
    svc = app.get(AssignmentService);
  });

  beforeEach(async () => {
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    const emirate = await db.deliveryArea.findFirstOrThrow({
      where: { countryId: ae.id, level: 'EMIRATE' },
    });
    area = (
      await db.deliveryArea.create({
        data: { countryId: ae.id, level: 'AREA', code: 't-area', parentId: emirate.id },
      })
    ).id;
    await withScope(db, platformScope, async (tx) => {
      zone = (
        await tx.deliveryZone.create({
          data: { brandId: brandA, marketId: marketA, code: 'zone-a' },
        })
      ).id;
      await tx.deliveryZoneArea.create({
        data: { zoneId: zone, brandId: brandA, marketId: marketA, areaId: area },
      });
      for (const kind of ['NEXT_DAY', 'SCHEDULED'] as const) {
        const method = await tx.deliveryMethod.create({
          data: {
            brandId: brandA,
            marketId: marketA,
            kind,
            code: kind.toLowerCase().replace('_', '-'),
          },
        });
        await tx.zoneCharge.create({
          data: {
            brandId: brandA,
            marketId: marketA,
            zoneId: zone,
            methodId: method.id,
            currencyCode: 'AED',
            feeMinor: 1500,
          },
        });
      }
      product = (
        await tx.product.create({
          data: { brandId: brandA, type: 'SIMPLE', status: 'PUBLISHED', prepTimeMinutes: 60 },
        })
      ).id;
      await tx.productMarket.create({
        data: { brandId: brandA, productId: product, marketId: marketA },
      });
      for (const [key, branchId, priority] of [
        ['a', branchA, 0],
        ['a2', branchA2, 1],
      ] as const) {
        await tx.branchZone.create({ data: { brandId: brandA, branchId, zoneId: zone, priority } });
        for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
          await tx.branchHours.create({
            data: {
              brandId: brandA,
              branchId,
              weekday,
              startTime: at('08:00'),
              endTime: at('20:00'),
            },
          });
          const slot = await tx.deliverySlot.create({
            data: {
              brandId: brandA,
              marketId: marketA,
              branchId,
              weekday,
              startTime: at('14:00'),
              endTime: at('16:00'),
              cutoffTime: at('12:00'),
              capacity: 5,
              methods: ['NEXT_DAY', 'SCHEDULED'],
            },
          });
          if (weekday === 3) wedSlot[key] = slot.id;
        }
        await tx.stockLevel.create({
          data: { brandId: brandA, branchId, productId: product, onHand: 10 },
        });
      }
    });
  });

  const ctx = (over: Record<string, unknown> = {}) => ({
    marketId: marketA,
    areaId: area,
    lines: [{ productId: product, quantity: 1 }],
    date: WED,
    ...over,
  });
  const rules = (kinds: Array<[string, ('ACTIVE' | 'INACTIVE')?]>) =>
    withScope(db, platformScope, async (tx) => {
      await tx.branchAssignmentRule.deleteMany({});
      await tx.branchAssignmentRule.createMany({
        data: kinds.map(([kind, status], position) => ({
          brandId: brandA,
          marketId: marketA,
          kind: kind as never,
          status: status ?? 'ACTIVE',
          position,
        })),
      });
    });
  const code = async (p: Promise<unknown>) =>
    p.then(
      () => 'OK',
      (e: { code?: string }) => e.code ?? 'ERROR',
    );
  const choose = (over: Record<string, unknown> = {}) => svc.choose(brandA, ctx(over), NOW);
  const url = (rest = '') => `${brandA}/delivery${rest}`;
  /** A delivery day well ahead of the real clock, for the HTTP calls (which use the real time). */
  const ahead = () => addDays(localNow(new Date(), 'Asia/Dubai').date, 3);

  describe('rules', () => {
    it('lists nothing at first, replaces the whole list and keeps the order', async () => {
      const empty = await call('viewerA', 'get', url(`/assignment-rules?marketId=${marketA}`));
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ marketId: marketA, rules: [] });
      const put = await call('opsA', 'put', url('/assignment-rules')).send({
        marketId: marketA,
        rules: [
          { kind: 'PRIORITY' },
          { kind: 'LEAST_LOADED', status: 'INACTIVE' },
          { kind: 'CLOSEST' },
        ],
      });
      expect(put.status).toBe(200);
      expect(
        put.body.rules.map(
          (r: { kind: string; position: number; status: string; ranks: boolean }) => [
            r.kind,
            r.position,
            r.status,
            r.ranks,
          ],
        ),
      ).toEqual([
        ['PRIORITY', 0, 'ACTIVE', true],
        ['LEAST_LOADED', 1, 'INACTIVE', true],
        ['CLOSEST', 2, 'ACTIVE', true],
      ]);
      const again = await call('opsA', 'put', url('/assignment-rules')).send({
        marketId: marketA,
        rules: [{ kind: 'HAS_STOCK' }, { kind: 'CLOSEST' }],
      });
      expect(again.body.rules.map((r: { kind: string }) => r.kind)).toEqual([
        'HAS_STOCK',
        'CLOSEST',
      ]);
      expect(again.body.rules[0].ranks).toBe(false);
      const read = await call('viewerA', 'get', url(`/assignment-rules?marketId=${marketA}`));
      expect(read.body.rules.map((r: { kind: string }) => r.kind)).toEqual([
        'HAS_STOCK',
        'CLOSEST',
      ]);
      const audit = await asOwner<{ action: string }>(
        `SELECT action FROM audit_log WHERE action LIKE 'delivery.assignment_rules%' ORDER BY id`,
      );
      expect(audit.map((a) => a.action)).toEqual([
        'delivery.assignment_rules.put',
        'delivery.assignment_rules.put',
      ]);
    });

    it('validates the list and the market', async () => {
      const put = (body: object) => call('opsA', 'put', url('/assignment-rules')).send(body);
      expect(
        (await put({ marketId: marketA, rules: [{ kind: 'CLOSEST' }, { kind: 'CLOSEST' }] }))
          .status,
      ).toBe(400);
      expect((await put({ marketId: marketA, rules: [{ kind: 'RANDOM' }] })).status).toBe(400);
      expect((await put({ marketId: 'x', rules: [] })).status).toBe(400);
      expect((await put({ marketId: NIL, rules: [] })).status).toBe(404);
      expect((await put({ marketId: marketB, rules: [] })).status).toBe(404);
      expect((await call('opsA', 'get', url(`/assignment-rules?marketId=${marketB}`))).status).toBe(
        404,
      );
    });

    it('needs the right permission and stays inside the brand', async () => {
      const body = { marketId: marketA, rules: [{ kind: 'PRIORITY' }] };
      expect((await call('viewerA', 'put', url('/assignment-rules')).send(body)).status).toBe(403);
      expect(
        (await call('nobody', 'get', url(`/assignment-rules?marketId=${marketA}`))).status,
      ).toBe(403);
      expect(
        (await call('managerB', 'get', url(`/assignment-rules?marketId=${marketA}`))).status,
      ).toBe(403);
      expect((await call('managerB', 'put', url('/assignment-rules')).send(body)).status).toBe(403);
      expect(
        (await call('managerB', 'put', `${brandB}/delivery/assignment-rules`).send(body)).status,
      ).toBe(404);
      expect(await asOwner('SELECT 1 FROM branch_assignment_rule')).toHaveLength(0);
    });
  });

  describe('ranking', () => {
    it('uses the serving priority when no rules are set', async () => {
      const r = await choose();
      expect(r.branchId).toBe(branchA);
      expect(r.rules).toEqual(['PRIORITY']);
      expect(r.ranking.map((x) => x.branchId)).toEqual([branchA, branchA2]);
      await withScope(db, platformScope, (tx) =>
        tx.branchZone.update({
          where: { branchId_zoneId: { branchId: branchA, zoneId: zone } },
          data: { priority: 9 },
        }),
      );
      expect((await choose()).branchId).toBe(branchA2);
    });

    it('prefers the branch with fewer places taken that day', async () => {
      await rules([['LEAST_LOADED']]);
      await withScope(db, platformScope, (tx) =>
        tx.slotDay.create({
          data: {
            brandId: brandA,
            slotId: wedSlot.a,
            deliveryDate: new Date(`${WED}T00:00:00Z`),
            booked: 3,
          },
        }),
      );
      const r = await choose();
      expect(r.branchId).toBe(branchA2);
      expect(r.ranking.map((x) => [x.branchId, x.loadBooked])).toEqual([
        [branchA2, 0],
        [branchA, 3],
      ]);
    });

    it('prefers the closest branch to the customer, and ignores the rule without coordinates', async () => {
      await withScope(db, platformScope, async (tx) => {
        await tx.branch.update({
          where: { id: branchA },
          data: { latitude: 25.2, longitude: 55.27 },
        });
        await tx.branch.update({
          where: { id: branchA2 },
          data: { latitude: 25.08, longitude: 55.14 },
        });
      });
      await rules([['CLOSEST']]);
      const near = await choose({ location: { latitude: 25.07, longitude: 55.13 } });
      expect(near.branchId).toBe(branchA2);
      expect(near.ranking[0]!.distanceMeters).toBeLessThan(near.ranking[1]!.distanceMeters!);
      const far = await choose({ location: { latitude: 25.21, longitude: 55.28 } });
      expect(far.branchId).toBe(branchA);
      const unknown = await choose();
      expect(unknown.ranking.every((x) => x.distanceMeters === null)).toBe(true);
      expect(unknown.branchId).toBe([branchA, branchA2].sort()[0]);
    });

    it('applies the rules in order and skips inactive ones and the always-on kinds', async () => {
      await withScope(db, platformScope, async (tx) => {
        await tx.branch.updateMany({
          where: { id: { in: [branchA, branchA2] } },
          data: { latitude: 25.1, longitude: 55.2 },
        });
        await tx.slotDay.create({
          data: {
            brandId: brandA,
            slotId: wedSlot.a,
            deliveryDate: new Date(`${WED}T00:00:00Z`),
            booked: 1,
          },
        });
      });
      await rules([['HAS_STOCK'], ['CLOSEST'], ['LEAST_LOADED', 'INACTIVE'], ['PRIORITY']]);
      const r = await choose({ location: { latitude: 25.1, longitude: 55.2 } });
      expect(r.rules).toEqual(['CLOSEST', 'PRIORITY']);
      expect(r.branchId).toBe(branchA); // tie on distance, priority decides (load is inactive)
      await rules([['LEAST_LOADED'], ['PRIORITY']]);
      expect((await choose()).branchId).toBe(branchA2); // load decides first
    });
  });

  describe('eligibility', () => {
    it('never picks a branch that cannot deliver, whatever the rules prefer', async () => {
      await withScope(db, platformScope, (tx) =>
        tx.stockLevel.updateMany({ where: { branchId: branchA }, data: { onHand: 0 } }),
      );
      const r = await choose();
      expect(r.branchId).toBe(branchA2);
      expect(r.ranking.map((x) => x.branchId)).toEqual([branchA2]);
    });

    it('follows the slot the shopper holds', async () => {
      await rules([['LEAST_LOADED']]);
      await withScope(db, platformScope, (tx) =>
        tx.slotDay.create({
          data: {
            brandId: brandA,
            slotId: wedSlot.a,
            deliveryDate: new Date(`${WED}T00:00:00Z`),
            booked: 4,
          },
        }),
      );
      expect((await choose()).branchId).toBe(branchA2);
      expect((await choose({ slotId: wedSlot.a })).branchId).toBe(branchA);
      expect(await code(choose({ slotId: NIL }))).toBe('SLOT_UNAVAILABLE');
    });

    it('refuses when nobody can deliver, with the reason', async () => {
      await withScope(db, platformScope, (tx) => tx.stockLevel.updateMany({ data: { onHand: 0 } }));
      expect(await code(choose())).toBe('NO_ELIGIBLE_BRANCH');
      await withScope(db, platformScope, (tx) =>
        tx.deliveryClosure.create({
          data: { brandId: brandA, closedOn: new Date(`${WED}T00:00:00Z`) },
        }),
      );
      await withScope(db, platformScope, (tx) =>
        tx.stockLevel.updateMany({ data: { onHand: 10 } }),
      );
      const err = await choose().catch((e: { message: string }) => e.message);
      expect(err).toContain('NO_SLOTS');
    });
  });

  describe('staff routes', () => {
    const body = (over: Record<string, unknown> = {}) => ctx({ date: ahead(), ...over });

    it('previews the choice, the ranking and whether a branch picked by hand is allowed', async () => {
      const res = await call('viewerA', 'post', url('/assignment/preview')).send(
        body({ branchId: branchA2 }),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        chosenBranchId: branchA,
        reason: null,
        rules: ['PRIORITY'],
        check: { branchId: branchA2, eligible: true },
      });
      expect(res.body.ranking).toHaveLength(2);
      await withScope(db, platformScope, (tx) =>
        tx.stockLevel.updateMany({ where: { branchId: branchA2 }, data: { onHand: 0 } }),
      );
      const blocked = await call('viewerA', 'post', url('/assignment/preview')).send(
        body({ branchId: branchA2 }),
      );
      expect(blocked.body.check.eligible).toBe(false);
      expect(blocked.body.chosenBranchId).toBe(branchA);
      await withScope(db, platformScope, (tx) => tx.stockLevel.updateMany({ data: { onHand: 0 } }));
      const none = await call('viewerA', 'post', url('/assignment/preview')).send(body());
      expect(none.status).toBe(200);
      expect(none.body).toMatchObject({ chosenBranchId: null, ranking: [] });
      expect(none.body.reason).toBeTruthy();
    });

    it('accepts a manual choice only from eligible branches, and audits it', async () => {
      const ok = await call('opsA', 'post', url('/assignment/override')).send(
        body({ branchId: branchA2, reference: 'ORD-1', reason: 'Closer to the customer' }),
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ branchId: branchA2, automaticBranchId: branchA, changed: true });
      const same = await call('opsA', 'post', url('/assignment/override')).send(
        body({ branchId: branchA, reason: 'Confirmed by phone' }),
      );
      expect(same.body.changed).toBe(false);
      const audit = await asOwner<{
        action: string;
        after: { reason: string; reference: string | null };
      }>(
        `SELECT action, after FROM audit_log WHERE action = 'delivery.assignment.override' ORDER BY id`,
      );
      expect(audit).toHaveLength(2);
      expect(audit[0]!.after).toMatchObject({
        reason: 'Closer to the customer',
        reference: 'ORD-1',
      });
      await withScope(db, platformScope, (tx) =>
        tx.stockLevel.updateMany({ where: { branchId: branchA2 }, data: { onHand: 0 } }),
      );
      const no = await call('opsA', 'post', url('/assignment/override')).send(
        body({ branchId: branchA2, reason: 'Try anyway' }),
      );
      expect(no.status).toBe(422);
      expect(no.body.code).toBe('BRANCH_NOT_ELIGIBLE');
      expect(no.body.message).toContain('NOT_AMONG_ELIGIBLE_BRANCHES');
      expect(
        await asOwner(`SELECT 1 FROM audit_log WHERE action = 'delivery.assignment.override'`),
      ).toHaveLength(2);
      const outsider = await call('opsA', 'post', url('/assignment/override')).send(
        body({ branchId: branchA3, reason: 'Not serving' }),
      );
      expect(outsider.status).toBe(422);
    });

    it('needs a reason and the assign permission', async () => {
      expect(
        (await call('opsA', 'post', url('/assignment/override')).send(body({ branchId: branchA })))
          .status,
      ).toBe(400);
      expect(
        (
          await call('opsA', 'post', url('/assignment/override')).send(
            body({ branchId: branchA, reason: 'x' }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await call('viewerA', 'post', url('/assignment/override')).send(
            body({ branchId: branchA, reason: 'Because' }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await call('nobody', 'post', url('/assignment/override')).send(
            body({ branchId: branchA, reason: 'Because' }),
          )
        ).status,
      ).toBe(403);
    });

    it('tests availability with the serving branches visible', async () => {
      const res = await call('viewerA', 'post', url('/availability-test')).send({
        marketId: marketA,
        areaId: area,
        lines: [{ productId: product, quantity: 1 }],
        days: 7,
      });
      expect(res.status).toBe(200);
      expect(res.body.deliverable).toBe(true);
      expect(res.body.branchIds.sort()).toEqual([branchA, branchA2].sort());
      const first = res.body.dates[0].slots[0];
      expect([branchA, branchA2]).toContain(first.branchId);
      expect(first).toMatchObject({
        method: { kind: expect.any(String) },
        feeMinor: expect.any(Number),
      });
      expect(
        (
          await call('nobody', 'post', url('/availability-test')).send({
            marketId: marketA,
            areaId: area,
            lines: [{ productId: product, quantity: 1 }],
          })
        ).status,
      ).toBe(403);
    });

    it('stays inside the brand and refuses anonymous callers', async () => {
      for (const path of ['/assignment/preview', '/assignment/override', '/availability-test']) {
        const res = await call('managerB', 'post', url(path)).send(
          body({ branchId: branchA, reason: 'Because' }),
        );
        expect(res.status).toBe(403);
      }
      const foreign = await call('managerB', 'post', `${brandB}/delivery/assignment/preview`).send(
        body(),
      );
      expect([404, 422, 200]).toContain(foreign.status);
      if (foreign.status === 200) expect(foreign.body.chosenBranchId).toBeNull();
      for (const [method, path] of [
        ['get', url(`/assignment-rules?marketId=${marketA}`)],
        ['put', url('/assignment-rules')],
        ['post', url('/availability-test')],
        ['post', url('/assignment/preview')],
        ['post', url('/assignment/override')],
      ] as const) {
        const anon = await request(app.getHttpServer())
          [method](`/api/v1/admin/brands/${path}`)
          .set('Origin', ORIGIN);
        expect([401, 403]).toContain(anon.status);
      }
    });
  });
});
