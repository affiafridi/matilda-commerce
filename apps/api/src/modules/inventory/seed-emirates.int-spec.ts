import { PrismaPg } from '@prisma/adapter-pg';
import { seed } from '../../cli/seed';
import { PrismaClient } from '../../generated/prisma/client';
import { createPool, testOwnerUrl } from '../../test-support/test-db';

/** The reference seed adds the seven emirates with English and Arabic names, and is idempotent. */
describe('reference seed: UAE emirates', () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testOwnerUrl() }) });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('seeds seven emirates with two languages and no cities or areas, twice over', async () => {
    const pool = createPool(testOwnerUrl());
    await pool.query('TRUNCATE delivery_area CASCADE');
    await pool.end();
    await seed(db, 'reference');
    await seed(db, 'reference');
    const areas = await db.deliveryArea.findMany({
      include: { translations: true },
      orderBy: { sortOrder: 'asc' },
    });
    expect(areas.map((a) => a.code)).toEqual([
      'abu-dhabi',
      'dubai',
      'sharjah',
      'ajman',
      'umm-al-quwain',
      'ras-al-khaimah',
      'fujairah',
    ]);
    for (const a of areas) {
      expect(a.level).toBe('EMIRATE');
      expect(a.parentId).toBeNull();
      expect(a.translations.map((t) => t.language).sort()).toEqual(['ar', 'en']);
    }
  });
});
