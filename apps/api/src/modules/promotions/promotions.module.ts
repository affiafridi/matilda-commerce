import { Module } from '@nestjs/common';
import { AdminPromotionsController } from './promotions.controller';
import { PromotionEvaluator } from './promotion-evaluator.service';
import { PromotionsAccess, PromotionsService } from './promotions.service';

/**
 * Promotions and coupons (Phase 5 step 5.5, docs/PHASE-5-PLAN.md): the pure engine, the evaluator
 * that finds the promotions that may apply to a cart (the pricing module applies them to every
 * quote), and the staff API that manages them.
 */
@Module({
  controllers: [AdminPromotionsController],
  providers: [PromotionEvaluator, PromotionsAccess, PromotionsService],
  exports: [PromotionEvaluator],
})
export class PromotionsModule {}
