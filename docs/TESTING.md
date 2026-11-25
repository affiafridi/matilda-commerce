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
- Admin E2E (step 2.10): Playwright specs in `apps/admin/e2e` (`pnpm --filter @matilda/admin test:e2e`). `launch-api.mjs` migrates and seeds the TEST database, starts the built API on port 4100 and records mail (invite links) the way a mailbox would; the admin runs on 3101 with its own build folder, so `pnpm dev` can stay up. Requires `pnpm --filter @matilda/api build` first and a running Docker database. Fixtures (Super Admin, Branch Manager, Catalog Manager, a sign-in user) are created through the real invite and 2FA flow. Browser: Microsoft Edge (`PLAYWRIGHT_CHANNEL` overrides). Not part of `pnpm check` yet.
- Not yet present: accessibility and performance suites, isolation/concurrency suites (arrive with their features).

## Definition of done

Code + tests + docs updated + `PROGRESS.md`/`CHANGELOG.md` + security and isolation review for anything touching tenant data + accessibility/RTL check for UI.
