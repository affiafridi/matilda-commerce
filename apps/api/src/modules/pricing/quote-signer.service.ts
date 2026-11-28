import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENV, type Env } from '../../config/env';
import { type QuoteCheck, checkQuoteSignature, signQuote } from './quote-signature';
import type { Quote } from './quote.service';

/**
 * Signs quotes with `QUOTE_SIGNING_SECRET` (required in staging and production). Without it a random
 * key lives for the process only, so development quotes simply expire on restart.
 */
@Injectable()
export class QuoteSigner {
  private readonly secret: Buffer;

  constructor(@Inject(APP_ENV) env: Env) {
    this.secret = env.QUOTE_SIGNING_SECRET
      ? Buffer.from(env.QUOTE_SIGNING_SECRET, 'utf8')
      : randomBytes(32);
  }

  sign(brandId: string, quote: Quote, now: Date = new Date()) {
    return signQuote(this.secret, brandId, quote, now);
  }

  check(
    brandId: string,
    quote: Quote,
    expiresAt: Date,
    signature: string,
    now: Date = new Date(),
  ): QuoteCheck {
    return checkQuoteSignature(this.secret, brandId, quote, expiresAt, signature, now);
  }
}
