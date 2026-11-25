import { Module } from '@nestjs/common';
import { CustomerAuthController, CustomerController } from './customer-auth.controller';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerSessionGuard } from './customer-session.guard';
import { CustomerSessionService } from './customer-session.service';

/** Registered-customer authentication (Phase 2 step 2.8): brand-scoped, separate from staff. */
@Module({
  controllers: [CustomerAuthController, CustomerController],
  providers: [CustomerSessionService, CustomerSessionGuard, CustomerAuthService],
})
export class CustomerAuthModule {}
