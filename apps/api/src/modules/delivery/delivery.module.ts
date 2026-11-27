import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { AssignmentService } from './assignment.service';
import { AdminAreasController, AdminZonesController } from './delivery.controllers';
import {
  AdminAssignmentController,
  AdminCalendarController,
  AdminChargesController,
  AdminMethodsController,
  AdminRestrictionsController,
  AdminSlotsController,
} from './delivery-config.controllers';
import { CalendarService } from './calendar.service';
import { MethodsService } from './methods.service';
import { RestrictionsService } from './restrictions.service';
import { SlotsService } from './slots.service';
import { DeliveryAccess } from './delivery-common';
import { LocationsService } from './locations.service';
import { ZonesService } from './zones.service';

/**
 * Delivery (Phase 4, docs/PHASE-4-PLAN.md, docs/DELIVERY.md). Step 4.3 adds the location tree and
 * zones (coverage and serving branches), step 4.4 the branch calendar, methods and charges, step 4.5 slots, step 4.6 restrictions;
 * step 4.11 branch assignment rules and the availability tester (availability itself lives in the availability module). Every rule is configuration,
 * never code.
 */
@Module({
  imports: [AvailabilityModule],
  controllers: [
    AdminAssignmentController,
    AdminAreasController,
    AdminZonesController,
    AdminCalendarController,
    AdminMethodsController,
    AdminChargesController,
    AdminSlotsController,
    AdminRestrictionsController,
  ],
  providers: [
    DeliveryAccess,
    LocationsService,
    ZonesService,
    CalendarService,
    MethodsService,
    SlotsService,
    RestrictionsService,
    AssignmentService,
  ],
})
export class DeliveryModule {}
