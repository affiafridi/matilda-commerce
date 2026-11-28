import { Module } from '@nestjs/common';
import { PromotionsModule } from '../promotions/promotions.module';
import { QuoteSigner } from './quote-signer.service';
import { QuoteService } from './quote.service';

/**
 * Pricing (Phase 5 step 5.3, docs/PHASE-5-PLAN.md): the pure pricing engine and the service that
 * loads catalog data for it, then applies promotions (step 5.5). No routes of its own: the cart,
 * checkout and order modules call it inside their brand-scoped transactions, so there is exactly
 * one place prices are computed.
 */
@Module({
  imports: [PromotionsModule],
  providers: [QuoteService, QuoteSigner],
  exports: [QuoteService, QuoteSigner],
})
export class PricingModule {}
