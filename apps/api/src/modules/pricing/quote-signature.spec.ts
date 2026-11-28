import { checkQuoteSignature, signQuote } from './quote-signature';
import type { Quote } from './quote.service';

const secret = Buffer.from('s'.repeat(32));
const now = new Date('2026-11-28T10:00:00Z');

const quote = (): Quote => ({
  marketId: 'market',
  currency: 'AED',
  at: now,
  lines: [
    {
      cartLineId: 'l1',
      kind: 'PRODUCT',
      productId: 'p1',
      variationId: null,
      addonItemId: null,
      name: {},
      sku: 'SKU1',
      options: [],
      bundleItems: [],
      quantity: 2,
      unitMinor: 5000,
      discountMinor: 0,
      taxMinor: 476,
      totalMinor: 10000,
    },
  ] as unknown as Quote['lines'],
  totals: {
    currency: 'AED',
    subtotalMinor: 10000,
    discountMinor: 0,
    deliveryFeeMinor: 2500,
    taxMinor: 595,
    taxInclusive: true,
    totalMinor: 12500,
  },
  delivery: null,
  tax: { rateBps: 500, inclusive: true },
  promotions: { applied: [], coupon: null, freeDelivery: false },
});

describe('quote signature', () => {
  it('verifies an untouched quote until it expires', () => {
    const { expiresAt, signature } = signQuote(secret, 'brand', quote(), now);
    expect(expiresAt.getTime() - now.getTime()).toBe(15 * 60 * 1000);
    expect(checkQuoteSignature(secret, 'brand', quote(), expiresAt, signature, now)).toBe('OK');
    const late = new Date(expiresAt.getTime() + 1);
    expect(checkQuoteSignature(secret, 'brand', quote(), expiresAt, signature, late)).toBe(
      'EXPIRED',
    );
  });

  it('rejects any changed amount, brand, key or expiry', () => {
    const { expiresAt, signature } = signQuote(secret, 'brand', quote(), now);
    const cheaper = quote();
    cheaper.totals.totalMinor = 100;
    expect(checkQuoteSignature(secret, 'brand', cheaper, expiresAt, signature, now)).toBe(
      'INVALID',
    );
    expect(checkQuoteSignature(secret, 'other', quote(), expiresAt, signature, now)).toBe(
      'INVALID',
    );
    const other = Buffer.from('t'.repeat(32));
    expect(checkQuoteSignature(other, 'brand', quote(), expiresAt, signature, now)).toBe('INVALID');
    const later = new Date(expiresAt.getTime() + 60_000);
    expect(checkQuoteSignature(secret, 'brand', quote(), later, signature, now)).toBe('INVALID');
    expect(checkQuoteSignature(secret, 'brand', quote(), expiresAt, 'AAAA', now)).toBe('INVALID');
  });
});
