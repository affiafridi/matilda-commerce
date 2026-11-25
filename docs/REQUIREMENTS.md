# Requirements

All items are **[Approved]** unless marked. Detail lives in the linked domain file. IDs are stable references for tests and progress tracking.

## Functional

| ID | Area | Requirement | Detail |
|---|---|---|---|
| F-01 | Multi-brand | Independent domains, branding, layouts, products, customers, carts, orders, coupons, payment configs, templates, SEO, analytics, CMS, settings, feature flags per brand; server-side brand resolution; strict isolation | [MULTI-STORE](MULTI-STORE.md) |
| F-02 | Multi-market | Brand → Market → Branch; per-market currency, pricing, tax, languages, timezone, gateways, merchant accounts, availability, legal, SEO, order numbering/invoicing. Only Flowers/UAE active initially | [MULTI-STORE](MULTI-STORE.md) |
| F-03 | Multi-branch | Branch hours, inventory, capacity, delivery coverage, slots, prep times, holidays, assignment rules; branch may serve multiple brands; auto and manual assignment/transfer | [DELIVERY](DELIVERY.md), [ORDER-MANAGEMENT](ORDER-MANAGEMENT.md) |
| F-04 | Staff auth | 12 role templates, custom roles, granular permissions, multi-role, brand/market/branch scope, 2FA, audit | [ROLES-AND-PERMISSIONS](ROLES-AND-PERMISSIONS.md) |
| F-05 | Customer auth | Registered accounts (brand-specific) and guest checkout | [CUSTOMER-AUTH](CUSTOMER-AUTH.md) |
| F-06 | Catalog | Simple/variable products, attributes, variations, add-ons, bundles, customization, conditional options, uploads, market pricing, branch availability, scheduling, bulk ops, import/export, duplication, reviews | [PRODUCT-ENGINE](PRODUCT-ENGINE.md) |
| F-07 | Inventory | Product/variation/branch stock, reservations, movements, transfers, alerts, made-to-order, raw materials | [INVENTORY](INVENTORY.md) |
| F-08 | Cart/Checkout | Persistent/guest carts, merge, promotions, gifts, delivery/tax, gifting, scheduling, abandoned carts, reservations; backend-authoritative | [CART-AND-CHECKOUT](CART-AND-CHECKOUT.md) |
| F-09 | Payments | Per-brand/market CCAvenue, COD, manual, advance/partial, callbacks, idempotency, refunds on original merchant config, reconciliation | [PAYMENTS](PAYMENTS.md) |
| F-10 | Delivery | Location hierarchy, zones, charges, slots, capacity, cutoffs, restrictions, holidays, riders, tracking, proof of delivery — all admin-configurable | [DELIVERY](DELIVERY.md) |
| F-11 | Orders | Website/WhatsApp/phone/walk-in/manual orders, controlled statuses, production, snapshots, invoices, refunds, exports | [ORDER-MANAGEMENT](ORDER-MANAGEMENT.md) |
| F-12 | Localization | English + Arabic, RTL, DB-driven translations, localized formats, fallback | [MULTILINGUAL](MULTILINGUAL.md) |
| F-13 | Admin | Enterprise admin with brand/market/branch switcher, permission-based nav | [ADMIN-PANEL](ADMIN-PANEL.md) |
| F-14 | SEO | First-class SEO Manager (Rank Math/Yoast-class), sitemaps, schema, hreflang, redirects, feeds, analytics | [SEO](SEO.md) |
| F-15 | CMS/Marketing | Homepage sections, banners, pages, blog, menus, media, coupons, promotions, loyalty, gift cards, referrals, abandoned-cart recovery | [CMS-AND-MARKETING](CMS-AND-MARKETING.md) |
| F-16 | Notifications | Email, WhatsApp, SMS, in-app, future push; per-brand/language templates; consent | [NOTIFICATIONS](NOTIFICATIONS.md) |
| F-17 | Feature parity | Matilda Cake capabilities supported by the engine | [FEATURE-PARITY](FEATURE-PARITY.md) |

## Non-functional

| ID | Area | Requirement | Detail |
|---|---|---|---|
| N-01 | Architecture | Modular monolith, monorepo, API-only DB access, no microservices | [ARCHITECTURE](ARCHITECTURE.md) |
| N-02 | Security | Production-grade authN/Z, Argon2id, staff 2FA, encrypted payment secrets, audit, rate limiting, secure uploads, backups | [SECURITY](SECURITY.md) |
| N-03 | Performance | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 (targets to measure, not guarantees); brand/market/language-aware caching | [PERFORMANCE](PERFORMANCE.md) |
| N-04 | Data integrity | FKs, constraints, transactions, no float money, UTC timestamps, snapshots, retention policy | [DATABASE](DATABASE.md) |
| N-05 | Accessibility | WCAG 2.2 AA, keyboard, semantic HTML, reduced motion, RTL | [DESIGN-SYSTEM](DESIGN-SYSTEM.md) |
| N-06 | Quality | Unit, integration, API, E2E, isolation, concurrency, payment, RTL, SEO, a11y, perf, security, backup-restore tests | [TESTING](TESTING.md) |
| N-07 | Operations | Dev/Staging/Prod, Docker, Nginx, GitHub Actions, Cloudflare, off-site backups, rollback, monitoring | [DEPLOYMENT](DEPLOYMENT.md) |
| N-08 | API | Versioned REST, OpenAPI, validation, pagination, idempotency, structured logging | [API](API.md) |
| N-09 | Design | Premium, non-generic UI; distinct per-brand themes without duplicating business logic | [DESIGN-SYSTEM](DESIGN-SYSTEM.md) |
| N-10 | Maintainability | Strict TypeScript, minimal dependencies, docs kept current | [CLAUDE.md](../CLAUDE.md) |

## Explicit exclusions / constraints

- No WooCommerce, Shopify, Medusa or similar as the new backend.
- Do not modify the existing live websites.
- No development before explicit owner authorization.
- Not every admin module is in the first phase ([ROADMAP](ROADMAP.md)).

## Open requirements

Tracked in [DECISIONS.md](DECISIONS.md) "Open questions".
