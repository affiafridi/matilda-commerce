# Database

PostgreSQL + Prisma. One centralized database per environment (Development, Staging, Production). **The entity list below is preliminary [Proposed]; the final schema must be designed and reviewed before implementation. No executable Prisma schema or migration is to be created in Phase 0.**

## Preliminary entity groups

| Group | Entities |
|---|---|
| Tenancy | Brand, Domain, Country, Market, Branch, BranchBrand (branch↔brand/market) |
| Identity | StaffUser, Customer, Role, Permission, RolePermission, RoleAssignment (with brand/market/branch scope), Session, AuditLog |
| Catalog | Product, ProductTranslation, Category, CategoryTranslation, Collection, Tag, Attribute, AttributeValue, ProductAttribute, ProductOption, Variation (SKU), AddOn, AddOnGroup, Bundle, BundleItem, CustomizationField, ConditionalRule, ProductRelation (cross/up/related), Review |
| Pricing | MarketPrice (product/variation × market × currency), SalePrice schedule, TaxRule |
| Inventory | BranchInventory, StockReservation, StockMovement, StockTransfer, RawMaterial, Recipe/consumption |
| Cart/Order | Cart, CartItem, Order, OrderItem (+ snapshots), OrderAddress, OrderStatusHistory, Invoice |
| Payments | PaymentConfiguration (brand/market scoped, encrypted), Payment, PaymentAttempt, Refund, WebhookEvent |
| Delivery | DeliveryLocation (country→emirate/province→city→area), DeliveryZone, ZoneCharge, DeliverySlot, SlotCapacity, DeliveryRestriction, Holiday, DeliveryAssignment, Rider |
| Marketing | Promotion, Coupon, CouponRedemption, GiftCard, LoyaltyAccount, LoyaltyTransaction |
| Content | Media, CmsPage, BlogPost, HomepageSection, Banner, Menu, SeoMetadata, Redirect, NotFoundLog |
| Comms | NotificationTemplate, Notification, ConsentRecord |

## Required design principles [Approved]

- Proper foreign keys, check/unique constraints, and appropriate indexes.
- **Unique constraints scoped by brand or market** (e.g., SKU, slug, coupon code, order number are unique per brand/market, not globally).
- Transactional integrity; **safe concurrent inventory updates** (row locking / atomic conditional updates; see [INVENTORY](INVENTORY.md)).
- **No floating-point money**: integer minor units or `Decimal`, with explicit currency and rounding rules per market. [Proposed: integer minor units + ISO 4217 code]
- **Historical snapshots**: order items store product name, options, price, tax, discount at purchase; later catalog changes never alter past orders.
- **UTC timestamps**; market timezone applied only at presentation and for business-rule evaluation (cutoffs, slots).
- Deletion/retention policy per entity (soft-delete for catalog; legal retention for orders/invoices/payments; anonymization for customer deletion requests). [Open: durations]
- Translation tables rather than duplicated products ([MULTILINGUAL](MULTILINGUAL.md)).

## Tenant isolation [Approved requirement, mechanism Open]

Prevent cross-brand and cross-market leakage at **application and database** level.
- Every tenant-owned table carries `brand_id` (and `market_id` where relevant); composite foreign keys keep children in the same brand.
- Mandatory scoped data-access layer; no unscoped queries in services.
- [Open] PostgreSQL Row-Level Security as a second layer (session variable set per request) vs. repository-only enforcement; evaluate Prisma compatibility and pooling implications.
- Isolation tests in [TESTING](TESTING.md).

## Sensitive data

Payment credentials encrypted at rest (envelope encryption, key outside the DB) — [PAYMENTS](PAYMENTS.md), [SECURITY](SECURITY.md). Never store raw card data. Customer PII minimized.

## Operations

Migrations reviewed and applied via controlled procedure ([DEPLOYMENT](DEPLOYMENT.md)); connection pooling; off-site backups with tested restores. Future regional databases for scale/regulation are planned-for, not built ([ARCHITECTURE](ARCHITECTURE.md)).

## Open schema questions

Customer identity model (brand-specific rows vs. shared identity with per-brand profile); order-number format per market; tax model (inclusive/exclusive, VAT 5% UAE assumption to verify); how inventory is modeled for made-to-order and bundles; RLS decision. Tracked in [DECISIONS](DECISIONS.md).

## Catalog (Phase 3, implemented in migration `catalog_engine`)

Forty tables for products, translations, categories, collections, tags, attributes, variations, market prices, customization options and rules, add-ons, bundles, media and slug history. Every table has `brand_id`, composite foreign keys to `(id, brand_id)` parents, forced row-level security with one `<table>_scope` policy, and integer minor-unit prices. Full definition, rules and deviations: [PHASE-3-SCHEMA-DRAFT.md](PHASE-3-SCHEMA-DRAFT.md).

- Attribute keys (step 3.3, migration `attribute_key_unique`): unique per brand among live shared attributes and per product among live product-specific ones; a soft-deleted attribute releases its key. The slug history table only accepts product, category and collection (tags have no public URL).
