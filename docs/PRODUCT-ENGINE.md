# Product and Catalog Engine

Goal [Approved]: a flexible engine comparable to the relevant WooCommerce product capabilities, **not hardcoded** for flowers, cakes or cookies. Different product shapes come from configurable attributes, options, variations and rules.

## Capabilities [Approved]

- Product types: simple, variable, bundles, gift combinations.
- Taxonomy: categories/subcategories, collections, tags, optional product brands.
- Attributes: dynamic, global and product-specific.
- Variations: multiple combinations; per-variation price, stock, SKU, images.
- Media: galleries, variation images.
- Pricing: regular and sale price, scheduled promotional pricing, **market-specific prices**.
- Availability: branch-specific availability; availability schedules; draft/published; scheduled publishing.
- Add-ons: product add-ons; **variable add-on products**; mandatory and optional.
- Merchandising: cross-sells, up-sells, related products.
- Customization: custom text fields, image/file uploads, conditional options.
- Purchase limits: min/max quantity.
- Operations: bulk operations, import/export, duplication.
- Reviews and ratings.

## Critical distinction [Approved]

| Concept | Affects SKU/stock? | Examples |
|---|---|---|
| **Variation** | Yes — has its own SKU and inventory | Cake flavor × weight; bouquet stem count |
| **Customization option** | No — price delta and/or order instruction only | Message on cake, reference image, ribbon colour, card text |
| **Add-on** | Separate purchasable line (simple or variable) or priced option | Balloon, chocolate box, vase |

## Proposed data approach [Proposed]

- Core Product + ProductTranslation (name, description, SEO fields per language).
- AttributeDefinition (global or product-scoped) with typed values; ProductAttribute marks which attributes drive variations.
- Variation = unique combination of variation-driving attribute values → SKU.
- Option groups (select/radio/checkbox/text/textarea/file/date) with price modifiers, required flags, min/max selections, **conditional visibility rules** (show option B when option A = X).
- Add-on groups reference products/variations or inline priced options, with rules (required, max qty, per-product vs per-cart).
- MarketPrice rows keyed by (variation or product, market, currency); no price on the core record.
- Per-product operational rules: preparation time, lead time, delivery restrictions (category-level and product-level), allowed branches — consumed by [DELIVERY](DELIVERY.md).
- Made-to-order flag so stock is not required ([INVENTORY](INVENTORY.md)).
- Final price is computed by the backend pricing service from base + variation + options + add-ons + promotions ([CART-AND-CHECKOUT](CART-AND-CHECKOUT.md)).

## Uploads

Customer reference images/files: type and size limits, malware/content validation, private storage in R2, attached to order item ([SECURITY](SECURITY.md)).

## SEO and translations

Slugs per language/market, structured data (Product, ProductGroup/variant), feed attributes — [SEO](SEO.md), [MULTILINGUAL](MULTILINGUAL.md).

## Admin UX

Efficient variation management (bulk generate, bulk edit price/stock/SKU/image), duplicate product, import/export — [ADMIN-PANEL](ADMIN-PANEL.md).

## Observed on live sites (requires verification)

Flowers site shows piece-count options (e.g., 6 to 51 pcs) with price ranges in AED and "Select Options" buttons, plus cards sold as separate items (observed in text-only fetch). Cake site not reviewed. See [FEATURE-PARITY](FEATURE-PARITY.md).

## Open

Bundle pricing models (fixed vs sum-minus-discount) and bundle stock semantics; whether add-on products consume their own stock; import format and WooCommerce migration mapping; review moderation and verified-purchase rules.
