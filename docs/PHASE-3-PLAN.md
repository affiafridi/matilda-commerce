# Phase 3 Plan: Product and Catalog Engine

**Status: APPROVED by the owner on 2026-11-25 ("Approve, start 3.1"), including decisions D3-01 to D3-15 as recommended. Steps 3.1 and 3.2 are done and 3.2 was approved ("Approve, start 3.3"); step 3.3 was approved ("Approve, start 3.4"); step 3.4 was approved ("Approve, start 3.5"); step 3.5 was approved ("Approve, start 3.6"); step 3.6 was approved ("Approve, start 3.7"); step 3.7 was approved ("Approve, start 3.8"); step 3.8 was approved ("Approve, start 3.9"); step 3.9 was approved ("Approve, start 3.10"); step 3.10 was approved ("Approve, start 3.11"); step 3.11 was approved ("Approve, start 3.12"); step 3.12 is done and awaits the owner's approval before Phase 4.** Live status: [PROGRESS.md](PROGRESS.md).

Labels: **[Approved]** is from the owner's master prompt; **[Proposed]** needs review; **[Open]** is unresolved.

## 1. Scope [Approved]

From the roadmap: products, categories, attributes, variations, customization, add-ons, bundles, translations, media and market pricing. The engine must never be flower-specific: Matilda Cake's variations, customization and add-ons shape it ([PRODUCT-ENGINE](PRODUCT-ENGINE.md), [FEATURE-PARITY](FEATURE-PARITY.md) items 1 to 16).

### Out of scope (later phases)

Stock and reservations, delivery rules and slots (Phase 4); cart, final price calculation with promotions and coupons, checkout, payments (Phase 5); orders and snapshots (Phase 6); CMS, SEO manager, feeds (Phase 7); storefront screens (Phase 8); reviews and ratings, import/export and WooCommerce migration (Phase 11 or a later catalog step, see D3-13); tax rules (decided with checkout).

What Phase 3 **does** provide to those phases: stable catalog data, per-market prices, the product fields that Phase 4 will read (preparation time, lead time, made-to-order, allowed branches, restriction references), and a read-only price **preview** in admin so pricing rules can be checked. Authoritative price calculation stays in the backend pricing service built in Phase 5.

## 2. What already exists and is reused

Brand to market to branch tenancy with row-level security, scoped data access (`withScope`), permission and scope guards, step-up for sensitive permissions, audit log, the admin shell with permission-driven navigation, tables, drawers and forms, Playwright E2E, and brand-scoped uniqueness patterns. Catalog tables follow the same rules: every row carries `brand_id` with composite keys and RLS, reads and writes go through `withScope`, and every route checks permission and scope.

## 3. Domain model [Proposed]

Catalog data is **brand-owned** (a Matilda Flower product is not visible to Matilda Cake) and **market-priced** (prices and availability per market). Translations are rows, never duplicated products.

| Group | Entities | Notes |
|---|---|---|
| Products | `product`, `product_translation` | Type: simple, variable, bundle. Status: draft, published, archived; optional scheduled publish and unpublish. Soft delete. Operational fields: preparation time, lead time, made-to-order flag, min and max quantity, allowed branches. |
| Taxonomy | `category` (tree), `category_translation`, `collection`, `tag`, links to products | Category tree with ordering; collections are manual groups; tags are free labels. |
| Attributes | `attribute`, `attribute_value`, translations, `product_attribute` | Global per brand or product-specific; typed values (text, colour, number). Marks which attributes drive variations. |
| Variations | `variation` (own SKU), variation attribute values | One row per combination. Has price, image and (in Phase 4) stock. |
| Customization | `option_group`, `option_choice`, `option_rule` | Types: select, radio, checkbox, text, textarea, file, date. Price delta, required, min and max selections, conditional visibility. **Never affects SKU or stock.** |
| Add-ons | `addon_group`, `addon_item` | Items point at a simple or variable product, or are inline priced options. Required or optional, max quantity. |
| Bundles | `bundle_item` | A bundle product lists component products or variations and quantities. |
| Pricing | `market_price` | (product or variation) x market x currency, integer minor units, regular and sale price, sale schedule. No price on the core record. |
| Media | `media_asset`, `product_media` | Gallery order, per-variation image, alt text per language. |
| Merchandising | `product_relation` | Related, up-sell, cross-sell. |
| Availability | `product_market`, `product_branch` | Which markets and branches a product may be sold in. Phase 4 adds inventory and delivery rules on top. |

Money is stored as integer minor units with a currency code, never floating point. SKUs, slugs and category slugs are unique **per brand** (slugs per language). Deletion of anything referenced by a variation or add-on is blocked or soft-deleted. Exact columns, indexes and RLS policies are written as a schema draft for owner review at step 3.2 (as in `PHASE-2-SCHEMA-DRAFT.md`) before any migration.

## 4. Permissions [Proposed]

The existing approved keys are reused (`products.view`, `.create`, `.edit`, `.delete`, `.publish`, `pricing.edit`, `media.manage`) and one key is added in step 3.1: `taxonomy.manage` (categories, collections, tags and attributes). Only the Catalog Manager and Super Admin roles can create, edit, delete or publish products, edit prices and manage taxonomy; Branch, Inventory, Order, Operations and Marketing roles keep read access (`products.view`). **Open for your review:** whether `products.publish` and `pricing.edit` should be sensitive (ask for a fresh two-factor code); today they are not, to keep daily catalog work fast. Same sign-off as D2-08.

## 5. API [Proposed]

REST under `/api/v1/admin/catalog/*` for management and a read-only public `GET /api/v1/catalog/*` for the storefront, resolved server-side from the trusted domain (brand, market, language) and cached with keys that include brand, market and language. No client-sent store ID is ever trusted. Public responses contain only published, in-market products and no cost or internal fields.

## 6. Admin screens [Proposed]

Products (table with search, filters, status; editor with tabs for details, translations, attributes, variations, options, add-ons, pricing, media, availability), categories (tree), attributes, collections and tags, media library, and a price preview. Variation management supports bulk generate from attributes and bulk edit of SKU, price and image. Same neutral admin design and navigation model as Phase 2; no new visual direction.

## 7. Steps and gates

| Step | Work | Gate |
|---|---|---|
| 3.1 | Foundations: permissions and role defaults, shared types and validation, catalog module skeleton, test fixtures (a flower product and a Cake-style product with flavour x size variations, message option, reference image option, required and optional add-ons) | |
| 3.2 | **Catalog schema draft** and RLS plan, then migration and seed after approval | **Owner reviews DDL** |
| 3.3 | Taxonomy and attributes (categories, collections, tags, attributes, translations) | |
| 3.4 | Products and translations, status, scheduled publishing, availability by market and branch | |
| 3.5 | Variations (generate, edit, SKU rules) | |
| 3.6 | Market pricing (regular, sale, schedules) and the read-only price preview | |
| 3.7 | Customization options and conditional rules | |
| 3.8 | Add-ons and bundles | |
| 3.9 | Media (storage adapter, upload validation, library, gallery and variation images) | Done (R2 adapter and category images deferred) |
| 3.10 | Public catalog read API with brand, market and language resolution and cache keys | Done |
| 3.11 | Admin screens for all of the above, Playwright E2E | Done and approved |
| 3.12 | Hardening: cross-brand isolation matrix for every catalog table, route coverage, audit, performance of listing queries, dependency audit, docs | Done, **owner approval before Phase 4** |

Every step ends green on `pnpm check` and the database suites, updates the docs (`PROGRESS`, `CHANGELOG`, `DECISIONS`, `API`, `DATABASE`, `TESTING`, `ROADMAP`) and does not start the next phase.

## 8. Decisions needing your approval

| ID | Decision | Recommendation | Impact if different |
|---|---|---|---|
| D3-01 | Catalog ownership | Products, categories and attributes belong to one brand; no sharing across brands in Phase 3 | Shared catalogs need a global layer and cross-brand rules |
| D3-02 | Price storage | Integer minor units per (product or variation, market, currency); sale price with start and end; no price on the core record | Floats or per-brand prices break market pricing |
| D3-03 | Tax | Prices are stored as entered; whether they include VAT is a per-market setting decided with checkout (UAE VAT 5% expected) | Wrong choice forces price re-entry later |
| D3-04 | Slugs and URLs | Slug per language per brand, unique within brand and language; history kept for redirects. **Final public URL structure is decided in Phase 7 and the Cake 301 map in Phase 11** | Changing later requires a redirect map |
| D3-05 | Variation limit and identity | Variation = unique combination of variation-driving attribute values, own SKU; at most 100 variations per product at first | Higher limits need bulk tooling and index review |
| D3-06 | Customization vs add-on vs variation | As in PRODUCT-ENGINE: options never touch SKU or stock; add-ons are purchasable lines; variations carry SKU | Mixing them breaks inventory and reporting |
| D3-07 | Bundles | Fixed bundle price set per market; components are listed for stock deduction in Phase 4. Sum-minus-discount pricing is deferred | Dynamic bundle pricing needs the Phase 5 pricing service |
| D3-08 | Add-on stock | Add-on products that are real products consume their own stock (Phase 4); inline priced options do not | Unlisted stock causes overselling |
| D3-09 | Media storage | A storage adapter with local disk in development and Cloudflare R2 in production; images only in Phase 3 (JPEG, PNG, WebP, size limit, content-type sniffing); customer upload files come with checkout | Without an adapter R2 is hard to introduce later |
| D3-10 | Image processing | Resize and WebP variants generated on upload with `sharp` (already allowed in the build) | Next.js image optimization alone cannot protect the origin |
| D3-11 | Translations | English required, Arabic optional per market setting; missing Arabic falls back to English with a visible flag in admin | Required Arabic blocks publishing until copy exists |
| D3-12 | Publishing | Draft, published, archived, plus scheduled publish; publishing needs `catalog.publish` | Looser rules let anyone publish |
| D3-13 | Deferred features | Reviews, import/export, WooCommerce migration and bulk CSV are not built in Phase 3 | Pulling them in delays the engine |
| D3-14 | Product shapes for tests | Phase 3 tests use two modelled products (flower bouquet with piece counts, cake with flavour x size, message, reference image and add-ons) as fixtures only, never as production data | |
| D3-15 | Search | Admin search uses PostgreSQL (trigram and full text); a search service for the storefront is decided in Phase 8 | Early search engine adds operations cost |

## 9. Information I need from you (does not block drafting)

1. **Real product data shapes**: confirmation of the flower piece-count options and the Cake variation, message and add-on structure (a read-only audit with admin access, as noted in FEATURE-PARITY).
2. Whether Arabic content is required at launch of Matilda Flower (D3-11).
3. The bundle pricing model you want (D3-07) and whether a cake plus flowers combination across brands is wanted ([Open] cross-brand cart).
4. Whether prices include VAT (D3-03).
5. The Matilda logo and brand assets for later phases (still outstanding from Phase 2), and the real branch list.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Variation and option rules get over-complex | Fixtures from the Cake audit; schema review at 3.2; no rule types beyond those listed |
| Price logic drifts between admin preview and Phase 5 | Preview calls the same pure pricing functions that Phase 5 will extend |
| Catalog data leaks across brands | RLS and composite keys on every table; isolation matrix test at 3.12 |
| Large listings are slow | Indexes planned at 3.2, listing performance check at 3.12 |
| Upload abuse | Type and size validation, content sniffing, private storage, rate limits |
