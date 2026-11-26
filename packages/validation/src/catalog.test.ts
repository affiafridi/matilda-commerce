import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_VARIATIONS_PER_PRODUCT,
  effectivePrice,
  formatMinorUnits,
  generateVariationCombinations,
  marketPriceSchema,
  parseMajorToMinorUnits,
  skuSchema,
  slugSchema,
  slugify,
  variationKey,
} from './catalog.ts';

test('slugs accept Latin and Arabic letters and reject spaces, caps and double hyphens', () => {
  for (const ok of ['red-roses', 'cake-2kg', 'ورد-احمر'])
    assert.equal(slugSchema.safeParse(ok).success, true, ok);
  for (const bad of ['Red-Roses', 'red roses', 'red--roses', '-red', 'red-', '', 'a/b']) {
    assert.equal(slugSchema.safeParse(bad).success, false, bad);
  }
});

test('SKUs are upper-case and limited to safe characters', () => {
  assert.equal(skuSchema.safeParse('CAKE-CHOC-1KG').success, true);
  for (const bad of ['cake', 'CAKE 1', '-CAKE', ''])
    assert.equal(skuSchema.safeParse(bad).success, false, bad);
});

test('money is formatted and parsed without floating point', () => {
  assert.equal(formatMinorUnits(12550, 2), '125.50');
  assert.equal(formatMinorUnits(5, 2), '0.05');
  assert.equal(formatMinorUnits(-5, 2), '-0.05');
  assert.equal(formatMinorUnits(1500, 0), '1500');
  assert.equal(formatMinorUnits(1234, 3), '1.234');
  assert.equal(parseMajorToMinorUnits('125.5', 2), 12550);
  assert.equal(parseMajorToMinorUnits('0.07', 2), 7);
  assert.equal(parseMajorToMinorUnits('19', 2), 1900);
  assert.throws(() => parseMajorToMinorUnits('1.234', 2));
  assert.throws(() => parseMajorToMinorUnits('-1', 2));
  assert.throws(() => parseMajorToMinorUnits('abc', 2));
  assert.throws(() => formatMinorUnits(1.5, 2));
});

test('market prices need a lower sale price and consistent sale dates', () => {
  const base = {
    marketId: '0197b7e2-0000-7000-8000-000000000001',
    currency: 'AED',
    regular: 10000,
  };
  assert.equal(marketPriceSchema.safeParse(base).success, true);
  assert.equal(marketPriceSchema.safeParse({ ...base, sale: 8000 }).success, true);
  assert.equal(marketPriceSchema.safeParse({ ...base, sale: 10000 }).success, false);
  assert.equal(marketPriceSchema.safeParse({ ...base, regular: 10.5 }).success, false);
  assert.equal(marketPriceSchema.safeParse({ ...base, currency: 'aed' }).success, false);
  assert.equal(
    marketPriceSchema.safeParse({
      ...base,
      sale: 8000,
      saleStartsAt: '2026-12-02',
      saleEndsAt: '2026-12-01',
    }).success,
    false,
  );
  assert.equal(marketPriceSchema.safeParse({ ...base, saleStartsAt: '2026-12-01' }).success, false);
});

test('variation combinations are the cartesian product in a stable order', () => {
  const combos = generateVariationCombinations([
    { key: 'flavour', values: ['chocolate', 'vanilla'] },
    { key: 'size', values: ['1kg', '2kg', '3kg'] },
  ]);
  assert.equal(combos.length, 6);
  assert.deepEqual(combos[0], { flavour: 'chocolate', size: '1kg' });
  assert.deepEqual(combos[5], { flavour: 'vanilla', size: '3kg' });
  assert.equal(new Set(combos.map(variationKey)).size, 6);
  assert.equal(
    variationKey({ size: '1kg', flavour: 'vanilla' }),
    variationKey({ flavour: 'vanilla', size: '1kg' }),
  );
});

test('variation generation refuses empty, repeated and oversized input', () => {
  assert.deepEqual(generateVariationCombinations([]), []);
  assert.throws(() => generateVariationCombinations([{ key: 'a', values: [] }]));
  assert.throws(() => generateVariationCombinations([{ key: 'a', values: ['x', 'x'] }]));
  assert.throws(() =>
    generateVariationCombinations([
      { key: 'a', values: ['x'] },
      { key: 'a', values: ['y'] },
    ]),
  );
  const many = Array.from({ length: 11 }, (_, i) => `v${i}`);
  assert.throws(() =>
    generateVariationCombinations([
      { key: 'a', values: many },
      { key: 'b', values: many },
    ]),
  );
  assert.equal(MAX_VARIATIONS_PER_PRODUCT, 100);
});

test('slugify lower-cases, strips accents and joins words', () => {
  assert.equal(slugify('  Red Velvet & Roses! '), 'red-velvet-roses');
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
});

test('slugify keeps Arabic letters and returns empty when nothing usable remains', () => {
  assert.equal(slugify('باقة الورد'), 'باقة-الورد');
  assert.equal(slugify('!!!'), '');
});

test('slugify never exceeds the slug limit', () => {
  assert.ok(slugify('a'.repeat(300)).length <= 120);
});

test('effectivePrice applies the sale only inside its window', () => {
  const start = new Date('2026-12-01T00:00:00Z');
  const end = new Date('2026-12-10T00:00:00Z');
  const price = { regular: 20000, sale: 15000, saleStartsAt: start, saleEndsAt: end };
  assert.deepEqual(effectivePrice(price, new Date('2026-11-30T23:59:59Z')), {
    amount: 20000,
    onSale: false,
  });
  assert.deepEqual(effectivePrice(price, start), { amount: 15000, onSale: true });
  assert.deepEqual(effectivePrice(price, end), { amount: 20000, onSale: false });
  assert.deepEqual(effectivePrice({ regular: 100, sale: 80 }, new Date()), {
    amount: 80,
    onSale: true,
  });
  assert.deepEqual(effectivePrice({ regular: 100 }, new Date()), { amount: 100, onSale: false });
});
