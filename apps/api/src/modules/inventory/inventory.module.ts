import { Module } from '@nestjs/common';

/**
 * Inventory (Phase 4, docs/PHASE-4-PLAN.md, docs/INVENTORY.md). Step 4.1 is only the module shell;
 * stock levels, the ledger, reservations and transfers arrive in steps 4.7 to 4.9 after the schema
 * review at 4.2. Stock is keyed by brand, branch and variation or product (D4-01).
 */
@Module({})
export class InventoryModule {}
