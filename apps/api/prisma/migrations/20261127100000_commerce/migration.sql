-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('OPEN', 'CONVERTED', 'ABANDONED', 'MERGED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'COD_PENDING', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_DELIVERY', 'RETURNED', 'PICKUP_READY', 'PICKED_UP');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATED', 'REDIRECTED', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('CCAVENUE', 'COD', 'MANUAL');

-- CreateEnum
CREATE TYPE "PromotionKind" AS ENUM ('PERCENT_OFF', 'FIXED_OFF', 'FREE_DELIVERY', 'FREE_GIFT');

-- CreateEnum
CREATE TYPE "PromotionScope" AS ENUM ('ORDER', 'PRODUCT', 'CATEGORY', 'COLLECTION');

-- CreateEnum
CREATE TYPE "PromotionAudience" AS ENUM ('EVERYONE', 'CUSTOMERS', 'FIRST_ORDER');

-- CreateEnum
CREATE TYPE "OrderLineKind" AS ENUM ('PRODUCT', 'ADD_ON', 'GIFT');

-- CreateTable
CREATE TABLE "cart" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "customer_id" UUID,
    "guest_token_hash" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'OPEN',
    "delivery_area_id" UUID,
    "delivery_date" DATE,
    "delivery_method_id" UUID,
    "slot_id" UUID,
    "coupon_code" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "abandoned_at" TIMESTAMPTZ,
    "converted_order_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_line" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variation_id" UUID,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_line_option" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "choice_id" UUID,
    "text" TEXT,

    CONSTRAINT "cart_line_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_line_addon" (
    "line_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "addon_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "cart_line_addon_pkey" PRIMARY KEY ("line_id","addon_item_id")
);

-- CreateTable
CREATE TABLE "cart_line_bundle_choice" (
    "line_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "bundle_item_id" UUID NOT NULL,
    "variation_id" UUID,

    CONSTRAINT "cart_line_bundle_choice_pkey" PRIMARY KEY ("line_id","bundle_item_id")
);

-- CreateTable
CREATE TABLE "customer_order" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "fulfillment_status" "FulfillmentStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "customer_id" UUID,
    "guest_email" TEXT,
    "guest_phone" TEXT,
    "currency_code" CHAR(3) NOT NULL,
    "subtotal_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "delivery_fee_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,
    "tax_inclusive" BOOLEAN NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "delivery_address" JSONB NOT NULL,
    "billing_address" JSONB,
    "delivery_area_id" UUID,
    "zone_id" UUID,
    "delivery_method_id" UUID,
    "delivery_method_kind" "DeliveryMethodKind",
    "delivery_date" DATE,
    "slot_id" UUID,
    "slot_start" TIME,
    "slot_end" TIME,
    "branch_id" UUID,
    "gift_message" TEXT,
    "anonymous_gift" BOOLEAN NOT NULL DEFAULT false,
    "instructions" TEXT,
    "payment_config_version" INTEGER,
    "payment_provider" "PaymentProvider",
    "payment_method" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "coupon_code" TEXT,
    "placed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "OrderLineKind" NOT NULL,
    "product_id" UUID,
    "variation_id" UUID,
    "name" JSONB NOT NULL,
    "sku" TEXT,
    "options" JSONB NOT NULL DEFAULT '[]',
    "add_ons" JSONB NOT NULL DEFAULT '[]',
    "bundle_items" JSONB NOT NULL DEFAULT '[]',
    "quantity" INTEGER NOT NULL,
    "unit_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL,
    "tax_minor" INTEGER NOT NULL,
    "total_minor" INTEGER NOT NULL,

    CONSTRAINT "order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_promotion" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "promotion_id" UUID,
    "coupon_code" TEXT,
    "name" JSONB NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "amount_minor" INTEGER NOT NULL,

    CONSTRAINT "order_promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "dimension" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "actor_staff_id" UUID,
    "actor_customer_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_counter" (
    "brand_id" UUID NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 100000,

    CONSTRAINT "order_counter_pkey" PRIMARY KEY ("brand_id")
);

-- CreateTable
CREATE TABLE "payment_config" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "display_name" JSONB NOT NULL,
    "enabled_methods" TEXT[],
    "credentials_encrypted" TEXT,
    "credentials_last4" TEXT,
    "test_mode" BOOLEAN NOT NULL DEFAULT true,
    "cod_zone_ids" TEXT[],
    "cod_max_order_minor" INTEGER,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "config_id" UUID NOT NULL,
    "config_version" INTEGER NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "paid_minor" INTEGER NOT NULL DEFAULT 0,
    "refunded_minor" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempt" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "amount_minor" INTEGER NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "provider_reference" TEXT,
    "request_summary" JSONB NOT NULL DEFAULT '{}',
    "verified_summary" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "verified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_event" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "payment_id" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "event_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PromotionKind" NOT NULL,
    "scope" "PromotionScope" NOT NULL DEFAULT 'ORDER',
    "percent_bps" INTEGER,
    "fixed_minor" INTEGER,
    "currency_code" CHAR(3),
    "gift_product_id" UUID,
    "gift_variation_id" UUID,
    "max_discount_minor" INTEGER,
    "min_subtotal_minor" INTEGER NOT NULL DEFAULT 0,
    "audience" "PromotionAudience" NOT NULL DEFAULT 'EVERYONE',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "combinable" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ,
    "ends_at" TIMESTAMPTZ,
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "requires_coupon" BOOLEAN NOT NULL DEFAULT false,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_translation" (
    "promotion_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "promotion_translation_pkey" PRIMARY KEY ("promotion_id","language")
);

-- CreateTable
CREATE TABLE "promotion_market" (
    "promotion_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,

    CONSTRAINT "promotion_market_pkey" PRIMARY KEY ("promotion_id","market_id")
);

-- CreateTable
CREATE TABLE "promotion_target" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "product_id" UUID,
    "category_id" UUID,
    "collection_id" UUID,

    CONSTRAINT "promotion_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "usage_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_usage" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "coupon_id" UUID,
    "order_id" UUID NOT NULL,
    "customer_id" UUID,
    "amount_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_address" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "area_id" UUID NOT NULL,
    "city" TEXT,
    "notes" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cart_guest_token_hash_key" ON "cart"("guest_token_hash");

-- CreateIndex
CREATE INDEX "cart_market_id_brand_id_idx" ON "cart"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_market_id_currency_code_idx" ON "cart"("market_id", "currency_code");

-- CreateIndex
CREATE INDEX "cart_customer_id_brand_id_idx" ON "cart"("customer_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_status_last_activity_at_idx" ON "cart"("status", "last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "cart_id_brand_id_key" ON "cart"("id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_cart_id_brand_id_idx" ON "cart_line"("cart_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_product_id_brand_id_idx" ON "cart_line"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_variation_id_brand_id_idx" ON "cart_line"("variation_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_line_id_brand_id_key" ON "cart_line"("id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_option_line_id_brand_id_idx" ON "cart_line_option"("line_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_option_option_group_id_brand_id_idx" ON "cart_line_option"("option_group_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_option_choice_id_brand_id_idx" ON "cart_line_option"("choice_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_addon_line_id_brand_id_idx" ON "cart_line_addon"("line_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_addon_addon_item_id_brand_id_idx" ON "cart_line_addon"("addon_item_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_bundle_choice_line_id_brand_id_idx" ON "cart_line_bundle_choice"("line_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_bundle_choice_bundle_item_id_brand_id_idx" ON "cart_line_bundle_choice"("bundle_item_id", "brand_id");

-- CreateIndex
CREATE INDEX "cart_line_bundle_choice_variation_id_brand_id_idx" ON "cart_line_bundle_choice"("variation_id", "brand_id");

-- CreateIndex
CREATE INDEX "customer_order_market_id_brand_id_idx" ON "customer_order"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "customer_order_market_id_currency_code_idx" ON "customer_order"("market_id", "currency_code");

-- CreateIndex
CREATE INDEX "customer_order_customer_id_brand_id_created_at_idx" ON "customer_order"("customer_id", "brand_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_order_brand_id_status_created_at_idx" ON "customer_order"("brand_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "customer_order_branch_id_delivery_date_idx" ON "customer_order"("branch_id", "delivery_date");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_id_brand_id_key" ON "customer_order"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_brand_id_number_key" ON "customer_order"("brand_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_brand_id_idempotency_key_key" ON "customer_order"("brand_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_line_order_id_brand_id_idx" ON "order_line"("order_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_order_id_position_key" ON "order_line"("order_id", "position");

-- CreateIndex
CREATE INDEX "order_promotion_order_id_brand_id_idx" ON "order_promotion"("order_id", "brand_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_brand_id_idx" ON "order_status_history"("order_id", "brand_id");

-- CreateIndex
CREATE INDEX "payment_config_market_id_brand_id_idx" ON "payment_config"("market_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_config_id_brand_id_key" ON "payment_config"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_config_brand_id_market_id_provider_version_key" ON "payment_config"("brand_id", "market_id", "provider", "version");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_id_key" ON "payment"("order_id");

-- CreateIndex
CREATE INDEX "payment_config_id_brand_id_idx" ON "payment"("config_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_id_brand_id_key" ON "payment"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_id_brand_id_key" ON "payment"("order_id", "brand_id");

-- CreateIndex
CREATE INDEX "payment_attempt_payment_id_brand_id_idx" ON "payment_attempt"("payment_id", "brand_id");

-- CreateIndex
CREATE INDEX "payment_attempt_status_expires_at_idx" ON "payment_attempt"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempt_brand_id_reference_key" ON "payment_attempt"("brand_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempt_brand_id_idempotency_key_key" ON "payment_attempt"("brand_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "payment_event_payment_id_brand_id_idx" ON "payment_event"("payment_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_event_brand_id_provider_event_key_key" ON "payment_event"("brand_id", "provider", "event_key");

-- CreateIndex
CREATE INDEX "promotion_brand_id_status_priority_idx" ON "promotion"("brand_id", "status", "priority");

-- CreateIndex
CREATE INDEX "promotion_gift_product_id_brand_id_idx" ON "promotion"("gift_product_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_gift_variation_id_brand_id_idx" ON "promotion"("gift_variation_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_currency_code_idx" ON "promotion"("currency_code");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_id_brand_id_key" ON "promotion"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_brand_id_code_key" ON "promotion"("brand_id", "code");

-- CreateIndex
CREATE INDEX "promotion_translation_promotion_id_brand_id_idx" ON "promotion_translation"("promotion_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_market_promotion_id_brand_id_idx" ON "promotion_market"("promotion_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_market_market_id_brand_id_idx" ON "promotion_market"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_target_promotion_id_brand_id_idx" ON "promotion_target"("promotion_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_target_product_id_brand_id_idx" ON "promotion_target"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_target_category_id_brand_id_idx" ON "promotion_target"("category_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_target_collection_id_brand_id_idx" ON "promotion_target"("collection_id", "brand_id");

-- CreateIndex
CREATE INDEX "coupon_promotion_id_brand_id_idx" ON "coupon"("promotion_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_id_brand_id_key" ON "coupon"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_brand_id_code_key" ON "coupon"("brand_id", "code");

-- CreateIndex
CREATE INDEX "promotion_usage_promotion_id_brand_id_idx" ON "promotion_usage"("promotion_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_usage_coupon_id_brand_id_idx" ON "promotion_usage"("coupon_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_usage_order_id_brand_id_idx" ON "promotion_usage"("order_id", "brand_id");

-- CreateIndex
CREATE INDEX "promotion_usage_customer_id_idx" ON "promotion_usage"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_usage_order_id_promotion_id_key" ON "promotion_usage"("order_id", "promotion_id");

-- CreateIndex
CREATE INDEX "customer_address_customer_id_brand_id_idx" ON "customer_address"("customer_id", "brand_id");

-- CreateIndex
CREATE INDEX "customer_address_area_id_idx" ON "customer_address"("area_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_address_id_brand_id_key" ON "customer_address"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_item_id_brand_id_key" ON "bundle_item"("id", "brand_id");

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_market_id_currency_code_fkey" FOREIGN KEY ("market_id", "currency_code") REFERENCES "market_currency"("market_id", "currency_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_customer_id_brand_id_fkey" FOREIGN KEY ("customer_id", "brand_id") REFERENCES "customer"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line" ADD CONSTRAINT "cart_line_cart_id_brand_id_fkey" FOREIGN KEY ("cart_id", "brand_id") REFERENCES "cart"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line" ADD CONSTRAINT "cart_line_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line" ADD CONSTRAINT "cart_line_variation_id_brand_id_fkey" FOREIGN KEY ("variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line_option" ADD CONSTRAINT "cart_line_option_line_id_brand_id_fkey" FOREIGN KEY ("line_id", "brand_id") REFERENCES "cart_line"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line_option" ADD CONSTRAINT "cart_line_option_option_group_id_brand_id_fkey" FOREIGN KEY ("option_group_id", "brand_id") REFERENCES "option_group"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line_option" ADD CONSTRAINT "cart_line_option_choice_id_brand_id_fkey" FOREIGN KEY ("choice_id", "brand_id") REFERENCES "option_choice"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line_addon" ADD CONSTRAINT "cart_line_addon_line_id_brand_id_fkey" FOREIGN KEY ("line_id", "brand_id") REFERENCES "cart_line"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line_addon" ADD CONSTRAINT "cart_line_addon_addon_item_id_brand_id_fkey" FOREIGN KEY ("addon_item_id", "brand_id") REFERENCES "addon_item"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line_bundle_choice" ADD CONSTRAINT "cart_line_bundle_choice_line_id_brand_id_fkey" FOREIGN KEY ("line_id", "brand_id") REFERENCES "cart_line"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line_bundle_choice" ADD CONSTRAINT "cart_line_bundle_choice_bundle_item_id_brand_id_fkey" FOREIGN KEY ("bundle_item_id", "brand_id") REFERENCES "bundle_item"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_line_bundle_choice" ADD CONSTRAINT "cart_line_bundle_choice_variation_id_brand_id_fkey" FOREIGN KEY ("variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_market_id_currency_code_fkey" FOREIGN KEY ("market_id", "currency_code") REFERENCES "market_currency"("market_id", "currency_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order" ADD CONSTRAINT "customer_order_customer_id_brand_id_fkey" FOREIGN KEY ("customer_id", "brand_id") REFERENCES "customer"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_brand_id_fkey" FOREIGN KEY ("order_id", "brand_id") REFERENCES "customer_order"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_promotion" ADD CONSTRAINT "order_promotion_order_id_brand_id_fkey" FOREIGN KEY ("order_id", "brand_id") REFERENCES "customer_order"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_brand_id_fkey" FOREIGN KEY ("order_id", "brand_id") REFERENCES "customer_order"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_counter" ADD CONSTRAINT "order_counter_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_config" ADD CONSTRAINT "payment_config_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_brand_id_fkey" FOREIGN KEY ("order_id", "brand_id") REFERENCES "customer_order"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_config_id_brand_id_fkey" FOREIGN KEY ("config_id", "brand_id") REFERENCES "payment_config"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_payment_id_brand_id_fkey" FOREIGN KEY ("payment_id", "brand_id") REFERENCES "payment"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_payment_id_brand_id_fkey" FOREIGN KEY ("payment_id", "brand_id") REFERENCES "payment"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_gift_product_id_brand_id_fkey" FOREIGN KEY ("gift_product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion" ADD CONSTRAINT "promotion_gift_variation_id_brand_id_fkey" FOREIGN KEY ("gift_variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_translation" ADD CONSTRAINT "promotion_translation_promotion_id_brand_id_fkey" FOREIGN KEY ("promotion_id", "brand_id") REFERENCES "promotion"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_market" ADD CONSTRAINT "promotion_market_promotion_id_brand_id_fkey" FOREIGN KEY ("promotion_id", "brand_id") REFERENCES "promotion"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_market" ADD CONSTRAINT "promotion_market_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_target" ADD CONSTRAINT "promotion_target_promotion_id_brand_id_fkey" FOREIGN KEY ("promotion_id", "brand_id") REFERENCES "promotion"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_target" ADD CONSTRAINT "promotion_target_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_target" ADD CONSTRAINT "promotion_target_category_id_brand_id_fkey" FOREIGN KEY ("category_id", "brand_id") REFERENCES "category"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_target" ADD CONSTRAINT "promotion_target_collection_id_brand_id_fkey" FOREIGN KEY ("collection_id", "brand_id") REFERENCES "collection"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon" ADD CONSTRAINT "coupon_promotion_id_brand_id_fkey" FOREIGN KEY ("promotion_id", "brand_id") REFERENCES "promotion"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_usage" ADD CONSTRAINT "promotion_usage_promotion_id_brand_id_fkey" FOREIGN KEY ("promotion_id", "brand_id") REFERENCES "promotion"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_usage" ADD CONSTRAINT "promotion_usage_coupon_id_brand_id_fkey" FOREIGN KEY ("coupon_id", "brand_id") REFERENCES "coupon"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_usage" ADD CONSTRAINT "promotion_usage_order_id_brand_id_fkey" FOREIGN KEY ("order_id", "brand_id") REFERENCES "customer_order"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_brand_id_fkey" FOREIGN KEY ("customer_id", "brand_id") REFERENCES "customer"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "delivery_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================================
-- Hand-written part (docs/PHASE-5-SCHEMA-DRAFT.md): constraints, partial indexes, state machines,
-- frozen snapshots, append-only tables and row-level security.
-- =====================================================================================================

-- Partial unique indexes ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "cart_one_open_per_customer" ON "cart" ("brand_id", "customer_id")
  WHERE "status" = 'OPEN' AND "customer_id" IS NOT NULL;
CREATE UNIQUE INDEX "payment_config_one_active" ON "payment_config" ("brand_id", "market_id", "provider")
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "customer_address_one_default" ON "customer_address" ("brand_id", "customer_id")
  WHERE "is_default";

-- Check constraints ----------------------------------------------------------------------------------
ALTER TABLE "cart"
  ADD CONSTRAINT "cart_owner_check" CHECK (("customer_id" IS NOT NULL) <> ("guest_token_hash" IS NOT NULL)),
  ADD CONSTRAINT "cart_coupon_code_check" CHECK ("coupon_code" IS NULL OR "coupon_code" ~ '^[A-Z0-9_-]{3,32}$');
ALTER TABLE "cart_line"
  ADD CONSTRAINT "cart_line_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99),
  ADD CONSTRAINT "cart_line_note_check" CHECK ("note" IS NULL OR char_length("note") <= 200);
ALTER TABLE "cart_line_option"
  ADD CONSTRAINT "cart_line_option_value_check" CHECK ("choice_id" IS NOT NULL OR "text" IS NOT NULL),
  ADD CONSTRAINT "cart_line_option_text_check" CHECK ("text" IS NULL OR char_length("text") <= 500);
ALTER TABLE "cart_line_addon"
  ADD CONSTRAINT "cart_line_addon_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99);

ALTER TABLE "customer_order"
  ADD CONSTRAINT "customer_order_number_check" CHECK ("number" ~ '^[A-Z0-9]{2,8}-[0-9]{4,12}$'),
  ADD CONSTRAINT "customer_order_idempotency_check" CHECK (char_length("idempotency_key") BETWEEN 16 AND 128),
  ADD CONSTRAINT "customer_order_amounts_check" CHECK (
    "subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "delivery_fee_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0),
  ADD CONSTRAINT "customer_order_total_check" CHECK (
    "total_minor" = "subtotal_minor" - "discount_minor" + "delivery_fee_minor" + CASE WHEN "tax_inclusive" THEN 0 ELSE "tax_minor" END),
  ADD CONSTRAINT "customer_order_owner_check" CHECK ("customer_id" IS NOT NULL OR ("guest_email" IS NOT NULL AND "guest_phone" IS NOT NULL)),
  ADD CONSTRAINT "customer_order_slot_check" CHECK ("slot_start" IS NULL OR "slot_end" IS NULL OR "slot_end" > "slot_start"),
  ADD CONSTRAINT "customer_order_gift_check" CHECK ("gift_message" IS NULL OR char_length("gift_message") <= 500);
ALTER TABLE "order_line"
  ADD CONSTRAINT "order_line_position_check" CHECK ("position" >= 1),
  ADD CONSTRAINT "order_line_quantity_check" CHECK ("quantity" >= 1),
  ADD CONSTRAINT "order_line_amounts_check" CHECK ("unit_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0),
  ADD CONSTRAINT "order_line_total_check" CHECK ("total_minor" = "unit_minor" * "quantity" - "discount_minor"),
  ADD CONSTRAINT "order_line_gift_check" CHECK ("kind" <> 'GIFT' OR "unit_minor" = 0);
ALTER TABLE "order_promotion"
  ADD CONSTRAINT "order_promotion_amount_check" CHECK ("amount_minor" >= 0);
ALTER TABLE "order_status_history"
  ADD CONSTRAINT "order_status_history_dimension_check" CHECK ("dimension" IN ('ORDER', 'PAYMENT', 'FULFILLMENT'));
ALTER TABLE "order_counter"
  ADD CONSTRAINT "order_counter_prefix_check" CHECK ("prefix" ~ '^[A-Z0-9]{2,8}$'),
  ADD CONSTRAINT "order_counter_next_check" CHECK ("next_value" >= 1);

ALTER TABLE "payment_config"
  ADD CONSTRAINT "payment_config_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "payment_config_credentials_check" CHECK (
    ("provider" = 'CCAVENUE') = ("credentials_encrypted" IS NOT NULL)),
  ADD CONSTRAINT "payment_config_envelope_check" CHECK (
    "credentials_encrypted" IS NULL OR "credentials_encrypted" ~ '^v[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  ADD CONSTRAINT "payment_config_last4_check" CHECK ("credentials_last4" IS NULL OR char_length("credentials_last4") <= 4),
  ADD CONSTRAINT "payment_config_cod_check" CHECK (
    "provider" = 'COD' OR (cardinality("cod_zone_ids") = 0 AND "cod_max_order_minor" IS NULL)),
  ADD CONSTRAINT "payment_config_cod_max_check" CHECK ("cod_max_order_minor" IS NULL OR "cod_max_order_minor" > 0);
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amounts_check" CHECK (
    "amount_minor" >= 0 AND "paid_minor" >= 0 AND "refunded_minor" >= 0
    AND "paid_minor" <= "amount_minor" AND "refunded_minor" <= "paid_minor");
ALTER TABLE "payment_attempt"
  ADD CONSTRAINT "payment_attempt_amount_check" CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "payment_attempt_expiry_check" CHECK ("expires_at" > "created_at");

ALTER TABLE "promotion"
  ADD CONSTRAINT "promotion_code_check" CHECK (char_length("code") BETWEEN 2 AND 64),
  ADD CONSTRAINT "promotion_kind_values_check" CHECK (COALESCE(
    CASE "kind"
      WHEN 'PERCENT_OFF' THEN "percent_bps" BETWEEN 1 AND 10000 AND "fixed_minor" IS NULL AND "gift_product_id" IS NULL
      WHEN 'FIXED_OFF' THEN "fixed_minor" > 0 AND "currency_code" IS NOT NULL AND "percent_bps" IS NULL AND "gift_product_id" IS NULL
      WHEN 'FREE_DELIVERY' THEN "percent_bps" IS NULL AND "fixed_minor" IS NULL AND "gift_product_id" IS NULL
      WHEN 'FREE_GIFT' THEN "gift_product_id" IS NOT NULL AND "percent_bps" IS NULL AND "fixed_minor" IS NULL
    END, false)),
  ADD CONSTRAINT "promotion_gift_variation_check" CHECK ("gift_variation_id" IS NULL OR "gift_product_id" IS NOT NULL),
  ADD CONSTRAINT "promotion_max_discount_check" CHECK (
    "max_discount_minor" IS NULL OR ("kind" = 'PERCENT_OFF' AND "max_discount_minor" > 0)),
  ADD CONSTRAINT "promotion_min_subtotal_check" CHECK ("min_subtotal_minor" >= 0),
  ADD CONSTRAINT "promotion_window_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"),
  ADD CONSTRAINT "promotion_limits_check" CHECK (
    ("usage_limit" IS NULL OR "usage_limit" > 0) AND ("per_customer_limit" IS NULL OR "per_customer_limit" > 0)
    AND "used_count" >= 0 AND ("usage_limit" IS NULL OR "used_count" <= "usage_limit")),
  ADD CONSTRAINT "promotion_priority_check" CHECK ("priority" BETWEEN 0 AND 10000);
ALTER TABLE "coupon"
  ADD CONSTRAINT "coupon_code_check" CHECK ("code" ~ '^[A-Z0-9_-]{3,32}$'),
  ADD CONSTRAINT "coupon_limits_check" CHECK (
    ("usage_limit" IS NULL OR "usage_limit" > 0) AND "used_count" >= 0
    AND ("usage_limit" IS NULL OR "used_count" <= "usage_limit"));
ALTER TABLE "promotion_usage"
  ADD CONSTRAINT "promotion_usage_amount_check" CHECK ("amount_minor" >= 0);
ALTER TABLE "customer_address"
  ADD CONSTRAINT "customer_address_text_check" CHECK (char_length("line1") BETWEEN 1 AND 200);

-- State machines (docs/ORDER-MANAGEMENT.md; mirrors @matilda/validation commerce.ts) -------------------
CREATE FUNCTION commerce_transition_ok(machine text, from_state text, to_state text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT to_state = ANY (COALESCE(CASE machine
    WHEN 'order' THEN CASE from_state
      WHEN 'DRAFT' THEN ARRAY['PENDING_PAYMENT', 'CANCELLED']
      WHEN 'PENDING_PAYMENT' THEN ARRAY['CONFIRMED', 'CANCELLED']
      WHEN 'CONFIRMED' THEN ARRAY['IN_PROGRESS', 'ON_HOLD', 'CANCELLED']
      WHEN 'IN_PROGRESS' THEN ARRAY['COMPLETED', 'ON_HOLD', 'CANCELLED']
      WHEN 'ON_HOLD' THEN ARRAY['CONFIRMED', 'IN_PROGRESS', 'CANCELLED']
    END
    WHEN 'payment' THEN CASE from_state
      WHEN 'UNPAID' THEN ARRAY['PENDING', 'COD_PENDING', 'PAID']
      WHEN 'PENDING' THEN ARRAY['PAID', 'PARTIALLY_PAID', 'FAILED']
      WHEN 'COD_PENDING' THEN ARRAY['PAID', 'PARTIALLY_PAID', 'FAILED']
      WHEN 'PARTIALLY_PAID' THEN ARRAY['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']
      WHEN 'PAID' THEN ARRAY['PARTIALLY_REFUNDED', 'REFUNDED']
      WHEN 'FAILED' THEN ARRAY['PENDING']
      WHEN 'PARTIALLY_REFUNDED' THEN ARRAY['REFUNDED']
    END
    WHEN 'fulfillment' THEN CASE from_state
      WHEN 'UNASSIGNED' THEN ARRAY['ASSIGNED']
      WHEN 'ASSIGNED' THEN ARRAY['OUT_FOR_DELIVERY', 'PICKUP_READY', 'UNASSIGNED']
      WHEN 'OUT_FOR_DELIVERY' THEN ARRAY['DELIVERED', 'FAILED_DELIVERY']
      WHEN 'FAILED_DELIVERY' THEN ARRAY['ASSIGNED', 'RETURNED']
      WHEN 'PICKUP_READY' THEN ARRAY['PICKED_UP']
    END
    WHEN 'attempt' THEN CASE from_state
      WHEN 'INITIATED' THEN ARRAY['REDIRECTED', 'SUCCEEDED', 'FAILED', 'EXPIRED']
      WHEN 'REDIRECTED' THEN ARRAY['SUCCEEDED', 'FAILED', 'EXPIRED']
    END
    WHEN 'cart' THEN CASE from_state
      WHEN 'OPEN' THEN ARRAY['CONVERTED', 'ABANDONED', 'MERGED']
      WHEN 'ABANDONED' THEN ARRAY['OPEN']
    END
  END, ARRAY[]::text[]))
$$;

CREATE FUNCTION commerce_assert_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE col text := TG_ARGV[1]; old_v text; new_v text;
BEGIN
  old_v := to_jsonb(OLD) ->> col;
  new_v := to_jsonb(NEW) ->> col;
  IF old_v IS DISTINCT FROM new_v AND NOT commerce_transition_ok(TG_ARGV[0], old_v, new_v) THEN
    RAISE EXCEPTION 'A % cannot change from % to %', TG_ARGV[0], old_v, new_v USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "customer_order_status_transition" BEFORE UPDATE OF "status" ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_transition('order', 'status');
CREATE TRIGGER "customer_order_payment_transition" BEFORE UPDATE OF "payment_status" ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_transition('payment', 'payment_status');
CREATE TRIGGER "customer_order_fulfillment_transition" BEFORE UPDATE OF "fulfillment_status" ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_transition('fulfillment', 'fulfillment_status');
CREATE TRIGGER "payment_status_transition" BEFORE UPDATE OF "status" ON "payment"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_transition('payment', 'status');
CREATE TRIGGER "payment_attempt_status_transition" BEFORE UPDATE OF "status" ON "payment_attempt"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_transition('attempt', 'status');
CREATE TRIGGER "cart_status_transition" BEFORE UPDATE OF "status" ON "cart"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_transition('cart', 'status');

-- A new order starts in DRAFT, UNPAID, UNASSIGNED; the service then moves it through the machines.
CREATE FUNCTION commerce_assert_order_start() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'DRAFT' OR NEW."payment_status" <> 'UNPAID' OR NEW."fulfillment_status" <> 'UNASSIGNED' THEN
    RAISE EXCEPTION 'A new order starts as a draft, unpaid and unassigned' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "customer_order_start_check" BEFORE INSERT ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_order_start();

-- Every status change writes its history row (D5-05). Services may set app.actor_staff_id,
-- app.actor_customer_id and app.status_reason with set_config(..., true) in the same transaction.
CREATE FUNCTION commerce_record_order_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  staff uuid := NULLIF(current_setting('app.actor_staff_id', true), '')::uuid;
  customer uuid := NULLIF(current_setting('app.actor_customer_id', true), '')::uuid;
  why text := NULLIF(current_setting('app.status_reason', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "order_status_history" ("id", "brand_id", "order_id", "dimension", "from_status", "to_status", "actor_staff_id", "actor_customer_id", "reason")
    VALUES (gen_random_uuid(), NEW."brand_id", NEW."id", 'ORDER', NULL, NEW."status"::text, staff, customer, why);
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "order_status_history" ("id", "brand_id", "order_id", "dimension", "from_status", "to_status", "actor_staff_id", "actor_customer_id", "reason")
    VALUES (gen_random_uuid(), NEW."brand_id", NEW."id", 'ORDER', OLD."status"::text, NEW."status"::text, staff, customer, why);
  END IF;
  IF NEW."payment_status" IS DISTINCT FROM OLD."payment_status" THEN
    INSERT INTO "order_status_history" ("id", "brand_id", "order_id", "dimension", "from_status", "to_status", "actor_staff_id", "actor_customer_id", "reason")
    VALUES (gen_random_uuid(), NEW."brand_id", NEW."id", 'PAYMENT', OLD."payment_status"::text, NEW."payment_status"::text, staff, customer, why);
  END IF;
  IF NEW."fulfillment_status" IS DISTINCT FROM OLD."fulfillment_status" THEN
    INSERT INTO "order_status_history" ("id", "brand_id", "order_id", "dimension", "from_status", "to_status", "actor_staff_id", "actor_customer_id", "reason")
    VALUES (gen_random_uuid(), NEW."brand_id", NEW."id", 'FULFILLMENT', OLD."fulfillment_status"::text, NEW."fulfillment_status"::text, staff, customer, why);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "customer_order_history_insert" AFTER INSERT ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION commerce_record_order_history();
CREATE TRIGGER "customer_order_history_update" AFTER UPDATE OF "status", "payment_status", "fulfillment_status" ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION commerce_record_order_history();

-- Snapshots are frozen once the order leaves DRAFT (D5-06). Only the status columns, the branch,
-- confirmation and cancellation times, the chosen payment method and a guest order's later link to a
-- new account may change. Anything else needs a Phase 6 audited amendment path.
CREATE FUNCTION commerce_freeze_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  open_keys text[] := ARRAY['status', 'payment_status', 'fulfillment_status', 'branch_id', 'confirmed_at', 'cancelled_at',
    'updated_at', 'payment_config_version', 'payment_provider', 'payment_method', 'customer_id'];
BEGIN
  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      IF NOT EXISTS (SELECT 1 FROM "order_line" WHERE "order_id" = NEW."id") THEN
        RAISE EXCEPTION 'An order needs at least one line' USING ERRCODE = '23514';
      END IF;
      IF NEW."subtotal_minor" <> (SELECT COALESCE(sum("unit_minor"::bigint * "quantity"), 0) FROM "order_line" WHERE "order_id" = NEW."id") THEN
        RAISE EXCEPTION 'The order subtotal does not match its lines' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - open_keys) IS DISTINCT FROM (to_jsonb(OLD) - open_keys) THEN
    RAISE EXCEPTION 'An order is frozen once placed' USING ERRCODE = '23514';
  END IF;
  IF NEW."customer_id" IS DISTINCT FROM OLD."customer_id" AND OLD."customer_id" IS NOT NULL THEN
    RAISE EXCEPTION 'An order cannot move to another customer' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "customer_order_freeze" BEFORE UPDATE ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION commerce_freeze_order();

-- Orders are never deleted; the audit history stays.
CREATE FUNCTION commerce_forbid_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER "customer_order_no_delete" BEFORE DELETE ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION commerce_forbid_delete();
CREATE TRIGGER "payment_no_delete" BEFORE DELETE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION commerce_forbid_delete();
CREATE TRIGGER "payment_attempt_no_delete" BEFORE DELETE ON "payment_attempt"
  FOR EACH ROW EXECUTE FUNCTION commerce_forbid_delete();
CREATE TRIGGER "payment_config_no_delete" BEFORE DELETE ON "payment_config"
  FOR EACH ROW EXECUTE FUNCTION commerce_forbid_delete();

-- Append-only tables ---------------------------------------------------------------------------------
CREATE FUNCTION commerce_forbid_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER "order_line_no_row_change" BEFORE UPDATE OR DELETE ON "order_line"
  FOR EACH ROW EXECUTE FUNCTION commerce_forbid_row_change();
CREATE TRIGGER "order_promotion_no_row_change" BEFORE UPDATE OR DELETE ON "order_promotion"
  FOR EACH ROW EXECUTE FUNCTION commerce_forbid_row_change();
CREATE TRIGGER "order_status_history_no_row_change" BEFORE UPDATE OR DELETE ON "order_status_history"
  FOR EACH ROW EXECUTE FUNCTION commerce_forbid_row_change();
CREATE TRIGGER "payment_event_no_row_change" BEFORE UPDATE OR DELETE ON "payment_event"
  FOR EACH ROW EXECUTE FUNCTION commerce_forbid_row_change();
REVOKE UPDATE, DELETE ON "order_line", "order_promotion", "order_status_history", "payment_event" FROM matilda_app;

-- Lines and promotions can only be added while the order is a draft.
CREATE FUNCTION commerce_assert_order_is_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "status" FROM "customer_order" WHERE "id" = NEW."order_id") <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines and promotions can only be added to a draft order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "order_line_draft_only" BEFORE INSERT ON "order_line"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_order_is_draft();
CREATE TRIGGER "order_promotion_draft_only" BEFORE INSERT ON "order_promotion"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_order_is_draft();

-- Payment config rows are versions: never edited in place except to deactivate ---------------------------
CREATE FUNCTION commerce_freeze_payment_config() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'A payment configuration version cannot be edited; add a new version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payment_config_frozen" BEFORE UPDATE ON "payment_config"
  FOR EACH ROW EXECUTE FUNCTION commerce_freeze_payment_config();

-- A payment matches its order's currency and its config's market and provider ----------------------------
CREATE FUNCTION commerce_assert_payment_matches() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record; c record;
BEGIN
  SELECT "currency_code", "market_id", "total_minor" INTO o FROM "customer_order" WHERE "id" = NEW."order_id";
  SELECT "market_id", "provider", "version" INTO c FROM "payment_config" WHERE "id" = NEW."config_id";
  IF o."currency_code" <> NEW."currency_code" THEN
    RAISE EXCEPTION 'The payment currency must match the order' USING ERRCODE = '23514';
  END IF;
  IF o."total_minor" <> NEW."amount_minor" THEN
    RAISE EXCEPTION 'The payment amount must match the order total' USING ERRCODE = '23514';
  END IF;
  IF c."market_id" <> o."market_id" OR c."provider" <> NEW."provider" OR c."version" <> NEW."config_version" THEN
    RAISE EXCEPTION 'The payment configuration must match the order market, provider and version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payment_matches_order" BEFORE INSERT ON "payment"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_payment_matches();

-- A payment never changes its order, config, amount or currency after creation.
CREATE FUNCTION commerce_freeze_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."order_id" <> OLD."order_id" OR NEW."config_id" <> OLD."config_id" OR NEW."config_version" <> OLD."config_version"
     OR NEW."amount_minor" <> OLD."amount_minor" OR NEW."currency_code" <> OLD."currency_code" OR NEW."provider" <> OLD."provider" THEN
    RAISE EXCEPTION 'A payment keeps its order, configuration, provider and amount' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payment_frozen_columns" BEFORE UPDATE ON "payment"
  FOR EACH ROW EXECUTE FUNCTION commerce_freeze_payment();

-- Cart rules ----------------------------------------------------------------------------------------------
CREATE FUNCTION commerce_assert_cart_line_shape() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "ProductType"; line_count integer;
BEGIN
  SELECT "type" INTO kind FROM "product" WHERE "id" = NEW."product_id";
  IF kind = 'VARIABLE' AND NEW."variation_id" IS NULL THEN
    RAISE EXCEPTION 'A variable product needs a variation' USING ERRCODE = '23514';
  ELSIF kind <> 'VARIABLE' AND NEW."variation_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Only a variable product has variations' USING ERRCODE = '23514';
  END IF;
  IF NEW."variation_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "variation" WHERE "id" = NEW."variation_id" AND "product_id" = NEW."product_id") THEN
    RAISE EXCEPTION 'The variation belongs to another product' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO line_count FROM "cart_line" WHERE "cart_id" = NEW."cart_id";
    IF line_count >= 50 THEN
      RAISE EXCEPTION 'A cart holds at most 50 lines' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cart_line_shape_check" BEFORE INSERT OR UPDATE OF "product_id", "variation_id" ON "cart_line"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_cart_line_shape();

-- An add-on or option chosen on a line must belong to that line's product; a bundle choice must name a
-- component bundle of that product and a variation of the component.
CREATE FUNCTION commerce_assert_cart_selection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_product uuid;
BEGIN
  SELECT "product_id" INTO line_product FROM "cart_line" WHERE "id" = NEW."line_id";
  IF TG_TABLE_NAME = 'cart_line_option' THEN
    IF NOT EXISTS (SELECT 1 FROM "option_group" WHERE "id" = NEW."option_group_id" AND "product_id" = line_product) THEN
      RAISE EXCEPTION 'The option belongs to another product' USING ERRCODE = '23514';
    END IF;
    IF NEW."choice_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "option_choice" WHERE "id" = NEW."choice_id" AND "option_group_id" = NEW."option_group_id") THEN
      RAISE EXCEPTION 'The choice belongs to another option' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'cart_line_addon' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "addon_item" i JOIN "addon_group" g ON g."id" = i."addon_group_id"
      WHERE i."id" = NEW."addon_item_id" AND g."product_id" = line_product) THEN
      RAISE EXCEPTION 'The add-on belongs to another product' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'cart_line_bundle_choice' THEN
    IF NOT EXISTS (SELECT 1 FROM "bundle_item" WHERE "id" = NEW."bundle_item_id" AND "bundle_product_id" = line_product) THEN
      RAISE EXCEPTION 'The bundle item belongs to another product' USING ERRCODE = '23514';
    END IF;
    IF NEW."variation_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "bundle_item" b JOIN "variation" v ON v."product_id" = b."component_product_id"
      WHERE b."id" = NEW."bundle_item_id" AND v."id" = NEW."variation_id") THEN
      RAISE EXCEPTION 'The variation is not one of the bundle component' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cart_line_option_check" BEFORE INSERT OR UPDATE ON "cart_line_option"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_cart_selection();
CREATE TRIGGER "cart_line_addon_check" BEFORE INSERT OR UPDATE ON "cart_line_addon"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_cart_selection();
CREATE TRIGGER "cart_line_bundle_choice_check" BEFORE INSERT OR UPDATE ON "cart_line_bundle_choice"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_cart_selection();

-- Branch must serve the brand (Phase 4 helper) ----------------------------------------------------------------
CREATE TRIGGER "customer_order_branch_serves_brand" BEFORE INSERT OR UPDATE OF "branch_id" ON "customer_order"
  FOR EACH ROW EXECUTE FUNCTION delivery_assert_branch_serves_brand('branch_id');

-- Promotion targets match the promotion scope -----------------------------------------------------------------
CREATE FUNCTION commerce_assert_target_matches_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "PromotionScope"; n integer;
BEGIN
  SELECT "scope" INTO s FROM "promotion" WHERE "id" = NEW."promotion_id";
  n := (NEW."product_id" IS NOT NULL)::int + (NEW."category_id" IS NOT NULL)::int + (NEW."collection_id" IS NOT NULL)::int;
  IF n <> 1 OR s = 'ORDER'
     OR (s = 'PRODUCT' AND NEW."product_id" IS NULL)
     OR (s = 'CATEGORY' AND NEW."category_id" IS NULL)
     OR (s = 'COLLECTION' AND NEW."collection_id" IS NULL) THEN
    RAISE EXCEPTION 'The target does not match the promotion scope' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "promotion_target_scope_check" BEFORE INSERT OR UPDATE ON "promotion_target"
  FOR EACH ROW EXECUTE FUNCTION commerce_assert_target_matches_scope();

-- A product, category or collection promotion needs at least one target (checked at commit).
CREATE FUNCTION commerce_assert_scope_has_targets() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pid uuid; s "PromotionScope";
BEGIN
  IF TG_TABLE_NAME = 'promotion' THEN
    pid := NEW."id";
  ELSE
    pid := OLD."promotion_id";
  END IF;
  SELECT "scope" INTO s FROM "promotion" WHERE "id" = pid;
  IF s IS NOT NULL AND s <> 'ORDER' AND NOT EXISTS (SELECT 1 FROM "promotion_target" WHERE "promotion_id" = pid) THEN
    RAISE EXCEPTION 'A % promotion needs at least one target', s USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "promotion_scope_targets" AFTER INSERT OR UPDATE OF "scope" ON "promotion"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce_assert_scope_has_targets();
CREATE CONSTRAINT TRIGGER "promotion_target_removed" AFTER DELETE ON "promotion_target"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commerce_assert_scope_has_targets();

-- Row-level security on every table (all 21 are brand-keyed) -------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cart', 'cart_line', 'cart_line_option', 'cart_line_addon', 'cart_line_bundle_choice',
    'customer_order', 'order_line', 'order_promotion', 'order_status_history', 'order_counter',
    'payment_config', 'payment', 'payment_attempt', 'payment_event',
    'promotion', 'promotion_translation', 'promotion_market', 'promotion_target', 'coupon', 'promotion_usage',
    'customer_address']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform()) WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())',
      t || '_scope', t);
  END LOOP;
END $$;

-- BundleItem composite key needed by cart bundle choices is created by the generated part above.
