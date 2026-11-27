import { randomBytes } from 'node:crypto';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { seed } from '../../cli/seed';
import { hashToken } from '../../common/security/tokens';
import { loadEnv } from '../../config/env';
import { withScope } from '../../database/scope';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import { PERMISSION_METADATA, PUBLIC_METADATA } from '../iam/authorization/decorators';

/**
 * Locations and zones API (Phase 4 step 4.3): rules, permissions, brand isolation, audit, and
 * route coverage of every delivery route found in the live route table.
 */

const ORIGIN = 'http://localhost:3001';
const NIL = '00000000-0000-4000-8000-000000000001';
const platformScope = { brandIds: [], platform: true } as const;

type Who = 'platform' | 'managerA' | 'viewerA' | 'managerB' | 'nobody';
interface Sess {
  token: string;
  csrf: string;
}

describe('delivery locations and zones', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let marketB = '';
  let branchA = '';
  let branchB = '';
  let sess: Record<Who, Sess>;
  let counter = 0;

  async function session(label: string, perms: string[], brandId: string | null): Promise<Sess> {
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
        data: { staffUserId: staff.id, roleId: role.id, brandId },
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
      [method](`/api/v1/${path}`)
      .set('Cookie', `matilda_staff=${s.token}`)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', ORIGIN);
  };

  async function auditActions(targetId: string): Promise<string[]> {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      const res = await client.query<{ action: string }>(
        'SELECT action FROM audit_log WHERE target_id = $1 ORDER BY id',
        [targetId],
      );
      return res.rows.map((r) => r.action);
    } finally {
      client.release();
    }
  }

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
    await db.country.upsert({
      where: { iso2: 'OM' },
      create: { iso2: 'OM', iso3: 'OMN', name: 'Oman' },
      update: {},
    });
    await withScope(db, platformScope, async (tx) => {
      brandA = (await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } })).id;
      brandB = (await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } })).id;
      const mk = (brandId: string) =>
        tx.market.create({
          data: { brandId, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
        });
      marketA = (await mk(brandA)).id;
      marketB = (await mk(brandB)).id;
      const br = (code: string, marketId: string) =>
        tx.branch.create({
          data: {
            code,
            name: code,
            countryId: ae.id,
            timezone: 'Asia/Dubai',
            markets: { create: [{ marketId }] },
          },
        });
      branchA = (await br('kitchen-a', marketA)).id;
      branchB = (await br('kitchen-b', marketB)).id;
    });
    sess = {
      platform: await session('platform', ['delivery.view', 'delivery.manage'], null),
      managerA: await session('managera', ['delivery.view', 'delivery.manage'], brandA),
      viewerA: await session('viewera', ['delivery.view'], brandA),
      managerB: await session('managerb', ['delivery.view', 'delivery.manage'], brandB),
      nobody: await session('nobody', [], null),
    };
  });

  const area = (body: Record<string, unknown>, who: Who = 'platform') =>
    call(who, 'post', 'admin/delivery/areas').send({
      countryIso2: 'AE',
      translations: [{ language: 'en', name: 'Name' }],
      ...body,
    });

  const emirate = async (code = 'test-emirate') =>
    (await area({ level: 'EMIRATE', code })).body as { id: string };

  describe('locations', () => {
    it('lists the seeded emirates for anyone who can view delivery', async () => {
      const res = await call('viewerA', 'get', 'admin/delivery/areas?countryIso2=AE&level=EMIRATE');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(7);
      expect(res.body[0].translations.map((t: { language: string }) => t.language)).toContain('en');
    });

    it('builds the tree and enforces its rules', async () => {
      const dubai = await emirate();
      expect(dubai.id).toBeDefined();
      const city = await area({ level: 'CITY', code: 'dubai-city', parentId: dubai.id });
      expect(city.status).toBe(201);
      const marina = await area({ level: 'AREA', code: 'marina', parentId: city.body.id });
      expect(marina.status).toBe(201);
      const topArea = await area({ level: 'AREA', code: 'orphan' });
      expect(topArea.status).toBe(422);
      expect(topArea.body.code).toBe('AREA_TREE_INVALID');
      const cityOfCity = await area({ level: 'CITY', code: 'nested', parentId: city.body.id });
      expect(cityOfCity.body.code).toBe('AREA_TREE_INVALID');
      expect((await area({ level: 'EMIRATE', code: 'test-emirate' })).body.code).toBe(
        'AREA_CODE_TAKEN',
      );
      expect((await area({ level: 'CITY', code: 'x', parentId: NIL })).body.code).toBe(
        'PARENT_NOT_FOUND',
      );
    });

    it('requires an English name and manages translations', async () => {
      const noEnglish = await area({
        level: 'EMIRATE',
        code: 'fujairah-2',
        translations: [{ language: 'ar', name: 'الفجيرة' }],
      });
      expect(noEnglish.status).toBe(422);
      expect(noEnglish.body.code).toBe('ENGLISH_REQUIRED');
      const dubai = await emirate();
      const put = await call(
        'platform',
        'put',
        `admin/delivery/areas/${dubai.id}/translations/ar`,
      ).send({
        name: 'دبي',
      });
      expect(put.status).toBe(200);
      expect(put.body.translations).toHaveLength(2);
      expect(
        (await call('platform', 'delete', `admin/delivery/areas/${dubai.id}/translations/en`))
          .status,
      ).toBe(422);
      const del = await call(
        'platform',
        'delete',
        `admin/delivery/areas/${dubai.id}/translations/ar`,
      );
      expect(del.body.translations).toHaveLength(1);
    });

    it('updates a location and records audit rows', async () => {
      const dubai = await emirate();
      const res = await call('platform', 'patch', `admin/delivery/areas/${dubai.id}`).send({
        status: 'INACTIVE',
      });
      expect(res.body.status).toBe('INACTIVE');
      expect(await auditActions(dubai.id)).toEqual([
        'delivery.area.create',
        'delivery.area.update',
      ]);
    });

    it('refuses deleting a location in use and deletes a leaf', async () => {
      const dubai = await emirate();
      const city = await area({ level: 'CITY', code: 'c1', parentId: dubai.id });
      const blocked = await call('platform', 'delete', `admin/delivery/areas/${dubai.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('AREA_IN_USE');
      expect(
        (await call('platform', 'delete', `admin/delivery/areas/${city.body.id}`)).status,
      ).toBe(204);
      expect((await call('platform', 'delete', `admin/delivery/areas/${dubai.id}`)).status).toBe(
        204,
      );
    });

    it('lets brand staff read but never change locations', async () => {
      for (const who of ['managerA', 'viewerA', 'nobody'] as const) {
        expect((await area({ level: 'EMIRATE', code: `x-${who.toLowerCase()}` }, who)).status).toBe(
          403,
        );
      }
      expect((await call('nobody', 'get', 'admin/delivery/areas')).status).toBe(403);
      expect((await call('managerA', 'get', 'admin/delivery/areas')).status).toBe(200);
    });
  });

  describe('zones', () => {
    const base = () => `admin/brands/${brandA}/delivery/zones`;
    const zone = (body: Record<string, unknown> = {}, who: Who = 'managerA', brand = brandA) =>
      call(who, 'post', `admin/brands/${brand}/delivery/zones`).send({
        marketId: brand === brandA ? marketA : marketB,
        code: 'central',
        translations: [{ language: 'en', name: 'Central' }],
        ...body,
      });

    it('creates, reads, updates and deletes a zone with audit', async () => {
      const created = await zone();
      expect(created.body).not.toHaveProperty('statusCode');
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ code: 'central', areaIds: [], branches: [] });
      const id = created.body.id as string;
      expect((await call('viewerA', 'get', `${base()}/${id}`)).status).toBe(200);
      expect((await call('viewerA', 'get', `${base()}?marketId=${marketA}`)).body).toHaveLength(1);
      const patched = await call('managerA', 'patch', `${base()}/${id}`).send({
        status: 'INACTIVE',
      });
      expect(patched.body.status).toBe('INACTIVE');
      expect((await call('managerA', 'delete', `${base()}/${id}`)).status).toBe(204);
      expect((await call('managerA', 'get', `${base()}/${id}`)).status).toBe(404);
      expect(await auditActions(id)).toEqual([
        'delivery.zone.create',
        'delivery.zone.update',
        'delivery.zone.delete',
      ]);
    });

    it('validates input and rejects duplicates and foreign markets', async () => {
      expect((await zone({ translations: [{ language: 'ar', name: 'x' }] })).body.code).toBe(
        'ENGLISH_REQUIRED',
      );
      expect((await zone({ code: 'Bad Code' })).status).toBe(400);
      expect((await zone({ marketId: marketB })).status).toBe(404);
      expect((await zone()).status).toBe(201);
      const dup = await zone();
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('ZONE_CODE_TAKEN');
    });

    it('keeps zones apart between brands', async () => {
      const mine = await zone();
      await zone({ code: 'north' }, 'managerB', brandB);
      expect((await call('managerA', 'get', base())).body).toHaveLength(1);
      expect((await call('managerB', 'get', `${base()}/${mine.body.id}`)).status).toBe(403);
      expect(
        (await call('managerB', 'patch', `${base()}/${mine.body.id}`).send({ sortOrder: 1 }))
          .status,
      ).toBe(403);
      // Brand B's own path with brand A's zone id finds nothing: row-level security hides it.
      const viaB = await call(
        'managerB',
        'get',
        `admin/brands/${brandB}/delivery/zones/${mine.body.id}`,
      );
      expect(viaB.status).toBe(404);
    });

    it('needs delivery.manage to write and delivery.view to read', async () => {
      expect((await zone({}, 'viewerA')).status).toBe(403);
      expect((await zone({}, 'nobody')).status).toBe(403);
      expect((await call('nobody', 'get', base())).status).toBe(403);
    });

    it('manages translations and keeps English', async () => {
      const id = (await zone()).body.id as string;
      const put = await call('managerA', 'put', `${base()}/${id}/translations/ar`).send({
        name: 'وسط',
      });
      expect(put.body.translations).toHaveLength(2);
      expect((await call('managerA', 'delete', `${base()}/${id}/translations/en`)).status).toBe(
        422,
      );
      expect((await call('managerA', 'delete', `${base()}/${id}/translations/ar`)).status).toBe(
        200,
      );
    });

    it('covers locations once per market and only in the market country', async () => {
      const dubai = await emirate('test-emirate');
      const sharjah = await emirate('sharjah-x');
      const z1 = (await zone({ code: 'one' })).body.id as string;
      const z2 = (await zone({ code: 'two' })).body.id as string;
      const put = (id: string, areaIds: string[]) =>
        call('managerA', 'put', `${base()}/${id}/areas`).send({ areaIds });
      const ok = await put(z1, [dubai.id, sharjah.id]);
      expect(ok.status).toBe(200);
      expect(ok.body.areaIds).toHaveLength(2);
      const clash = await put(z2, [sharjah.id]);
      expect(clash.status).toBe(409);
      expect(clash.body.code).toBe('AREA_ALREADY_COVERED');
      expect((await put(z1, [dubai.id])).body.areaIds).toEqual([dubai.id]);
      expect((await put(z2, [sharjah.id])).status).toBe(200);
      expect((await put(z2, [NIL])).body.code).toBe('AREA_NOT_FOUND');
      const muscat = (await area({ countryIso2: 'OM', level: 'EMIRATE', code: 'muscat' })).body.id;
      expect((await put(z2, [muscat])).body.code).toBe('AREA_COUNTRY_MISMATCH');
    });

    it('assigns serving branches of the market and refuses others', async () => {
      const id = (await zone()).body.id as string;
      const put = (branches: unknown[]) =>
        call('managerA', 'put', `${base()}/${id}/branches`).send({ branches });
      const ok = await put([{ branchId: branchA, priority: 2 }]);
      expect(ok.status).toBe(200);
      expect(ok.body.branches).toEqual([{ branchId: branchA, priority: 2 }]);
      const foreign = await put([{ branchId: branchB }]);
      expect(foreign.status).toBe(422);
      expect(foreign.body.code).toBe('BRANCH_NOT_FOUND');
      expect((await put([{ branchId: NIL }])).body.code).toBe('BRANCH_NOT_FOUND');
      expect((await put([{ branchId: branchA }, { branchId: branchA }])).body.code).toBe(
        'DUPLICATE_BRANCH',
      );
      expect((await put([])).body.branches).toEqual([]);
    });

    it('refuses deleting a zone or a location that a restriction uses', async () => {
      const dubai = await emirate();
      const id = (await zone()).body.id as string;
      const category = await withScope(db, platformScope, (tx) =>
        tx.category.create({ data: { brandId: brandA } }),
      );
      const insert = (condition: string, column: string, value: string) =>
        withScope(db, platformScope, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO delivery_restriction (id, brand_id, market_id, target, category_id, condition, ${column})
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'CATEGORY', $3::uuid, '${condition}', $4::uuid)`,
            brandA,
            marketA,
            category.id,
            value,
          ),
        );
      await insert('ZONE', 'zone_id', id);
      await insert('AREA', 'area_id', dubai.id);
      const res = await call('managerA', 'delete', `${base()}/${id}`);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ZONE_IN_USE');
      const loc = await call('platform', 'delete', `admin/delivery/areas/${dubai.id}`);
      expect(loc.status).toBe(409);
      expect(loc.body.code).toBe('AREA_IN_USE');
    });
  });

  describe('route coverage', () => {
    it('every delivery route requires a permission, none is public', () => {
      const methods: Record<number, string> = {
        [RequestMethod.GET]: 'GET',
        [RequestMethod.POST]: 'POST',
        [RequestMethod.PUT]: 'PUT',
        [RequestMethod.PATCH]: 'PATCH',
        [RequestMethod.DELETE]: 'DELETE',
      };
      const bad: string[] = [];
      let found = 0;
      for (const wrapper of app.get(DiscoveryService).getControllers()) {
        const cls = wrapper.metatype as (new (...a: never[]) => object) | null;
        const base = cls ? (Reflect.getMetadata('path', cls) as string | undefined) : undefined;
        if (
          !cls ||
          typeof base !== 'string' ||
          !base.startsWith('admin/') ||
          !base.includes('delivery')
        )
          continue;
        const proto = cls.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(proto)) {
          const fn = proto[name];
          if (typeof fn !== 'function' || name === 'constructor') continue;
          const method = Reflect.getMetadata('method', fn) as number | undefined;
          if (method === undefined) continue;
          found++;
          const meta = (k: string) =>
            (Reflect.getMetadata(k, fn) ?? Reflect.getMetadata(k, cls)) as unknown;
          if (!meta(PERMISSION_METADATA) || meta(PUBLIC_METADATA) === true) {
            bad.push(`${methods[method]} ${base} (${cls.name}.${name})`);
          }
        }
      }
      expect(found).toBeGreaterThanOrEqual(16);
      expect(bad).toEqual([]);
    });

    it('refuses every delivery route without a session or a role', async () => {
      const probes: Array<['get' | 'post' | 'put' | 'patch' | 'delete', string]> = [
        ['get', 'admin/delivery/areas'],
        ['post', 'admin/delivery/areas'],
        ['patch', `admin/delivery/areas/${NIL}`],
        ['put', `admin/delivery/areas/${NIL}/translations/ar`],
        ['delete', `admin/delivery/areas/${NIL}`],
        ['get', `admin/brands/${brandA}/delivery/zones`],
        ['post', `admin/brands/${brandA}/delivery/zones`],
        ['patch', `admin/brands/${brandA}/delivery/zones/${NIL}`],
        ['put', `admin/brands/${brandA}/delivery/zones/${NIL}/areas`],
        ['put', `admin/brands/${brandA}/delivery/zones/${NIL}/branches`],
        ['delete', `admin/brands/${brandA}/delivery/zones/${NIL}`],
      ];
      for (const [method, path] of probes) {
        const anon = await request(app.getHttpServer())
          [method](`/api/v1/${path}`)
          .set('Origin', ORIGIN);
        expect([401, 403]).toContain(anon.status);
        const nobody = await call('nobody', method, path).send({});
        expect(nobody.status).toBe(403);
        if (path.includes('/brands/')) {
          const other = await call('managerB', method, path).send({});
          // A body-less write fails validation before scope is checked; either way nothing changes.
          expect(method === 'get' ? [403] : [400, 403]).toContain(other.status);
        }
      }
    });
  });
});
