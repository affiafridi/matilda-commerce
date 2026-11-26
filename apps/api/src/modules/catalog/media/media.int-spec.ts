import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { configureApp } from '../../../app.setup';
import { seed } from '../../../cli/seed';
import { hashToken } from '../../../common/security/tokens';
import { loadEnv } from '../../../config/env';
import { withScope } from '../../../database/scope';
import { PrismaClient } from '../../../generated/prisma/client';
import { createPool, resetAuditLog, testAppUrl, testOwnerUrl } from '../../../test-support/test-db';

const ORIGIN = 'http://localhost:3001';
const API = '/api/v1/admin/brands';
const PLATFORM = { brandIds: [], platform: true } as const;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
interface Actor {
  call: (method: Method, path: string, body?: object) => request.Test;
}
describe('catalog media (uploads, library, gallery, delivery)', () => {
  let app: INestApplication;
  let owner: Pool;
  let db: PrismaClient;
  let counter = 0;
  let brandA = '';
  let brandB = '';
  let marketA = '';
  let manager: Actor;
  let managerB: Actor;
  let viewer: Actor;
  let marketManager: Actor;
  let nobody: Actor;
  let mediaDir = '';

  async function actor(
    label: string,
    permissions: string[],
    scope: { brandId: string; marketId?: string } | null,
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
      const role = await db.role.create({
        data: {
          name: `${label} ${++counter}`,
          kind: 'CUSTOM',
          permissions: { create: permissions.map((permissionKey) => ({ permissionKey })) },
        },
      });
      await db.staffRoleAssignment.create({
        data: { staffUserId: staff.id, roleId: role.id, ...scope },
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
        stepUpUntil: new Date(Date.now() + 3_600_000),
      },
    });
    return {
      call: (method, path, body) => {
        const req = request(app.getHttpServer())
          [method](`${API}${path}`)
          .set('Cookie', `matilda_staff=${token}`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrf);
        return body ? req.send(body) : req;
      },
    };
  }

  const asPlatform = <T>(fn: (tx: Parameters<Parameters<typeof withScope>[2]>[0]) => Promise<T>) =>
    withScope(db, PLATFORM, fn);

  const base = (brandId: string, rest: string) => `/${brandId}/catalog/${rest}`;

  async function auditCount(action: string): Promise<number> {
    const client = await owner.connect();
    try {
      await client.query(`SELECT set_config('app.platform','on',false)`);
      const res = await client.query('SELECT 1 FROM audit_log WHERE action = $1', [action]);
      return res.rowCount ?? 0;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
    mediaDir = mkdtempSync(path.join(tmpdir(), 'matilda-media-'));
    process.env.MEDIA_LOCAL_DIR = mediaDir;
    process.env.MEDIA_MAX_UPLOAD_BYTES = '300000';
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
    rmSync(mediaDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await owner.query('TRUNCATE staff_user, brand, branch, role, auth_attempt CASCADE');
    await resetAuditLog(owner);
    await seed(db, 'reference');
    const ae = await db.country.findUniqueOrThrow({ where: { iso2: 'AE' } });
    const { a, b, m } = await asPlatform(async (tx) => {
      const a = await tx.brand.create({ data: { slug: 'alpha', name: 'Alpha' } });
      const b = await tx.brand.create({ data: { slug: 'beta', name: 'Beta' } });
      const m = await tx.market.create({
        data: { brandId: a.id, countryId: ae.id, code: 'ae', timezone: 'Asia/Dubai' },
      });
      return { a, b, m };
    });
    brandA = a.id;
    brandB = b.id;
    marketA = m.id;
    await asPlatform((tx) =>
      tx.marketCurrency.create({
        data: { marketId: m.id, currencyCode: 'AED', isDefault: true },
      }),
    );
    const MANAGE = [
      'products.view',
      'products.create',
      'products.edit',
      'products.delete',
      'taxonomy.manage',
      'media.manage',
    ];
    manager = await actor('manager', MANAGE, { brandId: brandA });
    managerB = await actor('managerb', MANAGE, { brandId: brandB });
    viewer = await actor('viewer', ['products.view'], { brandId: brandA });
    marketManager = await actor('marketmanager', MANAGE, { brandId: brandA, marketId: marketA });
    nobody = await actor('nobody', [], null);
  });

  const P = (id: string, rest = '') => base(brandA, `products/${id}${rest}`);
  const M = (rest = '') => base(brandA, `media${rest}`);

  /** A small solid-colour picture; different colours give different files. */
  const picture = (
    r: number,
    options: { width?: number; height?: number; format?: 'jpeg' | 'png' | 'webp' } = {},
  ) =>
    sharp({
      create: {
        width: options.width ?? 400,
        height: options.height ?? 300,
        channels: 3,
        background: { r, g: 90, b: 120 },
      },
    })
      [options.format ?? 'jpeg']()
      .toBuffer();

  const upload = (who: Actor, brandId: string, file: Buffer, name = 'cake.jpg', alt?: string) => {
    const req = who.call('post', base(brandId, 'media')).attach('file', file, name);
    return alt ? req.field('altText', alt) : req;
  };

  async function newProduct(name: string, type: 'SIMPLE' | 'VARIABLE' = 'SIMPLE') {
    const res = await manager.call('post', base(brandA, 'products'), {
      type,
      translations: [{ language: 'en', name }],
    });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }
  async function asset(r: number, alt: string | undefined = 'A cake') {
    const res = await upload(manager, brandA, await picture(r), `p${r}.jpg`, alt);
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  it('stores a picture, its variants and English alt text, and audits the upload', async () => {
    const big = await picture(10, { width: 2000, height: 1000 });
    const res = await upload(manager, brandA, big, 'Birthday Cake!.jpg', 'A birthday cake');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'READY',
      contentType: 'image/jpeg',
      width: 2000,
      height: 1000,
      filename: 'Birthday Cake_.jpg',
      alt: [{ language: 'en', altText: 'A birthday cake' }],
    });
    const widths = Object.fromEntries(
      (res.body.variants as { kind: string; width: number }[]).map((v) => [v.kind, v.width]),
    );
    expect(widths).toEqual({ THUMBNAIL: 320, MEDIUM: 800, LARGE: 1600 });
    expect(await auditCount('media.upload')).toBe(1);
    const row = await asPlatform((tx) =>
      tx.mediaAsset.findFirstOrThrow({ where: { id: res.body.id } }),
    );
    expect(existsSync(path.join(mediaDir, row.storageKey))).toBe(true);
  });

  it('never enlarges small pictures', async () => {
    const res = await upload(manager, brandA, await picture(11, { width: 200, height: 100 }));
    expect(res.status).toBe(201);
    const widths = (res.body.variants as { width: number }[]).map((v) => v.width);
    expect(widths).toEqual([200, 200, 200]);
  });

  it('accepts PNG and WebP', async () => {
    const png = await upload(manager, brandA, await picture(12, { format: 'png' }), 'a.png');
    const webp = await upload(manager, brandA, await picture(13, { format: 'webp' }), 'a.webp');
    expect(png.body.contentType).toBe('image/png');
    expect(webp.body.contentType).toBe('image/webp');
  });

  it('removes metadata such as location from the stored original', async () => {
    const withExif = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-owner' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const res = await upload(manager, brandA, withExif);
    const row = await asPlatform((tx) =>
      tx.mediaAsset.findFirstOrThrow({ where: { id: res.body.id } }),
    );
    const stored = readFileSync(path.join(mediaDir, row.storageKey));
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(Buffer.from('secret-owner'))).toBe(false);
  });

  it('rejects files that are not pictures, whatever their name or declared type', async () => {
    const text = await upload(manager, brandA, Buffer.from('<script>alert(1)</script>'), 'a.png');
    expect(text.status).toBe(422);
    expect(text.body.code).toBe('UNSUPPORTED_IMAGE');
    const fake = await upload(
      manager,
      brandA,
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64),
      ]),
    );
    expect(fake.status).toBe(422);
    const svg = await upload(
      manager,
      brandA,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
      'a.svg',
    );
    expect(svg.status).toBe(422);
  });

  it('requires a file and enforces the size limit', async () => {
    const none = await manager.call('post', M(), {});
    expect(none.status).toBe(400);
    const noise = await sharp(randomBytes(900 * 900 * 3), {
      raw: { width: 900, height: 900, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(noise.length).toBeGreaterThan(300_000);
    const big = await upload(manager, brandA, noise, 'big.png');
    expect(big.status).toBe(413);
    expect(big.body.code).toBe('FILE_TOO_LARGE');
  });

  it('refuses the same picture twice in a brand but allows it in another brand', async () => {
    const file = await picture(20);
    expect((await upload(manager, brandA, file)).status).toBe(201);
    const again = await upload(manager, brandA, file);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('DUPLICATE_MEDIA');
    expect((await upload(managerB, brandB, file)).status).toBe(201);
  });

  it('needs media.manage over the whole brand', async () => {
    const file = await picture(30);
    for (const who of [viewer, nobody, managerB, marketManager]) {
      expect((await upload(who, brandA, file)).status).toBe(403);
      expect((await who.call('get', M())).status).toBe(403);
    }
    expect((await upload(manager, brandA, file)).status).toBe(201);
  });

  it('keeps each brand library separate', async () => {
    const a = await asset(40);
    const b = await upload(managerB, brandB, await picture(41));
    const list = await manager.call('get', M());
    expect(list.body.total).toBe(1);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    expect((await manager.call('get', M(`/${b.body.id}`))).status).toBe(404);
    expect((await manager.call('delete', M(`/${b.body.id}`))).status).toBe(404);
    expect((await managerB.call('get', base(brandB, `media/${a.id}`))).status).toBe(404);
  });

  it('replaces alt text and requires English', async () => {
    const a = await asset(50, '');
    const noEn = await manager.call('put', M(`/${a.id}/alt`), {
      translations: [{ language: 'ar', altText: 'cake-ar' }],
    });
    expect(noEn.status).toBe(422);
    expect(noEn.body.code).toBe('ENGLISH_REQUIRED');
    const ok = await manager.call('put', M(`/${a.id}/alt`), {
      translations: [
        { language: 'en', altText: 'A cake' },
        { language: 'ar', altText: 'cake-ar' },
      ],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.alt).toHaveLength(2);
    expect(await auditCount('media.alt.set')).toBe(1);
  });

  it('builds a product gallery in order with one main picture', async () => {
    const p = await newProduct('Rose');
    const [a, b, c] = [await asset(60), await asset(61), await asset(62)];
    const res = await manager.call('put', P(p.id, '/media'), {
      items: [
        { mediaAssetId: b.id },
        { mediaAssetId: a.id },
        { mediaAssetId: c.id, isPrimary: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([b.id, a.id, c.id]);
    expect(res.body.items.map((i: { isPrimary: boolean }) => i.isPrimary)).toEqual([
      false,
      false,
      true,
    ]);
    const def = await manager.call('put', P(p.id, '/media'), {
      items: [{ mediaAssetId: a.id }, { mediaAssetId: b.id }],
    });
    expect(def.body.items[0].isPrimary).toBe(true);
    expect((await manager.call('get', P(p.id, '/media'))).body.items).toHaveLength(2);
    expect(await auditCount('product.media.set')).toBe(2);
  });

  it('rejects bad gallery content', async () => {
    const p = await newProduct('Rose');
    const a = await asset(70);
    const noAlt = await asset(71, '');
    const other = await upload(managerB, brandB, await picture(72), 'x.jpg', 'Other');
    const put = (items: object[]) => manager.call('put', P(p.id, '/media'), { items });
    expect((await put([{ mediaAssetId: noAlt.id }])).body.code).toBe('ALT_REQUIRED');
    expect((await put([{ mediaAssetId: other.body.id }])).body.code).toBe('MEDIA_NOT_FOUND');
    expect((await put([{ mediaAssetId: a.id }, { mediaAssetId: a.id }])).body.code).toBe(
      'DUPLICATE_MEDIA_ITEM',
    );
    const twoMain = await put([
      { mediaAssetId: a.id, isPrimary: true },
      { mediaAssetId: noAlt.id, isPrimary: true },
    ]);
    expect(twoMain.body.code).toBe('PRIMARY_MEDIA_CONFLICT');
    const missing = await manager.call('put', P('018f0000-0000-7000-8000-000000000000', '/media'), {
      items: [],
    });
    expect(missing.status).toBe(404);
  });

  it('sets and clears a variation picture', async () => {
    const label = (text: string) => [{ language: 'en', label: text }];
    const attr = await manager.call('post', base(brandA, 'attributes'), {
      key: 'size',
      translations: label('Size'),
      values: ['1kg', '2kg'].map((k) => ({ key: k, translations: label(k) })),
    });
    const p = await newProduct('Cake', 'VARIABLE');
    await manager.call('put', P(p.id, '/attributes'), {
      attributes: [
        {
          attributeId: attr.body.id,
          drivesVariations: true,
          valueIds: attr.body.values.map((v: { id: string }) => v.id),
        },
      ],
    });
    const gen = await manager.call('post', P(p.id, '/variations/generate'), { skuPrefix: 'CK' });
    const v = gen.body[0].id as string;
    const a = await asset(80);
    const set = await manager.call('put', P(p.id, `/variations/${v}/media`), {
      mediaAssetId: a.id,
    });
    expect(set.status).toBe(200);
    const row = await asPlatform((tx) => tx.variation.findFirstOrThrow({ where: { id: v } }));
    expect(row.mediaAssetId).toBe(a.id);
    const noAlt = await asset(81, '');
    const refused = await manager.call('put', P(p.id, `/variations/${v}/media`), {
      mediaAssetId: noAlt.id,
    });
    expect(refused.body.code).toBe('ALT_REQUIRED');
    const clear = await manager.call('put', P(p.id, `/variations/${v}/media`), {
      mediaAssetId: null,
    });
    expect(clear.status).toBe(200);
    const other = await newProduct('Other');
    const wrong = await manager.call('put', P(other.id, `/variations/${v}/media`), {
      mediaAssetId: null,
    });
    expect(wrong.status).toBe(404);
    expect(await auditCount('variation.media.set')).toBe(2);
  });

  it('protects pictures in use and deletes the files of unused ones', async () => {
    const p = await newProduct('Rose');
    const a = await asset(90);
    await manager.call('put', P(p.id, '/media'), { items: [{ mediaAssetId: a.id }] });
    const blocked = await manager.call('delete', M(`/${a.id}`));
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('MEDIA_IN_USE');
    const row = await asPlatform((tx) =>
      tx.mediaAsset.findFirstOrThrow({ where: { id: a.id }, include: { variants: true } }),
    );
    await manager.call('put', P(p.id, '/media'), { items: [] });
    expect((await manager.call('delete', M(`/${a.id}`))).status).toBe(204);
    expect(existsSync(path.join(mediaDir, row.storageKey))).toBe(false);
    for (const v of row.variants) expect(existsSync(path.join(mediaDir, v.storageKey))).toBe(false);
    expect((await manager.call('get', M(`/${a.id}`))).status).toBe(404);
    expect(await auditCount('media.delete')).toBe(1);
  });

  it('serves variants publicly with long-lived cache headers but never the original', async () => {
    const a = await asset(100);
    const url = `/api/v1/media/${brandA}/${a.id}`;
    const res = await request(app.getHttpServer())
      .get(`${url}/medium`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect((await sharp(res.body as Buffer).metadata()).format).toBe('webp');
    expect((await request(app.getHttpServer()).get(`${url}/original`)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(`${url}/huge`)).status).toBe(404);
    const wrongBrand = await request(app.getHttpServer()).get(
      `/api/v1/media/${brandB}/${a.id}/medium`,
    );
    expect(wrongBrand.status).toBe(404);
  });
});
