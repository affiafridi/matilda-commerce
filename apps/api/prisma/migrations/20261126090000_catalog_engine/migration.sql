-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SIMPLE', 'VARIABLE', 'BUNDLE');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttributeKind" AS ENUM ('TEXT', 'COLOR', 'NUMBER');

-- CreateEnum
CREATE TYPE "OptionType" AS ENUM ('SELECT', 'RADIO', 'CHECKBOX', 'TEXT', 'TEXTAREA', 'FILE', 'DATE');

-- CreateEnum
CREATE TYPE "RuleOperator" AS ENUM ('FILLED', 'EQUALS', 'NOT_EQUALS');

-- CreateEnum
CREATE TYPE "AddonKind" AS ENUM ('PRODUCT', 'INLINE');

-- CreateEnum
CREATE TYPE "ProductRelationKind" AS ENUM ('RELATED', 'UPSELL', 'CROSS_SELL');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADED', 'READY', 'REJECTED');

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "type" "ProductType" NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "sku" TEXT,
    "publish_at" TIMESTAMPTZ,
    "unpublish_at" TIMESTAMPTZ,
    "made_to_order" BOOLEAN NOT NULL DEFAULT false,
    "prep_time_minutes" INTEGER,
    "lead_time_minutes" INTEGER,
    "min_quantity" INTEGER NOT NULL DEFAULT 1,
    "max_quantity" INTEGER,
    "primary_category_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_translation" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,

    CONSTRAINT "product_translation_pkey" PRIMARY KEY ("product_id","language")
);

-- CreateTable
CREATE TABLE "product_category" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_category_pkey" PRIMARY KEY ("product_id","category_id")
);

-- CreateTable
CREATE TABLE "product_collection" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_collection_pkey" PRIMARY KEY ("product_id","collection_id")
);

-- CreateTable
CREATE TABLE "product_tag" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_tag_pkey" PRIMARY KEY ("product_id","tag_id")
);

-- CreateTable
CREATE TABLE "product_relation" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "related_product_id" UUID NOT NULL,
    "kind" "ProductRelationKind" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_relation_pkey" PRIMARY KEY ("product_id","related_product_id","kind")
);

-- CreateTable
CREATE TABLE "product_market" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,

    CONSTRAINT "product_market_pkey" PRIMARY KEY ("product_id","market_id")
);

-- CreateTable
CREATE TABLE "product_branch" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "product_branch_pkey" PRIMARY KEY ("product_id","branch_id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("product_id","media_asset_id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "parent_id" UUID,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "media_asset_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_translation" (
    "brand_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,

    CONSTRAINT "category_translation_pkey" PRIMARY KEY ("category_id","language")
);

-- CreateTable
CREATE TABLE "collection" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_translation" (
    "brand_id" UUID NOT NULL,
    "collection_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,

    CONSTRAINT "collection_translation_pkey" PRIMARY KEY ("collection_id","language")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_translation" (
    "brand_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slug" TEXT NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,

    CONSTRAINT "tag_translation_pkey" PRIMARY KEY ("tag_id","language")
);

-- CreateTable
CREATE TABLE "attribute" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "AttributeKind" NOT NULL DEFAULT 'TEXT',
    "product_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "attribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_value" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "color_hex" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "attribute_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_translation" (
    "brand_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "attribute_translation_pkey" PRIMARY KEY ("attribute_id","language")
);

-- CreateTable
CREATE TABLE "attribute_value_translation" (
    "brand_id" UUID NOT NULL,
    "attribute_value_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "attribute_value_translation_pkey" PRIMARY KEY ("attribute_value_id","language")
);

-- CreateTable
CREATE TABLE "product_attribute" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "drives_variations" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_attribute_pkey" PRIMARY KEY ("product_id","attribute_id")
);

-- CreateTable
CREATE TABLE "product_attribute_value" (
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "attribute_value_id" UUID NOT NULL,

    CONSTRAINT "product_attribute_value_pkey" PRIMARY KEY ("product_id","attribute_id","attribute_value_id")
);

-- CreateTable
CREATE TABLE "variation" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "combination_key" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "media_asset_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "variation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variation_value" (
    "brand_id" UUID NOT NULL,
    "variation_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "attribute_value_id" UUID NOT NULL,

    CONSTRAINT "variation_value_pkey" PRIMARY KEY ("variation_id","attribute_id")
);

-- CreateTable
CREATE TABLE "market_price" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "product_id" UUID,
    "variation_id" UUID,
    "regular_minor" INTEGER NOT NULL,
    "sale_minor" INTEGER,
    "sale_starts_at" TIMESTAMPTZ,
    "sale_ends_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "market_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_group" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "type" "OptionType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER,
    "max_length" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "option_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_choice" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "option_choice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_rule" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "depends_on_group_id" UUID NOT NULL,
    "operator" "RuleOperator" NOT NULL,
    "depends_on_choice_id" UUID,

    CONSTRAINT "option_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_group_translation" (
    "brand_id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "help_text" TEXT,

    CONSTRAINT "option_group_translation_pkey" PRIMARY KEY ("option_group_id","language")
);

-- CreateTable
CREATE TABLE "option_choice_translation" (
    "brand_id" UUID NOT NULL,
    "option_choice_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "option_choice_translation_pkey" PRIMARY KEY ("option_choice_id","language")
);

-- CreateTable
CREATE TABLE "option_price" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "option_group_id" UUID,
    "option_choice_id" UUID,
    "delta_minor" INTEGER NOT NULL,

    CONSTRAINT "option_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_group" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "addon_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_item" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "addon_group_id" UUID NOT NULL,
    "kind" "AddonKind" NOT NULL,
    "addon_product_id" UUID,
    "addon_variation_id" UUID,
    "key" TEXT,
    "max_quantity" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "addon_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_group_translation" (
    "brand_id" UUID NOT NULL,
    "addon_group_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "addon_group_translation_pkey" PRIMARY KEY ("addon_group_id","language")
);

-- CreateTable
CREATE TABLE "addon_item_translation" (
    "brand_id" UUID NOT NULL,
    "addon_item_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "addon_item_translation_pkey" PRIMARY KEY ("addon_item_id","language")
);

-- CreateTable
CREATE TABLE "addon_item_price" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "addon_item_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "delta_minor" INTEGER NOT NULL,

    CONSTRAINT "addon_item_price_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_item" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "bundle_product_id" UUID NOT NULL,
    "component_product_id" UUID NOT NULL,
    "component_variation_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bundle_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADED',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset_translation" (
    "brand_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "alt_text" TEXT NOT NULL,

    CONSTRAINT "media_asset_translation_pkey" PRIMARY KEY ("media_asset_id","language")
);

-- CreateTable
CREATE TABLE "media_variant" (
    "brand_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "content_type" TEXT NOT NULL,

    CONSTRAINT "media_variant_pkey" PRIMARY KEY ("media_asset_id","kind")
);

-- CreateTable
CREATE TABLE "catalog_slug_history" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "retired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_slug_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_brand_id_status_sort_order_idx" ON "product"("brand_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "product_primary_category_id_brand_id_idx" ON "product"("primary_category_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_id_brand_id_key" ON "product"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_brand_id_sku_key" ON "product"("brand_id", "sku");

-- CreateIndex
CREATE INDEX "product_translation_product_id_brand_id_idx" ON "product_translation"("product_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_translation_brand_id_language_slug_key" ON "product_translation"("brand_id", "language", "slug");

-- CreateIndex
CREATE INDEX "product_category_category_id_product_id_idx" ON "product_category"("category_id", "product_id");

-- CreateIndex
CREATE INDEX "product_category_product_id_brand_id_idx" ON "product_category"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_category_category_id_brand_id_idx" ON "product_category"("category_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_collection_collection_id_product_id_idx" ON "product_collection"("collection_id", "product_id");

-- CreateIndex
CREATE INDEX "product_collection_product_id_brand_id_idx" ON "product_collection"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_collection_collection_id_brand_id_idx" ON "product_collection"("collection_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_tag_tag_id_product_id_idx" ON "product_tag"("tag_id", "product_id");

-- CreateIndex
CREATE INDEX "product_tag_product_id_brand_id_idx" ON "product_tag"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_tag_tag_id_brand_id_idx" ON "product_tag"("tag_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_relation_product_id_brand_id_idx" ON "product_relation"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_relation_related_product_id_brand_id_idx" ON "product_relation"("related_product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_market_market_id_product_id_idx" ON "product_market"("market_id", "product_id");

-- CreateIndex
CREATE INDEX "product_market_product_id_brand_id_idx" ON "product_market"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_market_market_id_brand_id_idx" ON "product_market"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_branch_branch_id_product_id_idx" ON "product_branch"("branch_id", "product_id");

-- CreateIndex
CREATE INDEX "product_branch_product_id_brand_id_idx" ON "product_branch"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_media_media_asset_id_idx" ON "product_media"("media_asset_id");

-- CreateIndex
CREATE INDEX "product_media_product_id_brand_id_idx" ON "product_media"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_media_media_asset_id_brand_id_idx" ON "product_media"("media_asset_id", "brand_id");

-- CreateIndex
CREATE INDEX "category_brand_id_parent_id_sort_order_idx" ON "category"("brand_id", "parent_id", "sort_order");

-- CreateIndex
CREATE INDEX "category_parent_id_brand_id_idx" ON "category"("parent_id", "brand_id");

-- CreateIndex
CREATE INDEX "category_media_asset_id_brand_id_idx" ON "category"("media_asset_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_id_brand_id_key" ON "category"("id", "brand_id");

-- CreateIndex
CREATE INDEX "category_translation_category_id_brand_id_idx" ON "category_translation"("category_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_translation_brand_id_language_slug_key" ON "category_translation"("brand_id", "language", "slug");

-- CreateIndex
CREATE INDEX "collection_brand_id_status_sort_order_idx" ON "collection"("brand_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "collection_id_brand_id_key" ON "collection"("id", "brand_id");

-- CreateIndex
CREATE INDEX "collection_translation_collection_id_brand_id_idx" ON "collection_translation"("collection_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_translation_brand_id_language_slug_key" ON "collection_translation"("brand_id", "language", "slug");

-- CreateIndex
CREATE INDEX "tag_brand_id_status_sort_order_idx" ON "tag"("brand_id", "status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "tag_id_brand_id_key" ON "tag"("id", "brand_id");

-- CreateIndex
CREATE INDEX "tag_translation_tag_id_brand_id_idx" ON "tag_translation"("tag_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "tag_translation_brand_id_language_slug_key" ON "tag_translation"("brand_id", "language", "slug");

-- CreateIndex
CREATE INDEX "attribute_brand_id_key_idx" ON "attribute"("brand_id", "key");

-- CreateIndex
CREATE INDEX "attribute_product_id_brand_id_idx" ON "attribute"("product_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_id_brand_id_key" ON "attribute"("id", "brand_id");

-- CreateIndex
CREATE INDEX "attribute_value_attribute_id_brand_id_idx" ON "attribute_value"("attribute_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_value_id_brand_id_key" ON "attribute_value"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_value_attribute_id_key_key" ON "attribute_value"("attribute_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_value_id_attribute_id_key" ON "attribute_value"("id", "attribute_id");

-- CreateIndex
CREATE INDEX "attribute_translation_attribute_id_brand_id_idx" ON "attribute_translation"("attribute_id", "brand_id");

-- CreateIndex
CREATE INDEX "attribute_value_translation_attribute_value_id_brand_id_idx" ON "attribute_value_translation"("attribute_value_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_attribute_attribute_id_idx" ON "product_attribute"("attribute_id");

-- CreateIndex
CREATE INDEX "product_attribute_product_id_brand_id_idx" ON "product_attribute"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_attribute_attribute_id_brand_id_idx" ON "product_attribute"("attribute_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_attribute_product_id_attribute_id_brand_id_key" ON "product_attribute"("product_id", "attribute_id", "brand_id");

-- CreateIndex
CREATE INDEX "product_attribute_value_attribute_value_id_attribute_id_idx" ON "product_attribute_value"("attribute_value_id", "attribute_id");

-- CreateIndex
CREATE INDEX "product_attribute_value_product_id_attribute_id_brand_id_idx" ON "product_attribute_value"("product_id", "attribute_id", "brand_id");

-- CreateIndex
CREATE INDEX "variation_product_id_brand_id_idx" ON "variation"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "variation_media_asset_id_brand_id_idx" ON "variation"("media_asset_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "variation_id_brand_id_key" ON "variation"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "variation_brand_id_sku_key" ON "variation"("brand_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "variation_product_id_combination_key_key" ON "variation"("product_id", "combination_key");

-- CreateIndex
CREATE UNIQUE INDEX "variation_id_product_id_key" ON "variation"("id", "product_id");

-- CreateIndex
CREATE INDEX "variation_value_product_id_attribute_id_attribute_value_id_idx" ON "variation_value"("product_id", "attribute_id", "attribute_value_id");

-- CreateIndex
CREATE INDEX "variation_value_variation_id_brand_id_idx" ON "variation_value"("variation_id", "brand_id");

-- CreateIndex
CREATE INDEX "variation_value_variation_id_product_id_idx" ON "variation_value"("variation_id", "product_id");

-- CreateIndex
CREATE INDEX "market_price_market_id_product_id_idx" ON "market_price"("market_id", "product_id");

-- CreateIndex
CREATE INDEX "market_price_market_id_variation_id_idx" ON "market_price"("market_id", "variation_id");

-- CreateIndex
CREATE INDEX "market_price_market_id_brand_id_idx" ON "market_price"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "market_price_market_id_currency_code_idx" ON "market_price"("market_id", "currency_code");

-- CreateIndex
CREATE INDEX "market_price_product_id_brand_id_idx" ON "market_price"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "market_price_variation_id_brand_id_idx" ON "market_price"("variation_id", "brand_id");

-- CreateIndex
CREATE INDEX "option_group_product_id_brand_id_idx" ON "option_group"("product_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "option_group_id_brand_id_key" ON "option_group"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "option_group_product_id_key_key" ON "option_group"("product_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "option_group_id_product_id_key" ON "option_group"("id", "product_id");

-- CreateIndex
CREATE INDEX "option_choice_option_group_id_brand_id_idx" ON "option_choice"("option_group_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "option_choice_id_brand_id_key" ON "option_choice"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "option_choice_option_group_id_key_key" ON "option_choice"("option_group_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "option_choice_id_option_group_id_key" ON "option_choice"("id", "option_group_id");

-- CreateIndex
CREATE INDEX "option_rule_product_id_idx" ON "option_rule"("product_id");

-- CreateIndex
CREATE INDEX "option_rule_option_group_id_idx" ON "option_rule"("option_group_id");

-- CreateIndex
CREATE INDEX "option_rule_depends_on_group_id_idx" ON "option_rule"("depends_on_group_id");

-- CreateIndex
CREATE INDEX "option_rule_depends_on_choice_id_depends_on_group_id_idx" ON "option_rule"("depends_on_choice_id", "depends_on_group_id");

-- CreateIndex
CREATE INDEX "option_rule_product_id_brand_id_idx" ON "option_rule"("product_id", "brand_id");

-- CreateIndex
CREATE INDEX "option_rule_option_group_id_product_id_idx" ON "option_rule"("option_group_id", "product_id");

-- CreateIndex
CREATE INDEX "option_rule_depends_on_group_id_product_id_idx" ON "option_rule"("depends_on_group_id", "product_id");

-- CreateIndex
CREATE INDEX "option_group_translation_option_group_id_brand_id_idx" ON "option_group_translation"("option_group_id", "brand_id");

-- CreateIndex
CREATE INDEX "option_choice_translation_option_choice_id_brand_id_idx" ON "option_choice_translation"("option_choice_id", "brand_id");

-- CreateIndex
CREATE INDEX "option_price_market_id_currency_code_idx" ON "option_price"("market_id", "currency_code");

-- CreateIndex
CREATE INDEX "option_price_option_group_id_idx" ON "option_price"("option_group_id");

-- CreateIndex
CREATE INDEX "option_price_option_choice_id_idx" ON "option_price"("option_choice_id");

-- CreateIndex
CREATE INDEX "option_price_market_id_brand_id_idx" ON "option_price"("market_id", "brand_id");

-- CreateIndex
CREATE INDEX "option_price_option_group_id_brand_id_idx" ON "option_price"("option_group_id", "brand_id");

-- CreateIndex
CREATE INDEX "option_price_option_choice_id_brand_id_idx" ON "option_price"("option_choice_id", "brand_id");

-- CreateIndex
CREATE INDEX "addon_group_product_id_brand_id_idx" ON "addon_group"("product_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "addon_group_id_brand_id_key" ON "addon_group"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "addon_group_product_id_key_key" ON "addon_group"("product_id", "key");

-- CreateIndex
CREATE INDEX "addon_item_addon_group_id_idx" ON "addon_item"("addon_group_id");

-- CreateIndex
CREATE INDEX "addon_item_addon_product_id_idx" ON "addon_item"("addon_product_id");

-- CreateIndex
CREATE INDEX "addon_item_addon_variation_id_addon_product_id_idx" ON "addon_item"("addon_variation_id", "addon_product_id");

-- CreateIndex
CREATE INDEX "addon_item_addon_group_id_brand_id_idx" ON "addon_item"("addon_group_id", "brand_id");

-- CreateIndex
CREATE INDEX "addon_item_addon_product_id_brand_id_idx" ON "addon_item"("addon_product_id", "brand_id");

-- CreateIndex
CREATE INDEX "addon_item_addon_variation_id_brand_id_idx" ON "addon_item"("addon_variation_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "addon_item_id_brand_id_key" ON "addon_item"("id", "brand_id");

-- CreateIndex
CREATE INDEX "addon_group_translation_addon_group_id_brand_id_idx" ON "addon_group_translation"("addon_group_id", "brand_id");

-- CreateIndex
CREATE INDEX "addon_item_translation_addon_item_id_brand_id_idx" ON "addon_item_translation"("addon_item_id", "brand_id");

-- CreateIndex
CREATE INDEX "addon_item_price_market_id_currency_code_idx" ON "addon_item_price"("market_id", "currency_code");

-- CreateIndex
CREATE INDEX "addon_item_price_addon_item_id_brand_id_idx" ON "addon_item_price"("addon_item_id", "brand_id");

-- CreateIndex
CREATE INDEX "addon_item_price_market_id_brand_id_idx" ON "addon_item_price"("market_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "addon_item_price_addon_item_id_market_id_currency_code_key" ON "addon_item_price"("addon_item_id", "market_id", "currency_code");

-- CreateIndex
CREATE INDEX "bundle_item_bundle_product_id_idx" ON "bundle_item"("bundle_product_id");

-- CreateIndex
CREATE INDEX "bundle_item_component_product_id_idx" ON "bundle_item"("component_product_id");

-- CreateIndex
CREATE INDEX "bundle_item_component_variation_id_component_product_id_idx" ON "bundle_item"("component_variation_id", "component_product_id");

-- CreateIndex
CREATE INDEX "bundle_item_bundle_product_id_brand_id_idx" ON "bundle_item"("bundle_product_id", "brand_id");

-- CreateIndex
CREATE INDEX "bundle_item_component_product_id_brand_id_idx" ON "bundle_item"("component_product_id", "brand_id");

-- CreateIndex
CREATE INDEX "bundle_item_component_variation_id_brand_id_idx" ON "bundle_item"("component_variation_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_id_brand_id_key" ON "media_asset"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_brand_id_sha256_key" ON "media_asset"("brand_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "media_asset_storage_key_key" ON "media_asset"("storage_key");

-- CreateIndex
CREATE INDEX "media_asset_translation_media_asset_id_brand_id_idx" ON "media_asset_translation"("media_asset_id", "brand_id");

-- CreateIndex
CREATE INDEX "media_variant_media_asset_id_brand_id_idx" ON "media_variant"("media_asset_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_variant_storage_key_key" ON "media_variant"("storage_key");

-- CreateIndex
CREATE INDEX "catalog_slug_history_entity_type_entity_id_idx" ON "catalog_slug_history"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_slug_history_brand_id_entity_type_language_slug_key" ON "catalog_slug_history"("brand_id", "entity_type", "language", "slug");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_primary_category_id_brand_id_fkey" FOREIGN KEY ("primary_category_id", "brand_id") REFERENCES "category"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_translation" ADD CONSTRAINT "product_translation_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_category_id_brand_id_fkey" FOREIGN KEY ("category_id", "brand_id") REFERENCES "category"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collection" ADD CONSTRAINT "product_collection_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_collection" ADD CONSTRAINT "product_collection_collection_id_brand_id_fkey" FOREIGN KEY ("collection_id", "brand_id") REFERENCES "collection"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tag" ADD CONSTRAINT "product_tag_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tag" ADD CONSTRAINT "product_tag_tag_id_brand_id_fkey" FOREIGN KEY ("tag_id", "brand_id") REFERENCES "tag"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_related_product_id_brand_id_fkey" FOREIGN KEY ("related_product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_market" ADD CONSTRAINT "product_market_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_market" ADD CONSTRAINT "product_market_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_branch" ADD CONSTRAINT "product_branch_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_branch" ADD CONSTRAINT "product_branch_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_media_asset_id_brand_id_fkey" FOREIGN KEY ("media_asset_id", "brand_id") REFERENCES "media_asset"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_brand_id_fkey" FOREIGN KEY ("parent_id", "brand_id") REFERENCES "category"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_media_asset_id_brand_id_fkey" FOREIGN KEY ("media_asset_id", "brand_id") REFERENCES "media_asset"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_translation" ADD CONSTRAINT "category_translation_category_id_brand_id_fkey" FOREIGN KEY ("category_id", "brand_id") REFERENCES "category"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection" ADD CONSTRAINT "collection_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_translation" ADD CONSTRAINT "collection_translation_collection_id_brand_id_fkey" FOREIGN KEY ("collection_id", "brand_id") REFERENCES "collection"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_translation" ADD CONSTRAINT "tag_translation_tag_id_brand_id_fkey" FOREIGN KEY ("tag_id", "brand_id") REFERENCES "tag"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute" ADD CONSTRAINT "attribute_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute" ADD CONSTRAINT "attribute_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_value" ADD CONSTRAINT "attribute_value_attribute_id_brand_id_fkey" FOREIGN KEY ("attribute_id", "brand_id") REFERENCES "attribute"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_translation" ADD CONSTRAINT "attribute_translation_attribute_id_brand_id_fkey" FOREIGN KEY ("attribute_id", "brand_id") REFERENCES "attribute"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_value_translation" ADD CONSTRAINT "attribute_value_translation_attribute_value_id_brand_id_fkey" FOREIGN KEY ("attribute_value_id", "brand_id") REFERENCES "attribute_value"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute" ADD CONSTRAINT "product_attribute_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute" ADD CONSTRAINT "product_attribute_attribute_id_brand_id_fkey" FOREIGN KEY ("attribute_id", "brand_id") REFERENCES "attribute"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_value" ADD CONSTRAINT "product_attribute_value_product_id_attribute_id_brand_id_fkey" FOREIGN KEY ("product_id", "attribute_id", "brand_id") REFERENCES "product_attribute"("product_id", "attribute_id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attribute_value" ADD CONSTRAINT "product_attribute_value_attribute_value_id_attribute_id_fkey" FOREIGN KEY ("attribute_value_id", "attribute_id") REFERENCES "attribute_value"("id", "attribute_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation" ADD CONSTRAINT "variation_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation" ADD CONSTRAINT "variation_media_asset_id_brand_id_fkey" FOREIGN KEY ("media_asset_id", "brand_id") REFERENCES "media_asset"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_value" ADD CONSTRAINT "variation_value_variation_id_brand_id_fkey" FOREIGN KEY ("variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_value" ADD CONSTRAINT "variation_value_variation_id_product_id_fkey" FOREIGN KEY ("variation_id", "product_id") REFERENCES "variation"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variation_value" ADD CONSTRAINT "variation_value_product_id_attribute_id_attribute_value_id_fkey" FOREIGN KEY ("product_id", "attribute_id", "attribute_value_id") REFERENCES "product_attribute_value"("product_id", "attribute_id", "attribute_value_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_market_id_currency_code_fkey" FOREIGN KEY ("market_id", "currency_code") REFERENCES "market_currency"("market_id", "currency_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_variation_id_brand_id_fkey" FOREIGN KEY ("variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_group" ADD CONSTRAINT "option_group_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_choice" ADD CONSTRAINT "option_choice_option_group_id_brand_id_fkey" FOREIGN KEY ("option_group_id", "brand_id") REFERENCES "option_group"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_rule" ADD CONSTRAINT "option_rule_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_rule" ADD CONSTRAINT "option_rule_option_group_id_product_id_fkey" FOREIGN KEY ("option_group_id", "product_id") REFERENCES "option_group"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_rule" ADD CONSTRAINT "option_rule_depends_on_group_id_product_id_fkey" FOREIGN KEY ("depends_on_group_id", "product_id") REFERENCES "option_group"("id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_rule" ADD CONSTRAINT "option_rule_depends_on_choice_id_depends_on_group_id_fkey" FOREIGN KEY ("depends_on_choice_id", "depends_on_group_id") REFERENCES "option_choice"("id", "option_group_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_group_translation" ADD CONSTRAINT "option_group_translation_option_group_id_brand_id_fkey" FOREIGN KEY ("option_group_id", "brand_id") REFERENCES "option_group"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_choice_translation" ADD CONSTRAINT "option_choice_translation_option_choice_id_brand_id_fkey" FOREIGN KEY ("option_choice_id", "brand_id") REFERENCES "option_choice"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_price" ADD CONSTRAINT "option_price_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_price" ADD CONSTRAINT "option_price_market_id_currency_code_fkey" FOREIGN KEY ("market_id", "currency_code") REFERENCES "market_currency"("market_id", "currency_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_price" ADD CONSTRAINT "option_price_option_group_id_brand_id_fkey" FOREIGN KEY ("option_group_id", "brand_id") REFERENCES "option_group"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_price" ADD CONSTRAINT "option_price_option_choice_id_brand_id_fkey" FOREIGN KEY ("option_choice_id", "brand_id") REFERENCES "option_choice"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_group" ADD CONSTRAINT "addon_group_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_item" ADD CONSTRAINT "addon_item_addon_group_id_brand_id_fkey" FOREIGN KEY ("addon_group_id", "brand_id") REFERENCES "addon_group"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_item" ADD CONSTRAINT "addon_item_addon_product_id_brand_id_fkey" FOREIGN KEY ("addon_product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_item" ADD CONSTRAINT "addon_item_addon_variation_id_brand_id_fkey" FOREIGN KEY ("addon_variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_item" ADD CONSTRAINT "addon_item_addon_variation_id_addon_product_id_fkey" FOREIGN KEY ("addon_variation_id", "addon_product_id") REFERENCES "variation"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_group_translation" ADD CONSTRAINT "addon_group_translation_addon_group_id_brand_id_fkey" FOREIGN KEY ("addon_group_id", "brand_id") REFERENCES "addon_group"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_item_translation" ADD CONSTRAINT "addon_item_translation_addon_item_id_brand_id_fkey" FOREIGN KEY ("addon_item_id", "brand_id") REFERENCES "addon_item"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_item_price" ADD CONSTRAINT "addon_item_price_addon_item_id_brand_id_fkey" FOREIGN KEY ("addon_item_id", "brand_id") REFERENCES "addon_item"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_item_price" ADD CONSTRAINT "addon_item_price_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_item_price" ADD CONSTRAINT "addon_item_price_market_id_currency_code_fkey" FOREIGN KEY ("market_id", "currency_code") REFERENCES "market_currency"("market_id", "currency_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_item" ADD CONSTRAINT "bundle_item_bundle_product_id_brand_id_fkey" FOREIGN KEY ("bundle_product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_item" ADD CONSTRAINT "bundle_item_component_product_id_brand_id_fkey" FOREIGN KEY ("component_product_id", "brand_id") REFERENCES "product"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_item" ADD CONSTRAINT "bundle_item_component_variation_id_brand_id_fkey" FOREIGN KEY ("component_variation_id", "brand_id") REFERENCES "variation"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_item" ADD CONSTRAINT "bundle_item_component_variation_id_component_product_id_fkey" FOREIGN KEY ("component_variation_id", "component_product_id") REFERENCES "variation"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset_translation" ADD CONSTRAINT "media_asset_translation_media_asset_id_brand_id_fkey" FOREIGN KEY ("media_asset_id", "brand_id") REFERENCES "media_asset"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_variant" ADD CONSTRAINT "media_variant_media_asset_id_brand_id_fkey" FOREIGN KEY ("media_asset_id", "brand_id") REFERENCES "media_asset"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_slug_history" ADD CONSTRAINT "catalog_slug_history_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================================
-- Hand-written part of `catalog_engine` (docs/PHASE-3-SCHEMA-DRAFT.md, approved).
-- Everything Prisma cannot express: check constraints, partial unique indexes, triggers, the
-- trigram index and row-level security on every catalog table.
-- ===========================================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Check constraints -----------------------------------------------------------------------------
ALTER TABLE "product" ADD CONSTRAINT "product_quantity_rules"
  CHECK ("min_quantity" >= 1 AND ("max_quantity" IS NULL OR "max_quantity" >= "min_quantity"));
ALTER TABLE "product" ADD CONSTRAINT "product_times_nonnegative"
  CHECK (("prep_time_minutes" IS NULL OR "prep_time_minutes" >= 0) AND ("lead_time_minutes" IS NULL OR "lead_time_minutes" >= 0));
ALTER TABLE "product" ADD CONSTRAINT "product_publish_window"
  CHECK ("unpublish_at" IS NULL OR "publish_at" IS NULL OR "unpublish_at" > "publish_at");
ALTER TABLE "product" ADD CONSTRAINT "product_variable_has_no_sku"
  CHECK ("type" <> 'VARIABLE' OR "sku" IS NULL);
ALTER TABLE "product" ADD CONSTRAINT "product_sku_format"
  CHECK ("sku" IS NULL OR "sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$');
ALTER TABLE "variation" ADD CONSTRAINT "variation_sku_format"
  CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$');
ALTER TABLE "variation" ADD CONSTRAINT "variation_combination_not_empty" CHECK (length("combination_key") > 0);
ALTER TABLE "category" ADD CONSTRAINT "category_not_own_parent" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_not_self" CHECK ("product_id" <> "related_product_id");
ALTER TABLE "attribute_value" ADD CONSTRAINT "attribute_value_color_format"
  CHECK ("color_hex" IS NULL OR "color_hex" ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE "attribute" ADD CONSTRAINT "attribute_key_format" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "attribute_value" ADD CONSTRAINT "attribute_value_key_format" CHECK ("key" ~ '^[a-z0-9]+([.-][a-z0-9]+)*$');
ALTER TABLE "option_group" ADD CONSTRAINT "option_group_key_format" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "option_group" ADD CONSTRAINT "option_group_select_rules"
  CHECK ("min_select" >= 0 AND ("max_select" IS NULL OR "max_select" >= "min_select") AND ("max_length" IS NULL OR "max_length" > 0));
ALTER TABLE "option_choice" ADD CONSTRAINT "option_choice_key_format" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "option_rule" ADD CONSTRAINT "option_rule_not_self" CHECK ("option_group_id" <> "depends_on_group_id");
ALTER TABLE "option_rule" ADD CONSTRAINT "option_rule_choice_matches_operator"
  CHECK (("operator" = 'FILLED' AND "depends_on_choice_id" IS NULL) OR ("operator" <> 'FILLED' AND "depends_on_choice_id" IS NOT NULL));
ALTER TABLE "option_price" ADD CONSTRAINT "option_price_one_target"
  CHECK (("option_group_id" IS NOT NULL)::int + ("option_choice_id" IS NOT NULL)::int = 1);
ALTER TABLE "addon_group" ADD CONSTRAINT "addon_group_key_format" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "addon_group" ADD CONSTRAINT "addon_group_select_rules"
  CHECK ("min_select" >= 0 AND ("max_select" IS NULL OR "max_select" >= "min_select"));
ALTER TABLE "addon_item" ADD CONSTRAINT "addon_item_quantity" CHECK ("max_quantity" >= 1);
ALTER TABLE "addon_item" ADD CONSTRAINT "addon_item_kind_shape" CHECK (
  ("kind" = 'PRODUCT' AND "addon_product_id" IS NOT NULL AND "key" IS NULL)
  OR ("kind" = 'INLINE' AND "key" IS NOT NULL AND "addon_product_id" IS NULL AND "addon_variation_id" IS NULL));
ALTER TABLE "bundle_item" ADD CONSTRAINT "bundle_item_quantity" CHECK ("quantity" >= 1);
ALTER TABLE "bundle_item" ADD CONSTRAINT "bundle_item_not_self" CHECK ("bundle_product_id" <> "component_product_id");
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_one_target"
  CHECK (("product_id" IS NOT NULL)::int + ("variation_id" IS NOT NULL)::int = 1);
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_amounts" CHECK (
  "regular_minor" >= 0 AND ("sale_minor" IS NULL OR ("sale_minor" >= 0 AND "sale_minor" < "regular_minor")));
ALTER TABLE "market_price" ADD CONSTRAINT "market_price_sale_dates" CHECK (
  ("sale_starts_at" IS NULL AND "sale_ends_at" IS NULL)
  OR ("sale_minor" IS NOT NULL AND ("sale_starts_at" IS NULL OR "sale_ends_at" IS NULL OR "sale_ends_at" > "sale_starts_at")));
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_type" CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_size" CHECK ("byte_size" > 0 AND ("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0));
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "media_variant" ADD CONSTRAINT "media_variant_kind" CHECK ("kind" IN ('THUMBNAIL', 'MEDIUM', 'LARGE'));
ALTER TABLE "catalog_slug_history" ADD CONSTRAINT "slug_history_entity_type" CHECK ("entity_type" IN ('product', 'category', 'collection'));

-- Language codes (as used by markets) and slugs on every translation table ----------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_translation', 'category_translation', 'collection_translation', 'tag_translation',
    'attribute_translation', 'attribute_value_translation', 'option_group_translation', 'option_choice_translation',
    'addon_group_translation', 'addon_item_translation', 'media_asset_translation']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ("language" ~ ''^[a-z]{2,3}(-[A-Z]{2})?$'')', t, t || '_language_format');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['product_translation', 'category_translation', 'collection_translation', 'tag_translation']
  LOOP
    -- Lower-case, no spaces or URL separators, no leading, trailing or doubled hyphens. Letters of any script are allowed.
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ("slug" = lower("slug") AND length("slug") BETWEEN 1 AND 120 AND "slug" !~ ''[[:space:]/\\?#]'' AND "slug" !~ ''--'' AND "slug" !~ ''^-|-$'')', t, t || '_slug_format');
  END LOOP;
END $$;
ALTER TABLE "catalog_slug_history" ADD CONSTRAINT "slug_history_language_format" CHECK ("language" ~ '^[a-z]{2,3}(-[A-Z]{2})?$');

-- Partial unique indexes ------------------------------------------------------------------------------
CREATE UNIQUE INDEX "attribute_brand_key_global" ON "attribute" ("brand_id", "key")
  WHERE "product_id" IS NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "attribute_product_key" ON "attribute" ("product_id", "key")
  WHERE "product_id" IS NOT NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "product_media_one_primary" ON "product_media" ("product_id") WHERE "is_primary";
CREATE UNIQUE INDEX "market_price_product_unique" ON "market_price" ("market_id", "currency_code", "product_id")
  WHERE "product_id" IS NOT NULL;
CREATE UNIQUE INDEX "market_price_variation_unique" ON "market_price" ("market_id", "currency_code", "variation_id")
  WHERE "variation_id" IS NOT NULL;
CREATE UNIQUE INDEX "option_price_group_unique" ON "option_price" ("market_id", "currency_code", "option_group_id")
  WHERE "option_group_id" IS NOT NULL;
CREATE UNIQUE INDEX "option_price_choice_unique" ON "option_price" ("market_id", "currency_code", "option_choice_id")
  WHERE "option_choice_id" IS NOT NULL;
CREATE UNIQUE INDEX "addon_item_key_unique" ON "addon_item" ("addon_group_id", "key") WHERE "key" IS NOT NULL;
CREATE UNIQUE INDEX "addon_item_product_unique" ON "addon_item"
  ("addon_group_id", "addon_product_id", COALESCE("addon_variation_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "kind" = 'PRODUCT';
CREATE UNIQUE INDEX "bundle_item_unique" ON "bundle_item"
  ("bundle_product_id", "component_product_id", COALESCE("component_variation_id", '00000000-0000-0000-0000-000000000000'::uuid));

-- Admin search (trigram, D3-15) ---------------------------------------------------------------------------
CREATE INDEX "product_translation_name_trgm" ON "product_translation" USING gin ("name" gin_trgm_ops);

-- Triggers --------------------------------------------------------------------------------------------------
-- A SKU is unique across products and variations of one brand (the two unique indexes cover each table).
CREATE FUNCTION catalog_assert_sku_unused() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sku" IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(NEW."brand_id"::text || ':' || NEW."sku"));
  IF TG_TABLE_NAME = 'product' THEN
    IF EXISTS (SELECT 1 FROM "variation" v WHERE v."brand_id" = NEW."brand_id" AND v."sku" = NEW."sku") THEN
      RAISE EXCEPTION 'SKU % is already used by a variation', NEW."sku" USING ERRCODE = '23505';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "product" p WHERE p."brand_id" = NEW."brand_id" AND p."sku" = NEW."sku") THEN
      RAISE EXCEPTION 'SKU % is already used by a product', NEW."sku" USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "product_sku_unused" BEFORE INSERT OR UPDATE OF "sku" ON "product"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_sku_unused();
CREATE TRIGGER "variation_sku_unused" BEFORE INSERT OR UPDATE OF "sku" ON "variation"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_sku_unused();

-- Variations exist only for VARIABLE products, at most 100 live ones (D3-05).
CREATE FUNCTION catalog_assert_variation_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "ProductType"; live integer;
BEGIN
  SELECT p."type" INTO kind FROM "product" p WHERE p."id" = NEW."product_id";
  IF kind IS DISTINCT FROM 'VARIABLE' THEN
    RAISE EXCEPTION 'Variations belong to variable products only' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."deleted_at" IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('variation-limit:' || NEW."product_id"::text));
    SELECT count(*) INTO live FROM "variation" v WHERE v."product_id" = NEW."product_id" AND v."deleted_at" IS NULL;
    IF live >= 100 THEN
      RAISE EXCEPTION 'A product can have at most 100 variations' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "variation_parent_check" BEFORE INSERT OR UPDATE OF "product_id" ON "variation"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_variation_parent();

-- A product that has variations cannot stop being VARIABLE.
CREATE FUNCTION catalog_assert_type_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."type" = 'VARIABLE' AND NEW."type" <> 'VARIABLE'
     AND EXISTS (SELECT 1 FROM "variation" v WHERE v."product_id" = NEW."id") THEN
    RAISE EXCEPTION 'A product with variations must stay variable' USING ERRCODE = '23514';
  END IF;
  IF OLD."type" = 'BUNDLE' AND NEW."type" <> 'BUNDLE'
     AND EXISTS (SELECT 1 FROM "bundle_item" b WHERE b."bundle_product_id" = NEW."id") THEN
    RAISE EXCEPTION 'A bundle with components must stay a bundle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "product_type_change_check" BEFORE UPDATE OF "type" ON "product"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_type_change();

-- Bundles: the parent is a BUNDLE, components are not bundles (no nesting).
CREATE FUNCTION catalog_assert_bundle_shape() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_type "ProductType"; component_type "ProductType";
BEGIN
  SELECT p."type" INTO parent_type FROM "product" p WHERE p."id" = NEW."bundle_product_id";
  SELECT p."type" INTO component_type FROM "product" p WHERE p."id" = NEW."component_product_id";
  IF parent_type IS DISTINCT FROM 'BUNDLE' THEN
    RAISE EXCEPTION 'Bundle components belong to a bundle product' USING ERRCODE = '23514';
  END IF;
  IF component_type = 'BUNDLE' THEN
    RAISE EXCEPTION 'Bundles cannot contain bundles' USING ERRCODE = '23514';
  END IF;
  IF NEW."component_variation_id" IS NOT NULL AND component_type <> 'VARIABLE' THEN
    RAISE EXCEPTION 'Only variable products have variations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "bundle_item_shape_check" BEFORE INSERT OR UPDATE ON "bundle_item"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_bundle_shape();

-- Add-on products are simple or variable products, never the product the group belongs to.
CREATE FUNCTION catalog_assert_addon_shape() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE addon_type "ProductType"; owner uuid;
BEGIN
  IF NEW."kind" <> 'PRODUCT' THEN RETURN NEW; END IF;
  SELECT p."type" INTO addon_type FROM "product" p WHERE p."id" = NEW."addon_product_id";
  SELECT g."product_id" INTO owner FROM "addon_group" g WHERE g."id" = NEW."addon_group_id";
  IF addon_type NOT IN ('SIMPLE', 'VARIABLE') THEN
    RAISE EXCEPTION 'An add-on product must be a simple or variable product' USING ERRCODE = '23514';
  END IF;
  IF NEW."addon_product_id" = owner THEN
    RAISE EXCEPTION 'A product cannot be its own add-on' USING ERRCODE = '23514';
  END IF;
  IF NEW."addon_variation_id" IS NOT NULL AND addon_type <> 'VARIABLE' THEN
    RAISE EXCEPTION 'Only variable products have variations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "addon_item_shape_check" BEFORE INSERT OR UPDATE ON "addon_item"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_addon_shape();

-- A price on a product is for SIMPLE or BUNDLE products; variable products are priced per variation.
CREATE FUNCTION catalog_assert_price_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind "ProductType";
BEGIN
  IF NEW."product_id" IS NOT NULL THEN
    SELECT p."type" INTO kind FROM "product" p WHERE p."id" = NEW."product_id";
    IF kind = 'VARIABLE' THEN
      RAISE EXCEPTION 'Variable products are priced per variation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "market_price_target_check" BEFORE INSERT OR UPDATE ON "market_price"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_price_target();

-- A branch restriction must name a branch that serves a market of the product's brand.
CREATE FUNCTION catalog_assert_branch_serves_brand() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "branch_market" bm JOIN "market" m ON m."id" = bm."market_id"
    WHERE bm."branch_id" = NEW."branch_id" AND m."brand_id" = NEW."brand_id"
  ) THEN
    RAISE EXCEPTION 'The branch does not serve this brand' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "product_branch_serves_brand" BEFORE INSERT OR UPDATE ON "product_branch"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_branch_serves_brand();

-- Category tree: no cycles, at most 4 levels.
CREATE FUNCTION catalog_assert_category_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cursor_id uuid := NEW."parent_id"; depth integer := 1;
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW."id" THEN
      RAISE EXCEPTION 'A category cannot be placed under itself' USING ERRCODE = '23514';
    END IF;
    depth := depth + 1;
    IF depth > 4 THEN
      RAISE EXCEPTION 'Categories can be nested at most 4 levels deep' USING ERRCODE = '23514';
    END IF;
    SELECT c."parent_id" INTO cursor_id FROM "category" c WHERE c."id" = cursor_id;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "category_tree_check" BEFORE INSERT OR UPDATE OF "parent_id" ON "category"
  FOR EACH ROW EXECUTE FUNCTION catalog_assert_category_tree();

-- Row-level security on every catalog table --------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'product', 'product_translation', 'product_category', 'product_collection', 'product_tag', 'product_relation',
    'product_market', 'product_branch', 'product_media',
    'category', 'category_translation', 'collection', 'collection_translation', 'tag', 'tag_translation',
    'attribute', 'attribute_value', 'attribute_translation', 'attribute_value_translation', 'product_attribute',
    'product_attribute_value', 'variation', 'variation_value',
    'market_price',
    'option_group', 'option_choice', 'option_rule', 'option_group_translation', 'option_choice_translation', 'option_price',
    'addon_group', 'addon_item', 'addon_group_translation', 'addon_item_translation', 'addon_item_price', 'bundle_item',
    'media_asset', 'media_asset_translation', 'media_variant', 'catalog_slug_history']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform()) WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())',
      t || '_scope', t);
  END LOOP;
END $$;
