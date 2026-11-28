import type { CartLineInput } from '@matilda/validation';

/**
 * Modelled carts used ONLY by tests (as D3-14 and the Phase 4 delivery fixtures did). They are not
 * the owner's real products or prices and are never seeded or shown as data. They prove the engine
 * copes with a simple flower order and a complex cake order at once. Product ids are placeholders
 * that the integration suites replace with the ids of the products they create.
 */
export interface FixtureCart {
  code: string;
  currency: string;
  lines: readonly CartLineInput[];
}

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const FLOWER_CART: FixtureCart = {
  code: 'fx-flower-bouquet',
  currency: 'AED',
  lines: [{ productId: id(1), quantity: 1, options: [], addOns: [], bundleChoices: [] }],
};

export const CAKE_CART: FixtureCart = {
  code: 'fx-cake-custom',
  currency: 'AED',
  lines: [
    {
      productId: id(2),
      variationId: id(3),
      quantity: 1,
      options: [{ optionId: id(4), valueIds: [id(5)], text: 'Happy birthday' }],
      addOns: [{ addOnId: id(6), quantity: 2 }],
      bundleChoices: [],
    },
  ],
};

export const FIXTURE_CARTS: readonly FixtureCart[] = [FLOWER_CART, CAKE_CART];
