# Testing and Quality Assurance

A feature is **not complete merely because its interface exists**. Before launching any storefront, verify the complete journey from product selection through successful delivery or cancellation.

## Tools [Approved]

Jest (unit/integration), Playwright (E2E), Swagger/OpenAPI contract checks, accessibility tooling (axe), Lighthouse CI.

## Test categories [Approved]

| Category | Focus |
|---|---|
| Unit | Pricing, promotions, state machines, validators, money rounding |
| Integration / API | Module behavior with real PostgreSQL/Redis (containers) |
| End-to-end | Browse → cart → checkout → payment → tracking; admin order flow |
| Authentication | Login, 2FA, sessions, revocation, password reset, brute force |
| Authorization | Permission × scope matrix; role-name independence; IDOR attempts |
| **Cross-brand isolation** | Every endpoint/query cannot read/write another brand's data |
| **Cross-market isolation** | Same for markets; per-market prices/payments |
| Product variations | Combinations, SKU/stock per variation, conditional options |
| **Inventory concurrency** | Parallel purchases of last unit, reservation expiry, transfers |
| Coupons/promotions | Stacking, limits, schedules, gifts |
| Cart / Checkout | Merge, recalculation, tampered prices, expired reservations |
| **Payment verification** | Forged callbacks, amount mismatch, replay |
| **Duplicate payment** | Double submit, repeated callbacks, idempotency |
| Refunds | Partial/full, original merchant config |
| Delivery restrictions | Product/category/location rules, cutoffs, holidays |
| Delivery capacity | Slot and branch capacity races |
| Arabic and RTL | Layout, typography, mixed text, formats |
| SEO | Metadata, canonical, hreflang, sitemaps, schema validation, redirects |
| Accessibility | WCAG 2.2 AA automated + manual keyboard/screen reader checks |
| Responsive | Mobile-first breakpoints, real-device checks |
| Performance | Web Vitals budgets, load/spike tests |
| Security | Dependency audit, SAST, header checks, upload abuse, pen-test before launch |
| Backup restoration | Scheduled restore drills to a clean environment |

## Process [Proposed]

- CI (GitHub Actions) runs lint, type-check, unit/integration, and E2E smoke on every PR; nightly full E2E and a11y.
- Test data from seeded fixtures (clearly marked as test) — no fake business data in production.
- Payment testing in CCAvenue test/sandbox where available; staging uses separate merchant credentials ([PAYMENTS](PAYMENTS.md)).
- Pre-launch checklist per storefront; manual exploratory pass on devices; UAT with real staff roles (coordinator, production, rider).
- Regression suite for Matilda Cake parity items ([FEATURE-PARITY](FEATURE-PARITY.md)).

## Current structure (Phase 1)

- API unit tests: `apps/api/src/**/*.spec.ts` (`pnpm --filter @matilda/api test:unit`).
- API HTTP tests: `apps/api/src/**/*.e2e-spec.ts` using the real Nest app and supertest, no database needed (`test:e2e`).
- API DB integration tests: `apps/api/src/**/*.int-spec.ts` against the `matilda_test` database as the real runtime role (`pnpm test:int`; needs `pnpm docker:up`). Migrations are applied to the test database automatically (Jest global setup). Not part of `pnpm test`/`pnpm check`; use `pnpm check:full`.
- Packages/frontends: `node:test` files (`*.test.ts`).
- Run everything: `pnpm test`; full gate: `pnpm check`.
- Staff authentication (step 2.6) is covered by `staff-auth.int-spec.ts` (HTTP stack + database: full invite → password → 2FA flow, lockout, replay, recovery codes, expiry, revocation, CSRF/origin, reset/invite tokens, CLI), unit specs for password policy, Argon2 parameters and TOTP, guard HTTP tests (pending session, CSRF, step-up) and `no-default-credentials.spec.ts` (repository scan).
- Admin management APIs (step 2.7) are covered by `admin.int-spec.ts`: every route returns 401 without a session and 403 without the permission, plus scope matrices (own brand, other brand, shared branch, market-restricted grants), step-up, audit rows, escalation and last-Super-Admin cases, Swagger tag coverage and the `X-Admin-Brand` header.
- Customer authentication (step 2.8) is covered by `customer-auth.int-spec.ts`: per-brand accounts and cross-brand login/cookie/token denial, enumeration-safe registration and reset, token single-use and expiry, lockout per brand, CSRF/same-brand Origin, password change/deletion, audit content, row-level security and composite-key checks at the database, and the admin read-only view.
- Admin app (step 2.9): `node --test` unit tests for the HTTP client (CSRF fetch/refresh/retry, step-up retry, 401 handling), safe post-login redirects and the permission-filtered navigation model; the new CSRF route is in `staff-auth.int-spec.ts`. Screens were verified in a real browser (sign-in to 2FA to shell, step-up dialog, session expiry, mobile drawer) and with axe-core (WCAG 2.2 AA plus best practice, zero violations on sign-in, forgot password, home and security). 
- Hardening (step 2.11): `node apps/api/scripts/load-smoke.mjs` (local only) checks latency and fail-closed behaviour of unauthenticated, wrong-credential and forged-header requests; `pnpm audit --prod` is part of the manual checklist; clean-database migrate and seed verification is done on a scratch database (see PROGRESS).
- Catalog foundations (step 3.1): `packages/validation/src/catalog.test.ts` (slugs including Arabic, SKUs, integer money formatting and parsing, market price rules, variation generation and its limit) and `apps/api/src/modules/catalog/testing/fixtures.spec.ts` (the two modelled products produce valid unique SKUs and prices; options never overlap variation attributes).
- Catalog schema (step 3.2): `catalog-schema.int-spec.ts` checks that all 40 tables have `brand_id`, forced RLS and one scope policy, that every foreign key is indexed, that the runtime role cannot truncate, a per-table isolation matrix (own rows only, no context sees nothing, platform sees all), cross-brand inserts, updates and deletes, composite keys rejecting cross-brand links, and each check constraint and trigger with a passing and a failing case.
- Catalog taxonomy and attributes (step 3.3): `taxonomy.int-spec.ts` drives the real HTTP API with seeded staff sessions: 401 without a session, 403 for viewers, users without a role and managers of another brand, 404 for another brand's records, no writes with a market-scoped grant, English-required and slug rules, redirect history, category tree limits and cycles, delete blocks, attribute key and colour rules, usage blocks and audit rows. `slugify` is covered in `catalog.test.ts`.
- Catalog products (step 3.4): `products.int-spec.ts` over the real HTTP API: permission per action (viewer, no role, other brand, market-scoped grant, scheduling needs publish rights), generated slugs, SKU and slug uniqueness, translation and slug history, operational field and type rules, taxonomy and availability replacement with cross-brand rejection, publish prerequisites, derived scheduled and expired visibility, soft delete, bundle component protection and audit rows.
- Catalog variations (step 3.5): `variations.int-spec.ts` over the real HTTP API: permissions and brand isolation, attribute rules (variable only, foreign attribute and value rejected), generation of a flavour x size set with SKUs, repeat safety, only-missing generation, the 100 limit, full rollback on a SKU clash, manual create, bulk edit and SKU swap, atomic failure, protection of in-use attributes and values, soft delete with SKU and combination reuse, bundle component protection, and the publish rule for variable products.
- Catalog pricing (step 3.6): `pricing.int-spec.ts` over the real HTTP API: permission (`pricing.edit` versus edit and view), brand isolation, minor-unit validation (floats, negatives, sale rules, dates), currency and market checks, duplicates, per-variation versus per-product pricing, bundles, cleanup when a variation is deleted or a product becomes variable, and the preview before, during and after a sale. `effectivePrice` is unit-tested in `catalog.test.ts`; the publish tests now require prices.
- Catalog options (step 3.7): `options.int-spec.ts` over the real HTTP API: permissions (view, edit, edit-with-pricing), brand isolation, the cake example (message, colour shown only with a message, reference image, candles), stable ids on re-save, cleanup of removed options with their rules and prices, per-type shape rules, selection limits, rule validation including loops, price validation (floats, negatives, wrong target, currency, market, duplicates), and that options never create SKUs or variations.
- Catalog hardening (step 3.12): `catalog-hardening.int-spec.ts` inspects the live route table (every admin catalog route needs a permission, only explicit GETs are public) and drives every admin route as nobody, as a role-less user and as a manager of another brand; `catalog-performance.int-spec.ts` bulk-inserts 5,000 products and asserts generous time ceilings on admin and public lists (`PERF_LOG=1` prints timings).
- Background jobs (step 4.1): `jobs.int-spec.ts` runs a delayed BullMQ job against a real Redis (`pnpm docker:redis:up`; `TEST_REDIS_URL` overrides, default database 15) and checks that a repeated job id runs once. Delivery fixtures (`modules/delivery/testing`) are test-only data and are validated by `fixtures.spec.ts`.
- Public catalog (step 3.10): `public-catalog.int-spec.ts` over the real HTTP API with `Host` headers: only published, in-window, in-market products; unknown hosts; no mixing of brands and no effect from client-sent brand or market ids; brand-wide domains needing a valid market; languages with English fallback and slugs per language; sale windows; category (with sub-categories), collection, tag and search filters, sorting and paging; product detail with gallery, options, add-ons (unpriced ones left out), variations and bundle components; no internal fields. `public-catalog.cache.spec.ts` covers the cache key (brand, market, language) and expiry.
- Catalog media (step 3.9): `media.int-spec.ts` over the real HTTP API with generated pictures and a temporary storage folder: variants and no enlargement, JPEG/PNG/WebP, metadata removal, rejection of text, fake PNG and SVG files, the size limit, duplicates per brand, permissions (including market-scoped and other-brand staff), brand isolation, alt text rules, gallery order and main picture, variation images, deletion protection and file cleanup, and public delivery headers (originals and other brands' pictures are not served).
- Catalog add-ons and bundles (step 3.8): `addons.int-spec.ts` over the real HTTP API: permissions (view, edit, edit-with-pricing), brand isolation, the cake add-ons (required box, optional balloons, a product add-on), stable ids and cleanup on re-save, variable add-on products needing a variation, rejected references (self, bundle, unknown, other brand), group and item shape and price validation, deletion protection for add-on and component products and variations, bundle component rules (no nesting, variation required, no duplicates), and the component requirement to publish a bundle.
- Admin E2E (step 2.10): Playwright specs in `apps/admin/e2e` (`pnpm --filter @matilda/admin test:e2e`). `launch-api.mjs` migrates and seeds the TEST database, starts the built API on port 4100 and records mail (invite links) the way a mailbox would; the admin runs on 3101 with its own build folder, so `pnpm dev` can stay up. Requires `pnpm --filter @matilda/api build` first and a running Docker database. Fixtures (Super Admin, Branch Manager, Catalog Manager, a sign-in user) are created through the real invite and 2FA flow. Browser: Microsoft Edge (`PLAYWRIGHT_CHANNEL` overrides). Not part of `pnpm check` yet. Step 3.11 adds `catalog.e2e.ts` (catalog screens, brand lock, cross-brand 403, menu by permission); 14 specs in total.
- Not yet present: accessibility and performance suites, isolation/concurrency suites (arrive with their features).

## Definition of done

Code + tests + docs updated + `PROGRESS.md`/`CHANGELOG.md` + security and isolation review for anything touching tenant data + accessibility/RTL check for UI.
