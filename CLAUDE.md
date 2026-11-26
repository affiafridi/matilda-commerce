# CLAUDE.md — Matilda Commerce

Permanent entry point for all work on this repository. Read this first, then the relevant file in `docs/` before touching any feature.

## Current status

**Phase 1 and Phase 2 (Multi-Store and Access Foundation) are complete and approved by the owner (Phase 2 on 2026-11-25). Phase 3 (Product and Catalog Engine) is in progress per the approved [docs/PHASE-3-PLAN.md](docs/PHASE-3-PLAN.md): steps 3.1 (foundations) and 3.2 (catalog schema, [docs/PHASE-3-SCHEMA-DRAFT.md](docs/PHASE-3-SCHEMA-DRAFT.md), approved) are done, 3.3 (taxonomy and attributes API) is approved, 3.4 (products API) is approved, 3.5 (variations API) is approved, 3.6 (market pricing and price preview API) is approved, 3.7 (customization options API) is approved, and step 3.8 (add-ons and bundles API) is approved, and step 3.9 (media: storage adapter, upload validation, library, gallery and variation images) is done and awaits the owner's review before step 3.10 (public catalog read API).** Phase 2 summary per [docs/PHASE-2-PLAN.md](docs/PHASE-2-PLAN.md): steps 2.1 to 2.11 are done (customer authentication in 2.8; tenancy schema per [docs/PHASE-2-SCHEMA-DRAFT.md](docs/PHASE-2-SCHEMA-DRAFT.md); staff authentication in 2.6, which the owner approved; admin management APIs in 2.7); admin design approved (D2-21), the admin shell and sign-in screens built in 2.9 (approved), and the switchers, management screens and Playwright E2E built in 2.10 (approved), and hardening and verification in 2.11, all approved. Do not skip review gates in later phases (Phase 3 step 3.2 stops for the schema review), and do not start Phase 3 or move between phases without explicit owner approval. No business modules, products, orders, checkout, payments or storefront designs exist. See [docs/PROGRESS.md](docs/PROGRESS.md), [docs/ROADMAP.md](docs/ROADMAP.md) and the run commands in [README.md](README.md) (`pnpm install`, `pnpm dev`, `pnpm check`; ports: storefront 3000, admin 3001, API 4000, Docker PostgreSQL 5434 (5432/5433 are used by native installs), Redis 6379; start/stop the database with `pnpm docker:up` / `pnpm docker:down`).

## What this is

A fully custom, multi-brand, multi-market, multi-branch commerce platform ("Matilda Commerce").
Brands: **Matilda Flower** (http://matildaflower.com, first launch), **Matilda Cake** (https://matildacake.com), **Cookies by Matilda** (https://cookiesbymatilda.com).
The engine must never be flower-specific: Matilda Cake's complexity (variations, customization, add-ons, delivery restrictions, promotions) shapes the core. First active market: UAE only. See [docs/PROJECT-OVERVIEW.md](docs/PROJECT-OVERVIEW.md).

## Approved architecture (summary)

- Modular monolith in a pnpm monorepo, one GitHub repo. No microservices.
- `apps/storefront` (Next.js App Router, one codebase, per-brand themes), `apps/admin` (Next.js), `apps/api` (NestJS, REST). Shared `packages/*`.
- Only the API talks to PostgreSQL (Prisma). Storefront/admin use secured APIs.
- Hierarchy: **Brand → Market/Country → Branch**. Brand is resolved server-side from trusted domain config; never trust a client-sent store ID.
- Authoritative pricing, inventory, payment and order logic lives in the backend only.
- Not allowed: WooCommerce, Shopify, Medusa, or any e-commerce framework as the new backend.
- Stack and introduction timing: [docs/TECH-STACK.md](docs/TECH-STACK.md). Add dependencies only when a feature needs them; no unapproved technologies.

Details: [ARCHITECTURE](docs/ARCHITECTURE.md) · [FOLDER-STRUCTURE](docs/FOLDER-STRUCTURE.md) · [DATABASE](docs/DATABASE.md) · [API](docs/API.md) · [MULTI-STORE](docs/MULTI-STORE.md)

## Non-negotiable engineering rules

1. Strict TypeScript. Clean, modular, reusable code; no needless abstractions or duplication.
2. Every protected API independently verifies permission **and** data scope (brand/market/branch). Frontend hiding is not security. Never hardcode authorization on role names; use permissions.
3. Staff and customer auth are logically separate.
4. Money: no floating point (integer minor units or Decimal). Prices, discounts, stock and delivery rules are recalculated by the backend; never trust client prices or payment-success claims.
5. Inventory changes are transactional and concurrency-safe. Orders keep historical snapshots.
6. Controlled state machines for order/payment/fulfillment status.
7. Business rules (delivery, cutoffs, restrictions, branches, prices) are configurable in admin, never hardcoded to a brand/branch/category.
8. Payment secrets encrypted, never in frontend/logs/Git. Never store raw card data. Refunds use the original transaction's merchant config.
9. Cache keys always include brand, market, language; never cache private customer data across sessions.
10. No fake/mock business data as production functionality. No secrets committed.
11. Consider the impact on every brand, market and branch before changing anything. Do not modify unrelated functionality or remove features without authorization.
12. Do not change architectural decisions without discussing with the owner; record decisions in [DECISIONS](docs/DECISIONS.md).

## UI/UX standards

Premium, editorial, restrained; never generic AI/SaaS styling (no excess gradients, glassmorphism, glow, pills, card-in-card, emoji icons, default component-library look). Admin = enterprise commerce tool (Shopify-Admin-like usability; tables/forms/drawers over oversized cards). WCAG 2.2 AA, mobile-first, full RTL, reduced motion. Do not invent brand colors/logos — ask the owner for assets. Full rules: [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md).

## Workflow (once development is authorized)

- Read this file and the relevant docs before implementing.
- Understand existing code before modifying it.
- Add/maintain automated tests ([TESTING](docs/TESTING.md)).
- Update docs when behavior changes; update `PROGRESS.md` after each task, `DECISIONS.md` for architectural decisions, `CHANGELOG.md`, and keep `ROADMAP.md` current.
- Report incomplete work and known issues accurately. A UI existing is not "done".

## Documentation map

| Area | File |
|---|---|
| Index | [docs/README.md](docs/README.md) |
| Business | [PROJECT-OVERVIEW](docs/PROJECT-OVERVIEW.md), [REQUIREMENTS](docs/REQUIREMENTS.md), [FEATURE-PARITY](docs/FEATURE-PARITY.md) |
| Technical | [TECH-STACK](docs/TECH-STACK.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [FOLDER-STRUCTURE](docs/FOLDER-STRUCTURE.md), [DATABASE](docs/DATABASE.md), [API](docs/API.md) |
| Domain | [MULTI-STORE](docs/MULTI-STORE.md), [ROLES-AND-PERMISSIONS](docs/ROLES-AND-PERMISSIONS.md), [CUSTOMER-AUTH](docs/CUSTOMER-AUTH.md), [PRODUCT-ENGINE](docs/PRODUCT-ENGINE.md), [INVENTORY](docs/INVENTORY.md), [CART-AND-CHECKOUT](docs/CART-AND-CHECKOUT.md), [PAYMENTS](docs/PAYMENTS.md), [DELIVERY](docs/DELIVERY.md), [ORDER-MANAGEMENT](docs/ORDER-MANAGEMENT.md) |
| Experience | [MULTILINGUAL](docs/MULTILINGUAL.md), [ADMIN-PANEL](docs/ADMIN-PANEL.md), [SEO](docs/SEO.md), [CMS-AND-MARKETING](docs/CMS-AND-MARKETING.md), [NOTIFICATIONS](docs/NOTIFICATIONS.md), [DESIGN-SYSTEM](docs/DESIGN-SYSTEM.md) |
| Quality/Ops | [SECURITY](docs/SECURITY.md), [PERFORMANCE](docs/PERFORMANCE.md), [TESTING](docs/TESTING.md), [DEPLOYMENT](docs/DEPLOYMENT.md) |
| Project mgmt | [ROADMAP](docs/ROADMAP.md), [PROGRESS](docs/PROGRESS.md), [DECISIONS](docs/DECISIONS.md), [CHANGELOG](docs/CHANGELOG.md) |

## Conventions for docs

Each requirement is labeled **[Approved]** (owner's master prompt), **[Proposed]** (suggested implementation, needs review), **[Open]** (unresolved question) or **[Assumption]**. Existing-site features are **Confirmed**, **Proposed** or **Requires verification**.
