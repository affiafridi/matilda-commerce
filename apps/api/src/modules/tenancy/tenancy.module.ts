import { Global, Module } from '@nestjs/common';
import { StorefrontContextService } from './storefront-context.service';
import { StorefrontController } from './storefront.controller';
import { TenantResolver } from './tenant-resolver.service';
import { TenantGuard } from './tenant.guard';

@Global()
@Module({
  controllers: [StorefrontController],
  providers: [TenantResolver, TenantGuard, StorefrontContextService],
  exports: [TenantResolver, TenantGuard],
})
export class TenancyModule {}
