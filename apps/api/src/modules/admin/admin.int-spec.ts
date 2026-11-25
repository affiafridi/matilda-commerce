import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
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

const ORIGIN = 'http://localhost:3001';
const A = '/api/v1/admin';
const PLATFORM = { brandIds: [], platform: true } as const;
const UUID0 = '00000000-0000-4000-8000-000000000000';

interface Actor {
  staffId: string;
  call: (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
    headers?: Record<string, string>,
  ) => request.Test;
}

describe('admin management APIs (permission, scope, step-up, audit)', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let counter = 0;
  const ids: Record<'a' | 'b' | 'ma' | 'mb' | 'x' | 'y', string> = {
    a: '',
    b: '',
    ma: '',
    mb: '',
    x: '',
    y: '',
  };
  let root: Actor;
  let mgrA: Actor;
  let mgrB: Actor;
  let nobody: Actor;
  let viewerA: Actor;
  let branchOnly: Actor;

  // ------------------------------------------------------------------ fixtures

  async function role(name: string, permissions: string[]) {
    return db.role.create({
      data: {
        name: `${name} ${++counter}`,
        kind: 'CUSTOM',
        permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
      },
    });
  }

  async function actor(
    label: string,
    permissions: string[],
    scope: { brandId?: string; marketId?: string; branchId?: string } | null,
    options: { stepUp?: boolean } = {},
  ): Promise<Actor> {
    const staff = await db.staffUser.create({
      data: {
        email: `${label}-${++counter}@example.test`,
        fullName: label,
        status: 'ACTIVE',
        passwordHash: 'fixture-no-login',
        mfaEnrolledAt: new Date(),
      },
    });
    if (scope) {
      const r = await role(label, permissions);
      await db.staffRoleAssignment.create({
        data: { staffUserId: staff.id, roleId: r.id, ...scope },
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
        stepUpUntil: options.stepUp === false ? null : new Date(Date.now() + 3_600_000),
      },
    });
    return {
      staffId: staff.id,
      call: (method, path, body, headers = {}) => {
        let req = request(app.getHttpServer())
          [method](`${A}${path}`)
          .set('Cookie', `matilda_staff=${token}`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrf);
        for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
        return body ? req.send(body) : req;
      },
    };
  }

  const ALL = [
    'brands.view',
    'brands.manage',
    'markets.view',
    'markets.manage',
    'branches.view',
    'branches.manage',
    'users.view',
    'users.manage',
    'roles.view',
    'roles.manage',
    'audit.view',
  ];
  const VIEW = ALL.filter((k) => k.endsWith('.view'));

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
    await owner.query('TRUNCATE staff_user, brand, branch, role, auth_attempt CASCADE');
    await resetAuditLog(owner);
    // role CASCADE removed the system roles; restore them for tests that need Super Admin.
    await seed(db, 'reference');
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    await withScope(db, PLATFORM, async (tx) => {
      const a = await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } });
      const b = await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } });
      const ma = await tx.market.create({
        data: { brandId: a.id, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
      });
      const mb = await tx.market.create({
        data: { brandId: b.id, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
      });
      const x = await tx.branch.create({
        data: {
          code: 'only-a',
          name: 'Only A',
          countryId: ae.id,
          timezone: 'Asia/Dubai',
          markets: { create: [{ marketId: ma.id }] },
        },
      });
      const y = await tx.branch.create({
        data: {
          code: 'shared',
          name: 'Shared',
          countryId: ae.id,
          timezone: 'Asia/Dubai',
          markets: {
            create: [{ marketId: ma.id }, { marketId: mb.id }],
          },
        },
      });
      Object.assign(ids, { a: a.id, b: b.id, ma: ma.id, mb: mb.id, x: x.id, y: y.id });
    });
    root = await actor('root', ALL, {});
    mgrA = await actor(
      'mgra',
      ALL.filter((k) => k !== 'brands.manage'),
      { brandId: ids.a },
    );
    mgrB = await actor(
      'mgrb',
      ALL.filter((k) => k !== 'brands.manage'),
      { brandId: ids.b },
    );
    viewerA = await actor('viewera', VIEW, { brandId: ids.a });
    branchOnly = await actor('branchonly', ['branches.view'], { branchId: ids.x });
    nobody = await actor('nobody', [], null);
  });

  const audited = async (action: string) => {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      const res = await client.query('SELECT brand_id, actor_id FROM audit_log WHERE action = $1', [
        action,
      ]);
      return res.rows as { brand_id: string | null; actor_id: string | null }[];
    } finally {
      client.release();
    }
  };

  // ------------------------------------------------------------------ every route

  const ROUTES: [string, string, string?][] = [
    ['get', '/brands'],
    ['get', `/brands/${UUID0}`],
    ['post', '/brands'],
    ['patch', `/brands/${UUID0}`],
    ['get', `/brands/${UUID0}/domains`],
    ['post', `/brands/${UUID0}/domains`],
    ['patch', `/brands/${UUID0}/domains/${UUID0}`],
    ['delete', `/brands/${UUID0}/domains/${UUID0}`],
    ['get', '/markets'],
    ['get', `/markets/${UUID0}`],
    ['post', '/markets'],
    ['patch', `/markets/${UUID0}`],
    ['get', '/branches'],
    ['get', `/branches/${UUID0}`],
    ['post', '/branches'],
    ['patch', `/branches/${UUID0}`],
    ['put', `/branches/${UUID0}/markets/${UUID0}`],
    ['delete', `/branches/${UUID0}/markets/${UUID0}`],
    ['get', '/staff'],
    ['get', `/staff/${UUID0}`],
    ['post', '/staff'],
    ['patch', `/staff/${UUID0}`],
    ['post', `/staff/${UUID0}/invite`],
    ['patch', `/staff/${UUID0}/status`],
    ['post', `/staff/${UUID0}/assignments`],
    ['delete', `/assignments/${UUID0}`],
    ['get', '/permissions'],
    ['get', '/roles'],
    ['get', `/roles/${UUID0}`],
    ['post', '/roles'],
    ['patch', `/roles/${UUID0}`],
    ['delete', `/roles/${UUID0}`],
    ['post', `/roles/${UUID0}/clone`],
    ['get', '/audit'],
    ['get', '/customers'],
    ['get', `/customers/${UUID0}`],
  ];

  it.each(ROUTES)('%s %s: 401 without a session, 403 without the permission', async (m, path) => {
    const method = m as Actor['call'] extends (m: infer M, ...a: never[]) => unknown ? M : never;
    const anon = await request(app.getHttpServer())[method](`${A}${path}`).set('Origin', ORIGIN);
    expect(anon.status).toBe(401);
    expect((await nobody.call(method, path, {})).status).toBe(403);
  });

  it('rejects a customer-realm cookie on admin routes', async () => {
    const res = await request(app.getHttpServer())
      .get(`${A}/brands`)
      .set('Cookie', 'matilda_customer=abc');
    expect(res.status).toBe(401);
  });

  it('documents every admin route in Swagger with a tag', async () => {
    const doc = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const missing: string[] = [];
    for (const [path, ops] of Object.entries<Record<string, { tags?: string[] }>>(doc.body.paths)) {
      if (!path.includes('/admin/')) continue;
      for (const [method, op] of Object.entries(ops)) {
        if (!op.tags?.length) missing.push(`${method} ${path}`);
      }
    }
    expect(missing).toEqual([]);
    expect(Object.keys(doc.body.paths).filter((p) => p.includes('/admin/')).length).toBeGreaterThan(
      25,
    );
  });

  // ------------------------------------------------------------------ brands and domains

  describe('brands and domains', () => {
    it('lists only brands within scope and hides others as 404', async () => {
      const mine = await mgrA.call('get', '/brands').expect(200);
      expect(mine.body.map((b: { id: string }) => b.id)).toEqual([ids.a]);
      expect((await root.call('get', '/brands').expect(200)).body).toHaveLength(2);
      await mgrA.call('get', `/brands/${ids.b}`).expect(404);
      await mgrA.call('get', `/brands/${ids.a}`).expect(200);
    });

    it('creates brands only with a platform-wide grant, and audits it', async () => {
      const body = { slug: 'gamma', name: 'Gamma' };
      await mgrA.call('post', '/brands', body).expect(403);
      const created = await root.call('post', '/brands', body).expect(201);
      expect(created.body.slug).toBe('gamma');
      await root.call('post', '/brands', body).expect(409);
      await root.call('post', '/brands', { slug: 'Bad Slug', name: 'x' }).expect(400);
      expect(await audited('brand.create')).toHaveLength(1);
    });

    it('allows brand-scoped edits only inside the brand (and root everywhere)', async () => {
      const own = await actor('brandmgr', ['brands.view', 'brands.manage'], { brandId: ids.a });
      await own.call('patch', `/brands/${ids.a}`, { name: 'Alpha 2' }).expect(200);
      await own.call('patch', `/brands/${ids.b}`, { name: 'Hacked' }).expect(403);
      await viewerA.call('patch', `/brands/${ids.a}`, { name: 'Nope' }).expect(403);
      await root.call('patch', `/brands/${ids.b}`, { status: 'INACTIVE' }).expect(200);
      expect(await audited('brand.update')).toHaveLength(2);
    });

    it('manages domains, keeps one primary and rejects duplicates', async () => {
      const own = await actor('brandmgr', ['brands.view', 'brands.manage'], { brandId: ids.a });
      const first = await own
        .call('post', `/brands/${ids.a}/domains`, {
          hostname: 'Alpha.Example.test',
          isPrimary: true,
        })
        .expect(201);
      expect(first.body.hostname).toBe('alpha.example.test');
      const second = await own
        .call('post', `/brands/${ids.a}/domains`, {
          hostname: 'www.alpha.example.test',
          isPrimary: true,
        })
        .expect(201);
      const list = await own.call('get', `/brands/${ids.a}/domains`).expect(200);
      expect(list.body.filter((d: { isPrimary: boolean }) => d.isPrimary)).toHaveLength(1);
      await own
        .call('post', `/brands/${ids.a}/domains`, { hostname: 'alpha.example.test' })
        .expect(409);
      await own.call('post', `/brands/${ids.a}/domains`, { hostname: 'not a host!' }).expect(400);
      await own
        .call('post', `/brands/${ids.b}/domains`, { hostname: 'x.example.test' })
        .expect(403);
      await own.call('get', `/brands/${ids.b}/domains`).expect(404);
      await own
        .call('patch', `/brands/${ids.a}/domains/${second.body.id}`, { redirectToPrimary: true })
        .expect(200);
      await own.call('delete', `/brands/${ids.a}/domains/${second.body.id}`).expect(204);
      await own.call('delete', `/brands/${ids.a}/domains/${second.body.id}`).expect(404);
      expect(await audited('brand.domain.add')).toHaveLength(2);
      expect(await audited('brand.domain.remove')).toHaveLength(1);
    });

    it("refuses a domain pointing at another brand's market", async () => {
      const res = await root
        .call('post', `/brands/${ids.a}/domains`, {
          hostname: 'cross.example.test',
          marketId: ids.mb,
        })
        .expect(422);
      expect(res.body.code).toBe('INVALID_MARKET');
    });
  });

  // ------------------------------------------------------------------ markets

  describe('markets', () => {
    const body = (brandId: string, over: object = {}) => ({
      brandId,
      countryIso2: 'AE',
      code: 'ae',
      timezone: 'Asia/Dubai',
      currencies: [{ code: 'AED', isDefault: true }],
      languages: [
        { code: 'en', isDefault: true },
        { code: 'ar', isDefault: false },
      ],
      ...over,
    });

    it('lists in scope only; market-restricted grants see only their market', async () => {
      expect(
        (await mgrA.call('get', '/markets').expect(200)).body.map((m: { id: string }) => m.id),
      ).toEqual([ids.ma]);
      expect((await root.call('get', '/markets').expect(200)).body).toHaveLength(2);
      await mgrA.call('get', `/markets/${ids.mb}`).expect(404);
      const marketOnly = await actor('mkt', ['markets.view'], { brandId: ids.a, marketId: ids.ma });
      expect((await marketOnly.call('get', '/markets').expect(200)).body).toHaveLength(1);
    });

    it('creates markets inside the brand only and validates defaults', async () => {
      await mgrA.call('post', '/markets', body(ids.b)).expect(403);
      await viewerA.call('post', '/markets', body(ids.a)).expect(403);
      await mgrA
        .call('post', '/markets', body(ids.a, { currencies: [{ code: 'AED' }] }))
        .expect(400);
      const created = await mgrA.call(
        'post',
        '/markets',
        body(ids.a, { countryIso2: 'SA', code: 'sa' }),
      );
      // Saudi Arabia is not in the reference seed: a clear 422, not a crash.
      expect([201, 422]).toContain(created.status);
      await mgrA.call('post', '/markets', body(ids.a)).expect(409); // brand already has AE
    });

    it('updates status, timezone and replaces currencies and languages', async () => {
      const res = await mgrA
        .call('patch', `/markets/${ids.ma}`, {
          status: 'ACTIVE',
          languages: [{ code: 'ar', isDefault: true }],
        })
        .expect(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.languages.map((l: { languageCode: string }) => l.languageCode)).toEqual([
        'ar',
      ]);
      await mgrA.call('patch', `/markets/${ids.mb}`, { status: 'ACTIVE' }).expect(404);
      expect(await audited('market.update')).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ branches

  describe('branches', () => {
    it('lists only branches serving markets in scope', async () => {
      const list = (await mgrA.call('get', '/branches').expect(200)).body as { code: string }[];
      expect(list.map((b) => b.code).sort()).toEqual(['only-a', 'shared']);
      expect((await root.call('get', '/branches').expect(200)).body).toHaveLength(2);
      const only = (await branchOnly.call('get', '/branches').expect(200)).body as {
        code: string;
      }[];
      expect(only.map((b) => b.code)).toEqual(['only-a']);
      await branchOnly.call('get', `/branches/${ids.y}`).expect(404);
    });

    it('edits a shared branch only with the permission over every market it serves', async () => {
      await mgrA.call('patch', `/branches/${ids.x}`, { name: 'Renamed' }).expect(200);
      await mgrA.call('patch', `/branches/${ids.y}`, { name: 'Nope' }).expect(403);
      await root.call('patch', `/branches/${ids.y}`, { name: 'Shared 2' }).expect(200);
      await viewerA.call('patch', `/branches/${ids.x}`, { name: 'Nope' }).expect(403);
      expect(await audited('branch.update')).toHaveLength(2);
    });

    it('creates branches only for markets the actor manages, in the market country', async () => {
      const body = (marketIds: string[]) => ({
        code: `new-${++counter}`,
        name: 'New',
        countryIso2: 'AE',
        timezone: 'Asia/Dubai',
        marketIds,
      });
      await mgrA.call('post', '/branches', body([ids.mb])).expect(403);
      await mgrA.call('post', '/branches', body([ids.ma, ids.mb])).expect(403);
      const ok = await mgrA.call('post', '/branches', body([ids.ma])).expect(201);
      expect(ok.body.markets).toHaveLength(1);
      await mgrA.call('post', '/branches', { ...body([ids.ma]), code: ok.body.code }).expect(409);
      await mgrA.call('post', '/branches', body([])).expect(400);
    });

    it('links and unlinks markets, keeping at least one', async () => {
      await mgrA.call('put', `/branches/${ids.x}/markets/${ids.mb}`).expect(403);
      await root.call('put', `/branches/${ids.x}/markets/${ids.mb}`).expect(200);
      await root.call('put', `/branches/${ids.x}/markets/${ids.mb}`).expect(409);
      await root.call('delete', `/branches/${ids.x}/markets/${ids.mb}`).expect(204);
      await root.call('delete', `/branches/${ids.x}/markets/${ids.ma}`).expect(409);
      expect(await audited('branch.market.link')).toHaveLength(1);
      expect(await audited('branch.market.unlink')).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ staff

  describe('staff and assignments', () => {
    const invite = (over: object = {}) => ({
      email: `new${++counter}@example.test`,
      fullName: 'New Person',
      ...over,
    });
    let viewerRole: string;
    beforeEach(async () => {
      viewerRole = (await role('Viewer', ['brands.view', 'markets.view'])).id;
    });

    it('invites inside scope, returns a one-time link and audits it', async () => {
      const res = await mgrA
        .call('post', '/staff', invite({ roleId: viewerRole, brandId: ids.a }))
        .expect(201);
      expect(res.body.inviteLink).toMatch(/accept-invite\?token=/);
      expect(res.body.staff.status).toBe('INVITED');
      expect(JSON.stringify(res.body.staff)).not.toMatch(/passwordHash/);
      expect(await audited('staff.create')).toHaveLength(1);
      expect(await audited('auth.invite.issue')).toHaveLength(1);
    });

    it('refuses invitations outside scope, with escalation, or for duplicate emails', async () => {
      await mgrA.call('post', '/staff', invite({ roleId: viewerRole, brandId: ids.b })).expect(403);
      await mgrA.call('post', '/staff', invite({ roleId: viewerRole })).expect(403); // platform scope
      const strong = await role('Strong', ['settings.manage_payments']);
      await mgrA.call('post', '/staff', invite({ roleId: strong.id, brandId: ids.a })).expect(403);
      const email = 'dup@example.test';
      await mgrA
        .call('post', '/staff', invite({ email, roleId: viewerRole, brandId: ids.a }))
        .expect(201);
      await mgrA
        .call('post', '/staff', invite({ email, roleId: viewerRole, brandId: ids.a }))
        .expect(409);
      await viewerA
        .call('post', '/staff', invite({ roleId: viewerRole, brandId: ids.a }))
        .expect(403);
    });

    it('lists and reads only staff within scope', async () => {
      const inA = await actor('worker-a', ['brands.view'], { brandId: ids.a });
      const inB = await actor('worker-b', ['brands.view'], { brandId: ids.b });
      const idsA = (
        (await mgrA.call('get', '/staff').expect(200)).body.items as { id: string }[]
      ).map((s) => s.id);
      expect(idsA).toContain(inA.staffId);
      expect(idsA).not.toContain(inB.staffId);
      expect(idsA).not.toContain(root.staffId);
      const all = (await root.call('get', '/staff').expect(200)).body;
      expect(all.total).toBe(8); // fixture staff
      await mgrA.call('get', `/staff/${inB.staffId}`).expect(404);
      await mgrA.call('get', `/staff/${inA.staffId}`).expect(200);
    });

    it('suspends, reactivates and deactivates; revokes sessions at once', async () => {
      const worker = await actor('worker', ['brands.view'], { brandId: ids.a });
      await worker.call('get', '/brands').expect(200);
      await mgrA
        .call('patch', `/staff/${worker.staffId}/status`, { status: 'SUSPENDED' })
        .expect(200);
      await worker.call('get', '/brands').expect(401);
      await mgrA.call('patch', `/staff/${worker.staffId}/status`, { status: 'ACTIVE' }).expect(200);
      await mgrA.call('patch', `/staff/${worker.staffId}/status`, { status: 'ACTIVE' }).expect(409);
      await mgrA
        .call('patch', `/staff/${worker.staffId}/status`, { status: 'DEACTIVATED' })
        .expect(200);
      await mgrA.call('patch', `/staff/${worker.staffId}/status`, { status: 'ACTIVE' }).expect(409);
      expect(await audited('staff.suspended')).toHaveLength(1);
      expect(await audited('staff.deactivated')).toHaveLength(1);
    });

    it('refuses self-changes, people outside scope, people who also work elsewhere, and the last Super Admin', async () => {
      await mgrA
        .call('patch', `/staff/${mgrA.staffId}/status`, { status: 'SUSPENDED' })
        .expect(409);
      const inB = await actor('worker-b', ['brands.view'], { brandId: ids.b });
      await mgrA.call('patch', `/staff/${inB.staffId}/status`, { status: 'SUSPENDED' }).expect(404);
      const both = await actor('both', ['brands.view'], { brandId: ids.a });
      await db.staffRoleAssignment.create({
        data: { staffUserId: both.staffId, roleId: viewerRole, brandId: ids.b },
      });
      await mgrA
        .call('patch', `/staff/${both.staffId}/status`, { status: 'SUSPENDED' })
        .expect(403);

      const superRole = await db.role.findUniqueOrThrow({ where: { systemKey: 'super_admin' } });
      const sa = await actor('sa', [], null);
      await db.staffRoleAssignment.create({
        data: { staffUserId: sa.staffId, roleId: superRole.id },
      });
      const res = await root.call('patch', `/staff/${sa.staffId}/status`, { status: 'SUSPENDED' });
      // `root` is a custom platform role, so `sa` is the only Super Admin.
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('LAST_SUPER_ADMIN');
    });

    it('grants and revokes assignments within scope without escalation', async () => {
      const worker = await actor('worker', ['brands.view'], { brandId: ids.a });
      const granted = await mgrA
        .call('post', `/staff/${worker.staffId}/assignments`, {
          roleId: viewerRole,
          brandId: ids.a,
        })
        .expect(201);
      await mgrA
        .call('post', `/staff/${worker.staffId}/assignments`, {
          roleId: viewerRole,
          brandId: ids.b,
        })
        .expect(403);
      await mgrA
        .call('post', `/staff/${worker.staffId}/assignments`, { roleId: UUID0, brandId: ids.a })
        .expect(404);
      await viewerA
        .call('post', `/staff/${worker.staffId}/assignments`, {
          roleId: viewerRole,
          brandId: ids.a,
        })
        .expect(403);
      await mgrB.call('delete', `/assignments/${granted.body.id}`).expect(403);
      await mgrA.call('delete', `/assignments/${granted.body.id}`).expect(204);
      await mgrA.call('delete', `/assignments/${granted.body.id}`).expect(404);
      expect(await audited('assignment.grant')).toHaveLength(1);
      expect(await audited('assignment.revoke')).toHaveLength(1);
    });

    it('updates profile fields and reissues invitations only for invited members', async () => {
      const created = await mgrA
        .call('post', '/staff', invite({ roleId: viewerRole, brandId: ids.a }))
        .expect(201);
      const id = created.body.staff.id as string;
      const again = await mgrA.call('post', `/staff/${id}/invite`).expect(200);
      expect(again.body.inviteLink).not.toBe(created.body.inviteLink);
      await mgrA
        .call('patch', `/staff/${id}`, { fullName: 'Renamed', phone: '+971500000000' })
        .expect(200);
      const active = await actor('active', ['brands.view'], { brandId: ids.a });
      await mgrA.call('post', `/staff/${active.staffId}/invite`).expect(409);
      expect(await audited('staff.update')).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------ roles and audit

  describe('roles', () => {
    it('lets viewers read the catalog and roles', async () => {
      const perms = (await viewerA.call('get', '/permissions').expect(200)).body as {
        key: string;
      }[];
      expect(perms.length).toBeGreaterThan(40);
      const roles = (await viewerA.call('get', '/roles').expect(200)).body as { kind: string }[];
      expect(roles.some((r) => r.kind === 'SYSTEM')).toBe(true);
    });

    it('creates, edits, clones and deletes custom roles; system roles are immutable', async () => {
      const created = await mgrA
        .call('post', '/roles', { name: 'Front desk', permissions: ['brands.view'] })
        .expect(201);
      await mgrA.call('post', '/roles', { name: 'Front desk', permissions: [] }).expect(409);
      await mgrA.call('post', '/roles', { name: 'Bad', permissions: ['nope.nope'] }).expect(422);
      await mgrA
        .call('post', '/roles', { name: 'Esc', permissions: ['settings.manage_payments'] })
        .expect(403);
      await viewerA.call('post', '/roles', { name: 'Viewer made', permissions: [] }).expect(403);
      await mgrA
        .call('patch', `/roles/${created.body.id}`, {
          permissions: ['brands.view', 'markets.view'],
        })
        .expect(200);
      const clone = await mgrA
        .call('post', `/roles/${created.body.id}/clone`, { name: 'Front desk copy' })
        .expect(201);
      expect(clone.body.permissions).toEqual(['brands.view', 'markets.view']);
      const system = (await mgrA.call('get', '/roles').expect(200)).body.find(
        (r: { kind: string }) => r.kind === 'SYSTEM',
      );
      await mgrA.call('patch', `/roles/${system.id}`, { name: 'Hacked' }).expect(409);
      await mgrA.call('delete', `/roles/${created.body.id}`).expect(204);
      await mgrA.call('delete', `/roles/${created.body.id}`).expect(404);
      for (const action of ['role.create', 'role.update', 'role.clone', 'role.delete']) {
        expect((await audited(action)).length).toBeGreaterThan(0);
      }
    });
  });

  describe('audit log', () => {
    it('returns only rows within scope and pages with keyset', async () => {
      await root.call('patch', `/brands/${ids.a}`, { name: 'A1' }).expect(200);
      await root.call('patch', `/brands/${ids.b}`, { name: 'B1' }).expect(200);
      const mine = (await mgrA.call('get', '/audit').expect(200)).body.items as {
        brandId: string;
      }[];
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((r) => r.brandId === ids.a)).toBe(true);
      const all = (await root.call('get', '/audit?limit=1').expect(200)).body;
      expect(all.items).toHaveLength(1);
      expect(all.nextBefore).toBeTruthy();
      const next = (await root.call('get', `/audit?limit=1&before=${all.nextBefore}`).expect(200))
        .body;
      expect(next.items[0].id).not.toBe(all.items[0].id);
      await mgrA
        .call('get', `/audit?brandId=${ids.b}`)
        .expect(200)
        .then((r) => {
          expect(r.body.items).toEqual([]);
        });
      await mgrA.call('get', '/audit?before=abc').expect(400);
    });
  });

  // ------------------------------------------------------------------ step-up and context

  describe('step-up and admin context', () => {
    it('demands a fresh step-up for sensitive writes but not for reads', async () => {
      const stale = await actor('stale', ALL, {}, { stepUp: false });
      await stale.call('get', '/brands').expect(200);
      const res = await stale.call('post', '/brands', { slug: 'delta', name: 'Delta' }).expect(403);
      expect(res.body.code).toBe('STEP_UP_REQUIRED');
      await stale.call('patch', `/staff/${UUID0}/status`, { status: 'SUSPENDED' }).expect(403);
      expect(await audited('brand.create')).toHaveLength(0);
    });

    it('rejects cross-origin and CSRF-less admin mutations', async () => {
      const res = await request(app.getHttpServer())
        .post(`${A}/brands`)
        .set('Origin', 'https://evil.test')
        .send({ slug: 'evil', name: 'Evil' });
      expect([401, 403]).toContain(res.status);
    });

    it('reports reach and validates the X-Admin-Brand header', async () => {
      const ctx = (await mgrA.call('get', '/me/context').expect(200)).body;
      expect(ctx.platformWide).toBe(false);
      expect(ctx.brands.map((b: { id: string }) => b.id)).toEqual([ids.a]);
      expect(ctx.assignments[0].permissions).toContain('users.manage');
      expect((await root.call('get', '/me/context').expect(200)).body.platformWide).toBe(true);

      const ok = await mgrA
        .call('get', '/me/context', undefined, { 'X-Admin-Brand': ids.a })
        .expect(200);
      expect(ok.body.activeBrandId).toBe(ids.a);
      const other = await mgrA
        .call('get', '/me/context', undefined, { 'X-Admin-Brand': ids.b })
        .expect(403);
      expect(other.body.code).toBe('ADMIN_CONTEXT_FORBIDDEN');
      await mgrA.call('get', '/me/context', undefined, { 'X-Admin-Brand': 'nope' }).expect(400);
      await nobody.call('get', '/me/context').expect(200); // any signed-in staff may ask
    });
  });
});
