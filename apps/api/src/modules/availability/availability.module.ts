import { Module } from '@nestjs/common';
import { PublicAvailabilityController } from './availability.controller';
import { AvailabilityAccess, AvailabilityService } from './availability.service';

/**
 * Delivery availability and the storefront stock flag (Phase 4 step 4.10). Read-only: it combines
 * delivery configuration, the branch calendar and stock; holds are made by the reservation service.
 */
@Module({
  controllers: [PublicAvailabilityController],
  providers: [AvailabilityAccess, AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
