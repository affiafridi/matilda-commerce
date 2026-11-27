-- CreateEnum
CREATE TYPE "DeliveryAreaLevel" AS ENUM ('EMIRATE', 'CITY', 'AREA');

-- CreateEnum
CREATE TYPE "DeliveryMethodKind" AS ENUM ('SAME_DAY', 'NEXT_DAY', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "RestrictionTarget" AS ENUM ('PRODUCT', 'CATEGORY', 'COLLECTION');

-- CreateEnum
CREATE TYPE "RestrictionCondition" AS ENUM ('AREA', 'ZONE', 'DATE_RANGE', 'WEEKDAY', 'METHOD');

-- CreateEnum
CREATE TYPE "AssignmentRuleKind" AS ENUM ('COVERS_AREA', 'HAS_STOCK', 'OPEN_IN_TIME', 'PRIORITY', 'CLOSEST', 'LEAST_LOADED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'SALE', 'RETURN', 'TRANSFER_OUT', 'TRANSFER_IN', 'WASTAGE', 'PRODUCTION_CONSUMPTION');

-- CreateEnum
CREATE TYPE "OutOfStockBehavior" AS ENUM ('HIDE', 'SHOW_UNAVAILABLE', 'ALLOW_BACKORDER');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "delivery_area" (
    "id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "parent_id" UUID,
    "level" "DeliveryAreaLevel" NOT NULL,
    "code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "delivery_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_area_translation" (
    "area_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "delivery_area_translation_pkey" PRIMARY KEY ("area_id","language")
);

-- CreateTable
CREATE TABLE "delivery_zone" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "delivery_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_zone_translation" (
    "zone_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "delivery_zone_translation_pkey" PRIMARY KEY ("zone_id","language")
);

-- CreateTable
CREATE TABLE "delivery_zone_area" (
    "zone_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,

    CONSTRAINT "delivery_zone_area_pkey" PRIMARY KEY ("zone_id","area_id")
);

-- CreateTable
CREATE TABLE "branch_zone" (
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "branch_zone_pkey" PRIMARY KEY ("branch_id","zone_id")
);

-- CreateTable
CREATE TABLE "delivery_method" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "kind" "DeliveryMethodKind" NOT NULL,
    "code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "delivery_method_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_method_translation" (
    "method_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "delivery_method_translation_pkey" PRIMARY KEY ("method_id","language")
);

-- CreateTable
CREATE TABLE "zone_charge" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "method_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "fee_minor" INTEGER NOT NULL,
    "minimum_order_minor" INTEGER NOT NULL DEFAULT 0,
    "free_over_minor" INTEGER,

    CONSTRAINT "zone_charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_hours" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,

    CONSTRAINT "branch_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_closure" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID,
    "branch_id" UUID,
    "closed_on" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "delivery_closure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_slot" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "zone_id" UUID,
    "weekday" INTEGER NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "cutoff_time" TIME(0) NOT NULL,
    "cutoff_days_before" INTEGER NOT NULL DEFAULT 0,
    "methods" "DeliveryMethodKind"[],
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "delivery_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_restriction" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "target" "RestrictionTarget" NOT NULL,
    "product_id" UUID,
    "category_id" UUID,
    "collection_id" UUID,
    "condition" "RestrictionCondition" NOT NULL,
    "area_id" UUID,
    "zone_id" UUID,
    "date_from" DATE,
    "date_to" DATE,
    "weekday" INTEGER,
    "method_kind" "DeliveryMethodKind",
    "note" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "delivery_restriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_assignment_rule" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "kind" "AssignmentRuleKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "branch_assignment_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_setting" (
    "brand_id" UUID NOT NULL,
    "reservation_minutes" INTEGER NOT NULL DEFAULT 15,
    "max_extensions" INTEGER NOT NULL DEFAULT 1,
    "default_out_of_stock" "OutOfStockBehavior" NOT NULL DEFAULT 'SHOW_UNAVAILABLE',

    CONSTRAINT "inventory_setting_pkey" PRIMARY KEY ("brand_id")
);

-- CreateTable
CREATE TABLE "stock_level" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variation_id" UUID,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
    "out_of_stock" "OutOfStockBehavior",
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "stock_level_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "on_hand_after" INTEGER NOT NULL,
    "reserved_after" INTEGER NOT NULL,
    "reason" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "transfer_id" UUID,
    "actor_staff_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservation" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "checkout_ref" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "extended_count" INTEGER NOT NULL DEFAULT 0,
    "committed_at" TIMESTAMPTZ,
    "released_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservation_line" (
    "reservation_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "stock_level_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "stock_reservation_line_pkey" PRIMARY KEY ("reservation_id","stock_level_id")
);

-- CreateTable
CREATE TABLE "slot_day" (
    "brand_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "booked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "slot_day_pkey" PRIMARY KEY ("slot_id","delivery_date")
);

-- CreateTable
CREATE TABLE "slot_reservation" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "checkout_ref" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slot_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" TEXT,
    "requested_by_id" UUID,
    "shipped_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stock_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_line" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variation_id" UUID,
    "quantity_requested" INTEGER NOT NULL,
    "quantity_shipped" INTEGER,
    "quantity_received" INTEGER,
    "discrepancy_note" TEXT,

    CONSTRAINT "stock_transfer_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_area_parent_id_country_id_idx" ON "delivery_area"("parent_id", "country_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_area_country_id_code_key" ON "delivery_area"("country_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_area_id_country_id_key" ON "delivery_area"("id", "country_id");

-- CreateIndex
CREATE INDEX "delivery_zone_market_id_brand_id_idx" ON "delivery_zone"("market_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zone_id_brand_id_key" ON "delivery_zone"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zone_id_market_id_key" ON "delivery_zone"("id", "market_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zone_brand_id_market_id_code_key" ON "delivery_zone"("brand_id", "market_id", "code");

-- CreateIndex
CREATE INDEX "delivery_zone_translation_zone_id_brand_id_idx" ON "delivery_zone_translation"("zone_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_zone_area_zone_id_brand_id_idx" ON "delivery_zone_area"("zone_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_zone_area_zone_id_market_id_idx" ON "delivery_zone_area"("zone_id", "market_id");

-- CreateIndex
CREATE INDEX "delivery_zone_area_area_id_idx" ON "delivery_zone_area"("area_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zone_area_market_id_area_id_key" ON "delivery_zone_area"("market_id", "area_id");

-- CreateIndex
CREATE INDEX "branch_zone_zone_id_priority_idx" ON "branch_zone"("zone_id", "priority");

-- CreateIndex
CREATE INDEX "branch_zone_zone_id_brand_id_idx" ON "branch_zone"("zone_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_method_market_id_brand_id_idx" ON "delivery_method"("market_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_method_id_brand_id_key" ON "delivery_method"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_method_id_market_id_key" ON "delivery_method"("id", "market_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_method_brand_id_market_id_code_key" ON "delivery_method"("brand_id", "market_id", "code");

-- CreateIndex
CREATE INDEX "delivery_method_translation_method_id_brand_id_idx" ON "delivery_method_translation"("method_id", "brand_id");

-- CreateIndex
CREATE INDEX "zone_charge_zone_id_brand_id_idx" ON "zone_charge"("zone_id", "brand_id");

-- CreateIndex
CREATE INDEX "zone_charge_zone_id_market_id_idx" ON "zone_charge"("zone_id", "market_id");

-- CreateIndex
CREATE INDEX "zone_charge_method_id_brand_id_idx" ON "zone_charge"("method_id", "brand_id");

-- CreateIndex
CREATE INDEX "zone_charge_method_id_market_id_idx" ON "zone_charge"("method_id", "market_id");

-- CreateIndex
CREATE INDEX "zone_charge_market_id_currency_code_idx" ON "zone_charge"("market_id", "currency_code");

-- CreateIndex
CREATE UNIQUE INDEX "zone_charge_zone_id_method_id_currency_code_key" ON "zone_charge"("zone_id", "method_id", "currency_code");

-- CreateIndex
CREATE INDEX "branch_hours_brand_id_branch_id_weekday_idx" ON "branch_hours"("brand_id", "branch_id", "weekday");

-- CreateIndex
CREATE INDEX "branch_hours_branch_id_idx" ON "branch_hours"("branch_id");

-- CreateIndex
CREATE INDEX "delivery_closure_brand_id_closed_on_idx" ON "delivery_closure"("brand_id", "closed_on");

-- CreateIndex
CREATE INDEX "delivery_closure_market_id_brand_id_idx" ON "delivery_closure"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_closure_branch_id_idx" ON "delivery_closure"("branch_id");

-- CreateIndex
CREATE INDEX "delivery_slot_brand_id_branch_id_weekday_idx" ON "delivery_slot"("brand_id", "branch_id", "weekday");

-- CreateIndex
CREATE INDEX "delivery_slot_market_id_brand_id_idx" ON "delivery_slot"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_slot_branch_id_idx" ON "delivery_slot"("branch_id");

-- CreateIndex
CREATE INDEX "delivery_slot_zone_id_brand_id_idx" ON "delivery_slot"("zone_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_slot_zone_id_market_id_idx" ON "delivery_slot"("zone_id", "market_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_slot_id_brand_id_key" ON "delivery_slot"("id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_restriction_brand_id_market_id_status_idx" ON "delivery_restriction"("brand_id", "market_id", "status");

-- CreateIndex
CREATE INDEX "delivery_restriction_market_id_brand_id_idx" ON "delivery_restriction"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_restriction_product_id_brand_id_idx" ON "delivery_restriction"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_restriction_category_id_brand_id_idx" ON "delivery_restriction"("category_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_restriction_collection_id_brand_id_idx" ON "delivery_restriction"("collection_id", "brand_id");

-- CreateIndex
CREATE INDEX "delivery_restriction_area_id_idx" ON "delivery_restriction"("area_id");

-- CreateIndex
CREATE INDEX "delivery_restriction_zone_id_brand_id_idx" ON "delivery_restriction"("zone_id", "brand_id");

-- CreateIndex
CREATE INDEX "branch_assignment_rule_market_id_brand_id_idx" ON "branch_assignment_rule"("market_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_assignment_rule_market_id_position_key" ON "branch_assignment_rule"("market_id", "position");

-- CreateIndex
CREATE INDEX "stock_level_brand_id_branch_id_idx" ON "stock_level"("brand_id", "branch_id");

-- CreateIndex
CREATE INDEX "stock_level_branch_id_idx" ON "stock_level"("branch_id");

-- CreateIndex
CREATE INDEX "stock_level_product_id_brand_id_idx" ON "stock_level"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_level_variation_id_brand_id_idx" ON "stock_level"("variation_id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_level_variation_id_product_id_idx" ON "stock_level"("variation_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_level_id_brand_id_key" ON "stock_level"("id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_movement_stock_level_id_created_at_idx" ON "stock_movement"("stock_level_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movement_stock_level_id_brand_id_idx" ON "stock_movement"("stock_level_id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_movement_transfer_id_brand_id_idx" ON "stock_movement"("transfer_id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_reservation_status_expires_at_idx" ON "stock_reservation"("status", "expires_at");

-- CreateIndex
CREATE INDEX "stock_reservation_market_id_brand_id_idx" ON "stock_reservation"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_reservation_checkout_ref_idx" ON "stock_reservation"("checkout_ref");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservation_id_brand_id_key" ON "stock_reservation"("id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_reservation_line_reservation_id_brand_id_idx" ON "stock_reservation_line"("reservation_id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_reservation_line_stock_level_id_brand_id_idx" ON "stock_reservation_line"("stock_level_id", "brand_id");

-- CreateIndex
CREATE INDEX "slot_day_slot_id_brand_id_idx" ON "slot_day"("slot_id", "brand_id");

-- CreateIndex
CREATE INDEX "slot_reservation_status_expires_at_idx" ON "slot_reservation"("status", "expires_at");

-- CreateIndex
CREATE INDEX "slot_reservation_slot_id_delivery_date_idx" ON "slot_reservation"("slot_id", "delivery_date");

-- CreateIndex
CREATE INDEX "slot_reservation_slot_id_brand_id_idx" ON "slot_reservation"("slot_id", "brand_id");

-- CreateIndex
CREATE INDEX "slot_reservation_checkout_ref_idx" ON "slot_reservation"("checkout_ref");

-- CreateIndex
CREATE INDEX "stock_transfer_brand_id_status_idx" ON "stock_transfer"("brand_id", "status");

-- CreateIndex
CREATE INDEX "stock_transfer_from_branch_id_idx" ON "stock_transfer"("from_branch_id");

-- CreateIndex
CREATE INDEX "stock_transfer_to_branch_id_idx" ON "stock_transfer"("to_branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_id_brand_id_key" ON "stock_transfer"("id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_transfer_line_transfer_id_brand_id_idx" ON "stock_transfer_line"("transfer_id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_transfer_line_product_id_brand_id_idx" ON "stock_transfer_line"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "stock_transfer_line_variation_id_brand_id_idx" ON "stock_transfer_line"("variation_id", "brand_id");

-- AddForeignKey
ALTER TABLE "delivery_area" ADD CONSTRAINT "delivery_area_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_area" ADD CONSTRAINT "delivery_area_parent_id_country_id_fkey" FOREIGN KEY ("parent_id", "country_id") REFERENCES "delivery_area"("id", "country_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_area_translation" ADD CONSTRAINT "delivery_area_translation_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "delivery_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zone" ADD CONSTRAINT "delivery_zone_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zone_translation" ADD CONSTRAINT "delivery_zone_translation_zone_id_brand_id_fkey" FOREIGN KEY ("zone_id", "brand_id") REFERENCES "delivery_zone"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zone_area" ADD CONSTRAINT "delivery_zone_area_zone_id_brand_id_fkey" FOREIGN KEY ("zone_id", "brand_id") REFERENCES "delivery_zone"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zone_area" ADD CONSTRAINT "delivery_zone_area_zone_id_market_id_fkey" FOREIGN KEY ("zone_id", "market_id") REFERENCES "delivery_zone"("id", "market_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zone_area" ADD CONSTRAINT "delivery_zone_area_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "delivery_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_zone" ADD CONSTRAINT "branch_zone_zone_id_brand_id_fkey" FOREIGN KEY ("zone_id", "brand_id") REFERENCES "delivery_zone"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_zone" ADD CONSTRAINT "branch_zone_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_method" ADD CONSTRAINT "delivery_method_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_method_translation" ADD CONSTRAINT "delivery_method_translation_method_id_brand_id_fkey" FOREIGN KEY ("method_id", "brand_id") REFERENCES "delivery_method"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_charge" ADD CONSTRAINT "zone_charge_zone_id_brand_id_fkey" FOREIGN KEY ("zone_id", "brand_id") REFERENCES "delivery_zone"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_charge" ADD CONSTRAINT "zone_charge_zone_id_market_id_fkey" FOREIGN KEY ("zone_id", "market_id") REFERENCES "delivery_zone"("id", "market_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_charge" ADD CONSTRAINT "zone_charge_method_id_brand_id_fkey" FOREIGN KEY ("method_id", "brand_id") REFERENCES "delivery_method"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_charge" ADD CONSTRAINT "zone_charge_method_id_market_id_fkey" FOREIGN KEY ("method_id", "market_id") REFERENCES "delivery_method"("id", "market_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_charge" ADD CONSTRAINT "zone_charge_market_id_currency_code_fkey" FOREIGN KEY ("market_id", "currency_code") REFERENCES "market_currency"("market_id", "currency_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_closure" ADD CONSTRAINT "delivery_closure_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_closure" ADD CONSTRAINT "delivery_closure_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_closure" ADD CONSTRAINT "delivery_closure_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_zone_id_brand_id_fkey" FOREIGN KEY ("zone_id", "brand_id") REFERENCES "delivery_zone"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_zone_id_market_id_fkey" FOREIGN KEY ("zone_id", "market_id") REFERENCES "delivery_zone"("id", "market_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_restriction" ADD CONSTRAINT "delivery_restriction_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_restriction" ADD CONSTRAINT "delivery_restriction_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_restriction" ADD CONSTRAINT "delivery_restriction_category_id_brand_id_fkey" FOREIGN KEY ("category_id", "brand_id") REFERENCES "category"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_restriction" ADD CONSTRAINT "delivery_restriction_collection_id_brand_id_fkey" FOREIGN KEY ("collection_id", "brand_id") REFERENCES "collection"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_restriction" ADD CONSTRAINT "delivery_restriction_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "delivery_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_restriction" ADD CONSTRAINT "delivery_restriction_zone_id_brand_id_fkey" FOREIGN KEY ("zone_id", "brand_id") REFERENCES "delivery_zone"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_assignment_rule" ADD CONSTRAINT "branch_assignment_rule_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_setting" ADD CONSTRAINT "inventory_setting_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_variation_id_brand_id_fkey" FOREIGN KEY ("variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_variation_id_product_id_fkey" FOREIGN KEY ("variation_id", "product_id") REFERENCES "variation"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_stock_level_id_brand_id_fkey" FOREIGN KEY ("stock_level_id", "brand_id") REFERENCES "stock_level"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_transfer_id_brand_id_fkey" FOREIGN KEY ("transfer_id", "brand_id") REFERENCES "stock_transfer"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation_line" ADD CONSTRAINT "stock_reservation_line_reservation_id_brand_id_fkey" FOREIGN KEY ("reservation_id", "brand_id") REFERENCES "stock_reservation"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation_line" ADD CONSTRAINT "stock_reservation_line_stock_level_id_brand_id_fkey" FOREIGN KEY ("stock_level_id", "brand_id") REFERENCES "stock_level"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_day" ADD CONSTRAINT "slot_day_slot_id_brand_id_fkey" FOREIGN KEY ("slot_id", "brand_id") REFERENCES "delivery_slot"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_reservation" ADD CONSTRAINT "slot_reservation_slot_id_brand_id_fkey" FOREIGN KEY ("slot_id", "brand_id") REFERENCES "delivery_slot"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_transfer_id_brand_id_fkey" FOREIGN KEY ("transfer_id", "brand_id") REFERENCES "stock_transfer"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_variation_id_brand_id_fkey" FOREIGN KEY ("variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================================
-- Hand-written part of `inventory_delivery` (docs/PHASE-4-SCHEMA-DRAFT.md, approved 2026-11-26).
-- Everything Prisma cannot express: the btree_gist extension, check constraints, partial and
-- expression indexes, the opening-hours exclusion constraint, triggers and row-level security on
-- the 21 brand-keyed tables. The two location tables are global reference data (like `country`).
-- ===========================================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Check constraints -----------------------------------------------------------------------------
ALTER TABLE "delivery_area" ADD CONSTRAINT "delivery_area_code_format" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "delivery_area_translation" ADD CONSTRAINT "delivery_area_translation_language_format"
  CHECK ("language" ~ '^[a-z]{2,3}(-[A-Z]{2})?$');
ALTER TABLE "delivery_zone" ADD CONSTRAINT "delivery_zone_code_format" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "delivery_zone_translation" ADD CONSTRAINT "delivery_zone_translation_language_format"
  CHECK ("language" ~ '^[a-z]{2,3}(-[A-Z]{2})?$');
ALTER TABLE "delivery_method" ADD CONSTRAINT "delivery_method_code_format" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "delivery_method_translation" ADD CONSTRAINT "delivery_method_translation_language_format"
  CHECK ("language" ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

ALTER TABLE "zone_charge" ADD CONSTRAINT "zone_charge_amounts"
  CHECK ("fee_minor" >= 0 AND "minimum_order_minor" >= 0 AND ("free_over_minor" IS NULL OR "free_over_minor" > 0));
ALTER TABLE "branch_zone" ADD CONSTRAINT "branch_zone_priority" CHECK ("priority" >= 0);

ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_weekday" CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_range" CHECK ("end_time" > "start_time");
ALTER TABLE "delivery_closure" ADD CONSTRAINT "delivery_closure_one_level"
  CHECK ("market_id" IS NULL OR "branch_id" IS NULL);

ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_weekday" CHECK ("weekday" BETWEEN 0 AND 6);
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_range" CHECK ("end_time" > "start_time");
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_capacity" CHECK ("capacity" > 0);
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_cutoff_days" CHECK ("cutoff_days_before" BETWEEN 0 AND 14);
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_methods" CHECK (cardinality("methods") > 0);
-- A same-day cutoff must come before the slot starts, otherwise the slot could never be booked.
ALTER TABLE "delivery_slot" ADD CONSTRAINT "delivery_slot_cutoff_before_start"
  CHECK ("cutoff_days_before" > 0 OR "cutoff_time" < "start_time");

-- A restriction names exactly one target and exactly the columns its condition needs.
ALTER TABLE "delivery_restriction" ADD CONSTRAINT "delivery_restriction_target_shape" CHECK (
  num_nonnulls("product_id", "category_id", "collection_id") = 1 AND (
    ("target" = 'PRODUCT' AND "product_id" IS NOT NULL) OR
    ("target" = 'CATEGORY' AND "category_id" IS NOT NULL) OR
    ("target" = 'COLLECTION' AND "collection_id" IS NOT NULL)));
ALTER TABLE "delivery_restriction" ADD CONSTRAINT "delivery_restriction_condition_shape" CHECK (
  ("condition" = 'AREA' AND "area_id" IS NOT NULL AND num_nonnulls("zone_id", "date_from", "date_to", "weekday", "method_kind") = 0) OR
  ("condition" = 'ZONE' AND "zone_id" IS NOT NULL AND num_nonnulls("area_id", "date_from", "date_to", "weekday", "method_kind") = 0) OR
  ("condition" = 'DATE_RANGE' AND "date_from" IS NOT NULL AND "date_to" IS NOT NULL AND "date_to" >= "date_from"
     AND num_nonnulls("area_id", "zone_id", "weekday", "method_kind") = 0) OR
  ("condition" = 'WEEKDAY' AND "weekday" BETWEEN 0 AND 6 AND num_nonnulls("area_id", "zone_id", "date_from", "date_to", "method_kind") = 0) OR
  ("condition" = 'METHOD' AND "method_kind" IS NOT NULL AND num_nonnulls("area_id", "zone_id", "date_from", "date_to", "weekday") = 0));
ALTER TABLE "branch_assignment_rule" ADD CONSTRAINT "branch_assignment_rule_position" CHECK ("position" >= 0);

ALTER TABLE "inventory_setting" ADD CONSTRAINT "inventory_setting_ranges"
  CHECK ("reservation_minutes" BETWEEN 1 AND 240 AND "max_extensions" BETWEEN 0 AND 5);

-- Stock: the database itself refuses overselling for any row that does not allow backorder.
-- When the brand default is ALLOW_BACKORDER the service writes that value on the row explicitly.
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_nonnegative"
  CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "low_stock_threshold" >= 0);
ALTER TABLE "stock_level" ADD CONSTRAINT "stock_level_no_oversell"
  CHECK ("reserved" <= "on_hand" OR COALESCE("out_of_stock" = 'ALLOW_BACKORDER', false));
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_amounts"
  CHECK ("quantity" > 0 AND "on_hand_after" >= 0 AND "reserved_after" >= 0);
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_window"
  CHECK ("expires_at" > "created_at" AND "extended_count" >= 0);
ALTER TABLE "stock_reservation_line" ADD CONSTRAINT "stock_reservation_line_quantity" CHECK ("quantity" > 0);
ALTER TABLE "slot_day" ADD CONSTRAINT "slot_day_booked" CHECK ("booked" >= 0);
ALTER TABLE "slot_reservation" ADD CONSTRAINT "slot_reservation_amounts"
  CHECK ("units" > 0 AND "expires_at" > "created_at");
ALTER TABLE "stock_transfer" ADD CONSTRAINT "stock_transfer_two_branches" CHECK ("from_branch_id" <> "to_branch_id");
ALTER TABLE "stock_transfer_line" ADD CONSTRAINT "stock_transfer_line_quantities" CHECK (
  "quantity_requested" > 0 AND
  ("quantity_shipped" IS NULL OR ("quantity_shipped" >= 0 AND "quantity_shipped" <= "quantity_requested")) AND
  ("quantity_received" IS NULL OR "quantity_received" >= 0));

-- Partial and expression indexes ------------------------------------------------------------------
-- One stock row per (branch, simple product) or (branch, variation).
CREATE UNIQUE INDEX "stock_level_branch_product_key" ON "stock_level" ("branch_id", "product_id") WHERE "variation_id" IS NULL;
CREATE UNIQUE INDEX "stock_level_branch_variation_key" ON "stock_level" ("branch_id", "variation_id") WHERE "variation_id" IS NOT NULL;
-- One closure per (brand, market or branch or whole brand, date).
CREATE UNIQUE INDEX "delivery_closure_unique_day" ON "delivery_closure"
  ("brand_id", COALESCE("market_id", '00000000-0000-0000-0000-000000000000'::uuid),
   COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid), "closed_on");
CREATE UNIQUE INDEX "stock_transfer_line_item_key" ON "stock_transfer_line"
  ("transfer_id", "product_id", COALESCE("variation_id", '00000000-0000-0000-0000-000000000000'::uuid));

-- Opening ranges of one branch and weekday may not overlap (touching ranges are fine). -------------
CREATE FUNCTION delivery_minutes_of_day(t time) RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
  $$ SELECT (EXTRACT(HOUR FROM t) * 60 + EXTRACT(MINUTE FROM t))::integer $$;
ALTER TABLE "branch_hours" ADD CONSTRAINT "branch_hours_no_overlap" EXCLUDE USING gist (
  "brand_id" WITH =, "branch_id" WITH =, "weekday" WITH =,
  int4range(delivery_minutes_of_day("start_time"), delivery_minutes_of_day("end_time")) WITH &&);

-- Triggers --------------------------------------------------------------------------------------------
-- Location tree: the parent is in the same country (also a composite key), levels go emirate, city, area
-- (an area may sit directly under an emirate), and the tree has no cycles.
CREATE FUNCTION delivery_assert_area_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_level "DeliveryAreaLevel"; cursor_id uuid := NEW."parent_id"; depth integer := 1;
BEGIN
  IF NEW."parent_id" IS NULL THEN
    IF NEW."level" <> 'EMIRATE' THEN
      RAISE EXCEPTION 'Only an emirate can be at the top of the location tree' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "level" INTO parent_level FROM "delivery_area" WHERE "id" = NEW."parent_id";
  IF NEW."level" = 'EMIRATE' OR (NEW."level" = 'CITY' AND parent_level <> 'EMIRATE')
     OR (NEW."level" = 'AREA' AND parent_level = 'AREA') THEN
    RAISE EXCEPTION 'A % cannot be placed under a %', NEW."level", parent_level USING ERRCODE = '23514';
  END IF;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW."id" THEN
      RAISE EXCEPTION 'A location cannot be placed under itself' USING ERRCODE = '23514';
    END IF;
    depth := depth + 1;
    IF depth > 4 THEN
      RAISE EXCEPTION 'The location tree is too deep' USING ERRCODE = '23514';
    END IF;
    SELECT a."parent_id" INTO cursor_id FROM "delivery_area" a WHERE a."id" = cursor_id;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "delivery_area_tree_check" BEFORE INSERT OR UPDATE OF "parent_id", "level" ON "delivery_area"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_area_tree();

-- A zone covers only areas of its market's country.
CREATE FUNCTION delivery_assert_zone_area_country() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "delivery_area" a JOIN "market" m ON m."country_id" = a."country_id"
    WHERE a."id" = NEW."area_id" AND m."id" = NEW."market_id"
  ) THEN
    RAISE EXCEPTION 'The area is not in the market''s country' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "delivery_zone_area_country_check" BEFORE INSERT OR UPDATE ON "delivery_zone_area"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_zone_area_country();

-- Any brand-keyed row that names a branch must name a branch that serves a market of that brand.
-- Trigger arguments list the columns that hold branch ids.
CREATE FUNCTION delivery_assert_branch_serves_brand() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE col text; branch uuid;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    branch := (to_jsonb(NEW) ->> col)::uuid;
    IF branch IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "branch_market" bm JOIN "market" m ON m."id" = bm."market_id"
      WHERE bm."branch_id" = branch AND m."brand_id" = NEW."brand_id"
    ) THEN
      RAISE EXCEPTION 'The branch does not serve this brand' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "branch_zone_serves_brand" BEFORE INSERT OR UPDATE ON "branch_zone"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_branch_serves_brand('branch_id');
CREATE TRIGGER "branch_hours_serves_brand" BEFORE INSERT OR UPDATE ON "branch_hours"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_branch_serves_brand('branch_id');
CREATE TRIGGER "delivery_closure_serves_brand" BEFORE INSERT OR UPDATE ON "delivery_closure"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_branch_serves_brand('branch_id');
CREATE TRIGGER "delivery_slot_serves_brand" BEFORE INSERT OR UPDATE ON "delivery_slot"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_branch_serves_brand('branch_id');
CREATE TRIGGER "stock_level_serves_brand" BEFORE INSERT OR UPDATE ON "stock_level"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_branch_serves_brand('branch_id');
CREATE TRIGGER "stock_transfer_serves_brand" BEFORE INSERT OR UPDATE ON "stock_transfer"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_branch_serves_brand('from_branch_id', 'to_branch_id');

-- A branch serves a zone only in a market it is linked to; a slot only in a market the branch is linked to.
CREATE FUNCTION delivery_assert_branch_serves_zone_market() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "delivery_zone" z JOIN "branch_market" bm ON bm."market_id" = z."market_id"
    WHERE z."id" = NEW."zone_id" AND bm."branch_id" = NEW."branch_id"
  ) THEN
    RAISE EXCEPTION 'The branch is not linked to the zone''s market' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "branch_zone_market_check" BEFORE INSERT OR UPDATE ON "branch_zone"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_branch_serves_zone_market();

CREATE FUNCTION delivery_assert_slot_market() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "branch_market" bm WHERE bm."branch_id" = NEW."branch_id" AND bm."market_id" = NEW."market_id"
  ) THEN
    RAISE EXCEPTION 'The branch is not linked to the slot''s market' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "delivery_slot_market_check" BEFORE INSERT OR UPDATE ON "delivery_slot"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_slot_market();

-- Stock rows: a variable product is stocked per variation, a simple product per product, a bundle never
-- (its components carry the stock, D4-06).
CREATE FUNCTION inventory_assert_stock_level_shape() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "ProductType";
BEGIN
  SELECT "type" INTO kind FROM "product" WHERE "id" = NEW."product_id";
  IF kind = 'BUNDLE' THEN
    RAISE EXCEPTION 'A bundle has no stock of its own; its components do' USING ERRCODE = '23514';
  ELSIF kind = 'VARIABLE' AND NEW."variation_id" IS NULL THEN
    RAISE EXCEPTION 'A variable product is stocked per variation' USING ERRCODE = '23514';
  ELSIF kind = 'SIMPLE' AND NEW."variation_id" IS NOT NULL THEN
    RAISE EXCEPTION 'A simple product is stocked on the product' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "stock_level_shape_check" BEFORE INSERT OR UPDATE OF "product_id", "variation_id" ON "stock_level"
  FOR EACH ROW EXECUTE FUNCTION inventory_assert_stock_level_shape();

-- The same shape rule for transfer lines.
CREATE TRIGGER "stock_transfer_line_shape_check" BEFORE INSERT OR UPDATE OF "product_id", "variation_id" ON "stock_transfer_line"
  FOR EACH ROW EXECUTE FUNCTION inventory_assert_stock_level_shape();

-- The ledger is append-only: nobody updates or deletes a movement (the table is emptied only by tests,
-- through TRUNCATE which does not fire row triggers).
CREATE FUNCTION forbid_stock_movement_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movement is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER "stock_movement_no_row_change" BEFORE UPDATE OR DELETE ON "stock_movement"
  FOR EACH ROW EXECUTE FUNCTION forbid_stock_movement_change();
REVOKE UPDATE, DELETE ON "stock_movement" FROM matilda_app;

-- Reservations and transfers only move forward through their allowed states.
CREATE FUNCTION inventory_assert_reservation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" AND OLD."status" <> 'ACTIVE' THEN
    RAISE EXCEPTION 'A % reservation cannot change to %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "stock_reservation_transition" BEFORE UPDATE OF "status" ON "stock_reservation"
  FOR EACH ROW EXECUTE FUNCTION inventory_assert_reservation_transition();
CREATE TRIGGER "slot_reservation_transition" BEFORE UPDATE OF "status" ON "slot_reservation"
  FOR EACH ROW EXECUTE FUNCTION inventory_assert_reservation_transition();

CREATE FUNCTION inventory_assert_transfer_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    (OLD."status" = 'REQUESTED' AND NEW."status" IN ('IN_TRANSIT', 'CANCELLED')) OR
    (OLD."status" = 'IN_TRANSIT' AND NEW."status" = 'RECEIVED')
  ) THEN
    RAISE EXCEPTION 'A % transfer cannot change to %', OLD."status", NEW."status" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "stock_transfer_transition" BEFORE UPDATE OF "status" ON "stock_transfer"
  FOR EACH ROW EXECUTE FUNCTION inventory_assert_transfer_transition();

-- Row-level security on every brand-keyed table ----------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'delivery_zone', 'delivery_zone_translation', 'delivery_zone_area', 'branch_zone',
    'delivery_method', 'delivery_method_translation', 'zone_charge',
    'branch_hours', 'delivery_closure', 'delivery_slot', 'delivery_restriction', 'branch_assignment_rule',
    'inventory_setting', 'stock_level', 'stock_movement',
    'stock_reservation', 'stock_reservation_line', 'slot_day', 'slot_reservation',
    'stock_transfer', 'stock_transfer_line']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform()) WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())',
      t || '_scope', t);
  END LOOP;
END $$;
