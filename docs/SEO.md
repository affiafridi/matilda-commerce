# SEO

SEO is a **first-class feature**: a dedicated SEO Manager comparable to the relevant functionality of Rank Math and Yoast, configurable per brand, market and language where appropriate.

## Capabilities [Approved]

- Meta titles/descriptions for products, categories, pages, blogs; customizable URL slugs; title/description templates with variables.
- Canonical URLs; index/noindex; nofollow where appropriate.
- Automatic XML sitemaps and sitemap indexes (per brand/market/language); robots.txt management.
- 301/302 redirect manager; 404 monitoring; broken-link monitoring; internal linking tools.
- Structured data: Product, **ProductGroup and variants**, Breadcrumb, Organization, LocalBusiness where applicable.
- Open Graph and social images; image alt text.
- **hreflang** across languages/markets.
- Google Merchant Center product feeds.
- Google Search Console, Google Analytics 4, Google Tag Manager, Meta Pixel, Meta Conversions API (server-side events with consent handling).
- SEO content analysis and metadata validation (length, duplicates, missing alt/meta, etc.).

## Technical rules [Proposed]

- Server-rendered/static (ISR) pages with correct metadata via Next.js metadata API; no client-only SEO.
- Canonical + hreflang strategy prevents duplicate content across markets/languages ([MULTILINGUAL](MULTILINGUAL.md)).
- Redirects resolved by brand+path; slug changes auto-create redirects.
- Sitemap generation as background jobs with cache invalidation on publish.
- Consent-aware tracking (banner and tag gating) — legal requirements per market **[Open]**.
- Permissions: `seo.view`, `seo.edit`, `seo.publish` ([ROLES-AND-PERMISSIONS](ROLES-AND-PERMISSIONS.md)).

## Migration risk [Approved concern]

Existing **Matilda Cake** URLs, metadata, backlinks and rankings must be preserved. Required before Phase 11 migration: crawl and export all URLs, titles, meta, canonicals, schema, redirects, sitemap, Search Console data and top-linked pages; build a 1:1 redirect map; staged cutover with monitoring. Same approach for the Flowers site (currently WordPress-style paths such as `/product/...` observed) and Cookies site. The new platform's URL scheme must accommodate legacy slugs — **[Open]**, see [DECISIONS](DECISIONS.md).

## Open

Slug uniqueness scope (brand+market+language); blog scope per market; feed attribute completeness for flowers/cakes (e.g., perishable, delivery limits); schema for delivery-area-restricted offers.
