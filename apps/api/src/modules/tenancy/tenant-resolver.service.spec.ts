import type { PrismaService } from '../../database/prisma.service';
import { NEGATIVE_TTL_MS, POSITIVE_TTL_MS, TenantResolver } from './tenant-resolver.service';

const ROW = {
  brand_id: 'b1',
  brand_slug: 'brand-one',
  market_id: 'm1',
  market_code: 'ae',
  language_code: 'en',
  is_primary: true,
  redirect_to_primary: false,
};

function setup(rows: unknown[][]) {
  const queryRaw = jest.fn();
  for (const r of rows) queryRaw.mockResolvedValueOnce(r);
  queryRaw.mockResolvedValue([]);
  const prisma = { client: { $queryRaw: queryRaw } } as unknown as PrismaService;
  return { resolver: new TenantResolver(prisma), queryRaw };
}

describe('TenantResolver', () => {
  afterEach(() => jest.useRealTimers());

  it('maps the row, normalizes the host and caches the result', async () => {
    const { resolver, queryRaw } = setup([[ROW]]);
    const first = await resolver.resolve('Brand.Example:443');
    expect(first).toEqual({
      hostname: 'brand.example',
      brand: { id: 'b1', slug: 'brand-one' },
      market: { id: 'm1', code: 'ae' },
      language: 'en',
      isPrimary: true,
      redirectToPrimary: false,
    });
    await resolver.resolve('brand.example');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns null for unknown hosts and does not query for invalid input', async () => {
    const { resolver, queryRaw } = setup([]);
    expect(await resolver.resolve('unknown.example')).toBeNull();
    expect(await resolver.resolve('bad host')).toBeNull();
    expect(await resolver.resolve(undefined)).toBeNull();
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('expires cached entries (shorter for unknown hosts)', async () => {
    jest.useFakeTimers();
    const { resolver, queryRaw } = setup([[], [ROW]]);
    expect(await resolver.resolve('new.example')).toBeNull();
    jest.advanceTimersByTime(NEGATIVE_TTL_MS + 1);
    expect(await resolver.resolve('new.example')).not.toBeNull();
    jest.advanceTimersByTime(POSITIVE_TTL_MS - 1);
    await resolver.resolve('new.example');
    expect(queryRaw).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(2);
    await resolver.resolve('new.example');
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });

  it('invalidates a host, a brand (including unknown-host entries) and everything', async () => {
    const { resolver, queryRaw } = setup([[ROW], [ROW], [ROW], [ROW]]);
    await resolver.resolve('a.example');
    resolver.invalidateHost('A.example');
    await resolver.resolve('a.example');
    expect(queryRaw).toHaveBeenCalledTimes(2);

    resolver.invalidateBrand('b1');
    await resolver.resolve('a.example');
    expect(queryRaw).toHaveBeenCalledTimes(3);

    resolver.invalidateAll();
    await resolver.resolve('a.example');
    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('accepts only http(s) origins of registered domains', async () => {
    const { resolver } = setup([[ROW]]);
    expect(await resolver.isBrandOrigin('https://brand.example')).toBe(true);
    expect(await resolver.isBrandOrigin('ftp://brand.example')).toBe(false);
    expect(await resolver.isBrandOrigin('not a url')).toBe(false);
    expect(await resolver.isBrandOrigin('https://other.example')).toBe(false);
  });
});
