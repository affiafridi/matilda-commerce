import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { generateSync } from 'otplib';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { createSuperAdmin } from '../../cli/create-super-admin';
import { seed } from '../../cli/seed';
import { ConsoleMailAdapter } from '../../common/mail/console-mail.adapter';
import { loadEnv } from '../../config/env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';

const ORIGIN = 'http://localhost:3001';
const BASE = 'http://localhost:3001';
const API = '/api/v1/admin';
const randomPassword = () => `Tt-${randomBytes(12).toString('hex')}`;

interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  email: string;
  password: string;
  secret: string;
  recoveryCodes: string[];
}

describe('staff authentication (HTTP + database)', () => {
  let app: INestApplication;
  let owner: Pool;
  let ownerClient: PrismaClient;
  let mail: ConsoleMailAdapter;
  let counter = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    process.env.DATABASE_URL = testAppUrl();
    owner = createPool(testOwnerUrl());
    ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: testOwnerUrl() }) });
    await seed(ownerClient, 'reference');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Per-route throttling is exercised separately; here many logins come from one address.
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
    await ownerClient.$disconnect();
    await owner.end();
  });

  beforeEach(async () => {
    await owner.query('TRUNCATE staff_user, auth_attempt CASCADE');
    await resetAuditLog(owner);
    mail.outbox.length = 0;
  });

  // ------------------------------------------------------------------ helpers

  const server = () => app.getHttpServer();
  const tokenFrom = (link: string) => new URL(link).searchParams.get('token') as string;

  async function provision(): Promise<{ email: string; password: string }> {
    const email = `admin${++counter}@example.test`;
    const password = randomPassword();
    const { link } = await createSuperAdmin(ownerClient, {
      email,
      fullName: 'Test Admin',
      adminBaseUrl: BASE,
      forceRecovery: true,
    });
    await request(server())
      .post(`${API}/auth/invite/accept`)
      .set('Origin', ORIGIN)
      .send({ token: tokenFrom(link), password })
      .expect(204);
    return { email, password };
  }

  const post = (s: { agent: Session['agent']; csrf: string }, path: string, body: object = {}) =>
    s.agent.post(`${API}/${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', s.csrf).send(body);

  /** Password + enrollment of 2FA; returns a fully verified session. */
  async function enrolled(): Promise<Session> {
    const { email, password } = await provision();
    const agent = request.agent(server());
    const login = await agent
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email, password })
      .expect(200);
    expect(login.body.next).toBe('MFA_ENROLL');
    let csrf = login.body.csrfToken as string;
    const start = await post({ agent, csrf }, 'auth/mfa/enroll/start').expect(200);
    const secret = start.body.secret as string;
    const confirm = await post({ agent, csrf }, 'auth/mfa/enroll/confirm', {
      code: generateSync({ secret }),
    }).expect(200);
    csrf = confirm.body.csrfToken;
    return { agent, csrf, email, password, secret, recoveryCodes: confirm.body.recoveryCodes };
  }

  /** A new verified login for an enrolled account. Clearing the burned step stands in for 30 s passing. */
  async function signIn(s: Pick<Session, 'email' | 'password' | 'secret'>): Promise<Session> {
    await owner.query('UPDATE staff_mfa_totp SET last_used_step = NULL');
    const agent = request.agent(server());
    const login = await agent
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: s.email, password: s.password })
      .expect(200);
    expect(login.body.next).toBe('MFA_VERIFY');
    const verify = await post({ agent, csrf: login.body.csrfToken }, 'auth/mfa/verify', {
      code: generateSync({ secret: s.secret }),
    }).expect(200);
    return { ...s, agent, csrf: verify.body.csrfToken, recoveryCodes: [] };
  }

  // ------------------------------------------------------------------ flow

  it('runs invite → password → 2FA enrollment → authenticated access', async () => {
    const { email, password } = await provision();
    const agent = request.agent(server());
    const login = await agent
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email, password })
      .expect(200);

    // A pending (password-only) session grants nothing.
    await agent.get(`${API}/me`).expect(401);
    const pendingState = await agent.get(`${API}/auth/session`).expect(200);
    expect(pendingState.body.stage).toBe('PENDING');

    const csrf = login.body.csrfToken as string;
    const start = await post({ agent, csrf }, 'auth/mfa/enroll/start').expect(200);
    expect(start.body.otpauthUri).toContain('otpauth://totp/');
    const confirm = await post({ agent, csrf }, 'auth/mfa/enroll/confirm', {
      code: generateSync({ secret: start.body.secret }),
    }).expect(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);

    const me = await agent.get(`${API}/me`).expect(200);
    expect(me.body).toMatchObject({ email, mfaEnrolled: true });
    expect(JSON.stringify(me.body)).not.toMatch(/hash|secret/i);

    const row = await owner.query(
      'SELECT secret_ciphertext FROM staff_mfa_totp WHERE secret_ciphertext IS NOT NULL',
    );
    expect(row.rows[0].secret_ciphertext).not.toContain(start.body.secret);
  });

  it('rotates the session token at 2FA completion (session fixation)', async () => {
    const { email, password } = await provision();
    const agent = request.agent(server());
    const login = await agent
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email, password })
      .expect(200);
    const pendingCookie = (login.headers['set-cookie'] as unknown as string[])[0] as string;
    const start = await post({ agent, csrf: login.body.csrfToken }, 'auth/mfa/enroll/start').expect(
      200,
    );
    const confirm = await post({ agent, csrf: login.body.csrfToken }, 'auth/mfa/enroll/confirm', {
      code: generateSync({ secret: start.body.secret }),
    }).expect(200);
    const verifiedCookie = (confirm.headers['set-cookie'] as unknown as string[])[0] as string;
    expect(verifiedCookie.split(';')[0]).not.toBe(pendingCookie.split(';')[0]);
    // The old pending token no longer works at all.
    await request(server())
      .get(`${API}/auth/session`)
      .set('Cookie', pendingCookie.split(';')[0] as string)
      .expect(401);
  });

  it('sets HttpOnly, SameSite=Lax cookies without a Domain attribute', async () => {
    const { email, password } = await provision();
    const res = await request(server())
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email, password })
      .expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] as string;
    expect(cookie).toMatch(/^matilda_staff=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  // ------------------------------------------------------------------ credentials & lockout

  it('answers identically for unknown accounts and wrong passwords', async () => {
    const { email } = await provision();
    const wrong = await request(server())
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email, password: randomPassword() });
    const unknown = await request(server())
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: 'nobody@example.test', password: randomPassword() });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const stable = ({ code, message, statusCode }: Record<string, unknown>) => ({
      code,
      message,
      statusCode,
    });
    expect(stable(unknown.body)).toEqual(stable(wrong.body));
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks after repeated failures, even for the correct password, then unlocks on expiry', async () => {
    const { email, password } = await provision();
    const attempt = (pw: string) =>
      request(server())
        .post(`${API}/auth/login`)
        .set('Origin', ORIGIN)
        .send({ email, password: pw });
    for (let i = 0; i < 5; i++) await attempt(randomPassword()).expect(401);
    const locked = await attempt(password).expect(429);
    expect(locked.body.code).toBe('TOO_MANY_ATTEMPTS');

    await owner.query(`UPDATE auth_attempt SET locked_until = now() - interval '1 minute'`);
    await attempt(password).expect(200);
  });

  it('locks unknown accounts the same way (no account enumeration)', async () => {
    const attempt = () =>
      request(server())
        .post(`${API}/auth/login`)
        .set('Origin', ORIGIN)
        .send({ email: 'ghost@example.test', password: randomPassword() });
    for (let i = 0; i < 5; i++) await attempt().expect(401);
    await attempt().expect(429);
  });

  it('never writes passwords or tokens to the audit log', async () => {
    const { email } = await provision();
    const secretLooking = randomPassword();
    await request(server())
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email, password: secretLooking })
      .expect(401);
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      const audit = await client.query(`SELECT action, after FROM audit_log ORDER BY id`);
      const text = JSON.stringify(audit.rows);
      expect(text).not.toContain(secretLooking);
      expect(audit.rows.map((r) => r.action)).toContain('auth.login.failure');
    } finally {
      client.release();
    }
  });

  // ------------------------------------------------------------------ 2FA

  it('rejects wrong and replayed TOTP codes', async () => {
    const s = await enrolled();
    const used = generateSync({ secret: s.secret });
    const login = await request
      .agent(server())
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: s.email, password: s.password })
      .expect(200);
    const agent = request.agent(server());
    const l2 = await agent
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: s.email, password: s.password })
      .expect(200);
    expect(login.body.next).toBe('MFA_VERIFY');
    const pending = { agent, csrf: l2.body.csrfToken as string };
    await post(pending, 'auth/mfa/verify', { code: '000000' }).expect(401);
    // The code consumed at enrollment can never be accepted again.
    await post(pending, 'auth/mfa/verify', { code: used }).expect(401);
    await agent.get(`${API}/me`).expect(401);
  });

  it('accepts each recovery code exactly once', async () => {
    const s = await enrolled();
    const [first, second] = s.recoveryCodes as [string, string];
    const recover = async (code: string) => {
      const agent = request.agent(server());
      const l = await agent
        .post(`${API}/auth/login`)
        .set('Origin', ORIGIN)
        .send({ email: s.email, password: s.password })
        .expect(200);
      return post({ agent, csrf: l.body.csrfToken }, 'auth/mfa/recovery', { code });
    };
    const ok = await recover(first);
    expect(ok.status).toBe(200);
    expect(ok.body.remainingCodes).toBe(9);
    expect((await recover(first)).status).toBe(401);
    expect((await recover(second.toLowerCase())).status).toBe(200);
  });

  it('only grants sensitive access after a fresh step-up', async () => {
    const s = await signIn(await enrolled());
    await owner.query(`UPDATE staff_session SET step_up_until = now() - interval '1 minute'`);
    await owner.query('UPDATE staff_mfa_totp SET last_used_step = NULL');
    const res = await post(s, 'auth/step-up', { code: generateSync({ secret: s.secret }) }).expect(
      200,
    );
    expect(new Date(res.body.stepUpUntil).getTime()).toBeGreaterThan(Date.now());
    await post(s, 'auth/step-up', { code: '123456' }).expect(401);
  });

  // ------------------------------------------------------------------ sessions

  it('expires sessions after the idle and absolute limits', async () => {
    const s = await enrolled();
    await s.agent.get(`${API}/me`).expect(200);
    await owner.query(`UPDATE staff_session SET idle_expires_at = now() - interval '1 second'`);
    await s.agent.get(`${API}/me`).expect(401);

    const t = await signIn(s);
    await t.agent.get(`${API}/me`).expect(200);
    await owner.query(`UPDATE staff_session SET absolute_expires_at = now() - interval '1 second'`);
    await t.agent.get(`${API}/me`).expect(401);
  });

  it('logout ends the session; logout-all ends every session', async () => {
    const s = await enrolled();
    const other = await signIn(s);
    await post(s, 'auth/logout').expect(204);
    await s.agent.get(`${API}/me`).expect(401);
    await other.agent.get(`${API}/me`).expect(200);

    const third = await signIn(s);
    await post(third, 'auth/logout-all').expect(200);
    await other.agent.get(`${API}/me`).expect(401);
    await third.agent.get(`${API}/me`).expect(401);
  });

  it('ends sessions immediately when the account is deactivated', async () => {
    const s = await enrolled();
    await s.agent.get(`${API}/me`).expect(200);
    await owner.query(`UPDATE staff_user SET status = 'DEACTIVATED'`);
    await s.agent.get(`${API}/me`).expect(401);
    await request(server())
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: s.email, password: s.password })
      .expect(401);
  });

  // ------------------------------------------------------------------ CSRF and origin

  it('rejects cross-origin and CSRF-less mutations', async () => {
    const s = await enrolled();
    const noCsrf = await s.agent.post(`${API}/auth/logout-all`).set('Origin', ORIGIN).send({});
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.code).toBe('CSRF_FAILED');
    const evil = await s.agent
      .post(`${API}/auth/logout-all`)
      .set('Origin', 'https://evil.test')
      .set('X-CSRF-Token', s.csrf)
      .send({});
    expect(evil.body.code).toBe('ORIGIN_NOT_ALLOWED');
    const loginCsrf = await request(server())
      .post(`${API}/auth/login`)
      .set('Origin', 'https://evil.test')
      .send({ email: s.email, password: s.password });
    expect(loginCsrf.status).toBe(403);
    await s.agent.get(`${API}/me`).expect(200); // the session survived the attacks
  });

  it('reissues a CSRF token for a live session after a reload, only from an allowed origin', async () => {
    const s = await enrolled();
    const fresh = await s.agent.post(`${API}/auth/csrf`).set('Origin', ORIGIN).send({}).expect(200);
    expect(fresh.body.csrfToken).not.toBe(s.csrf);
    await post({ agent: s.agent, csrf: fresh.body.csrfToken }, 'auth/step-up', {
      code: '000000',
    }).expect(401); // passes CSRF, fails on the wrong code
    expect((await post(s, 'auth/logout-all')).body.code).toBe('CSRF_FAILED'); // the old token is dead
    const evil = await s.agent.post(`${API}/auth/csrf`).set('Origin', 'https://evil.test').send({});
    expect(evil.body.code).toBe('ORIGIN_NOT_ALLOWED');
    await request(server()).post(`${API}/auth/csrf`).set('Origin', ORIGIN).send({}).expect(401);
  });

  // ------------------------------------------------------------------ tokens: invite & reset

  it('invite links are single-use and expire', async () => {
    const email = 'invitee@example.test';
    const { link } = await createSuperAdmin(ownerClient, {
      email,
      fullName: 'Invitee',
      adminBaseUrl: BASE,
      forceRecovery: true,
    });
    const token = tokenFrom(link);
    const accept = (pw: string, t = token) =>
      request(server())
        .post(`${API}/auth/invite/accept`)
        .set('Origin', ORIGIN)
        .send({ token: t, password: pw });
    await accept('short').expect(422);
    await accept(randomPassword()).expect(204);
    await accept(randomPassword()).expect(400);

    const second = await createSuperAdmin(ownerClient, {
      email: 'late@example.test',
      fullName: 'Late',
      adminBaseUrl: BASE,
      forceRecovery: true,
    });
    await owner.query(
      `UPDATE staff_token SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`,
    );
    await accept(randomPassword(), tokenFrom(second.link)).expect(400);
  });

  it('password reset: uniform answer, single-use, revokes sessions', async () => {
    const s = await enrolled();
    const known = await request(server())
      .post(`${API}/auth/password/forgot`)
      .set('Origin', ORIGIN)
      .send({ email: s.email })
      .expect(202);
    const unknown = await request(server())
      .post(`${API}/auth/password/forgot`)
      .set('Origin', ORIGIN)
      .send({ email: 'nobody@example.test' })
      .expect(202);
    expect(unknown.body).toEqual(known.body);
    expect(mail.outbox).toHaveLength(1);
    const token = /token=([\w-]+)/.exec(mail.outbox[0]?.text ?? '')?.[1] as string;

    const newPassword = randomPassword();
    const reset = (t: string, pw: string) =>
      request(server())
        .post(`${API}/auth/password/reset`)
        .set('Origin', ORIGIN)
        .send({ token: t, password: pw });
    await reset(token, newPassword).expect(204);
    await reset(token, randomPassword()).expect(400);
    await s.agent.get(`${API}/me`).expect(401); // old session revoked
    await signIn({ ...s, password: newPassword });
    await request(server())
      .post(`${API}/auth/login`)
      .set('Origin', ORIGIN)
      .send({ email: s.email, password: s.password })
      .expect(401);
  });

  it('changing the password keeps the current session and revokes the others', async () => {
    const s = await enrolled();
    const other = await signIn(s);
    const next = randomPassword();
    await post(s, 'auth/password/change', {
      currentPassword: s.password,
      newPassword: next,
    }).expect(204);
    await s.agent.get(`${API}/me`).expect(200);
    await other.agent.get(`${API}/me`).expect(401);
    await post(s, 'auth/password/change', {
      currentPassword: randomPassword(),
      newPassword: randomPassword(),
    }).expect(401);
  });

  // ------------------------------------------------------------------ Super Admin CLI

  it('creates the first Super Admin with platform scope, an audit row and no password', async () => {
    const { link, staffUserId } = await createSuperAdmin(ownerClient, {
      email: 'First@Example.test',
      fullName: 'First Admin',
      adminBaseUrl: `${BASE}/`,
    });
    expect(link).toMatch(/^http:\/\/localhost:3001\/accept-invite\?token=[\w-]{20,}$/);
    const user = await owner.query('SELECT email, status, password_hash FROM staff_user');
    expect(user.rows).toEqual([
      { email: 'first@example.test', status: 'INVITED', password_hash: null },
    ]);
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      const assignment = await client.query(
        `SELECT a.brand_id, a.market_id, a.branch_id, r.system_key
           FROM staff_role_assignment a JOIN role r ON r.id = a.role_id WHERE a.staff_user_id = $1`,
        [staffUserId],
      );
      expect(assignment.rows).toEqual([
        { brand_id: null, market_id: null, branch_id: null, system_key: 'super_admin' },
      ]);
      const audit = await client.query(`SELECT actor_type, action FROM audit_log`);
      expect(audit.rows).toEqual([{ actor_type: 'SYSTEM', action: 'cli.super_admin.invite' }]);
      expect(JSON.stringify(audit.rows)).not.toContain(tokenFrom(link));
    } finally {
      client.release();
    }
    // The token is stored only as a hash.
    const tokens = await owner.query('SELECT token_hash FROM staff_token');
    expect(tokens.rows[0].token_hash).not.toContain(tokenFrom(link));
  });

  it('refuses a second Super Admin unless recovery is forced', async () => {
    const s = await enrolled();
    expect(s.email).toBeTruthy();
    await expect(
      createSuperAdmin(ownerClient, {
        email: 'second@example.test',
        fullName: 'Second',
        adminBaseUrl: BASE,
      }),
    ).rejects.toThrow(/active Super Admin already exists/);
    await expect(
      createSuperAdmin(ownerClient, {
        email: 'second@example.test',
        fullName: 'Second',
        adminBaseUrl: BASE,
        forceRecovery: true,
      }),
    ).resolves.toHaveProperty('link');
    await expect(
      createSuperAdmin(ownerClient, {
        email: s.email,
        fullName: 'Same',
        adminBaseUrl: BASE,
        forceRecovery: true,
      }),
    ).rejects.toThrow(/already belongs to a staff account/);
  });
});
