import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { configureApp } from '../../app.setup';
import { loadEnv } from '../../config/env';
import { StorefrontContextService } from './storefront-context.service';
import { TenantResolver, type ResolvedTenant } from './tenant-resolver.service';

const SECRET = 'p'.repeat(40);

const tenants: Record<string, ResolvedTenant> = {
  'flower.test': {
    hostname: 'flower.test',
    brand: { id: 'b-flower', slug: 'flower' },
    market: { id: 'm-flower', code: 'ae' },
    language: 'en',
    isPrimary: true,
    redirectToPrimary: false,
  },
  'cake.test': {
    hostname: 'cake.test',
    brand: { id: 'b-cake', slug: 'cake' },
    market: null,
    language: null,
    isPrimary: true,
    redirectToPrimary: false,
  },
  'www.flower.test': {
    hostname: 'www.flower.test',
    brand: { id: 'b-flower', slug: 'flower' },
    market: { id: 'm-flower', code: 'ae' },
    language: 'en',
    isPrimary: false,
    redirectToPrimary: true,
  },
};

describe('GET /api/v1/storefront/context (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    process.env.TRUSTED_PROXY_SECRET = SECRET;
    const resolver = {
      resolve: async (host: string) => tenants[host] ?? null,
      isBrandOrigin: async (origin: string) => tenants[new URL(origin).hostname] !== undefined,
    };
    const contextService = {
      // Echoes what the service was given, so the tests prove which brand was resolved.
      load: async (t: ResolvedTenant) => ({
        brand: { slug: t.brand.slug, name: t.brand.slug, themeKey: t.brand.slug },
        market: null,
        markets: [],
        language: t.language,
        redirect: t.redirectToPrimary && !t.isPrimary ? { hostname: 'flower.test' } : null,
      }),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TenantResolver)
      .useValue(resolver)
      .overrideProvider(StorefrontContextService)
      .useValue(contextService)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app, loadEnv());
    await app.init();
  });

  afterAll(async () => {
    delete process.env.TRUSTED_PROXY_SECRET;
    await app.close();
  });

  const get = (host: string) =>
    request(app.getHttpServer()).get('/api/v1/storefront/context').set('Host', host);

  it('resolves the brand from the Host header', async () => {
    const res = await get('flower.test').expect(200);
    expect(res.body.brand.slug).toBe('flower');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns 404 for unknown hosts', async () => {
    const res = await get('unknown.test').expect(404);
    expect(res.body.code).toBe('TENANT_NOT_FOUND');
  });

  it('ignores forged brand headers and query parameters', async () => {
    const res = await get('flower.test')
      .query({ brand: 'cake', brandId: 'b-cake' })
      .set('X-Brand', 'cake')
      .set('X-Brand-Id', 'b-cake')
      .set('X-Forwarded-Host', 'cake.test')
      .expect(200);
    expect(res.body.brand.slug).toBe('flower');
  });

  it('honours X-Forwarded-Host only with the proxy secret', async () => {
    const res = await get('api.internal')
      .set('X-Forwarded-Host', 'cake.test')
      .set('X-Matilda-Proxy-Secret', SECRET)
      .expect(200);
    expect(res.body.brand.slug).toBe('cake');
    await get('api.internal')
      .set('X-Forwarded-Host', 'cake.test')
      .set('X-Matilda-Proxy-Secret', 'wrong')
      .expect(404);
  });

  it('reports the primary hostname for alias domains', async () => {
    const res = await get('www.flower.test').expect(200);
    expect(res.body.redirect).toEqual({ hostname: 'flower.test' });
  });

  it('allows CORS for registered brand domains only', async () => {
    const ok = await get('flower.test').set('Origin', 'https://cake.test').expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://cake.test');
    const denied = await get('flower.test').set('Origin', 'https://evil.test').expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
