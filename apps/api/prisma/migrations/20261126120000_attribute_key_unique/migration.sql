-- Attribute keys are unique per brand among live shared attributes, and per product among
-- live product-specific ones. Soft-deleted attributes release their key.
CREATE UNIQUE INDEX "attribute_shared_key_unique" ON "attribute" ("brand_id", "key")
  WHERE "product_id" IS NULL AND "deleted_at" IS NULL;
CREATE UNIQUE INDEX "attribute_product_key_unique" ON "attribute" ("product_id", "key")
  WHERE "product_id" IS NOT NULL AND "deleted_at" IS NULL;
