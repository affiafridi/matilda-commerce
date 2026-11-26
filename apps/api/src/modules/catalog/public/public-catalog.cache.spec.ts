import { PublicCatalogCache, catalogCacheKey } from './public-catalog.cache';

const scope = { brandId: 'b1', marketId: 'm1', language: 'en' };

describe('catalogCacheKey', () => {
  it('always includes brand, market and language', () => {
    const key = catalogCacheKey(scope, 'products', { page: 1 });
    expect(key).toContain('b1');
    expect(key).toContain('m1');
    expect(key).toContain('|en|');
  });

  it('differs when any of brand, market, language or parameters differ', () => {
    const base = catalogCacheKey(scope, 'products', { page: 1 });
    expect(catalogCacheKey({ ...scope, brandId: 'b2' }, 'products', { page: 1 })).not.toBe(base);
    expect(catalogCacheKey({ ...scope, marketId: 'm2' }, 'products', { page: 1 })).not.toBe(base);
    expect(catalogCacheKey({ ...scope, language: 'ar' }, 'products', { page: 1 })).not.toBe(base);
    expect(catalogCacheKey(scope, 'products', { page: 2 })).not.toBe(base);
    expect(catalogCacheKey(scope, 'categories', { page: 1 })).not.toBe(base);
  });

  it('ignores parameter order', () => {
    expect(catalogCacheKey(scope, 'p', { a: 1, b: 2 })).toBe(
      catalogCacheKey(scope, 'p', { b: 2, a: 1 }),
    );
  });
});

describe('PublicCatalogCache', () => {
  afterEach(() => jest.useRealTimers());

  it('serves repeated reads from memory until the entry expires', async () => {
    jest.useFakeTimers();
    const cache = new PublicCatalogCache();
    const load = jest.fn(() => Promise.resolve('value'));
    await cache.get('k', load);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(31_000);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one load between simultaneous requests and does not cache failures', async () => {
    const cache = new PublicCatalogCache();
    let calls = 0;
    const slow = () => new Promise<number>((resolve) => setTimeout(() => resolve(++calls), 10));
    const [a, b] = await Promise.all([cache.get('s', slow), cache.get('s', slow)]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    await expect(cache.get('f', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(cache.get('f', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
