import type { CartLineInput } from '@matilda/validation';
import { lineSignature } from './cart-signature';

const base: CartLineInput = {
  productId: 'p1',
  variationId: 'v1',
  quantity: 1,
  options: [
    { optionId: 'o2', valueIds: ['c2', 'c1'] },
    { optionId: 'o1', valueIds: [], text: ' Happy birthday ' },
  ],
  addOns: [
    { addOnId: 'a2', quantity: 1 },
    { addOnId: 'a1', quantity: 2 },
  ],
  bundleChoices: [{ bundleItemId: 'b1', variationId: 'v9' }],
};

describe('lineSignature', () => {
  it('ignores quantity and the order of options, values and add-ons', () => {
    const shuffled: CartLineInput = {
      ...base,
      quantity: 7,
      options: [...base.options]
        .reverse()
        .map((o) => ({ ...o, valueIds: [...o.valueIds].reverse() })),
      addOns: [...base.addOns].reverse(),
    };
    expect(lineSignature(shuffled)).toBe(lineSignature(base));
  });

  it('ignores surrounding spaces in a customization text', () => {
    const trimmed: CartLineInput = {
      ...base,
      options: [
        base.options[0] as CartLineInput['options'][number],
        { optionId: 'o1', valueIds: [], text: 'Happy birthday' },
      ],
    };
    expect(lineSignature(trimmed)).toBe(lineSignature(base));
  });

  it('tells apart a different product, variation, text, add-on quantity or bundle choice', () => {
    const sig = lineSignature(base);
    const differ = (over: Partial<CartLineInput>) =>
      expect(lineSignature({ ...base, ...over })).not.toBe(sig);
    differ({ productId: 'p2' });
    differ({ variationId: undefined });
    differ({ options: [{ optionId: 'o1', valueIds: [], text: 'Congratulations' }] });
    differ({ addOns: [{ addOnId: 'a1', quantity: 3 }] });
    differ({ bundleChoices: [{ bundleItemId: 'b1', variationId: 'v8' }] });
  });
});
