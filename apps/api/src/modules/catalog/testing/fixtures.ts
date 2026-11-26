import type { OptionType, ProductType } from '@matilda/validation';

/**
 * Two modelled products used ONLY by tests (D3-14). They exercise the engine with the shapes the
 * owner described: a flower bouquet with piece counts, and a cake with flavour x size variations,
 * customization options and required and optional add-ons. They are never seeded or shown as data.
 */
export interface FixtureOption {
  key: string;
  type: OptionType;
  required: boolean;
  /** Price change in minor units; never changes SKU or stock. */
  priceDelta: number;
  maxLength?: number;
  choices?: readonly { key: string; priceDelta: number }[];
  /** Shown only when another option has a value (conditional visibility). */
  showWhen?: { option: string; filled?: true; equals?: string };
}

export interface FixtureAddonGroup {
  key: string;
  required: boolean;
  maxQuantity: number;
  items: readonly { key: string; priceDelta: number }[];
}

export interface FixtureProduct {
  slug: string;
  type: ProductType;
  names: { en: string; ar?: string };
  /** Variation-driving attributes; one SKU per combination. */
  attributes: readonly { key: string; values: readonly string[] }[];
  skuPrefix: string;
  /** Regular price in fils (AED, 2 minor-unit digits) per variation key, or one price for all. */
  price: number | Record<string, number>;
  options: readonly FixtureOption[];
  addonGroups: readonly FixtureAddonGroup[];
}

export const FLOWER_BOUQUET: FixtureProduct = {
  slug: 'signature-rose-bouquet',
  type: 'VARIABLE',
  names: { en: 'Signature Rose Bouquet', ar: 'باقة الورد المميزة' },
  attributes: [{ key: 'pieces', values: ['6', '12', '24', '36', '51'] }],
  skuPrefix: 'FL-ROSE',
  price: {
    'pieces=6': 15000,
    'pieces=12': 26000,
    'pieces=24': 48000,
    'pieces=36': 69000,
    'pieces=51': 92000,
  },
  options: [
    { key: 'card-message', type: 'TEXTAREA', required: false, priceDelta: 0, maxLength: 200 },
  ],
  addonGroups: [
    {
      key: 'extras',
      required: false,
      maxQuantity: 3,
      items: [
        { key: 'glass-vase', priceDelta: 6000 },
        { key: 'chocolate-box', priceDelta: 4500 },
      ],
    },
  ],
};

export const CAKE: FixtureProduct = {
  slug: 'classic-celebration-cake',
  type: 'VARIABLE',
  names: { en: 'Classic Celebration Cake', ar: 'كعكة الاحتفال الكلاسيكية' },
  attributes: [
    { key: 'flavour', values: ['chocolate', 'vanilla', 'red-velvet'] },
    { key: 'size', values: ['1kg', '2kg', '3kg'] },
  ],
  skuPrefix: 'CK-CLASSIC',
  price: {
    'flavour=chocolate|size=1kg': 18000,
    'flavour=chocolate|size=2kg': 32000,
    'flavour=chocolate|size=3kg': 45000,
    'flavour=vanilla|size=1kg': 17000,
    'flavour=vanilla|size=2kg': 30000,
    'flavour=vanilla|size=3kg': 43000,
    'flavour=red-velvet|size=1kg': 19000,
    'flavour=red-velvet|size=2kg': 34000,
    'flavour=red-velvet|size=3kg': 48000,
  },
  options: [
    { key: 'cake-message', type: 'TEXT', required: false, priceDelta: 0, maxLength: 40 },
    {
      key: 'message-colour',
      type: 'SELECT',
      required: true,
      priceDelta: 0,
      choices: [
        { key: 'white', priceDelta: 0 },
        { key: 'gold', priceDelta: 1500 },
      ],
      showWhen: { option: 'cake-message', filled: true },
    },
    { key: 'reference-image', type: 'FILE', required: false, priceDelta: 2500 },
    { key: 'candles', type: 'CHECKBOX', required: false, priceDelta: 500 },
  ],
  addonGroups: [
    {
      key: 'cake-box',
      required: true,
      maxQuantity: 1,
      items: [
        { key: 'standard-box', priceDelta: 0 },
        { key: 'premium-box', priceDelta: 2500 },
      ],
    },
    {
      key: 'balloons',
      required: false,
      maxQuantity: 2,
      items: [{ key: 'balloon-bunch', priceDelta: 3500 }],
    },
  ],
};

export const FIXTURE_PRODUCTS: readonly FixtureProduct[] = [FLOWER_BOUQUET, CAKE];
