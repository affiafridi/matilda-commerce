import { Module } from '@nestjs/common';
import { InventoryAccess } from './inventory-common';
import {
  AdminInventoryController,
  AdminReservationsController,
  AdminTransfersController,
} from './inventory.controllers';
import { ReservationExpiryJob } from './reservation-expiry.job';
import { ReservationsService } from './reservations.service';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';

/**
 * Inventory (Phase 4, docs/PHASE-4-PLAN.md, docs/INVENTORY.md). Step 4.7 adds stock levels, the
 * brand settings and the movement ledger, step 4.8 stock and slot reservations with the expiry job, step 4.9 transfers; the public
 * availability read (4.10) follow. Stock is keyed by brand, branch and variation or product (D4-01).
 */
@Module({
  controllers: [AdminInventoryController, AdminReservationsController, AdminTransfersController],
  providers: [
    InventoryAccess,
    StockService,
    ReservationsService,
    ReservationExpiryJob,
    TransfersService,
  ],
  exports: [ReservationsService],
})
export class InventoryModule {}
