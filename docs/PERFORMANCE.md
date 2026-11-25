# Performance and Scalability

Performance is designed in from the start, without unnecessary infrastructure complexity.

## Targets [Approved — to be measured, not guaranteed]

| Metric | Target |
|---|---|
| LCP | ≤ 2.5 s |
| INP | ≤ 200 ms |
| CLS | ≤ 0.1 |

Measured with field data (RUM / Search Console CrUX) and lab tests (Lighthouse CI, Playwright traces) on mid-range mobile over UAE networks — [TESTING](TESTING.md).

## Strategies [Approved]

Next.js server rendering; static generation where suitable; incremental regeneration; store-aware caching; Redis caching with explicit invalidation; TanStack Query client caching; optimized DB indexes and efficient queries (no SELECT *, no N+1); pagination; lazy loading; responsive images in WebP/AVIF; CDN delivery (Cloudflare); code splitting; bundle-size budgets; background processing (BullMQ); connection pooling; readiness for high-traffic campaigns and seasonal spikes (Valentine's Day, Mother's Day, Eid, Ramadan, etc.).

## Caching rules [Approved]

- Cache keys always include **brand, market, language** (and currency/other pricing context where relevant).
- **Never cache private customer information across sessions** (no shared caching of personalized/authenticated responses).
- Cart, checkout, pricing quotes, inventory availability and payment operations use authoritative, fresh data — not stale caches.
- Catalog/CMS content may be cached with tag-based invalidation on publish/price change; availability shown on listings may be approximate but is re-validated at cart/checkout.

## Database [Proposed]

Index plan reviewed with schema design; query budgets per endpoint; slow-query logging; pooled connections (PgBouncer or Prisma pooling); read replicas only if measured need.

## Scalability path [Proposed]

Shared infrastructure first → scale API/storefront containers horizontally → isolate workers → separate storefronts per brand → regional databases if needed. Load tests for campaign peaks before launch ([TESTING](TESTING.md), [DEPLOYMENT](DEPLOYMENT.md)).

## Open

Peak traffic assumptions (orders/hour on peak days) — needed from the business to size infrastructure.
