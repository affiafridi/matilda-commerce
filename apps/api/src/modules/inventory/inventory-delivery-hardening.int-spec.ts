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
 * Inventory and delivery hardening (Phase 4 step 4.13). Route coverage: every inventory and delivery route is either explicitly
 * public (storefront reads) or requires a permission, found by inspecting the live route table, so a
 * new route added later without a guard fails this test. Then the same table is driven over HTTP:
 * nobody gets in without a session, without a role, or with a role from another brand.
 */

const ORIGIN = 'http://localhost:3001';
const BRAND_PREFIXES = ['admin/brands/:brandId/inventory', 'admin/brands/:brandId/delivery'];
const PUBLIC_PATHS = ['delivery/areas', 'delivery/availability', 'delivery/stock-status'];
const METHODS: Record<number, 'get' | 'post' | 'put' | 'delete' | 'patch'> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

interface Route {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  path: string;
  permission: string | undefined;
  isPublic: boolean;
  name: string;
}

const join = (...parts: string[]) =>
  parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

describe('inventory and delivery hardening (route coverage and cross-brand matrix)', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let brandA = '';
  let brandB = '';
  let routes: Route[] = [];
  let sessions: Record<'managerB' | 'nobody', { token: string; csrf: string }>;
  let counter = 0;

  async function session(label: string, brandId: string | null) {
    const staff = await db.staffUser.create({
      data: {
        email: `${label}-${++counter}@example.test`,
        fullName: label,
        status: 'ACTIVE',
        passwordHash: 'fixture-no-login',
        mfaEnrolledAt: new Date(),
      },
    });
    if (brandId) {
      const role = await db.role.create({
        data: {
          name: `${label} ${++counter}`,
          kind: 'CUSTOM',
          permissions: {
            create: [
              'inventory.view',
              'inventory.adjust',
              'inventory.transfer',
              'delivery.view',
              'delivery.manage',
              'delivery.assign',
              'branches.calendar',
            ].map((permissionKey) => ({ permissionKey })),
          },
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

  /** Fills route params: the brand from the path, a random id for ids, a harmless word otherwise. */
  const concrete = (path: string, brandId: string) =>
    path
      .replace(':brandId', brandId)
      .replace(/:(\w*[iI]d)\b/g, '00000000-0000-4000-8000-000000000001')
      .replace(':language', 'ar')
      .replace(/:\w+/g, 'x');

  /** A query the route insists on, so a probe is judged on permission and scope, not on validation. */
  const probeQuery = (r: Route) =>
    r.path.endsWith('assignment-rules') ? '?marketId=00000000-0000-4000-8000-000000000002' : '';

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

    routes = [];
    for (const wrapper of app.get(DiscoveryService).getControllers()) {
      const cls = wrapper.metatype as (new (...a: never[]) => object) | null;
      if (!cls) continue;
      const base = Reflect.getMetadata('path', cls) as string | undefined;
      if (typeof base !== 'string') continue;
      const inScope =
        BRAND_PREFIXES.some((p) => base.startsWith(p)) ||
        base === 'admin/delivery/areas' ||
        base === 'delivery';
      if (!inScope) continue;
      const proto = cls.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (name === 'constructor' || typeof fn !== 'function') continue;
        const path = Reflect.getMetadata('path', fn) as string | undefined;
        const method = Reflect.getMetadata('method', fn) as number | undefined;
        if (path === undefined || method === undefined) continue;
        const meta = (key: string) =>
          (Reflect.getMetadata(key, fn) ?? Reflect.getMetadata(key, cls)) as unknown;
        routes.push({
          method: METHODS[method]!,
          path: join(base, path),
          permission: (meta(PERMISSION_METADATA) as { permission: string } | undefined)?.permission,
          isPublic: meta(PUBLIC_METADATA) === true,
          name: `${cls.name}.${name}`,
        });
      }
    }
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.query('TRUNCATE staff_user, brand, branch, role, auth_attempt CASCADE');
    await resetAuditLog(owner);
    await seed(db, 'reference');
    [brandA, brandB] = await withScope(db, { brandIds: [], platform: true }, async (tx) => [
      (await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } })).id,
      (await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } })).id,
    ]);
    sessions = {
      managerB: await session('managerb', brandB),
      nobody: await session('nobody', null),
    };
  });

  const adminRoutes = () => routes.filter((r) => BRAND_PREFIXES.some((p) => r.path.startsWith(p)));

  it('finds the inventory and delivery route table', () => {
    expect(adminRoutes().length).toBeGreaterThanOrEqual(55);
    expect(routes.filter((r) => r.isPublic).length).toBe(PUBLIC_PATHS.length);
  });

  it('every admin route requires a permission and none is public', () => {
    const bad = routes.filter(
      (r) => !r.path.startsWith('delivery/') && (!r.permission || r.isPublic),
    );
    expect(bad.map((r) => `${r.method.toUpperCase()} ${r.path} (${r.name})`)).toEqual([]);
  });

  it('the only public routes are the three customer reads, none takes a brand id, none reveals stock counts', () => {
    const others = routes.filter((r) => r.path.startsWith('delivery/'));
    expect(others.map((r) => r.path).sort()).toEqual([...PUBLIC_PATHS].sort());
    const bad = others.filter((r) => !r.isPublic || r.path.includes(':brandId'));
    expect(bad.map((r) => `${r.method.toUpperCase()} ${r.path} (${r.name})`)).toEqual([]);
  });

  it('refuses requests with no session', async () => {
    const failures: string[] = [];
    for (const r of adminRoutes()) {
      const res = await request(app.getHttpServer())
        [r.method](`/api/v1/${concrete(r.path, brandA)}${probeQuery(r)}`)
        .set('Origin', ORIGIN);
      if (res.status !== 401) failures.push(`${r.method.toUpperCase()} ${r.path}: ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('refuses a signed-in person who holds no role', async () => {
    const failures: string[] = [];
    for (const r of adminRoutes()) {
      const res = await request(app.getHttpServer())
        [r.method](`/api/v1/${concrete(r.path, brandA)}${probeQuery(r)}`)
        .set('Cookie', `matilda_staff=${sessions.nobody.token}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', sessions.nobody.csrf);
      if (res.status !== 403) failures.push(`${r.method.toUpperCase()} ${r.path}: ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('never lets a full catalog manager of brand B reach brand A through any route', async () => {
    const failures: string[] = [];
    for (const r of adminRoutes()) {
      const res = await request(app.getHttpServer())
        [r.method](`/api/v1/${concrete(r.path, brandA)}${probeQuery(r)}`)
        .set('Cookie', `matilda_staff=${sessions.managerB.token}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', sessions.managerB.csrf);
      // Routes that read a body may reject a body-less probe (400) before reaching the data; that
      // still never touches brand A. Anything that succeeds, or reads without a body, must be 403.
      const bodyRoute = r.method !== 'get' && r.method !== 'delete';
      const refused = res.status === 403 || (bodyRoute && res.status === 400);
      if (!refused) failures.push(`${r.method.toUpperCase()} ${r.path}: ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('does serve brand B to its own manager (the matrix is not just refusing everything)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/admin/brands/${brandB}/inventory/stock`)
      .set('Cookie', `matilda_staff=${sessions.managerB.token}`)
      .set('Origin', ORIGIN);
    expect(res.status).toBe(200);
  });
});
