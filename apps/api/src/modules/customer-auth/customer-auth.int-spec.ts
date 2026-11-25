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
import { ConsoleMailAdapter } from '../../common/mail/console-mail.adapter';
import { hashToken } from '../../common/security/tokens';
import { loadEnv } from '../../config/env';
import { withScope } from '../../database/scope';
import { TenantResolver } from '../tenancy/tenant-resolver.service';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';

const PLATFORM = { brandIds: [], platform: true } as const;
const HOSTS = { a: 'alpha.example.test', b: 'beta.example.test' } as const;
const randomPassword = () => `Cu-${randomBytes(10).toString('hex')}`;

interface Login {
  cookie: string;
  csrf: string;
}

describe('customer authentication (HTTP + database)', () => {
  let app: INestApplication;
  let owner: Pool;
  let appPool: Pool;
  let db: PrismaClient;
  let mail: ConsoleMailAdapter;
  const ids = { a: '', b: '' };
  let counter = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    process.env.DATABASE_URL = testAppUrl();
    owner = createPool(testOwnerUrl());
    appPool = createPool(testAppUrl());
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
    mail = app.get(ConsoleMailAdapter);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
    await owner.end();
    await appPool.end();
  });

  beforeEach(async () => {
    await owner.query('TRUNCATE customer, staff_user, brand, auth_attempt CASCADE');
    await resetAuditLog(owner);
    mail.outbox.length = 0;
    app.get(TenantResolver).invalidateAll(); // brands are recreated per test
    await withScope(db, PLATFORM, async (tx) => {
      const a = await tx.brand.create({
        data: { slug: 'alpha', name: 'Alpha', domains: { create: [{ hostname: HOSTS.a }] } },
      });
      const b = await tx.brand.create({
        data: { slug: 'beta', name: 'Beta', domains: { create: [{ hostname: HOSTS.b }] } },
      });
      ids.a = a.id;
      ids.b = b.id;
    });
  });

  // ------------------------------------------------------------------ helpers

  type Brand = keyof typeof HOSTS;
  const call = (
    brand: Brand | string,
    method: 'get' | 'post' | 'patch',
    path: string,
    body?: object,
    opts: { login?: Login; origin?: string | null } = {},
  ) => {
    const host = brand in HOSTS ? HOSTS[brand as Brand] : brand;
    let req = request(app.getHttpServer())[method](`/api/v1/customer${path}`).set('Host', host);
    const origin = opts.origin === undefined ? `http://${host}` : opts.origin;
    if (origin) req = req.set('Origin', origin);
    if (opts.login) req = req.set('Cookie', opts.login.cookie).set('X-CSRF-Token', opts.login.csrf);
    return body ? req.send(body) : req;
  };

  const tokenFromMail = (index = mail.outbox.length - 1): string =>
    /token=([\w-]+)/.exec(mail.outbox[index]?.text ?? '')?.[1] as string;

  async function register(brand: Brand, over: Partial<{ email: string; password: string }> = {}) {
    const email = over.email ?? `person${++counter}@example.test`;
    const password = over.password ?? randomPassword();
    const res = await call(brand, 'post', '/auth/register', {
      email,
      password,
      fullName: 'Test Customer',
    });
    return { email, password, res };
  }

  async function login(brand: Brand, email: string, password: string): Promise<Login> {
    const res = await call(brand, 'post', '/auth/login', { email, password }).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] as string;
    return { cookie: cookie.split(';')[0] as string, csrf: res.body.csrfToken };
  }

  async function account(brand: Brand = 'a') {
    const { email, password } = await register(brand);
    return { email, password, session: await login(brand, email, password) };
  }

  /** Owner queries need platform context: row-level security is forced for every role. */
  const q = async (sql: string, params: unknown[] = []) => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.platform', 'on', true)");
      const res = await client.query(sql, params);
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };

  const audited = async (action: string) => {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      return (await client.query('SELECT brand_id FROM audit_log WHERE action = $1', [action]))
        .rows as { brand_id: string }[];
    } finally {
      client.release();
    }
  };

  // ------------------------------------------------------------------ brand binding

  it('keeps the same email as separate accounts per brand, and never logs in across brands', async () => {
    const email = 'shared@example.test';
    const pwA = randomPassword();
    const pwB = randomPassword();
    await register('a', { email, password: pwA }).then((r) => expect(r.res.status).toBe(202));
    await register('b', { email, password: pwB }).then((r) => expect(r.res.status).toBe(202));
    const rows = await q('SELECT brand_id FROM customer WHERE email = $1', [email]);
    expect(rows.rows.map((r) => r.brand_id).sort()).toEqual([ids.a, ids.b].sort());

    await login('a', email, pwA);
    await login('b', email, pwB);
    await call('a', 'post', '/auth/login', { email, password: pwB }).expect(401);
    await call('b', 'post', '/auth/login', { email, password: pwA }).expect(401);

    const only = await register('a', { email: 'only-a@example.test' });
    expect(only.res.status).toBe(202);
    await call('b', 'post', '/auth/login', { email: only.email, password: only.password }).expect(
      401,
    );
  });

  it('rejects a session cookie replayed against another brand or an unknown host', async () => {
    const { session } = await account('a');
    await call('a', 'get', '/me', undefined, { login: session }).expect(200);
    await call('b', 'get', '/me', undefined, { login: session }).expect(401);
    await call('unknown.example.test', 'get', '/me', undefined, { login: session }).expect(404);
  });

  it('answers 401 to guests and to other realms', async () => {
    await call('a', 'get', '/me').expect(401);
    await call('a', 'get', '/me', undefined, {
      login: { cookie: 'matilda_staff=abc', csrf: 'x' },
    }).expect(401);
    const { session } = await account('a');
    const admin = await request(app.getHttpServer())
      .get('/api/v1/admin/brands')
      .set('Host', HOSTS.a)
      .set('Cookie', session.cookie);
    expect(admin.status).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/admin/me')
          .set('Host', HOSTS.a)
          .set('Cookie', session.cookie)
      ).status,
    ).toBe(401);
    expect((await request(app.getHttpServer()).get('/api/v1/admin/brands')).status).toBe(401);
  });

  // ------------------------------------------------------------------ registration

  it('answers registration identically for new and existing emails', async () => {
    const first = await register('a');
    const again = await register('a', { email: first.email });
    expect(again.res.status).toBe(first.res.status);
    expect(again.res.body).toEqual(first.res.body);
    expect((await q('SELECT 1 FROM customer')).rowCount).toBe(1);
    expect(mail.outbox.map((m) => m.template)).toEqual(['customer.verify', 'customer.exists']);
    // The duplicate attempt cannot change the existing password.
    await login('a', first.email, first.password);
    expect(await audited('customer.register')).toHaveLength(1);
  });

  it('enforces the password policy and validates input', async () => {
    const weak = await register('a', { password: 'short' });
    expect(weak.res.status).toBe(422);
    expect(weak.res.body.code).toBe('WEAK_PASSWORD');
    expect((await register('a', { email: 'not-an-email' })).res.status).toBe(400);
    const withEmailName = await register('a', {
      email: 'janedoe@example.test',
      password: 'janedoe-forever-1',
    });
    expect(withEmailName.res.status).toBe(422);
  });

  it('stores emails lowercase and hashes passwords with Argon2id', async () => {
    const { password } = await register('a', { email: 'MiXeD@Example.test' });
    const row = await q('SELECT email, password_hash FROM customer');
    expect(row.rows[0].email).toBe('mixed@example.test');
    expect(row.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(row.rows[0].password_hash).not.toContain(password);
    await login('a', 'MIXED@example.test', password);
  });

  it('verifies email with a single-use, expiring token', async () => {
    const { email } = await register('a');
    const token = tokenFromMail();
    await call('a', 'post', '/auth/verify-email', { token }).expect(204);
    expect(
      (await q('SELECT email_verified_at FROM customer')).rows[0].email_verified_at,
    ).toBeTruthy();
    await call('a', 'post', '/auth/verify-email', { token }).expect(400);
    // another brand's host cannot redeem it
    await register('b', { email });
    await call('b', 'post', '/auth/verify-email', { token: tokenFromMail(1) }).expect(204);

    await q(`UPDATE customer SET email_verified_at = NULL`);
    await register('a', { email: 'late@example.test' });
    await q(
      `UPDATE customer_token SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`,
    );
    await call('a', 'post', '/auth/verify-email', { token: tokenFromMail() }).expect(400);
  });

  it('refuses a token from one brand on another brand', async () => {
    await register('a');
    await call('b', 'post', '/auth/verify-email', { token: tokenFromMail() }).expect(400);
    expect(
      (await q('SELECT email_verified_at FROM customer')).rows[0].email_verified_at,
    ).toBeNull();
  });

  // ------------------------------------------------------------------ login

  it('answers wrong password and unknown email identically, and sets safe cookies', async () => {
    const { email, password } = await register('a');
    const wrong = await call('a', 'post', '/auth/login', { email, password: randomPassword() });
    const unknown = await call('a', 'post', '/auth/login', {
      email: 'ghost@example.test',
      password: randomPassword(),
    });
    const stable = ({ code, message, statusCode }: Record<string, unknown>) => ({
      code,
      message,
      statusCode,
    });
    expect(wrong.status).toBe(401);
    expect(stable(unknown.body)).toEqual(stable(wrong.body));

    const ok = await call('a', 'post', '/auth/login', { email, password }).expect(200);
    const cookie = (ok.headers['set-cookie'] as unknown as string[])[0] as string;
    expect(cookie).toMatch(/^matilda_customer=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('locks after repeated failures per brand and unlocks on expiry', async () => {
    const { email, password } = await register('a');
    await register('b', { email, password });
    const bad = () => call('a', 'post', '/auth/login', { email, password: randomPassword() });
    for (let i = 0; i < 5; i++) await bad().expect(401);
    const locked = await call('a', 'post', '/auth/login', { email, password }).expect(429);
    expect(locked.body.code).toBe('TOO_MANY_ATTEMPTS');
    await call('b', 'post', '/auth/login', { email, password }).expect(200); // other brand unaffected
    await q(`UPDATE auth_attempt SET locked_until = now() - interval '1 minute'`);
    await call('a', 'post', '/auth/login', { email, password }).expect(200);
    expect(await audited('customer.lock')).toHaveLength(1);
  });

  it('blocks suspended accounts and expires sessions', async () => {
    const { email, password, session } = await account('a');
    await q(`UPDATE customer_session SET idle_expires_at = now() - interval '1 second'`);
    await call('a', 'get', '/me', undefined, { login: session }).expect(401);

    const again = await login('a', email, password);
    await q(`UPDATE customer SET status = 'SUSPENDED'`);
    await call('a', 'get', '/me', undefined, { login: again }).expect(401);
    await call('a', 'post', '/auth/login', { email, password }).expect(401);
  });

  // ------------------------------------------------------------------ CSRF and origin

  it('requires a same-brand Origin and the CSRF token for mutations', async () => {
    const { email, password, session } = await account('a');
    const loginWithOther = await call(
      'a',
      'post',
      '/auth/login',
      { email, password },
      { origin: `http://${HOSTS.b}` },
    );
    expect(loginWithOther.status).toBe(403);
    expect(
      (await call('a', 'post', '/auth/login', { email, password }, { origin: 'https://evil.test' }))
        .status,
    ).toBe(403);
    expect(
      (await call('a', 'post', '/auth/login', { email, password }, { origin: null })).status,
    ).toBe(403);

    expect(
      (await call('a', 'post', '/auth/logout', undefined, { login: { ...session, csrf: 'nope' } }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('a', 'post', '/auth/logout', undefined, {
          login: session,
          origin: `http://${HOSTS.b}`,
        })
      ).status,
    ).toBe(403);
    await call('a', 'get', '/me', undefined, { login: session }).expect(200); // survived the attacks
    await call('a', 'post', '/auth/logout', undefined, { login: session }).expect(204);
    await call('a', 'get', '/me', undefined, { login: session }).expect(401);
  });

  // ------------------------------------------------------------------ password reset and change

  it('resets passwords with a single-use token that revokes sessions and stays enumeration-safe', async () => {
    const { email, password, session } = await account('a');
    mail.outbox.length = 0;
    const known = await call('a', 'post', '/auth/forgot-password', { email }).expect(202);
    const unknown = await call('a', 'post', '/auth/forgot-password', {
      email: 'ghost@example.test',
    }).expect(202);
    const elsewhere = await call('b', 'post', '/auth/forgot-password', { email }).expect(202);
    expect(unknown.body).toEqual(known.body);
    expect(elsewhere.body).toEqual(known.body);
    expect(mail.outbox).toHaveLength(1); // only the real account on this brand

    const token = tokenFromMail();
    await call('b', 'post', '/auth/reset-password', { token, password: randomPassword() }).expect(
      400,
    );
    await call('a', 'post', '/auth/reset-password', { token, password: 'short' }).expect(422);
    const next = randomPassword();
    await call('a', 'post', '/auth/reset-password', { token, password: next }).expect(204);
    await call('a', 'post', '/auth/reset-password', { token, password: randomPassword() }).expect(
      400,
    );
    await call('a', 'get', '/me', undefined, { login: session }).expect(401);
    await call('a', 'post', '/auth/login', { email, password }).expect(401);
    await login('a', email, next);
  });

  it('expires reset tokens', async () => {
    const { email } = await account('a');
    await call('a', 'post', '/auth/forgot-password', { email }).expect(202);
    await q(
      `UPDATE customer_token SET expires_at = now() - interval '1 second' WHERE type = 'RESET'`,
    );
    await call('a', 'post', '/auth/reset-password', {
      token: tokenFromMail(),
      password: randomPassword(),
    }).expect(400);
  });

  it('changes the password keeping only the current session', async () => {
    const { email, password, session } = await account('a');
    const other = await login('a', email, password);
    const next = randomPassword();
    await call(
      'a',
      'post',
      '/me/password',
      { currentPassword: randomPassword(), newPassword: next },
      { login: session },
    ).expect(401);
    await call(
      'a',
      'post',
      '/me/password',
      { currentPassword: password, newPassword: next },
      { login: session },
    ).expect(204);
    await call('a', 'get', '/me', undefined, { login: session }).expect(200);
    await call('a', 'get', '/me', undefined, { login: other }).expect(401);
    await login('a', email, next);
  });

  // ------------------------------------------------------------------ profile and deletion

  it('reads and updates the profile without exposing credentials', async () => {
    const { session } = await account('a');
    const me = (await call('a', 'get', '/me', undefined, { login: session }).expect(200)).body;
    expect(JSON.stringify(me)).not.toMatch(/password|hash|brandId/i);
    const patched = await call(
      'a',
      'patch',
      '/me',
      {
        fullName: 'Renamed',
        phone: '+971500000000',
        marketingConsent: true,
        preferredLanguage: 'ar',
      },
      { login: session },
    ).expect(200);
    expect(patched.body).toMatchObject({
      fullName: 'Renamed',
      marketingConsent: true,
      preferredLanguage: 'ar',
    });
    expect(patched.body.marketingConsentAt).toBeTruthy();
    await call(
      'a',
      'patch',
      '/me',
      { email: 'x@example.test', status: 'ACTIVE', brandId: ids.b },
      { login: session },
    ).expect(200);
    const row = await q('SELECT brand_id, status FROM customer');
    expect(row.rows[0]).toEqual({ brand_id: ids.a, status: 'ACTIVE' });
  });

  it('handles a deletion request: password-confirmed, ends sessions, blocks sign-in', async () => {
    const { email, password, session } = await account('a');
    await call(
      'a',
      'post',
      '/me/deletion-request',
      { password: randomPassword() },
      { login: session },
    ).expect(401);
    await call('a', 'post', '/me/deletion-request', { password }, { login: session }).expect(202);
    await call('a', 'get', '/me', undefined, { login: session }).expect(401);
    await call('a', 'post', '/auth/login', { email, password }).expect(401);
    const row = await q('SELECT status, deletion_requested_at FROM customer');
    expect(row.rows[0].status).toBe('DELETION_REQUESTED');
    expect(row.rows[0].deletion_requested_at).toBeTruthy();
    expect(await audited('customer.deletion.request')).toHaveLength(1);
  });

  it('writes audit rows tagged with the brand and never logs secrets', async () => {
    const { email, password } = await account('a');
    const secret = randomPassword();
    await call('a', 'post', '/auth/login', { email, password: secret }).expect(401);
    for (const action of [
      'customer.register',
      'customer.login.success',
      'customer.login.failure',
    ]) {
      const rows = await audited(action);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.brand_id === ids.a)).toBe(true);
    }
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      const text = JSON.stringify((await client.query('SELECT * FROM audit_log')).rows);
      expect(text).not.toContain(secret);
      expect(text).not.toContain(password);
    } finally {
      client.release();
    }
  });

  // ------------------------------------------------------------------ database isolation

  describe('row-level security', () => {
    it('hides customer data from the runtime role without a brand scope', async () => {
      await account('a');
      await account('b');
      for (const table of ['customer', 'customer_session', 'customer_token']) {
        expect((await appPool.query(`SELECT 1 FROM ${table}`)).rowCount).toBe(0);
      }
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.brand_ids', $1, true)`, [ids.a]);
        const rows = await client.query('SELECT brand_id FROM customer');
        expect(rows.rows.map((r) => r.brand_id)).toEqual([ids.a]);
        await expect(
          client.query(
            `INSERT INTO customer (id, brand_id, email, password_hash, full_name, updated_at)
             VALUES (gen_random_uuid(), $1, 'x@example.test', 'h', 'x', now())`,
            [ids.b],
          ),
        ).rejects.toThrow(/row-level security/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it('refuses sessions whose brand differs from their customer (composite key)', async () => {
      await account('a');
      const customer = (await q('SELECT id FROM customer')).rows[0].id;
      await expect(
        q(
          `INSERT INTO customer_session (id, brand_id, customer_id, token_hash, csrf_hash, idle_expires_at, absolute_expires_at)
           VALUES (gen_random_uuid(), $1, $2, 'th', 'ch', now(), now())`,
          [ids.b, customer],
        ),
      ).rejects.toThrow(/foreign key|violates/);
    });
  });

  // ------------------------------------------------------------------ admin read-only view

  describe('admin customers (read-only)', () => {
    async function staff(
      label: string,
      scope: { brandId?: string; marketId?: string } | null,
      permissions: string[],
    ) {
      const user = await db.staffUser.create({
        data: {
          email: `${label}${++counter}@example.test`,
          fullName: label,
          status: 'ACTIVE',
          passwordHash: 'fixture-no-login',
        },
      });
      if (scope) {
        const role = await db.role.create({
          data: {
            name: `${label} ${++counter}`,
            kind: 'CUSTOM',
            permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
          },
        });
        await db.staffRoleAssignment.create({
          data: { staffUserId: user.id, roleId: role.id, ...scope },
        });
      }
      const token = randomBytes(24).toString('hex');
      const csrf = randomBytes(24).toString('hex');
      await db.staffSession.create({
        data: {
          staffUserId: user.id,
          tokenHash: hashToken(token),
          csrfHash: hashToken(csrf),
          idleExpiresAt: new Date(Date.now() + 3_600_000),
          absoluteExpiresAt: new Date(Date.now() + 3_600_000),
          mfaVerifiedAt: new Date(),
          stepUpUntil: new Date(Date.now() + 3_600_000),
        },
      });
      return (path: string) =>
        request(app.getHttpServer())
          .get(`/api/v1/admin${path}`)
          .set('Cookie', `matilda_staff=${token}`)
          .set('Origin', 'http://localhost:3001');
    }

    it('lists customers within scope without credentials', async () => {
      const a = await register('a', { email: 'ann@example.test' });
      await register('b', { email: 'bob@example.test' });
      const root = await staff('root', {}, ['customers.view']);
      const mgrA = await staff('mgra', { brandId: ids.a }, ['customers.view']);
      const marketOnly = await staff('mkt', { brandId: ids.a, marketId: await marketFor(ids.a) }, [
        'customers.view',
      ]);
      const nobody = await staff('nobody', null, []);

      const all = (await root('/customers').expect(200)).body;
      expect(all.total).toBe(2);
      expect(JSON.stringify(all)).not.toMatch(/password|hash/i);
      const mine = (await mgrA('/customers').expect(200)).body;
      expect(mine.items.map((c: { email: string }) => c.email)).toEqual([a.email]);
      expect((await mgrA('/customers?search=bob').expect(200)).body.items).toEqual([]);
      expect((await marketOnly('/customers').expect(200)).body.items).toEqual([]);

      const id = mine.items[0].id as string;
      await mgrA(`/customers/${id}`).expect(200);
      const other = (await q(`SELECT id FROM customer WHERE email = 'bob@example.test'`)).rows[0]
        .id;
      await mgrA(`/customers/${other}`).expect(404);
      await nobody('/customers').expect(403);
      await request(app.getHttpServer()).get('/api/v1/admin/customers').expect(401);
      // customers can never reach it
      const { session } = await account('a');
      await request(app.getHttpServer())
        .get('/api/v1/admin/customers')
        .set('Cookie', session.cookie)
        .expect(401);
    });

    async function marketFor(brandId: string): Promise<string> {
      const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
      return withScope(
        db,
        PLATFORM,
        async (tx) =>
          (
            await tx.market.create({
              data: { brandId, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
            })
          ).id,
      );
    }
  });
});
