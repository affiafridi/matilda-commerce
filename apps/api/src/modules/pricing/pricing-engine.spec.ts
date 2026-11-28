import type { CartLineInput } from '@matilda/validation';
import {
  composeTotals,
  priceCart,
  type OptionGroupDef,
  type ProductDef,
  type PricingInputLine,
} from './pricing-engine';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const en = (text: string) => ({ en: text });
const AT = new Date('2026-12-01T10:00:00Z');

const SIMPLE = id(1);
const VARIABLE = id(2);
const BUNDLE = id(3);
const VAR_SMALL = id(10);
const VAR_LARGE = id(11);
const VAR_OFF = id(12);

const price = (regular: number, extra: Partial<ProductDef['price'] & object> = {}) => ({
  regular,
  sale: null,
  saleStartsAt: null,
  saleEndsAt: null,
  ...extra,
});

const group = (over: Partial<OptionGroupDef> & { id: string; key: string }): OptionGroupDef => ({
  type: 'SELECT',
  label: en(over.key),
  required: false,
  minSelect: 0,
  maxSelect: null,
  maxLength: null,
  groupDeltaMinor: 0,
  choices: [],
  rules: [],
  ...over,
});

const product = (over: Partial<ProductDef> & { id: string }): ProductDef => ({
  type: 'SIMPLE',
  name: en('Product'),
  sku: 'SKU-1',
  minQuantity: 1,
  maxQuantity: null,
  price: price(10000),
  variations: [],
  options: [],
  addonGroups: [],
  bundleItems: [],
  ...over,
});

const line = (over: Partial<PricingInputLine> & { productId: string }): PricingInputLine => ({
  quantity: 1,
  options: [],
  addOns: [],
  bundleChoices: [],
  ...over,
});

const catalog = (...defs: ProductDef[]) => new Map(defs.map((d) => [d.id, d]));
const codes = (r: ReturnType<typeof priceCart>) => r.errors.map((e) => e.code);

describe('priceCart: base prices', () => {
  it('prices a simple product at its regular price times the quantity', () => {
    const r = priceCart(
      catalog(product({ id: SIMPLE })),
      [line({ productId: SIMPLE, quantity: 3 })],
      AT,
    );
    expect(r.errors).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({
      kind: 'PRODUCT',
      unitMinor: 10000,
      quantity: 3,
      totalMinor: 30000,
      discountMinor: 0,
      taxMinor: 0,
      sku: 'SKU-1',
    });
    expect(r.subtotalMinor).toBe(30000);
  });

  it('uses the sale price only inside its window', () => {
    const sale = price(10000, {
      sale: 8000,
      saleStartsAt: new Date('2026-12-01T00:00:00Z'),
      saleEndsAt: new Date('2026-12-02T00:00:00Z'),
    });
    const defs = catalog(product({ id: SIMPLE, price: sale }));
    const at = (d: string) => priceCart(defs, [line({ productId: SIMPLE })], new Date(d)).lines[0]!;
    expect(at('2026-11-30T23:59:59Z').unitMinor).toBe(10000);
    expect(at('2026-12-01T00:00:00Z').unitMinor).toBe(8000);
    expect(at('2026-12-01T23:59:59Z').unitMinor).toBe(8000);
    expect(at('2026-12-02T00:00:00Z').unitMinor).toBe(10000);
  });

  it('prices a variable product per variation and refuses inactive or missing ones', () => {
    const defs = catalog(
      product({
        id: VARIABLE,
        type: 'VARIABLE',
        sku: null,
        price: null,
        variations: [
          { id: VAR_SMALL, sku: 'V-S', active: true, price: price(5000) },
          { id: VAR_LARGE, sku: 'V-L', active: true, price: price(9000) },
          { id: VAR_OFF, sku: 'V-X', active: false, price: price(1000) },
        ],
      }),
    );
    const ok = priceCart(
      defs,
      [line({ productId: VARIABLE, variationId: VAR_LARGE, quantity: 2 })],
      AT,
    );
    expect(ok.lines[0]).toMatchObject({
      unitMinor: 9000,
      totalMinor: 18000,
      sku: 'V-L',
      variationId: VAR_LARGE,
    });
    expect(codes(priceCart(defs, [line({ productId: VARIABLE })], AT))).toEqual([
      'VARIATION_REQUIRED',
    ]);
    expect(
      codes(priceCart(defs, [line({ productId: VARIABLE, variationId: VAR_OFF })], AT)),
    ).toEqual(['VARIATION_UNAVAILABLE']);
    expect(
      codes(priceCart(defs, [line({ productId: VARIABLE, variationId: id(99) })], AT)),
    ).toEqual(['VARIATION_UNAVAILABLE']);
  });

  it('refuses a variation on a simple product, a missing price and unknown products', () => {
    const defs = catalog(product({ id: SIMPLE }), product({ id: BUNDLE, price: null }));
    expect(
      codes(priceCart(defs, [line({ productId: SIMPLE, variationId: VAR_SMALL })], AT)),
    ).toEqual(['VARIATION_NOT_ALLOWED']);
    expect(codes(priceCart(defs, [line({ productId: BUNDLE })], AT))).toEqual(['NO_PRICE']);
    expect(codes(priceCart(defs, [line({ productId: id(404) })], AT))).toEqual([
      'PRODUCT_UNAVAILABLE',
    ]);
  });

  it('enforces minimum and maximum quantities', () => {
    const defs = catalog(product({ id: SIMPLE, minQuantity: 2, maxQuantity: 5 }));
    expect(codes(priceCart(defs, [line({ productId: SIMPLE, quantity: 1 })], AT))).toEqual([
      'QUANTITY_TOO_LOW',
    ]);
    expect(codes(priceCart(defs, [line({ productId: SIMPLE, quantity: 6 })], AT))).toEqual([
      'QUANTITY_TOO_HIGH',
    ]);
    expect(priceCart(defs, [line({ productId: SIMPLE, quantity: 5 })], AT).errors).toEqual([]);
  });

  it('never trusts a price sent by the client', () => {
    const sneaky = {
      ...line({ productId: SIMPLE }),
      unitMinor: 1,
      price: 1,
    } as unknown as PricingInputLine;
    const r = priceCart(catalog(product({ id: SIMPLE })), [sneaky], AT);
    expect(r.lines[0]!.unitMinor).toBe(10000);
  });

  it('reports every bad line with its index and still prices the good ones', () => {
    const defs = catalog(product({ id: SIMPLE }));
    const r = priceCart(defs, [line({ productId: SIMPLE }), line({ productId: id(404) })], AT);
    expect(r.errors).toEqual([expect.objectContaining({ index: 1, field: 'product' })]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ cartLineId: null, productId: SIMPLE, totalMinor: 10000 });
    expect(r.subtotalMinor).toBe(10000);
  });

  it('adds up several lines as whole minor units', () => {
    const defs = catalog(
      product({ id: SIMPLE, price: price(1999) }),
      product({ id: BUNDLE, price: price(1) }),
    );
    const r = priceCart(
      defs,
      [line({ productId: SIMPLE, quantity: 3 }), line({ productId: BUNDLE, quantity: 7 })],
      AT,
    );
    expect(r.subtotalMinor).toBe(1999 * 3 + 7);
  });
});

describe('priceCart: options', () => {
  const MSG = id(20);
  const SIZE = id(21);
  const C_SMALL = id(30);
  const C_BIG = id(31);
  const TOPPING = id(22);
  const T_A = id(32);
  const T_B = id(33);
  const T_C = id(34);
  const NOTE = id(23);
  const DAY = id(24);
  const withOptions = (...options: OptionGroupDef[]) => catalog(product({ id: SIMPLE, options }));

  it('adds choice and group surcharges to the unit price and snapshots them', () => {
    const defs = withOptions(
      group({
        id: SIZE,
        key: 'size',
        required: true,
        choices: [
          { id: C_SMALL, key: 'small', label: en('Small'), deltaMinor: 0 },
          { id: C_BIG, key: 'big', label: en('Big'), deltaMinor: 2500 },
        ],
      }),
      group({ id: MSG, key: 'message', type: 'TEXT', maxLength: 20, groupDeltaMinor: 1000 }),
    );
    const r = priceCart(
      defs,
      [
        line({
          productId: SIMPLE,
          quantity: 2,
          options: [
            { optionId: SIZE, valueIds: [C_BIG], text: undefined },
            { optionId: MSG, valueIds: [], text: '  Happy birthday  ' },
          ],
        }),
      ],
      AT,
    );
    expect(r.errors).toEqual([]);
    expect(r.lines[0]).toMatchObject({ unitMinor: 10000 + 2500 + 1000, totalMinor: 2 * 13500 });
    expect(r.lines[0]!.options).toEqual([
      expect.objectContaining({
        optionKey: 'size',
        choiceKey: 'big',
        deltaMinor: 2500,
        text: null,
      }),
      expect.objectContaining({ optionKey: 'message', text: 'Happy birthday', deltaMinor: 1000 }),
    ]);
  });

  it('requires required groups and refuses unknown, duplicate and foreign options', () => {
    const defs = withOptions(
      group({
        id: SIZE,
        key: 'size',
        required: true,
        choices: [{ id: C_SMALL, key: 'small', label: en('S'), deltaMinor: 0 }],
      }),
    );
    expect(codes(priceCart(defs, [line({ productId: SIMPLE })], AT))).toEqual(['OPTION_REQUIRED']);
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, options: [{ optionId: id(99), valueIds: [], text: 'x' }] })],
          AT,
        ),
      ),
    ).toContain('OPTION_UNKNOWN');
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: SIMPLE,
              options: [
                { optionId: SIZE, valueIds: [C_SMALL] },
                { optionId: SIZE, valueIds: [C_SMALL] },
              ],
            }),
          ],
          AT,
        ),
      ),
    ).toContain('OPTION_DUPLICATE');
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, options: [{ optionId: SIZE, valueIds: [id(77)] }] })],
          AT,
        ),
      ),
    ).toEqual(['OPTION_INVALID']);
  });

  it('limits single choices to one and checkboxes to the maximum, with a minimum', () => {
    const defs = withOptions(
      group({
        id: SIZE,
        key: 'size',
        choices: [
          { id: C_SMALL, key: 'small', label: en('S'), deltaMinor: 0 },
          { id: C_BIG, key: 'big', label: en('B'), deltaMinor: 0 },
        ],
      }),
      group({
        id: TOPPING,
        key: 'topping',
        type: 'CHECKBOX',
        minSelect: 2,
        maxSelect: 2,
        choices: [
          { id: T_A, key: 'a', label: en('A'), deltaMinor: 100 },
          { id: T_B, key: 'b', label: en('B'), deltaMinor: 200 },
          { id: T_C, key: 'c', label: en('C'), deltaMinor: 300 },
        ],
      }),
    );
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, options: [{ optionId: SIZE, valueIds: [C_SMALL, C_BIG] }] })],
          AT,
        ),
      ),
    ).toEqual(['OPTION_TOO_MANY']);
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, options: [{ optionId: TOPPING, valueIds: [T_A] }] })],
          AT,
        ),
      ),
    ).toEqual(['OPTION_REQUIRED']);
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: SIMPLE,
              options: [{ optionId: TOPPING, valueIds: [T_A, T_B, T_C] }],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['OPTION_TOO_MANY']);
    const ok = priceCart(
      defs,
      [line({ productId: SIMPLE, options: [{ optionId: TOPPING, valueIds: [T_B, T_C] }] })],
      AT,
    );
    expect(ok.lines[0]!.unitMinor).toBe(10500);
  });

  it('checks text length and dates', () => {
    const defs = withOptions(
      group({ id: NOTE, key: 'note', type: 'TEXTAREA', maxLength: 5 }),
      group({ id: DAY, key: 'day', type: 'DATE' }),
    );
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: SIMPLE,
              options: [{ optionId: NOTE, valueIds: [], text: 'too long!' }],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['OPTION_TOO_LONG']);
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: SIMPLE,
              options: [{ optionId: DAY, valueIds: [], text: '2026-02-30' }],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['OPTION_INVALID']);
    expect(
      priceCart(
        defs,
        [
          line({
            productId: SIMPLE,
            options: [{ optionId: DAY, valueIds: [], text: '2026-12-24' }],
          }),
        ],
        AT,
      ).errors,
    ).toEqual([]);
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: SIMPLE,
              options: [{ optionId: NOTE, valueIds: [C_SMALL], text: undefined }],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['OPTION_INVALID']);
  });

  it('shows a conditional group only when its rules hold, and ignores it otherwise', () => {
    const defs = withOptions(
      group({
        id: SIZE,
        key: 'size',
        choices: [
          { id: C_SMALL, key: 'small', label: en('S'), deltaMinor: 0 },
          { id: C_BIG, key: 'big', label: en('B'), deltaMinor: 0 },
        ],
      }),
      group({
        id: MSG,
        key: 'message',
        type: 'TEXT',
        required: true,
        rules: [{ dependsOnGroupId: SIZE, operator: 'EQUALS', dependsOnChoiceId: C_BIG }],
      }),
    );
    // Small cake: the message group does not apply, so it is not required and may not be sent.
    expect(
      priceCart(
        defs,
        [line({ productId: SIMPLE, options: [{ optionId: SIZE, valueIds: [C_SMALL] }] })],
        AT,
      ).errors,
    ).toEqual([]);
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: SIMPLE,
              options: [
                { optionId: SIZE, valueIds: [C_SMALL] },
                { optionId: MSG, valueIds: [], text: 'Hello' },
              ],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['OPTION_NOT_APPLICABLE']);
    // Big cake: now the message is required.
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, options: [{ optionId: SIZE, valueIds: [C_BIG] }] })],
          AT,
        ),
      ),
    ).toEqual(['OPTION_REQUIRED']);
    expect(
      priceCart(
        defs,
        [
          line({
            productId: SIMPLE,
            options: [
              { optionId: SIZE, valueIds: [C_BIG] },
              { optionId: MSG, valueIds: [], text: 'Hello' },
            ],
          }),
        ],
        AT,
      ).errors,
    ).toEqual([]);
  });

  it('supports FILLED and NOT_EQUALS rules and chains of dependent groups', () => {
    const defs = withOptions(
      group({
        id: SIZE,
        key: 'size',
        choices: [
          { id: C_SMALL, key: 'small', label: en('S'), deltaMinor: 0 },
          { id: C_BIG, key: 'big', label: en('B'), deltaMinor: 0 },
        ],
      }),
      group({
        id: NOTE,
        key: 'note',
        type: 'TEXT',
        rules: [{ dependsOnGroupId: SIZE, operator: 'FILLED', dependsOnChoiceId: null }],
      }),
      group({
        id: MSG,
        key: 'message',
        type: 'TEXT',
        required: true,
        rules: [
          { dependsOnGroupId: NOTE, operator: 'FILLED', dependsOnChoiceId: null },
          { dependsOnGroupId: SIZE, operator: 'NOT_EQUALS', dependsOnChoiceId: C_SMALL },
        ],
      }),
    );
    // Nothing chosen: neither dependent group applies.
    expect(priceCart(defs, [line({ productId: SIMPLE })], AT).errors).toEqual([]);
    // Big and a note: the message becomes required (chain note -> message).
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: SIMPLE,
              options: [
                { optionId: SIZE, valueIds: [C_BIG] },
                { optionId: NOTE, valueIds: [], text: 'hi' },
              ],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['OPTION_REQUIRED']);
    // Small: NOT_EQUALS fails, message does not apply.
    expect(
      priceCart(
        defs,
        [
          line({
            productId: SIMPLE,
            options: [
              { optionId: SIZE, valueIds: [C_SMALL] },
              { optionId: NOTE, valueIds: [], text: 'hi' },
            ],
          }),
        ],
        AT,
      ).errors,
    ).toEqual([]);
  });

  it('refuses options that push the price below zero', () => {
    const defs = catalog(
      product({
        id: SIMPLE,
        price: price(1000),
        options: [
          group({
            id: SIZE,
            key: 'size',
            choices: [{ id: C_SMALL, key: 'x', label: en('X'), deltaMinor: -1500 }],
          }),
        ],
      }),
    );
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, options: [{ optionId: SIZE, valueIds: [C_SMALL] }] })],
          AT,
        ),
      ),
    ).toEqual(['PRICE_NEGATIVE']);
  });
});

describe('priceCart: add-ons', () => {
  const CARD = id(40);
  const CANDLE = id(41);
  const BALLOON = id(42);
  const G_EXTRAS = id(50);
  const G_PICK = id(51);
  const defs = catalog(
    product({
      id: SIMPLE,
      addonGroups: [
        {
          id: G_EXTRAS,
          key: 'extras',
          required: false,
          minSelect: 0,
          maxSelect: 2,
          items: [
            {
              id: CARD,
              key: 'card',
              kind: 'INLINE',
              label: en('Card'),
              maxQuantity: 1,
              unitMinor: 500,
              productId: null,
            },
            {
              id: CANDLE,
              key: 'candle',
              kind: 'INLINE',
              label: en('Candles'),
              maxQuantity: 5,
              unitMinor: 300,
              productId: null,
            },
            {
              id: BALLOON,
              key: 'balloon',
              kind: 'PRODUCT',
              label: en('Balloon'),
              maxQuantity: 3,
              unitMinor: null,
              productId: id(9),
            },
          ],
        },
        {
          id: G_PICK,
          key: 'wrap',
          required: true,
          minSelect: 1,
          maxSelect: 1,
          items: [
            {
              id: id(43),
              key: 'paper',
              kind: 'INLINE',
              label: en('Paper'),
              maxQuantity: 1,
              unitMinor: 0,
              productId: null,
            },
          ],
        },
      ],
    }),
  );
  const wrap = { addOnId: id(43), quantity: 1 };

  it('prices add-ons as their own lines, scaled by the parent quantity', () => {
    const r = priceCart(
      defs,
      [
        line({
          id: 'cart-line-1',
          productId: SIMPLE,
          quantity: 2,
          addOns: [wrap, { addOnId: CANDLE, quantity: 3 }],
        }),
      ],
      AT,
    );
    expect(r.errors).toEqual([]);
    const candles = r.lines.find((l) => l.addonItemId === CANDLE)!;
    expect(candles).toMatchObject({
      kind: 'ADD_ON',
      quantity: 6,
      unitMinor: 300,
      totalMinor: 1800,
      cartLineId: 'cart-line-1',
    });
    expect(r.subtotalMinor).toBe(2 * 10000 + 0 + 1800);
  });

  it('enforces group minimum, maximum, item quantity and market availability', () => {
    expect(codes(priceCart(defs, [line({ productId: SIMPLE })], AT))).toEqual(['ADDON_REQUIRED']);
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, addOns: [wrap, { addOnId: CANDLE, quantity: 6 }] })],
          AT,
        ),
      ),
    ).toEqual(['ADDON_QUANTITY']);
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, addOns: [wrap, { addOnId: BALLOON, quantity: 1 }] })],
          AT,
        ),
      ),
    ).toEqual(['ADDON_UNAVAILABLE']);
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: SIMPLE, addOns: [wrap, { addOnId: id(99), quantity: 1 }] })],
          AT,
        ),
      ),
    ).toEqual(['ADDON_UNKNOWN']);
    expect(codes(priceCart(defs, [line({ productId: SIMPLE, addOns: [wrap, wrap] })], AT))).toEqual(
      ['ADDON_DUPLICATE'],
    );
    const limited = catalog(
      product({
        id: SIMPLE,
        addonGroups: [
          {
            id: G_EXTRAS,
            key: 'extras',
            required: false,
            minSelect: 0,
            maxSelect: 1,
            items: [
              {
                id: CARD,
                key: 'card',
                kind: 'INLINE',
                label: en('Card'),
                maxQuantity: 1,
                unitMinor: 500,
                productId: null,
              },
              {
                id: CANDLE,
                key: 'candle',
                kind: 'INLINE',
                label: en('Candles'),
                maxQuantity: 5,
                unitMinor: 300,
                productId: null,
              },
            ],
          },
        ],
      }),
    );
    expect(
      codes(
        priceCart(
          limited,
          [
            line({
              productId: SIMPLE,
              addOns: [
                { addOnId: CARD, quantity: 1 },
                { addOnId: CANDLE, quantity: 1 },
              ],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['ADDON_TOO_MANY']);
  });
});

describe('priceCart: bundles', () => {
  const COMP_SIMPLE = id(60);
  const COMP_VARIABLE = id(61);
  const COMP_FIXED = id(62);
  const BI_SIMPLE = id(70);
  const BI_CHOOSE = id(71);
  const BI_FIXED = id(72);
  const V1 = id(80);
  const V2 = id(81);
  const bundle = product({
    id: BUNDLE,
    type: 'BUNDLE',
    price: price(25000),
    bundleItems: [
      {
        id: BI_SIMPLE,
        componentProductId: COMP_SIMPLE,
        fixedVariationId: null,
        choosableVariationIds: [],
        quantity: 2,
      },
      {
        id: BI_CHOOSE,
        componentProductId: COMP_VARIABLE,
        fixedVariationId: null,
        choosableVariationIds: [V1, V2],
        quantity: 1,
      },
      {
        id: BI_FIXED,
        componentProductId: COMP_FIXED,
        fixedVariationId: id(82),
        choosableVariationIds: [],
        quantity: 1,
      },
    ],
  });
  const defs = catalog(bundle, product({ id: SIMPLE }));

  it('prices a bundle at its own price and resolves every component', () => {
    const r = priceCart(
      defs,
      [line({ productId: BUNDLE, bundleChoices: [{ bundleItemId: BI_CHOOSE, variationId: V2 }] })],
      AT,
    );
    expect(r.errors).toEqual([]);
    expect(r.lines[0]).toMatchObject({ unitMinor: 25000 });
    expect(r.lines[0]!.bundleItems).toEqual([
      { bundleItemId: BI_SIMPLE, productId: COMP_SIMPLE, variationId: null, quantity: 2 },
      { bundleItemId: BI_CHOOSE, productId: COMP_VARIABLE, variationId: V2, quantity: 1 },
      { bundleItemId: BI_FIXED, productId: COMP_FIXED, variationId: id(82), quantity: 1 },
    ]);
  });

  it('needs a valid variation for a component the shopper chooses, and refuses other choices', () => {
    expect(codes(priceCart(defs, [line({ productId: BUNDLE })], AT))).toEqual([
      'BUNDLE_CHOICE_REQUIRED',
    ]);
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: BUNDLE,
              bundleChoices: [{ bundleItemId: BI_CHOOSE, variationId: id(99) }],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['BUNDLE_CHOICE_INVALID']);
    const base = { bundleItemId: BI_CHOOSE, variationId: V1 };
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: BUNDLE,
              bundleChoices: [base, { bundleItemId: BI_SIMPLE, variationId: V1 }],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['BUNDLE_CHOICE_INVALID']);
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: BUNDLE,
              bundleChoices: [base, { bundleItemId: BI_FIXED, variationId: V1 }],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['BUNDLE_CHOICE_INVALID']);
    expect(
      codes(priceCart(defs, [line({ productId: BUNDLE, bundleChoices: [base, base] })], AT)),
    ).toEqual(['BUNDLE_DUPLICATE']);
    expect(
      codes(
        priceCart(
          defs,
          [line({ productId: BUNDLE, bundleChoices: [base, { bundleItemId: id(99) }] })],
          AT,
        ),
      ),
    ).toEqual(['BUNDLE_UNKNOWN']);
  });

  it('refuses component choices on products that are not bundles', () => {
    expect(
      codes(
        priceCart(
          defs,
          [
            line({
              productId: SIMPLE,
              bundleChoices: [{ bundleItemId: BI_SIMPLE }] as CartLineInput['bundleChoices'],
            }),
          ],
          AT,
        ),
      ),
    ).toEqual(['BUNDLE_NOT_ALLOWED']);
  });
});

describe('composeTotals', () => {
  const base = {
    currency: 'AED',
    subtotalMinor: 10000,
    discountMinor: 1000,
    deliveryFeeMinor: 1500,
    taxMinor: 0,
  };

  it('adds tax on top only when prices exclude it, matching the database check', () => {
    expect(composeTotals({ ...base, taxMinor: 525, taxInclusive: true }).totalMinor).toBe(10500);
    expect(composeTotals({ ...base, taxMinor: 525, taxInclusive: false }).totalMinor).toBe(11025);
  });

  it('refuses a negative total and non-integer money', () => {
    expect(() => composeTotals({ ...base, discountMinor: 20000, taxInclusive: true })).toThrow(
      RangeError,
    );
    expect(() => composeTotals({ ...base, subtotalMinor: 10.5, taxInclusive: true })).toThrow(
      RangeError,
    );
  });
});
