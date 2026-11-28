import { createHmac, timingSafeEqual } from 'node:crypto';
import { QUOTE_TTL_SECONDS } from '@matilda/validation';
import type { Quote } from './quote.service';

export type QuoteCheck = 'OK' | 'EXPIRED' | 'INVALID';

/**
 * Everything a quote promises the shopper, in a fixed order. Changing any amount, line, delivery
 * choice, market or brand changes the signature.
 */
function canonical(brandId: string, quote: Quote, expiresAt: number): string {
  const d = quote.delivery;
  return JSON.stringify([
    brandId,
    quote.marketId,
    quote.currency,
    expiresAt,
    quote.lines.map((l) => [
      l.cartLineId,
      l.kind,
      l.productId,
      l.variationId,
      l.quantity,
      l.unitMinor,
      l.discountMinor,
      l.taxMinor,
      l.totalMinor,
    ]),
    [
      quote.totals.subtotalMinor,
      quote.totals.discountMinor,
      quote.totals.deliveryFeeMinor,
      quote.totals.taxMinor,
      quote.totals.taxInclusive,
      quote.totals.totalMinor,
    ],
    d ? [d.areaId, d.methodId, d.zoneId, d.feeMinor] : null,
  ]);
}

const mac = (secret: Buffer, text: string): Buffer =>
  createHmac('sha256', secret).update(text).digest();

/**
 * Signs a quote with an expiry (D5-01). The signature only tells the shopper's page that the numbers
 * came from this server a moment ago; it is never trusted to authorize anything. Order creation
 * recomputes every amount and refuses when the total moved.
 */
export function signQuote(
  secret: Buffer,
  brandId: string,
  quote: Quote,
  now: Date,
  ttlSeconds: number = QUOTE_TTL_SECONDS,
): { expiresAt: Date; signature: string } {
  const expiresAt = new Date(Math.floor(now.getTime() / 1000) * 1000 + ttlSeconds * 1000);
  return {
    expiresAt,
    signature: mac(secret, canonical(brandId, quote, expiresAt.getTime())).toString('base64url'),
  };
}

export function checkQuoteSignature(
  secret: Buffer,
  brandId: string,
  quote: Quote,
  expiresAt: Date,
  signature: string,
  now: Date,
): QuoteCheck {
  const expected = mac(secret, canonical(brandId, quote, expiresAt.getTime()));
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'INVALID';
  return now.getTime() > expiresAt.getTime() ? 'EXPIRED' : 'OK';
}
