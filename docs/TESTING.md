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
- Packages/frontends: `node:test` files (`*.test.ts`).
- Run everything: `pnpm test`; full gate: `pnpm check`.
- Not yet present: database-backed integration tests (needs a test database strategy), Playwright E2E, accessibility and performance suites, isolation/concurrency suites (arrive with their features).

## Definition of done

Code + tests + docs updated + `PROGRESS.md`/`CHANGELOG.md` + security and isolation review for anything touching tenant data + accessibility/RTL check for UI.
