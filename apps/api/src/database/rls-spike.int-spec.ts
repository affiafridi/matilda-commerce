import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { uuidv7 } from '../common/ids/uuid7';
import { createPool, testAppUrl, testOwnerUrl } from '../test-support/test-db';

/**
 * Step 2.2 spike (docs/PHASE-2-PLAN.md D2-03): proves that row-level security driven by a
 * per-transaction setting works with Prisma 7 + @prisma/adapter-pg and a non-owner role, and that
 * pooled connections cannot leak one brand's context into another request.
 */
describe('RLS with Prisma 7 + driver adapter (spike)', () => {
  const brandA = uuidv7();
  const brandB = uuidv7();
  let owner: Pool;
  let prisma: PrismaClient;

  /** The pattern the real data-access layer will use: context set with SET LOCAL semantics. */
  const asBrands = <T>(
    brandIds: string[],
    fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
  ) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.brand_ids', ${brandIds.join(',')}, true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    owner = createPool(testOwnerUrl());
    await owner.query('DROP TABLE IF EXISTS spike_item');
    await owner.query(`
      CREATE TABLE spike_item (
        id serial PRIMARY KEY,
        brand_id uuid NOT NULL,
        name text NOT NULL
      )`);
    await owner.query('ALTER TABLE spike_item ENABLE ROW LEVEL SECURITY');
    await owner.query('ALTER TABLE spike_item FORCE ROW LEVEL SECURITY');
    await owner.query(`
      CREATE POLICY brand_isolation ON spike_item
        USING (brand_id = ANY (string_to_array(current_setting('app.brand_ids', true), ',')::uuid[]))
        WITH CHECK (brand_id = ANY (string_to_array(current_setting('app.brand_ids', true), ',')::uuid[]))`);

    // Seed through the owner; FORCE RLS applies to the owner too, so it sets context as well.
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.brand_ids', $1, true)", [`${brandA},${brandB}`]);
      await client.query(
        'INSERT INTO spike_item (brand_id, name) VALUES ($1, $2), ($1, $3), ($4, $5)',
        [brandA, 'a1', 'a2', brandB, 'b1'],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testAppUrl(), max: 3 }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await owner.query('DROP TABLE IF EXISTS spike_item');
    await owner.end();
  });

  it('shows only the current brand rows', async () => {
    const rows = await asBrands(
      [brandA],
      (tx) => tx.$queryRaw<{ name: string }[]>`SELECT name FROM spike_item ORDER BY name`,
    );
    expect(rows.map((r) => r.name)).toEqual(['a1', 'a2']);
  });

  it('shows rows of several brands only when the actor is permitted for several', async () => {
    const rows = await asBrands(
      [brandA, brandB],
      (tx) => tx.$queryRaw<{ name: string }[]>`SELECT name FROM spike_item ORDER BY name`,
    );
    expect(rows.map((r) => r.name)).toEqual(['a1', 'a2', 'b1']);
  });

  it('denies everything when no context is set (deny by default)', async () => {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM spike_item`;
    expect(Number(rows[0]?.count)).toBe(0);
    const emptyContext = await asBrands(
      [],
      (tx) => tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM spike_item`,
    );
    expect(Number(emptyContext[0]?.count)).toBe(0);
  });

  it('blocks writes into another brand (WITH CHECK)', async () => {
    await expect(
      asBrands(
        [brandA],
        (tx) =>
          tx.$executeRaw`INSERT INTO spike_item (brand_id, name) VALUES (${brandB}::uuid, 'sneaky')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete another brand rows', async () => {
    const updated = await asBrands(
      [brandA],
      (tx) =>
        tx.$executeRaw`UPDATE spike_item SET name = 'hacked' WHERE brand_id = ${brandB}::uuid`,
    );
    const deleted = await asBrands(
      [brandA],
      (tx) => tx.$executeRaw`DELETE FROM spike_item WHERE brand_id = ${brandB}::uuid`,
    );
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
    const stillThere = await asBrands(
      [brandB],
      (tx) => tx.$queryRaw<{ name: string }[]>`SELECT name FROM spike_item`,
    );
    expect(stillThere.map((r) => r.name)).toEqual(['b1']);
  });

  it('does not leak context between pooled connections under concurrency', async () => {
    const jobs = Array.from({ length: 60 }, (_, i) => {
      const brand = i % 2 === 0 ? brandA : brandB;
      const expected = brand === brandA ? ['a1', 'a2'] : ['b1'];
      return asBrands([brand], async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(0.005)`;
        const rows = await tx.$queryRaw<
          { name: string }[]
        >`SELECT name FROM spike_item ORDER BY name`;
        return { got: rows.map((r) => r.name), expected };
      });
    });
    for (const { got, expected } of await Promise.all(jobs)) {
      expect(got).toEqual(expected);
    }
    // After the burst, a plain query on any pooled connection must still see nothing.
    for (let i = 0; i < 10; i += 1) {
      const rows = await prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM spike_item`;
      expect(Number(rows[0]?.count)).toBe(0);
    }
  });

  it('the runtime role cannot disable RLS or change policies', async () => {
    await expect(
      prisma.$executeRawUnsafe('ALTER TABLE spike_item DISABLE ROW LEVEL SECURITY'),
    ).rejects.toThrow(/must be owner/);
    await expect(
      prisma.$executeRawUnsafe('DROP POLICY brand_isolation ON spike_item'),
    ).rejects.toThrow(/must be owner/);
  });
});
