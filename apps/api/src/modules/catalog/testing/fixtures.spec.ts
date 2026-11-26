import {
  generateVariationCombinations,
  languageCodeSchema,
  marketPriceSchema,
  skuSchema,
  slugSchema,
  variationKey,
} from '@matilda/validation';
import { CAKE, FIXTURE_PRODUCTS, FLOWER_BOUQUET } from './fixtures';

const MARKET_ID = '0197b7e2-0000-7000-8000-000000000001';

describe('catalog test fixtures', () => {
  it('use valid slugs and have English names (Arabic optional)', () => {
    for (const p of FIXTURE_PRODUCTS) {
      expect(slugSchema.safeParse(p.slug).success).toBe(true);
      expect(p.names.en.length).toBeGreaterThan(0);
      expect(languageCodeSchema.safeParse('en').success).toBe(true);
    }
  });

  it('generate the expected variations, each with a valid unique SKU and a valid AED price', () => {
    const skus = new Set<string>();
    for (const p of FIXTURE_PRODUCTS) {
      const combos = generateVariationCombinations(p.attributes);
      expect(combos.length).toBe(p.attributes.reduce((n, a) => n * a.values.length, 1));
      for (const combo of combos) {
        const key = variationKey(combo);
        const sku = `${p.skuPrefix}-${Object.values(combo).join('-').toUpperCase()}`;
        expect(skuSchema.safeParse(sku).success).toBe(true);
        expect(skus.has(sku)).toBe(false);
        skus.add(sku);
        const regular = typeof p.price === 'number' ? p.price : p.price[key];
        expect(regular).toBeDefined();
        expect(
          marketPriceSchema.safeParse({ marketId: MARKET_ID, currency: 'AED', regular }).success,
        ).toBe(true);
      }
      if (typeof p.price !== 'number') {
        expect(Object.keys(p.price).sort()).toEqual(combos.map(variationKey).sort());
      }
    }
    expect(generateVariationCombinations(CAKE.attributes)).toHaveLength(9);
    expect(generateVariationCombinations(FLOWER_BOUQUET.attributes)).toHaveLength(5);
  });

  it('keep customization options out of the variation attributes (they never change SKU or stock)', () => {
    for (const p of FIXTURE_PRODUCTS) {
      const attributeKeys = new Set(p.attributes.map((a) => a.key));
      for (const o of p.options) expect(attributeKeys.has(o.key)).toBe(false);
    }
  });

  it('only reference options that exist in conditional rules, and use integer prices', () => {
    for (const p of FIXTURE_PRODUCTS) {
      const optionKeys = new Set(p.options.map((o) => o.key));
      for (const o of p.options) {
        if (o.showWhen) expect(optionKeys.has(o.showWhen.option)).toBe(true);
        expect(Number.isInteger(o.priceDelta)).toBe(true);
        for (const c of o.choices ?? []) expect(Number.isInteger(c.priceDelta)).toBe(true);
      }
      for (const g of p.addonGroups) {
        expect(g.maxQuantity).toBeGreaterThan(0);
        for (const i of g.items) expect(Number.isInteger(i.priceDelta)).toBe(true);
      }
    }
  });

  it('cover required and optional add-ons, a file option and a conditional option (Cake parity)', () => {
    expect(CAKE.addonGroups.some((g) => g.required)).toBe(true);
    expect(CAKE.addonGroups.some((g) => !g.required)).toBe(true);
    expect(CAKE.options.some((o) => o.type === 'FILE')).toBe(true);
    expect(CAKE.options.some((o) => o.showWhen)).toBe(true);
  });
});
