# Phase 3 Step 3.2: Catalog Schema Draft (for owner review)

**Status: APPROVED by the owner on 2026-11-26 ("Approve as recommended", all nine questions as recommended) and IMPLEMENTED as migration `20261126090000_catalog_engine`, applied to the development and test databases.** Deviations made during implementation: (1) translation tables have no foreign key to `language` (a format check plus the service validate the code against the market languages); (2) `media_asset.created_by_id` has no foreign key (the audit log records the actor); (3) a product's slug is not released by the database on soft delete; the delete service renames it and writes `catalog_slug_history` (step 3.4); (4) all relations are modelled in `schema.prisma` so migrations cannot drop the foreign keys; (5) the category tree trigger limits depth and cycles on insert and parent change, moving a whole subtree deeper is re-validated by the service.

Original review status: owner reviewed this DDL before anything was created (gate at step 3.2, [PHASE-3-PLAN.md](PHASE-3-PLAN.md)). Implementation follows the same pattern as the approved tenancy schema ([PHASE-2-SCHEMA-DRAFT.md](PHASE-2-SCHEMA-DRAFT.md)): Prisma models plus hand-written SQL for row-level security and check constraints in one migration, `catalog_engine`.

Decisions this draft relies on: D3-01 (brand-owned catalog), D3-02 (integer minor-unit prices per market), D3-04 (slugs per language per brand, with history), D3-05 (max 100 variations), D3-06 (variation vs option vs add-on), D3-07 (fixed bundle price), D3-08 (add-on stock in Phase 4), D3-09 and D3-10 (media), D3-11 (translations), D3-12 (publishing).

## 1. Rules that apply to every table below

1. **Brand column on every row.** Every table carries `brand_id uuid NOT NULL` (even child tables), so isolation is a direct check and not a join.
2. **Composite keys against cross-brand links.** Each parent has `UNIQUE (id, brand_id)`; each child references `(parent_id, brand_id)`. A child row can therefore never point at another brand's parent, whatever the application does. The existing `market` table already has `UNIQUE (id, brand_id)`.
3. **Row-level security, forced.** `ENABLE` and `FORCE ROW LEVEL SECURITY` on every table, with one policy per table using the existing helpers: `USING (brand_id = ANY (app_brand_ids()) OR app_is_platform())` and the same expression in `WITH CHECK`. No context means no rows. All reads and writes go through `withScope`.
4. **Money** is `integer` minor units plus a currency code (maximum 2,147,483,647 minor units, which is 21.4 million AED; ample for retail, and `bigint` can be chosen instead, see question 1). No floats, no `numeric` for prices.
5. **IDs** are UUIDv7 (`uuid(7)`), timestamps are `timestamptz`, columns are `snake_case` through `@map`, as in Phase 2.
6. **Soft delete** (`deleted_at`) on `product`, `variation`, `category`, `collection`, `tag`, `attribute`. Child rows are removed with `ON DELETE CASCADE` only where they cannot be referenced by anything else; everything else is `RESTRICT`. Nothing a future order snapshot will reference is ever hard-deleted.
7. **Audit.** Every create, update, delete, publish and price change writes an audit row in the same transaction (existing audit module). No new audit table.
8. **No stock, delivery or order columns.** Those arrive in Phases 4 and 6 as separate tables that reference `variation` and `product`.

## 2. Enums

```prisma
enum ProductType    { SIMPLE VARIABLE BUNDLE }
enum ProductStatus  { DRAFT PUBLISHED ARCHIVED }
enum AttributeKind  { TEXT COLOR NUMBER }
enum OptionType     { SELECT RADIO CHECKBOX TEXT TEXTAREA FILE DATE }
enum RuleOperator   { FILLED EQUALS NOT_EQUALS }
enum AddonKind      { PRODUCT INLINE }
enum ProductRelationKind { RELATED UPSELL CROSS_SELL }
enum MediaStatus    { UPLOADED READY REJECTED }
```

Category, collection and tag reuse `ProductStatus` (DRAFT, PUBLISHED, ARCHIVED).

## 3. Products

```prisma
model Product {
  id               String        @id @default(uuid(7)) @db.Uuid
  brandId          String        @map("brand_id") @db.Uuid
  type             ProductType
  status           ProductStatus @default(DRAFT)
  /// Simple and bundle products only; variable products carry SKUs on their variations.
  sku              String?
  publishAt        DateTime?     @map("publish_at") @db.Timestamptz()
  unpublishAt      DateTime?     @map("unpublish_at") @db.Timestamptz()
  madeToOrder      Boolean       @default(false) @map("made_to_order")
  prepTimeMinutes  Int?          @map("prep_time_minutes")
  leadTimeMinutes  Int?          @map("lead_time_minutes")
  minQuantity      Int           @default(1) @map("min_quantity")
  maxQuantity      Int?          @map("max_quantity")
  primaryCategoryId String?      @map("primary_category_id") @db.Uuid
  sortOrder        Int           @default(0) @map("sort_order")
  createdAt        DateTime      @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt        DateTime      @updatedAt @map("updated_at") @db.Timestamptz()
  deletedAt        DateTime?     @map("deleted_at") @db.Timestamptz()

  @@unique([id, brandId])
  @@unique([brandId, sku])
  @@index([brandId, status, sortOrder])
  @@map("product")
}

model ProductTranslation {
  productId        String  @map("product_id") @db.Uuid
  brandId          String  @map("brand_id") @db.Uuid
  language         String
  name             String
  shortDescription String? @map("short_description")
  description      String?
  slug             String
  seoTitle         String? @map("seo_title")
  seoDescription   String? @map("seo_description")

  @@id([productId, language])
  @@unique([brandId, language, slug])
  @@map("product_translation")
}
```

- `sku` is unique per brand across all rows, **including soft-deleted ones, so a SKU is never reused** (question 4). Variation SKUs share the same uniqueness through a unique index on a shared view-free rule: variation SKUs are checked against product SKUs by a trigger (`assert_sku_unused`).
- Slugs are unique per brand and language. A slug is released when its product is soft-deleted, and every retired slug is kept in `catalog_slug_history` for redirects (section 9).
- Check constraints: `min_quantity >= 1`, `max_quantity IS NULL OR max_quantity >= min_quantity`, `prep_time_minutes >= 0`, `lead_time_minutes >= 0`, `unpublish_at IS NULL OR publish_at IS NULL OR unpublish_at > publish_at`, `type = 'VARIABLE' → sku IS NULL`, `status = 'PUBLISHED'` requires an English translation (enforced by the publish service and verified by a test).
- Translation `language` is checked by the service against the market languages of the markets where the product is available; English is required, Arabic optional (D3-11).

Links, all with `(brand_id)` and composite foreign keys, primary key being the pair:

| Table | Columns | Purpose |
|---|---|---|
| `product_category` | product_id, category_id, brand_id, sort_order | A product in several categories |
| `product_collection` | product_id, collection_id, brand_id, sort_order | Manual collections |
| `product_tag` | product_id, tag_id, brand_id | Free labels |
| `product_relation` | product_id, related_product_id, brand_id, kind, sort_order | Related, up-sell, cross-sell; no self relation (check) |
| `product_market` | product_id, market_id, brand_id | Markets where the product may be sold. No row means not sold there |
| `product_branch` | product_id, branch_id, brand_id | Optional branch restriction. **No rows means every branch serving the market**; any row turns the list into an allow-list |
| `product_media` | product_id, media_asset_id, brand_id, sort_order, is_primary | Gallery; one primary per product (partial unique index) |

`branch` has no `brand_id` (it serves brands through `branch_market`), so `product_branch` cannot use a brand composite key on the branch side. Its integrity rule is a trigger, `assert_branch_serves_brand`, that rejects a row when the branch serves no market of the product's brand, plus a test.

## 4. Taxonomy

```prisma
model Category {
  id        String        @id @default(uuid(7)) @db.Uuid
  brandId   String        @map("brand_id") @db.Uuid
  parentId  String?       @map("parent_id") @db.Uuid     // (parent_id, brand_id) -> category(id, brand_id)
  status    ProductStatus @default(DRAFT)
  sortOrder Int           @default(0) @map("sort_order")
  mediaAssetId String?    @map("media_asset_id") @db.Uuid
  createdAt DateTime      @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt DateTime      @updatedAt @map("updated_at") @db.Timestamptz()
  deletedAt DateTime?     @map("deleted_at") @db.Timestamptz()
  @@unique([id, brandId])
  @@index([brandId, parentId, sortOrder])
  @@map("category")
}
```

`category_translation`, `collection_translation` and `tag_translation` have the same shape as `product_translation` without descriptions beyond `description` (columns: owner id, brand_id, language, name, description, slug, SEO title and description; primary key owner id plus language; unique `(brand_id, language, slug)`). `collection` and `tag` have id, brand_id, status, sort_order, timestamps and `deleted_at`.

Category tree rules (service plus a trigger test): maximum depth 4, no cycles, a parent belongs to the same brand (composite key), moving a category keeps product links.

## 5. Attributes and variations

```prisma
model Attribute {
  id        String        @id @default(uuid(7)) @db.Uuid
  brandId   String        @map("brand_id") @db.Uuid
  key       String                                    // 'flavour', 'size', 'pieces'
  kind      AttributeKind @default(TEXT)
  productId String?       @map("product_id") @db.Uuid // null = global attribute; set = product-specific
  deletedAt DateTime?     @map("deleted_at") @db.Timestamptz()
  @@unique([id, brandId])
  // global: unique (brand_id, key) where product_id is null; product-specific: unique (product_id, key)
  @@map("attribute")
}

model AttributeValue {
  id          String  @id @default(uuid(7)) @db.Uuid
  brandId     String  @map("brand_id") @db.Uuid
  attributeId String  @map("attribute_id") @db.Uuid
  key         String                                   // 'chocolate', '2kg', '12'
  colorHex    String? @map("color_hex")                // COLOR kind only
  sortOrder   Int     @default(0) @map("sort_order")
  @@unique([id, brandId])
  @@unique([attributeId, key])
  @@map("attribute_value")
}

model ProductAttribute {            // attributes used on a product
  productId        String  @map("product_id") @db.Uuid
  attributeId      String  @map("attribute_id") @db.Uuid
  brandId          String  @map("brand_id") @db.Uuid
  drivesVariations Boolean @default(false) @map("drives_variations")
  visible          Boolean @default(true)
  sortOrder        Int     @default(0) @map("sort_order")
  @@id([productId, attributeId])
  @@map("product_attribute")
}

model ProductAttributeValue {       // the values enabled on that product
  productId        String @map("product_id") @db.Uuid
  attributeId      String @map("attribute_id") @db.Uuid
  attributeValueId String @map("attribute_value_id") @db.Uuid
  brandId          String @map("brand_id") @db.Uuid
  @@id([productId, attributeId, attributeValueId])
  @@map("product_attribute_value")
}

model Variation {
  id             String    @id @default(uuid(7)) @db.Uuid
  brandId        String    @map("brand_id") @db.Uuid
  productId      String    @map("product_id") @db.Uuid
  sku            String
  /// Canonical combination, e.g. 'flavour=vanilla|size=2kg' (same function as the validation package).
  combinationKey String    @map("combination_key")
  active         Boolean   @default(true)
  sortOrder      Int       @default(0) @map("sort_order")
  mediaAssetId   String?   @map("media_asset_id") @db.Uuid
  deletedAt      DateTime? @map("deleted_at") @db.Timestamptz()
  @@unique([id, brandId])
  @@unique([brandId, sku])
  @@unique([productId, combinationKey])
  @@map("variation")
}

model VariationValue {
  variationId      String @map("variation_id") @db.Uuid
  productId        String @map("product_id") @db.Uuid
  attributeId      String @map("attribute_id") @db.Uuid
  attributeValueId String @map("attribute_value_id") @db.Uuid
  brandId          String @map("brand_id") @db.Uuid
  @@id([variationId, attributeId])
  @@map("variation_value")
}
```

- `attribute_translation` and `attribute_value_translation` carry the visible names per language (language, label; primary key owner id plus language).
- `VariationValue` references `ProductAttributeValue (product_id, attribute_id, attribute_value_id)`, so a variation can only use values that are enabled on its product, and only attributes marked `drives_variations` (check through the service; test).
- `variation` rows exist only for `VARIABLE` products (trigger `assert_variation_parent_is_variable`), at most 100 per product (trigger counting live rows; D3-05).
- A variable product has no price of its own; its variations are priced.

## 6. Pricing (market prices)

```prisma
model MarketPrice {
  id            String    @id @default(uuid(7)) @db.Uuid
  brandId       String    @map("brand_id") @db.Uuid
  marketId      String    @map("market_id") @db.Uuid
  currencyCode  String    @map("currency_code") @db.Char(3)
  productId     String?   @map("product_id") @db.Uuid
  variationId   String?   @map("variation_id") @db.Uuid
  regularMinor  Int       @map("regular_minor")
  saleMinor     Int?      @map("sale_minor")
  saleStartsAt  DateTime? @map("sale_starts_at") @db.Timestamptz()
  saleEndsAt    DateTime? @map("sale_ends_at") @db.Timestamptz()
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz()
  // FKs: (market_id, brand_id) -> market; (market_id, currency_code) -> market_currency;
  //      (product_id, brand_id) -> product; (variation_id, brand_id) -> variation
  @@map("market_price")
}
```

- Exactly one of `product_id` and `variation_id` is set (check). Unique `(market_id, currency_code, product_id)` and `(market_id, currency_code, variation_id)` as partial indexes.
- The currency must be one the market actually offers (composite key to `market_currency`).
- Checks: `regular_minor >= 0`, `sale_minor IS NULL OR sale_minor < regular_minor`, sale dates ordered, sale dates only with a sale price.
- Option and add-on price changes use the same pattern in `option_price` and `addon_item_price` (section 7, section 8), with `delta_minor` (may be negative only for options, never below the base price at calculation time, enforced in the Phase 5 pricing service).
- A price row existing for a market does not make the product sellable there; `product_market` does. The preview in admin warns when a sellable product lacks a price.
- Tax: nothing stored (D3-03).

## 7. Customization options (never affect SKU or stock)

```prisma
model OptionGroup {
  id        String     @id @default(uuid(7)) @db.Uuid
  brandId   String     @map("brand_id") @db.Uuid
  productId String     @map("product_id") @db.Uuid
  key       String
  type      OptionType
  required  Boolean    @default(false)
  minSelect Int        @default(0) @map("min_select")
  maxSelect Int?       @map("max_select")
  maxLength Int?       @map("max_length")          // TEXT and TEXTAREA
  sortOrder Int        @default(0) @map("sort_order")
  @@unique([id, brandId])
  @@unique([productId, key])
  @@map("option_group")
}

model OptionChoice {                                // SELECT, RADIO, CHECKBOX
  id            String @id @default(uuid(7)) @db.Uuid
  brandId       String @map("brand_id") @db.Uuid
  optionGroupId String @map("option_group_id") @db.Uuid
  key           String
  sortOrder     Int    @default(0) @map("sort_order")
  @@unique([id, brandId])
  @@unique([optionGroupId, key])
  @@map("option_choice")
}

model OptionRule {                                  // conditional visibility
  id               String       @id @default(uuid(7)) @db.Uuid
  brandId          String       @map("brand_id") @db.Uuid
  optionGroupId    String       @map("option_group_id") @db.Uuid   // the group that is shown or hidden
  dependsOnGroupId String       @map("depends_on_group_id") @db.Uuid
  operator         RuleOperator
  dependsOnChoiceId String?     @map("depends_on_choice_id") @db.Uuid
  @@map("option_rule")
}
```

- Translations: `option_group_translation` (label, help text) and `option_choice_translation` (label).
- Prices: `option_price` (brand_id, market_id, currency_code, `option_group_id` or `option_choice_id`, `delta_minor`).
- Rules: both groups belong to the same product (composite keys through `product_id`), no self dependency, `EQUALS` and `NOT_EQUALS` need a choice, `FILLED` does not. Cycle detection is done by the service on write with a test (no database trigger).
- `FILE` options only declare that an upload is requested; the file itself belongs to the order item in Phase 5 and 6, so no customer file is stored by this schema.

## 8. Add-ons and bundles

```prisma
model AddonGroup {
  id          String  @id @default(uuid(7)) @db.Uuid
  brandId     String  @map("brand_id") @db.Uuid
  productId   String  @map("product_id") @db.Uuid
  key         String
  required    Boolean @default(false)
  minSelect   Int     @default(0) @map("min_select")
  maxSelect   Int?    @map("max_select")
  sortOrder   Int     @default(0) @map("sort_order")
  @@unique([id, brandId])
  @@unique([productId, key])
  @@map("addon_group")
}

model AddonItem {
  id               String    @id @default(uuid(7)) @db.Uuid
  brandId          String    @map("brand_id") @db.Uuid
  addonGroupId     String    @map("addon_group_id") @db.Uuid
  kind             AddonKind
  /// PRODUCT: a simple or variable product (and optionally one variation); price comes from its market prices.
  addonProductId   String?   @map("addon_product_id") @db.Uuid
  addonVariationId String?   @map("addon_variation_id") @db.Uuid
  /// INLINE: a priced option that is not a product; label in addon_item_translation, price in addon_item_price.
  key              String?
  maxQuantity      Int       @default(1) @map("max_quantity")
  sortOrder        Int       @default(0) @map("sort_order")
  @@unique([id, brandId])
  @@map("addon_item")
}

model BundleItem {
  id                  String  @id @default(uuid(7)) @db.Uuid
  brandId             String  @map("brand_id") @db.Uuid
  bundleProductId     String  @map("bundle_product_id") @db.Uuid
  componentProductId  String  @map("component_product_id") @db.Uuid
  componentVariationId String? @map("component_variation_id") @db.Uuid
  quantity            Int     @default(1)
  sortOrder           Int     @default(0) @map("sort_order")
  @@map("bundle_item")
}
```

- `addon_item`: `PRODUCT` needs `addon_product_id` and no key; `INLINE` needs `key` and no product (check). An add-on product must be a `SIMPLE` or `VARIABLE` product of the same brand and may not be the product itself (check plus test). A variable add-on product with no chosen variation lets the shopper choose one.
- `addon_group_translation`, `addon_item_translation` (INLINE labels) and `addon_item_price` (INLINE prices per market) follow the same pattern as options.
- Bundles: `bundle_product_id` must be of type `BUNDLE` (trigger), components may not be bundles (no nesting; trigger), `quantity >= 1`, unique `(bundle_product_id, component_product_id, component_variation_id)`. The bundle's fixed price is a normal `market_price` row on the bundle product (D3-07). Components are recorded so Phase 4 can deduct stock.

## 9. Media and slug history

```prisma
model MediaAsset {
  id               String      @id @default(uuid(7)) @db.Uuid
  brandId          String      @map("brand_id") @db.Uuid
  storageKey       String      @map("storage_key")      // path in the storage adapter, never a public URL
  originalFilename String      @map("original_filename")
  contentType      String      @map("content_type")     // sniffed server side, jpeg png webp only
  byteSize         Int         @map("byte_size")
  width            Int?
  height           Int?
  sha256           String
  status           MediaStatus @default(UPLOADED)
  createdById      String?     @map("created_by_id") @db.Uuid
  createdAt        DateTime    @default(now()) @map("created_at") @db.Timestamptz()
  @@unique([id, brandId])
  @@unique([brandId, sha256])
  @@map("media_asset")
}
```

- `media_asset_translation` (alt text per language), `media_variant` (media_asset_id, brand_id, kind THUMBNAIL, MEDIUM, LARGE, storage_key, width, height, content_type; primary key asset plus kind).
- `unique (brand_id, sha256)` stops duplicate uploads within a brand.
- A media asset in use by a product, category or variation cannot be deleted (`RESTRICT`).

```prisma
model CatalogSlugHistory {
  id         String   @id @default(uuid(7)) @db.Uuid
  brandId    String   @map("brand_id") @db.Uuid
  entityType String   @map("entity_type")            // 'product' | 'category' | 'collection'
  entityId   String   @map("entity_id") @db.Uuid
  language   String
  slug       String
  retiredAt  DateTime @default(now()) @map("retired_at") @db.Timestamptz()
  @@unique([brandId, entityType, language, slug])
  @@index([entityType, entityId])
  @@map("catalog_slug_history")
}
```

This table has no foreign key to the entity on purpose (the entity may be soft-deleted or later merged). Redirect rules built from it belong to Phase 7.

## 10. Row-level security policy (all tables)

```sql
ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;
CREATE POLICY "<table>_scope" ON "<table>"
  USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())
  WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform());
```

Applied to every table in sections 3 to 9. `matilda_app` receives `SELECT, INSERT, UPDATE, DELETE` through the existing default privileges and nothing else. The public storefront catalog reads use the same helper with the brand resolved from the trusted domain, so a public request can never see another brand even if the application filter were wrong. Publication filters (`status`, `publish_at`) and market and branch availability are applied in the read service and covered by tests.

## 11. Indexes (listing and storefront paths)

- `product (brand_id, status, sort_order)`, `product_translation (brand_id, language, slug)` (unique), trigram index on `product_translation (name)` for admin search (D3-15, requires the `pg_trgm` extension created by the owner role in the migration).
- `product_category (category_id, product_id)`, `product_collection (collection_id, product_id)`, `product_tag (tag_id, product_id)`, `product_market (market_id, product_id)`, `product_branch (branch_id, product_id)`.
- `variation (product_id)`, `variation_value (attribute_value_id)`, `market_price (market_id, product_id)` and `(market_id, variation_id)` through the partial unique indexes.
- `category (brand_id, parent_id, sort_order)`, `catalog_slug_history (entity_type, entity_id)`.
- Every foreign key column gets an index; the migration test lists missing ones.

## 12. Seed and tests

- No catalog data is seeded in any tier. The two product fixtures from step 3.1 are used by tests only (D3-14).
- Migration tests (database-backed): every table has RLS enabled and forced and exactly one policy; every table has `brand_id`; no context returns zero rows; a brand A scope cannot read, insert, update or delete brand B rows in any table; every composite foreign key rejects a cross-brand reference; each check constraint and trigger above has a passing and a failing case; `matilda_app` cannot alter policies or truncate catalog tables; an index exists on every foreign key column.
- Existing suites must stay green (`pnpm check`, `pnpm test:int`).

## 13. Questions for the owner

1. **Price column size.** `integer` (up to 21.4 million AED per price) is proposed. Use `bigint` instead if prices or deltas could ever exceed that, for example wholesale or events. **Recommendation: integer.**
2. **Tag and collection translations.** Both are translated like categories. If you want tags to be a single-language internal label only, say so and `tag_translation` is dropped. **Recommendation: translated.**
3. **Product-specific attributes.** Allowed (`attribute.product_id`) as well as brand-wide ones. If you want only brand-wide attributes, the column and its rules are removed. **Recommendation: allow both** (WooCommerce parity).
4. **SKU reuse.** A SKU is never reused after deletion, and slugs are released with history kept. **Recommendation: as drafted.**
5. **Branch availability.** No `product_branch` rows means every branch serving the market; any row makes the list an allow-list. The alternative (explicit rows for every branch) is safer against accidental exposure but heavier to manage. **Recommendation: as drafted.**
6. **Option and add-on prices per market** (`option_price`, `addon_item_price`) rather than one price per brand. Required because the market currency decides the amount. **Recommendation: as drafted.**
7. **Variation limit of 100 per product** enforced in the database. The cake fixture uses 9; a bouquet with piece counts uses 5. **Recommendation: 100.**
8. **Default permission names** and the question whether `products.publish` and `pricing.edit` are sensitive (from step 3.1) are unchanged by this schema.
9. **`pg_trgm` extension** created by the owner role in the migration for admin search. **Recommendation: yes.**

## 14. Implementation plan once approved

1. Prisma models and the migration `catalog_engine` (generated tables, then hand-written SQL for partial unique indexes, check constraints, triggers, RLS and the trigram index).
2. Apply to the development and test databases, regenerate the client.
3. Database integration tests listed in section 12.
4. Docs: `DATABASE.md`, `PROGRESS.md`, `CHANGELOG.md`, `TESTING.md`; then stop for review of step 3.2 results before step 3.3.
