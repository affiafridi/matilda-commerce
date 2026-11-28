import { Module } from '@nestjs/common';
import { CustomerSessionService } from '../customer-auth/customer-session.service';
import { PricingModule } from '../pricing/pricing.module';
import { CartAccessGuard } from './cart-access.guard';
import { CartsController } from './carts.controller';
import { CartService } from './carts.service';

/**
 * Cart (Phase 5 step 5.4, docs/PHASE-5-PLAN.md): guest and customer carts, validated and priced by
 * the pricing module. The session service is provided here too (it only needs the database) so the
 * customer-auth module can import this one to merge a guest cart at sign-in without a cycle.
 */
@Module({
  imports: [PricingModule],
  controllers: [CartsController],
  providers: [CartService, CartAccessGuard, CustomerSessionService],
  exports: [CartService],
})
export class CartsModule {}
