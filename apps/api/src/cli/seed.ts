import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { withScope } from '../database/scope';
import { syncAccessControl } from '../modules/iam/access-control-sync';
import { BRANDS, COUNTRIES, CURRENCIES, DEV_HOSTS, LANGUAGES, UAE_MARKET } from './seed-data';

export type SeedTier = 'reference' | 'bootstrap' | 'dev';

/** Idempotent seeding. Runs as the owner role; row-level security still applies, so platform scope is set. */
export async function seed(client: PrismaClient, tier: SeedTier): Promise<void> {
  for (const c of CURRENCIES) {
    await client.currency.upsert({ where: { code: c.code }, create: c, update: {} });
  }
  for (const l of LANGUAGES) {
    await client.language.upsert({ where: { code: l.code }, create: l, update: {} });
  }
  for (const c of COUNTRIES) {
    await client.country.upsert({ where: { iso2: c.iso2 }, create: c, update: {} });
  }
  await syncAccessControl(client);
  if (tier === 'reference') return;

  const uae = await client.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
  await withScope(client, { brandIds: [], platform: true }, async (tx) => {
    for (const b of BRANDS) {
      const brand = await tx.brand.upsert({
        where: { slug: b.slug },
        create: { slug: b.slug, name: b.name, status: b.status },
        update: {},
      });
      const market = await tx.market.upsert({
        where: { brandId_countryId: { brandId: brand.id, countryId: uae.id } },
        create: {
          brandId: brand.id,
          countryId: uae.id,
          code: UAE_MARKET.code,
          timezone: UAE_MARKET.timezone,
        },
        update: {},
      });
      await tx.marketCurrency.upsert({
        where: {
          marketId_currencyCode: { marketId: market.id, currencyCode: UAE_MARKET.currency },
        },
        create: { marketId: market.id, currencyCode: UAE_MARKET.currency, isDefault: true },
        update: {},
      });
      for (const [i, code] of UAE_MARKET.languages.entries()) {
        await tx.marketLanguage.upsert({
          where: { marketId_languageCode: { marketId: market.id, languageCode: code } },
          create: { marketId: market.id, languageCode: code, isDefault: i === 0, sortOrder: i },
          update: {},
        });
      }
      const hosts = tier === 'dev' ? [b.host, DEV_HOSTS[b.slug]] : [b.host];
      for (const host of hosts) {
        if (!host) continue;
        await tx.brandDomain.upsert({
          where: { hostname: host },
          create: {
            brandId: brand.id,
            hostname: host,
            marketId: market.id,
            defaultLanguageCode: 'en',
            isPrimary: host === b.host,
          },
          update: {},
        });
      }
    }
  });

  if (tier === 'dev') {
    await withScope(client, { brandIds: [], platform: true }, async (tx) => {
      const markets = await tx.market.findMany({ where: { countryId: uae.id } });
      const branch = await tx.branch.upsert({
        where: { code: 'test-branch-dubai' },
        create: {
          code: 'test-branch-dubai',
          name: '[TEST] Dubai branch',
          countryId: uae.id,
          timezone: 'Asia/Dubai',
        },
        update: {},
      });
      for (const m of markets) {
        await tx.branchMarket.upsert({
          where: { branchId_marketId: { branchId: branch.id, marketId: m.id } },
          create: { branchId: branch.id, marketId: m.id, countryId: uae.id },
          update: {},
        });
      }
    });
  }
}

async function main(): Promise<void> {
  const tier = (process.argv[2] ?? 'bootstrap') as SeedTier;
  if (!['reference', 'bootstrap', 'dev'].includes(tier)) {
    throw new Error(`Unknown seed tier: ${tier}`);
  }
  if (tier === 'dev' && process.env.NODE_ENV === 'production') {
    throw new Error('The dev seed tier must never run in production');
  }
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (owner role) is not set');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await seed(client, tier);
    process.stdout.write(`Seeded tier: ${tier}\n`);
  } finally {
    await client.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
