# Roadmap

All application development phases are **pending**. Do not proceed from one phase to another without owner approval.

| Phase | Name | Status |
|---|---|---|
| 0 | Planning and Documentation | **Complete** |
| 1 | Project Foundation | **Complete** (2026-11-25; awaiting owner approval to start Phase 2; DB connectivity unverified) |
| 2 | Multi-Store and Access Foundation | **Complete and approved by the owner** (2026-11-25); Phase 3 not started and needs explicit approval |
| 3 | Product and Catalog Engine | Pending |
| 4 | Inventory and Delivery Foundation | Pending |
| 5 | E-commerce and Checkout | Pending |
| 6 | Order and Production Management | Pending |
| 7 | CMS, SEO and Marketing | Pending |
| 8 | Matilda Flower Storefront | Pending |
| 9 | Finance and Operational Reporting | Pending |
| 10 | Testing and Matilda Flower Launch | Pending |
| 11 | Matilda Cake and Cookies Expansion | Pending |
| 12 | Future Expansion | Pending |

## Phase scopes [Approved]

- **0:** understand requirements; project docs; record decisions; identify unresolved requirements; Cake parity checklist; engineering and UI/UX standards.
- **1:** initialize monorepo; configure Next.js and NestJS; TypeScript; PostgreSQL + Prisma; shared packages; environment configs; API conventions.
- **2:** brands, domains, markets, branches; staff and customer auth; roles, permissions; store-level isolation; admin layout.
- **3:** products, categories, attributes, variations, customization, add-ons, bundles, translations, media, market pricing.
- **4:** branch inventory, reservations, delivery zones/slots, prep times, restrictions, branch assignment.
- **5:** cart, promotions, coupons, guest/customer checkout, payment integrations, order creation, payment verification.
- **6:** order management, manual orders, production workflows, customers, delivery management, invoices, refunds, notifications.
- **7:** CMS pages, homepage, banners, blogs, SEO Manager, analytics integrations, product feeds, marketing.
- **8:** branding review, design system, homepage, shop, categories, product pages, search, cart, checkout, account, EN/AR, mobile.
- **9:** transactions, reconciliation, financial reports, operational dashboards, advanced analytics, exports.
- **10:** functional, security, performance, SEO, accessibility testing; staging; payment testing; backup verification; production deployment.
- **11:** audit existing sites; verify parity; brand-specific requirements; independent themes; migrate products/variations/customers/orders as appropriate; independent payment accounts; preserve SEO; test and launch.
- **12:** additional brands; international markets; mobile apps; automation; AI capabilities; advanced loyalty; integrations.

## Sequencing notes [Proposed — for owner review]

1. **Phase 8 (storefront design) depends on brand assets**; request assets and a design direction during Phases 1–3 so design is not blocked.
2. **Phase 10 payment work needs CCAvenue account/domain confirmation** early; lead time can be long.
3. Customization-heavy Cake requirements must be exercised against the engine by Phase 3 (test products modeled from the Cake audit) even though Cake launches in Phase 11 — pull a *read-only Cake audit* forward to Phase 0/1 if possible.
4. SEO foundations (slug/URL strategy, hreflang) must be decided before Phase 3 data modeling.
5. Not every admin module ships in the first release; Finance reports, Loyalty, Gift cards, Expenses, Backup management are candidates for post-launch.

See [PROGRESS.md](PROGRESS.md) and [DECISIONS.md](DECISIONS.md).
