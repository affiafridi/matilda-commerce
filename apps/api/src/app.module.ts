import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RequestContextModule } from './common/context/request-context.module';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { AppLoggingModule } from './common/logging/logging.module';
import { MailModule } from './common/mail/mail.module';
import { SecurityModule } from './common/security/security.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { IamModule } from './modules/iam/iam.module';
import { CustomerAuthModule } from './modules/customer-auth/customer-auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { StaffAuthModule } from './modules/staff-auth/staff-auth.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { CartsModule } from './modules/carts/carts.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PromotionsModule } from './modules/promotions/promotions.module';

@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    RequestContextModule,
    SecurityModule,
    MailModule,
    DatabaseModule,
    HealthModule,
    TenancyModule,
    AuditModule,
    StaffAuthModule,
    AdminModule,
    CustomerAuthModule,
    IamModule,
    CatalogModule,
    JobsModule,
    InventoryModule,
    DeliveryModule,
    AvailabilityModule,
    PricingModule,
    CartsModule,
    PromotionsModule,
    CheckoutModule,
    OrdersModule,
    PaymentsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
