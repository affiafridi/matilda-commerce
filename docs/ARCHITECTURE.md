# Architecture

## Style [Approved]

Modular monolith inside a pnpm monorepo. One repository, one shared storefront codebase with independent brand themes, one admin app, one NestJS backend, one PostgreSQL database per environment. No microservices. Storefronts or services must be separable later if business needs require it.

## System context

```text
 Browser (customer) ──> Storefront (Next.js, brand-themed) ──┐
 Browser (staff)    ──> Admin (Next.js)                      ├──> API (NestJS) ──> PostgreSQL
 Rider/Production UI ─> Admin (focused views)                │         │──> Redis (cache, rate limit, queues)
 CCAvenue / WhatsApp / Google / Meta ──webhooks/callbacks───┘         │──> BullMQ workers (jobs)
                                                                       └──> Cloudflare R2 (media)
```

- **Only the API talks to the database.** Storefront and admin use secured HTTP APIs ([API.md](API.md)). [Approved]
- Frontends may share UI/hooks/utilities via packages; **authoritative pricing, inventory, payment and order logic stays in the backend**. [Approved]

## Backend modules [Proposed]

Bounded modules inside `apps/api/src/modules/`, each with its own service layer and no cross-module table access except through module interfaces:

`tenancy` (brands, domains, markets, branches) · `iam` (staff, roles, permissions, sessions) · `customers` · `catalog` · `pricing` · `inventory` · `cart` · `promotions` · `checkout` · `orders` · `payments` · `delivery` · `production` · `media` · `cms` · `seo` · `notifications` · `loyalty` (later) · `reports` · `audit` · `integrations` · `webhooks`.

Business logic lives in services, not controllers. Controllers validate, authorize, delegate.

## Tenant context [Approved + Proposed mechanics]

1. Request arrives with a host/domain. A trusted domain→brand config resolves the **brand** server-side; market is resolved from path/config/account context; branch from assignment logic.
2. A request-scoped tenant context (brand, market, optional branch, actor) is created and passed to every service/repository call.
3. Client-submitted brand/market/branch IDs are never trusted; for staff, requested scope is checked against role assignments.
4. Database-level defense in depth (e.g., PostgreSQL row-level security and/or mandatory scoped repositories) is **[Open]**, to be decided in the schema design review ([DATABASE.md](DATABASE.md)).

## Cross-cutting

- **AuthN/Z:** separate staff and customer auth realms; permission guards on every protected endpoint ([ROLES-AND-PERMISSIONS](ROLES-AND-PERMISSIONS.md), [SECURITY](SECURITY.md)).
- **Transactions:** orders, payments, stock, reservations, refunds, coupon redemption.
- **Async work:** BullMQ for notifications, feed generation, abandoned-cart jobs, reservation expiry, reconciliation, scheduled publishing.
- **Caching:** Redis + Next.js caching with keys including brand, market, language; no private data shared ([PERFORMANCE](PERFORMANCE.md)).
- **Observability:** Pino structured logs (no secrets/PII), Sentry, health checks.
- **Idempotency:** keys for checkout, payment initiation/callbacks, refunds.
- **Audit:** append-only audit log for sensitive actions.

## Frontend architecture [Approved + Proposed]

- Storefront: one codebase; brand determined by domain; theme in `themes/{flowers,cakes,cookies}` supplying tokens, layouts and section components. Shared commerce hooks/components contain no brand business rules ([DESIGN-SYSTEM](DESIGN-SYSTEM.md)).
- Admin: separate app with permission-driven navigation and brand/market/branch switcher ([ADMIN-PANEL](ADMIN-PANEL.md)).

## Scalability strategy

Start on shared infrastructure; scale horizontally by running more API/storefront containers behind Nginx; Redis for hot reads; read replicas and regional databases are future options (data residency) **[Open]**. Separation points: storefront per brand, API workers, payments module.

## Key risks

Tenant leakage, oversell under concurrency, payment double-processing, SEO regression on migration, scope creep from parity ambition. Mitigations in [SECURITY](SECURITY.md), [INVENTORY](INVENTORY.md), [PAYMENTS](PAYMENTS.md), [SEO](SEO.md), [ROADMAP](ROADMAP.md).
