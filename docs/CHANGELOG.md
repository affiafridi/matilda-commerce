# Changelog

Records important project changes. Newest first.

## 2026-11-28 — Phase 5 step 5.6: delivery fee, tax and signed quote

- Migration `market_tax`: `market.tax_rate_bps` and `market.tax_inclusive`; the market create and update API accepts `taxRateBps` and `taxInclusive`.
- Quotes now include the delivery fee (zone charge, minimum order, free-over, free-delivery promotion), per-line and delivery tax, `delivery` and `tax` blocks. The cart view adds `quote.delivery`, `quote.tax`, `quote.expiresAt` and an HMAC `quote.signature`.
- New env `QUOTE_SIGNING_SECRET` (min 32 characters; required in staging and production).

## 2026-11-28 — Phase 5 step 5.5: promotions and coupons

- New promotion engine and evaluator; quotes now include discounts, free gifts and a free-delivery flag. Staff API for promotions and coupons under `/api/v1/admin/brands/:brandId/promotions`; shoppers apply and remove a coupon with `PUT` and `DELETE /api/v1/cart/coupon`.
- Cart view gains `quote.promotions` (applied offers, coupon outcome, free delivery). `QuoteService` takes the customer and coupon code and applies promotions unless `skipPromotions` is set.

## 2026-11-28 — Phase 5 step 5.4: cart API

- New routes under `/api/v1/cart` (read, add, change, remove, capture contact) for guests (secret cookie, hash stored) and signed-in customers (one open cart per brand), with same-brand origin and customer CSRF checks. Every read re-prices through the pricing engine; unbuyable lines stay visible with issues. Guest cart merges into the customer cart at sign-in.
- `QuoteService.quote` prices what it can and lists the rest; the engine no longer zeroes the whole cart when one line fails (`price` still throws for checkout). Customer sessions now return the customer id. New request contracts `addCartLineSchema`, `updateCartLineSchema`, `cartContactSchema`.

## 2026-11-28 — Phase 5 step 5.3: pricing engine

- New `pricing` module: pure `priceCart` engine plus `QuoteService` that loads catalog data under row-level security and returns snapshot-ready quote lines and totals, or 422 `CART_INVALID` with per-line errors. Covers sale windows, variations, option and add-on deltas, conditional option rules, bundles and quantity limits. No routes yet; the cart (5.4) and checkout (5.7) call it.
- Shared contract change: `bundleChoices` entries are `{ bundleItemId, variationId? }`; `quoteLineSchema` gained `cartLineId`, `addonItemId`, `name`, `sku`, `options` and `bundleItems`. 22 unit and 18 database tests.

## 2026-11-27 — Phase 5 step 5.2: commerce schema implemented

- Owner approved the schema draft as recommended. Migration `commerce` adds 21 brand-keyed tables (carts, orders, payments, promotions, saved addresses) with row-level security, state machines, frozen order snapshots, append-only history, encrypted versioned payment config and atomic coupon use and order numbers.
- `bundle_item` gained `UNIQUE (id, brand_id)`. New `commerce-schema.int-spec.ts` (101 tests). No API yet.

## 2026-11-27 — Phase 5 step 5.2: schema draft for review

- New [PHASE-5-SCHEMA-DRAFT.md](PHASE-5-SCHEMA-DRAFT.md): 22 tables, enums matching the shared contracts, row-level security, immutable order snapshots, payment config versioning and seven owner questions. Docs only; no migration yet.

## 2026-11-27 — Phase 5 step 5.1: commerce foundations

- Plan approved by the owner ("Approve, start 5.1").
- New permission `payments.view`; Finance Manager template gets it.
- New shared contracts and state machines in `packages/validation/src/commerce.ts` with tests; money helpers use whole minor units only.
- Skeleton modules for carts, promotions, checkout, orders and payments (no routes); test-only cart fixtures.

## 2026-11-27 — Phase 4 approved; Phase 5 plan drafted

- The owner approved Phase 4 after reviewing the screens ("Approve Phase 4, start Phase 5").
- New [PHASE-5-PLAN.md](PHASE-5-PLAN.md): scope, domain model, steps 5.1 to 5.13, decisions D5-01 to D5-18, owner inputs needed (CCAvenue test credentials, tax, cash on delivery, promotions) and risks. No Phase 5 code yet; step 5.1 waits for the owner to approve the plan.

## 2026-11-27 — Admin screens: usability pass after the owner's first look

- The owner found the Phase 4 screens hard to understand and unaligned. Fixes: a new "Delivery setup" checklist page (what to do first, what is still missing); opening hours as day switches with time pickers; date and time pickers instead of typed text; side-by-side fields now line up; sections are boxed with a plain-language description; plainer names (Methods and fees, Branch assignment, "preferences" instead of "rules").
- Bug found while looking: the local database's built-in roles lacked the Phase 4 `branches.calendar` permission, so opening hours could not be edited. Re-running `node --env-file=.env dist/cli/seed.js` (the bootstrap seed) syncs them; the test database was already correct.
- The E2E launcher now forces `DEV_SKIP_MFA=false`. 22 Playwright tests pass.

## 2026-11-27 — Phase 4, steps 4.9 to 4.13 (transfers, availability, assignment, admin screens, hardening)

- The owner said they have not tested anything yet and will check everything once I finish, so earlier "approved" step labels now read "built; not yet reviewed by the owner" and the rest of Phase 4 was built without further per-step stops.
- 4.9 transfers between branches (discrepancy notes); 4.10 availability service with three public reads (`/delivery/areas`, `/delivery/availability`, `/delivery/stock-status`); 4.11 assignment rules, preview and audited override.
- 4.12 admin screens: Stock, Transfers, Reservations, Zones, Methods and charges, Slots, Restrictions, Branch calendar, Assignment and tester, with their menus.
- 4.13 hardening: route coverage and cross-brand matrix for all inventory and delivery routes; dependency audit; docs. Decisions D4-17 to D4-19 recorded.
- No new dependency and no migration after 4.2.

## 2026-11-27 — Phase 4, step 4.8 (reservations)

- Owner approved step 4.7 ("Approve, start 4.8").
- New `ReservationsService` and `ReservationExpiryJob` in the inventory module; two staff routes under `/admin/brands/:brandId/inventory/reservations`. Documented in API.md and INVENTORY.md.
- Tests: 27 new integration tests (one uses Redis). No new dependency, no migration.

## 2026-11-27 — Phase 4, step 4.7 (stock levels and ledger API)

- Owner approved step 4.6 ("Approve, start 4.7").
- New routes `/admin/brands/:brandId/inventory/...` (settings, stock rows, movements, count). Documented in API.md.
- `BrandScopedAccess` gained `assertReaches` and `recordFor` (moved from `DeliveryAccess`); the inventory module has its own `InventoryAccess`.
- Tests: 17 new integration tests. No new dependency, no migration.

## 2026-11-27 — Phase 4, step 4.6 (restrictions API)

- Owner approved step 4.5 ("Approve, start 4.6").
- New routes `/admin/brands/:brandId/delivery/restrictions`. Documented in API.md.
- Tests: 8 new integration tests. No new dependency, no migration.

## 2026-11-27 — Phase 4, step 4.5 (slots API)

- Owner approved step 4.4 ("Approve, start 4.5").
- New routes `/admin/brands/:brandId/delivery/slots` (CRUD). Documented in API.md.
- Time helpers (`toTime`, `fromTime`) moved to `delivery-common`.
- Tests: 8 new integration tests. No new dependency, no migration.

## 2026-11-27 — Phase 4, step 4.4 (calendar, methods and charges API)

- Owner approved step 4.3 ("Approve, start 4.4").
- New routes under `/admin/brands/:brandId/delivery`: `branches/:branchId/hours`, `closures`, `methods`, `charges`. Documented in API.md.
- `BrandScopedAccess.runAt` checks a permission over a market or branch scope (so branch managers keep only their own branch's calendar); `DeliveryAccess.recordFor` writes audit rows with market and branch.
- Tests: 16 new integration tests (opening hours, closures, methods, charges, route probes). No new dependency, no migration.

## 2026-11-26 — Phase 4, step 4.3 (locations and zones API)

- Owner approved step 4.2 ("Approve, start 4.3").
- New routes: `/admin/delivery/areas` (shared location tree, platform-only writes) and `/admin/brands/:brandId/delivery/zones` (zones, translations, coverage, serving branches). Documented in API.md.
- `BrandScopedAccess` extracted to `modules/admin/brand-access.ts`; `CatalogAccess` and the new `DeliveryAccess` extend it (no behavior change for the catalog).
- Tests: 16 new integration tests. No new dependency, no migration.

## 2026-11-26 — Phase 4, step 4.2 (schema)

- Owner approved step 4.1 ("Approve, start 4.2"; 4.1 committed as `7e40f0c`) and then the schema draft ("Approve as recommended").
- Migration `inventory_delivery`: 23 tables, 9 enums, `btree_gist`, checks, triggers, exclusion constraint and row-level security; applied to development and test databases.
- Reference seed adds the seven UAE emirates with English and Arabic names.
- Tests: 81 new database tests (integration total 489); delivery test fixtures gained `cutoffDaysBefore`.
- No new dependency; no API or screen yet.

## 2026-11-26 — Phase 4, step 4.1 (foundations)

- Owner approved the Phase 4 plan ("Approve, start 4.1").
- Added permission `branches.calendar`; `delivery.manage` is now sensitive (step-up).
- Shared inventory and delivery contracts in `@matilda/validation` with tests.
- Added `bullmq` and the jobs module (Redis optional at start-up); empty inventory and delivery modules; test-only delivery fixtures.
- Tests: validation 19, API unit 137, integration 408 (jobs spec needs Redis). No schema change.

## 2026-11-26 — Phase 4 plan drafted

- Owner approved Phase 3 ("Approve Phase 3, start Phase 4"); Phase 3 marked complete.
- Added `docs/PHASE-4-PLAN.md` (draft): scope, domain model, services, permissions, API, screens, steps 4.1 to 4.13, decisions D4-01 to D4-16, open questions and risks. No code or schema change.

## 2026-11-26 — Phase 3, step 3.12 (hardening)

- Owner approved step 3.11 ("Approve, start 3.12").
- New tests: `catalog-hardening.int-spec.ts` (route table coverage and cross-brand HTTP matrix, 7) and `catalog-performance.int-spec.ts` (5,000 products, 2). Integration total 405.
- Fix: the public product list now pages in the database for featured and newest orders instead of loading every product; response shape unchanged.
- Dependency audit: nothing in production; 5 moderate advisories in developer tooling only. No schema change, no new dependency.

## 2026-11-26 — Phase 3, step 3.11 (admin catalog screens)

- Owner approved step 3.10 ("Approve, start 3.11").
- New admin screens: Products (list, new, tabbed editor), Categories, Collections, Tags, Attributes, Media library, with a Catalog navigation group. The HTTP client now accepts file uploads.
- Playwright `catalog.e2e.ts` added (brand needed, create tag and draft product, Catalog Manager brand lock and cross-brand 403, Branch Manager sees no catalog menu).
- No schema change, no new dependency. Admin E2E 14 of 14; integration 396; unit 132 (API) and 19 (admin).

## 2026-11-26 — Phase 3, step 3.10 (public catalog read API)

- Owner approved step 3.9 ("Approve, start 3.10"); the Phase 3 work through 3.9 was committed and pushed first (`3616974`).
- New public routes `GET /api/v1/catalog/categories`, `/collections`, `/products`, `/products/:slug`, resolved from the request host with the existing tenant guard.
- Visibility: published, inside the publish window, sold in the market and priced there. No internal fields. Language from the market's list with English fallback.
- Responses are cacheable for 30 seconds; the in-process cache key includes brand, market and language.
- No schema change and no new dependency. Tests: `public-catalog.int-spec.ts` (9) and `public-catalog.cache.spec.ts` (5); integration total 396.

## 2026-11-26 — Phase 3, step 3.9 (media)

- Owner approved step 3.8 ("Approve, start 3.9").
- Admin API: media library (`/media` upload, list, get, alt text, delete), product gallery (`/products/:id/media`) and variation image; public variant delivery at `/api/v1/media/:brandId/:assetId/:kind`. Audited as `media.upload`, `media.alt.set`, `media.delete`, `product.media.set`, `variation.media.set`.
- Uploads are validated by content, limited in size and pixels, stripped of metadata and re-encoded; WebP variants are generated with `sharp` (approved in D3-10). Storage sits behind an adapter (local disk now). New settings `MEDIA_STORAGE`, `MEDIA_LOCAL_DIR`, `MEDIA_MAX_UPLOAD_BYTES`; the local folder is git-ignored.
- New dependencies in the API: `sharp` 0.35.5 and `@types/multer` (dev).
- No schema change. Tests: `media.int-spec.ts` (15); integration total 387.

## 2026-11-26 — Phase 3, step 3.8 (add-ons and bundles)

- Owner approved step 3.7 ("Approve, start 3.8").
- Admin API `GET/PUT /products/:id/addons` and `GET/PUT /products/:id/bundle`; audited as `product.addons.set` and `product.bundle.set`.
- Rules: required groups need a minimum of one; selection limits within the item count; inline add-ons have a key, English label and per-market price; product add-ons use the add-on product's own price (D3-08); a variable add-on or component needs its variation; no self add-ons, no bundle add-ons, no nested bundles; one component entry per product and variation; a bundle needs a component to publish.
- No schema change. Tests: `addons.int-spec.ts` (11); integration total 372.

## 2026-11-26 — Phase 3, step 3.7 (customization options)

- Owner approved step 3.6 ("Approve, start 3.7").
- Admin API `GET/PUT /products/:id/options`: option groups, choices, translations, per-market extra charges and conditional visibility rules, matched by key so ids stay stable. Audited as `product.options.set`.
- Rules: shape per option type, English labels, selection limits within the choice count, no rule loops, prices in whole non-negative minor units for markets and currencies of the brand, price changes need `pricing.edit`.
- No schema change. Tests: `options.int-spec.ts` (11); integration total 361.

## 2026-11-26 — Phase 3, step 3.6 (market pricing)

- Owner approved step 3.5 ("Approve, start 3.6").
- Admin API under `/products/:id`: list, replace and delete prices, and a read-only price preview at any moment. Reading needs `products.view`, changing prices `pricing.edit`; audited as `price.set` and `price.delete`.
- Rules: integer minor units only; sale below regular; sale dates need a sale price; currency must belong to the market; one price per market, currency and item; variable products priced per variation. Publishing needs a price for every sellable item in every market.
- `@matilda/validation`: `effectivePrice` (shared base price rule). No schema change.
- Tests: `pricing.int-spec.ts` (11) plus the publish tests updated; integration total 350.

## 2026-11-26 — Phase 3, step 3.5 (variations)

- Owner approved step 3.4 ("Approve, start 3.5").
- Admin API under `/products/:id`: product attributes with chosen values and variation-driving flags, variation list, generate, manual create, single and bulk edit, soft delete. Permissions `products.view` and `products.edit` over the brand; every change audited.
- Rules: variable products only; at most 100 variations; one value per driving attribute; fixed combination; SKU unique per brand across products and variations; in-use attributes and values are protected; publishing a variable product needs an active variation.
- No schema change. Tests: `variations.int-spec.ts` (17); integration total 339.

## 2026-11-26 — Phase 3, step 3.4 (products)

- Owner approved step 3.3 ("Approve, start 3.4").
- Admin API under `/api/v1/admin/brands/:brandId/catalog/products`: list, create (draft), get, edit, delete (soft), translations, taxonomy links, availability (markets and branches), publish, unpublish, archive. Permissions `products.view`, `.create`, `.edit`, `.delete`, `.publish` over the brand; every change audited.
- Rules: English required; SKU unique per brand and shared with variations, not allowed on variable products; slug history on change and delete; publishing needs an English name and a market; scheduling needs `products.publish`; visibility derived from status and schedule; bundle components cannot be deleted.
- No schema change. Tests: `products.int-spec.ts` (16); integration total 322.

## 2026-11-26 — Phase 3, step 3.3 (taxonomy and attributes)

- Owner approved step 3.2 ("Approve, start 3.3").
- Admin API under `/api/v1/admin/brands/:brandId/catalog/`: `categories`, `collections`, `tags` (list with search and status, create, get, update, translations per language, soft delete) and `attributes` (with values and translations). Permissions `products.view` (read) and `taxonomy.manage` (write), checked over the brand; all changes audited.
- Rules: English required; slug from the name when omitted, unique per brand and language, redirect history kept for categories and collections; category tree at most 4 levels with no cycles; categories with subcategories or products, and attributes or values used by products, cannot be deleted or re-keyed; colours only on colour attributes.
- Migration `attribute_key_unique`: partial unique indexes on live attribute keys. Prisma relation names on catalog models made readable (names only, no database change).
- `@matilda/validation`: `slugify`. Tests: `taxonomy.int-spec.ts` (29); integration total 306.

## 2026-11-26 — Phase 3, step 3.2 (catalog schema migration)

- Owner approved the schema draft (all nine questions as recommended).
- Migration `catalog_engine`: 40 catalog tables with brand composite foreign keys, forced row-level security, check constraints, partial unique indexes, 9 integrity triggers (SKU sharing, variation limit, bundle and add-on shape, price targets, branch and brand, category tree) and a trigram search index; `pg_trgm` enabled.
- Tests: `catalog-schema.int-spec.ts` (104 tests); integration total 277.

## 2026-11-25 — Phase 3, step 3.2 (schema draft)

- Added `docs/PHASE-3-SCHEMA-DRAFT.md` for owner review: catalog tables, constraints, row-level security, indexes, tests and nine questions. No migration or code change.

## 2026-11-25 — Phase 3, step 3.1 (foundations)

- Owner approved the Phase 3 plan.
- Added permission `taxonomy.manage` (Catalog Manager default); permission catalog now has 53 keys.
- `@matilda/validation`: catalog contracts, money helpers and the variation generator (8 tests); package now builds with `rewriteRelativeImportExtensions`.
- API: empty `CatalogModule`, test-only product fixtures and their spec.

## 2026-11-25 — Phase 3 started (plan only)

- Added `docs/PHASE-3-PLAN.md` (draft): scope, domain model, permissions, API, admin screens, steps 3.1 to 3.12 with owner gates, decisions D3-01 to D3-15. No code written.

## 2026-11-25 — Phase 2, step 2.11 (hardening and verification)

- Security: `effect` pinned to 3.22.5 (fixes GHSA-7589-6fvf-x4pw); `pnpm audit --prod` is clean.
- Added `apps/api/scripts/load-smoke.mjs` (local load smoke for login and authorization paths).
- Verified migrations and the three seed tiers on a clean database (idempotent); no secrets in the repository; response headers checked.
- Admin: page content now uses the full width (removed fixed maximum widths); scope switchers have a chevron.
- Owner approved step 2.10 and then Phase 2 as a whole.

## 2026-11-25 — Phase 2, step 2.10 (switchers and management screens)

- Admin: brand → market → branch switchers (validated by the API through `X-Admin-Brand`), and the screens for brands and domains, markets, branches, employees and assignments, roles and permissions, audit log and customers; all navigation items now built and permission-filtered.
- Tests: Playwright introduced (D2-20) with 9 end-to-end tests on the test database; admin unit tests for the scope model.
- Fixed: inviting an employee now opens the new employee's page.
- Owner approved step 2.9 ("approve").

## 2026-11-25 — Phase 2, step 2.9 (admin design and app shell)

- Owner approved the admin design brief with the final direction (neutral, Inter, 4 to 6px radii, collapsible sidebar, dark-mode and RTL ready); see D2-21 and `docs/design/admin-brief.html`.
- Admin app: sign-in, two-factor verify/enrol, recovery codes, accept invite, forgot/reset password, account security, shell and navigation model, step-up dialog, same-origin API proxy, CSRF handling.
- API: `POST /api/v1/admin/auth/csrf` re-issues the session CSRF token after a page reload (Origin-checked, cookie required).
- Dependencies (admin): `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `lucide-react`, `@fontsource-variable/inter`, `axe-core` (dev).
- Tests: 14 admin unit tests (HTTP client retry rules, safe redirects, navigation filtering); one new integration test for the CSRF route (173 integration tests in total).

## 2026-11-25 — Phase 2, step 2.8 (customer authentication)

### Added
- Migration `customer_auth`: `customer`, `customer_session`, `customer_token` with row-level security, per-brand unique email and composite brand keys.
- `modules/customer-auth`: register, verify email, login/logout, forgot/reset/change password, profile, deletion request; `CustomerSessionGuard`.
- `GET /admin/customers` and `/admin/customers/:id` (read-only support view).

### Changed
- `passwordProblems` accepts a minimum length (customers: 10, staff: 12); `AuthAttemptService` is exported for the customer realm.

### Notes
- Anonymization after a deletion request is deferred (needs retention rules from the owner).

## 2026-11-25 — Phase 2, step 2.7 (admin management APIs)

### Added
- `modules/admin`: REST endpoints for brands and domains, markets, branches (and market links), staff, assignments, roles, the permission catalog, audit-log query and `/admin/me/context` (see PROGRESS for rules).
- `AuthorizationService.dbScopeForAny`, `AssignmentService.assertGrantable`.

### Changed
- `PermissionsGuard` loads the actor's grants for staff-only routes too.
- Input validation for brand slug, market code and branch code now mirrors the database check constraints.

### Notes
- Customers read-only endpoint waits for the customer tables (step 2.8).

## 2026-11-25 — Phase 2, step 2.6 (staff authentication)

### Added
- Migration `staff_auth`: staff password hash, MFA state, `staff_mfa_totp`, `staff_recovery_code`, `staff_session`, `staff_token` (invite/reset), `auth_attempt`; an ACTIVE account must have a password (check constraint).
- `modules/staff-auth`: login, mandatory TOTP enrollment/verification, recovery codes, step-up, logout/logout-all, password change/forgot/reset, invite acceptance, `GET /admin/me` and `/admin/auth/session`.
- Super Admin bootstrap CLI `db:create-super-admin` (one-time invitation link, no default credentials, audited).
- Env: `PASSWORD_PEPPER` (required in staging/production), `ADMIN_BASE_URL`. Dependencies: argon2, otplib, qrcode, cookie-parser, @nestjs/throttler.

### Changed
- `PermissionsGuard` authenticates the staff session cookie, checks Origin and CSRF on mutations, and enforces step-up for sensitive permissions; added `@AuthenticatedStaff()`.
- Jest configs share `jest.shared.cjs` so the ESM-only otplib dependencies run under Jest.

### Notes
- Review gate: stop for owner review before step 2.7. See PROGRESS for known issues.

## 2026-11-25 — Phase 2, step 2.5 (audit logging)

### Added
- Migrations `audit_log` and `audit_log_paging_indexes`: `audit_log` with no foreign keys, append-only for everyone (runtime role lacks UPDATE/DELETE/TRUNCATE; triggers block row changes and TRUNCATE even for the owner; forced row-level security has INSERT-anything and brand-scoped SELECT policies, so brand-less rows are platform-only).
- `AuditService`: `record(tx, …)` writes inside the caller's transaction (rolls back with the change), `recordStandalone` for denials (never throws), `query` with filters and keyset paging, scoped by `dbScopeFor(grants, 'audit.view')`. Redaction masks secrets by key name and email addresses, and bounds size.
- `access.denied` rows: from `PermissionsGuard` for sensitive permissions and from a global interceptor for denials raised inside protected handlers.
- Role create/update/delete/clone and assignment grant/revoke now write audit rows; `RoleService`/`AssignmentService` take the acting staff id.
- Request context now carries client IP and user agent.

### Notes
- No HTTP endpoint exposes the audit log yet (admin APIs, step 2.7). Retention is indefinite for now (D2-18).
- Test databases can only be emptied through the owner-only `resetAuditLog` test helper.

## 2026-11-25 — Phase 2, step 2.4 (permissions and authorization)

### Added
- Migration `access_control`: `staff_user` (core columns; credentials/MFA/sessions in 2.6), `permission`, `role`, `role_permission`, `staff_role_assignment`. DB rules: lowercase unique email, unique custom role names, system roles and permissions read-only for `matilda_app` (trigger and grants), assignment brand/market/branch consistency trigger.
- Typed permission catalog and the 12 system role templates (`modules/iam/permissions`); `syncAccessControl` (owner role; also run by the seed CLI).
- `AuthorizationService`, scope algebra (null = any), global fail-closed `PermissionsGuard`, `@RequirePermission` / `@PublicRoute`, `RoleService` (custom roles, clone, escalation checks), `AssignmentService` (scope and escalation checks, last-Super-Admin protection with an advisory lock).
- Tests: permission x scope matrix, no-role-name-in-code check, every-route-declares-access check.

### Notes
- Step-up enforcement for sensitive keys and audit rows for grants/role changes arrive with 2.6 and 2.5; the guard currently reads the staff actor from the request context, which authentication (2.6) will fill.
- Staff tables have no row-level security (staff are global, D2-06); access is controlled by permissions and scope in the services.

## 2026-11-25 — Phase 2, step 2.3 (tenant resolution)

### Added
- `GET /api/v1/storefront/context`: public brand config (brand, current market, ACTIVE markets, currencies, languages, theme key, alias redirect target) resolved from the request host only; unknown hosts and inactive brands return 404 `TENANT_NOT_FOUND`; responses are `no-store`.
- `TenantResolver` (in-process cache: 60 s hits, 10 s misses; `invalidateHost/Brand/All` to be called by domain management in step 2.7), `TenantGuard`, trusted-host handling (`X-Forwarded-Host` honoured only with `X-Matilda-Proxy-Secret` = `TRUSTED_PROXY_SECRET`), per-brand CORS from `brand_domain`, shared `StorefrontContext` types.

### Notes
- The cache is per API instance; a shared (Redis) cache or pub/sub invalidation is needed before running several instances.
- Local testing: `*.localhost` hosts resolve to loopback, e.g. `curl http://flower.localhost:4000/api/v1/storefront/context` after `db:seed dev`.

## 2026-11-25 — Phase 2, step 2.2 (tenancy schema)

### Added
- Prisma models and first migration `tenancy`: currency, language, country, brand, market, market_currency, market_language, brand_domain, branch, branch_market; check constraints, partial unique indexes, immutable brand slug, composite foreign keys (domain→market same brand, branch↔market same country).
- Row-level security (FORCE) on all tenancy tables, `app_brand_ids()`/`app_is_platform()`, SECURITY DEFINER `resolve_brand_domain(host)`; reference data read-only for `matilda_app`.
- `withScope()` scoped data-access helper; seed CLI (`pnpm --filter @matilda/api db:seed [reference|bootstrap|dev]`); `db:deploy`; tenancy integration tests (29 DB tests in total) with migrations applied by Jest global setup.

### Notes
- Deviations from the approved draft are listed at the top of PHASE-2-SCHEMA-DRAFT.md.

## 2026-11-25 — Phase 2, step 2.1 (foundations)

### Added
- Owner-approved Phase 2 plan (`docs/PHASE-2-PLAN.md`) and decisions D2-01 to D2-20 recorded in DECISIONS.md.
- Local PostgreSQL least-privilege roles (`matilda_owner`, `matilda_app`) and `matilda_test` database via `infrastructure/postgres/bootstrap.{sql,mjs}`; `pnpm db:bootstrap`, `pnpm test:int`, `pnpm check:full`.
- API: request context (`nestjs-cls`), `EncryptionService` (AES-256-GCM, key ring), token/cookie/CSRF utilities, `MailPort` + console adapter, UUIDv7 helper, permission-key type; env additions (`MIGRATION_DATABASE_URL`, `TEST_*`, `APP_ENCRYPTION_KEYS`, `APP_ENCRYPTION_ACTIVE_KEY`, `TRUSTED_PROXY_SECRET`).
- DB integration tests (role privileges; RLS spike with Prisma 7: GO).
- `docs/PHASE-2-SCHEMA-DRAFT.md`: tenancy DDL draft awaiting owner review.

### Changed
- The API now connects as `matilda_app` (no DDL, no RLS bypass); Prisma CLI uses `MIGRATION_DATABASE_URL`. Developers must re-run `pnpm docker:up` (or `pnpm db:bootstrap`) and refresh `apps/api/.env` from `.env.example`.

## 2026-11-25 — Phase 1: Project Foundation

### Added
- pnpm monorepo, Git repo (uncommitted), shared TypeScript presets, ESLint 9 + Prettier, root scripts (`pnpm check`).
- `apps/api` (NestJS 11): versioned `/api/v1`, health and readiness endpoints, Swagger at `/api/docs`, Zod-validated env, Pino logging with request ids, standard error filter, Zod validation pipe, Helmet, CORS allow-list, lazy Prisma service.
- Prisma 7 configuration (no models, no migrations).
- `apps/storefront` (3000) and `apps/admin` (3001): Next.js 16 + Tailwind 4 status pages calling the API.
- Packages: `@matilda/config`, `types`, `validation`, `api-client`, `ui` (empty), `commerce` (empty).
- `.env.example` files, `docker-compose.yml` (local Postgres, optional Redis), root `README.md`.
- Initial tests (API unit + HTTP, packages, frontends).

### Docker database (later same day)
- Docker PostgreSQL 17 with persistent named volume on host port 5434 (5433 was occupied by a native PostgreSQL 18), root `.env.example`, `pnpm docker:up|down|logs|redis:up` scripts, `DATABASE_URL` configured; Prisma connectivity and volume persistence verified; readiness returns 200.

### Decisions
- D-014 to D-020 recorded in DECISIONS.md (NestJS 11, Prisma 7.10.1, TypeScript 5.9, compiled shared packages, API conventions, test tooling, local DB).

### Notes
- Database connectivity not verified (see PROGRESS.md). Existing websites were not touched.

## 2026-11-25 — Phase 0 documentation

### Added
- `CLAUDE.md` project entry point.
- Complete documentation set in `docs/` (32 files): README, PROJECT-OVERVIEW, REQUIREMENTS, TECH-STACK, ARCHITECTURE, FOLDER-STRUCTURE, DATABASE, API, MULTI-STORE, ROLES-AND-PERMISSIONS, CUSTOMER-AUTH, PRODUCT-ENGINE, INVENTORY, CART-AND-CHECKOUT, PAYMENTS, DELIVERY, ORDER-MANAGEMENT, MULTILINGUAL, ADMIN-PANEL, SEO, CMS-AND-MARKETING, NOTIFICATIONS, DESIGN-SYSTEM, SECURITY, PERFORMANCE, TESTING, DEPLOYMENT, FEATURE-PARITY, ROADMAP, PROGRESS, DECISIONS, CHANGELOG.

### Cake audit (later same day)
- Added "Observed on the Cake site" section and design findings to FEATURE-PARITY.md from a public read-only audit; updated PROGRESS.md.

### Changed
- Brand name corrected to "Matilda Flower" (singular) everywhere (DECISIONS D-013).
- Domains corrected per owner: Matilda Flower → `matildaflower.com`; Cookies by Matilda → `cookiesbymatilda.com` (see DECISIONS D-002).

### Notes
- No application code, dependencies, schema, migrations, or infrastructure were created. Existing websites were not modified.
