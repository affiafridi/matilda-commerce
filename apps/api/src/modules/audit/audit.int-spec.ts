import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import type { RequestContextService } from '../../common/context/request-context.service';
import { uuidv7 } from '../../common/ids/uuid7';
import type { PrismaService } from '../../database/prisma.service';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../test-support/test-db';
import { AuditService } from './audit.service';

describe('audit log (database)', () => {
  let owner: Pool;
  let appPool: Pool;
  let client: PrismaClient;
  let audit: AuditService;

  const brandA = uuidv7();
  const brandB = uuidv7();
  const actor = { type: 'STAFF', id: uuidv7() } as const;

  /** Owner connection with platform scope: forced row-level security applies to the owner too. */
  const asPlatform = async (sql: string, params: unknown[] = []) => {
    const c = await owner.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.platform', 'on', true)");
      const res = await c.query(sql, params);
      await c.query('COMMIT');
      return res;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  };

  const record = (over: Partial<Parameters<AuditService['recordStandalone']>[0]> = {}) =>
    audit.recordStandalone({
      action: 'test.event',
      targetType: 'thing',
      actor,
      ...over,
    });

  beforeAll(() => {
    owner = createPool(testOwnerUrl());
    appPool = createPool(testAppUrl());
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: testAppUrl() }) });
    const context = {
      actor: { type: 'staff', id: actor.id },
      requestId: 'req-1',
      ip: '203.0.113.9',
      userAgent: 'jest',
    } as unknown as RequestContextService;
    audit = new AuditService({ client } as unknown as PrismaService, context);
  });

  afterAll(async () => {
    await resetAuditLog(owner);
    await Promise.all([owner.end(), appPool.end(), client.$disconnect()]);
  });

  beforeEach(async () => {
    await resetAuditLog(owner);
    await owner.query("DELETE FROM role WHERE name LIKE 'audit-%'");
  });

  describe('append-only', () => {
    beforeEach(async () => {
      await record({ action: 'seed.row' });
    });

    const attempts = [
      "UPDATE audit_log SET action = 'tampered'",
      'DELETE FROM audit_log',
      'TRUNCATE audit_log',
    ];

    it.each(attempts)('rejects `%s` for the runtime role', async (sql) => {
      await expect(appPool.query(sql)).rejects.toMatchObject({ code: '42501' });
    });

    it('denies UPDATE and DELETE to the owner through row-level security (no policy)', async () => {
      expect((await asPlatform("UPDATE audit_log SET action = 'tampered'")).rowCount).toBe(0);
      expect((await asPlatform('DELETE FROM audit_log')).rowCount).toBe(0);
    });

    it('rejects TRUNCATE for the owner (trigger)', async () => {
      await expect(asPlatform('TRUNCATE audit_log')).rejects.toThrow(/append-only/);
    });

    it.each(["UPDATE audit_log SET action = 'tampered'", 'DELETE FROM audit_log'])(
      'still rejects `%s` by trigger if row-level security were ever switched off',
      async (sql) => {
        const c = await owner.connect();
        try {
          await c.query('BEGIN');
          await c.query('ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY');
          await expect(c.query(sql)).rejects.toThrow(/append-only/);
        } finally {
          await c.query('ROLLBACK');
          c.release();
        }
      },
    );

    it('leaves the row untouched', async () => {
      const { rows } = await asPlatform('SELECT action FROM audit_log');
      expect(rows).toEqual([{ action: 'seed.row' }]);
    });
  });

  describe('transactional recording', () => {
    it('commits the change and its audit row together', async () => {
      await client.$transaction(async (tx) => {
        await tx.role.create({ data: { name: 'audit-commit', kind: 'CUSTOM' } });
        await audit.record(tx, { action: 'role.create', targetType: 'role', actor });
      });
      const rows = await asPlatform(`SELECT 1 FROM audit_log WHERE action = 'role.create'`);
      const roles = await owner.query(`SELECT 1 FROM role WHERE name = 'audit-commit'`);
      expect(rows.rowCount).toBe(1);
      expect(roles.rowCount).toBe(1);
      await owner.query(`DELETE FROM role WHERE name = 'audit-commit'`);
    });

    it('rolls the audit row back with the change', async () => {
      await expect(
        client.$transaction(async (tx) => {
          await tx.role.create({ data: { name: 'audit-rollback', kind: 'CUSTOM' } });
          await audit.record(tx, { action: 'role.create', targetType: 'role', actor });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect((await asPlatform(`SELECT 1 FROM audit_log`)).rowCount).toBe(0);
      expect((await owner.query(`SELECT 1 FROM role WHERE name = 'audit-rollback'`)).rowCount).toBe(
        0,
      );
    });

    it('fills actor, request metadata and brand from context and stores redacted JSON', async () => {
      await record({
        action: 'staff.create',
        brandId: brandA,
        before: { email: 'jane.doe@example.com', passwordHash: 'argon2id$secret' },
        after: { token: 'abc123', name: 'Jane' },
      });
      const { rows } = await asPlatform(
        `SELECT actor_type, actor_id, ip, user_agent, request_id, brand_id, before, after FROM audit_log`,
      );
      expect(rows[0]).toMatchObject({
        actor_type: 'STAFF',
        actor_id: actor.id,
        ip: '203.0.113.9',
        user_agent: 'jest',
        request_id: 'req-1',
        brand_id: brandA,
      });
      const stored = JSON.stringify(rows[0]);
      expect(stored).not.toMatch(/jane\.doe@|argon2id|abc123/);
      expect(rows[0].before.email).toBe('j***@example.com');
    });

    it('never throws from standalone recording when the write fails', async () => {
      await expect(
        audit.recordStandalone({
          action: 'x',
          targetType: 'y',
          actor: { type: 'STAFF', id: 'not-a-uuid' },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('scoped queries', () => {
    beforeEach(async () => {
      await record({ action: 'brand.update', brandId: brandA });
      await record({ action: 'brand.update', brandId: brandB });
      await record({ action: 'role.create', brandId: null, targetType: 'role' });
      await record({ action: 'role.update', brandId: null, targetType: 'role' });
      await record({ action: 'access.denied', brandId: brandA, outcome: 'DENIED' });
    });

    it('shows a brand only its own rows, never platform-level or other brands', async () => {
      const page = await audit.query({ brandIds: [brandA] });
      expect(page.items.map((r) => r.brandId)).toEqual([brandA, brandA]);
    });

    it('shows everything to the platform and nothing without a scope', async () => {
      expect((await audit.query({ brandIds: [], platform: true })).items).toHaveLength(5);
      expect((await audit.query({ brandIds: [] })).items).toHaveLength(0);
    });

    it('filters by action prefix, outcome and target', async () => {
      const scope = { brandIds: [], platform: true };
      expect((await audit.query(scope, { action: 'role.' })).items).toHaveLength(2);
      expect((await audit.query(scope, { action: 'brand.update' })).items).toHaveLength(2);
      expect((await audit.query(scope, { outcome: 'DENIED' })).items).toHaveLength(1);
      expect((await audit.query(scope, { targetType: 'role' })).items).toHaveLength(2);
      expect((await audit.query(scope, { actorId: actor.id, brandId: brandB })).items).toHaveLength(
        1,
      );
    });

    it('pages newest-first without gaps or repeats', async () => {
      const scope = { brandIds: [], platform: true };
      const seen: string[] = [];
      let before: bigint | undefined;
      for (let i = 0; i < 5; i++) {
        const page = await audit.query(scope, { limit: 2, before });
        seen.push(...page.items.map((r) => r.id));
        if (!page.nextBefore) break;
        before = BigInt(page.nextBefore);
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      expect(seen).toEqual([...seen].sort((a, b) => Number(BigInt(b) - BigInt(a))));
    });
  });

  describe('indexes (EXPLAIN)', () => {
    beforeAll(async () => {
      await resetAuditLog(owner);
      await owner.query(
        `INSERT INTO audit_log (occurred_at, actor_type, actor_id, brand_id, action, target_type, target_id)
         SELECT now() - (g % 400) * interval '1 day',
                'STAFF', ('00000000-0000-4000-8000-' || lpad((g % 200)::text, 12, '0'))::uuid,
                ('00000000-0000-4000-9000-' || lpad((g % 40)::text, 12, '0'))::uuid,
                'bulk.event', 'thing', 'target-' || (g % 3000)
         FROM generate_series(1, 30000) g`,
      );
      await owner.query('ANALYZE audit_log');
    });

    const plan = async (sql: string, params: unknown[]): Promise<string> => {
      const { rows } = await owner.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
      return JSON.stringify(rows[0]['QUERY PLAN']);
    };

    it('uses the brand index for brand-scoped pages', async () => {
      const p = await plan(
        'SELECT * FROM audit_log WHERE brand_id = $1 ORDER BY id DESC LIMIT 51',
        ['00000000-0000-4000-9000-000000000007'],
      );
      expect(p).toContain('audit_log_brand_id_id_idx');
    });

    it('uses the actor index for per-actor history', async () => {
      const p = await plan(
        `SELECT * FROM audit_log WHERE actor_type = 'STAFF' AND actor_id = $1 ORDER BY id DESC LIMIT 51`,
        ['00000000-0000-4000-8000-000000000042'],
      );
      expect(p).toContain('audit_log_actor_type_actor_id_id_idx');
    });

    it('uses the target index for per-record history', async () => {
      const p = await plan(
        `SELECT * FROM audit_log WHERE target_type = 'thing' AND target_id = $1 ORDER BY id DESC LIMIT 51`,
        ['target-17'],
      );
      expect(p).toContain('audit_log_target_type_target_id_idx');
    });

    it('uses the time index for narrow time ranges', async () => {
      const p = await plan(
        `SELECT * FROM audit_log WHERE occurred_at >= now() - interval '12 hours'`,
        [],
      );
      expect(p).toContain('audit_log_occurred_at_idx');
    });
  });
});
