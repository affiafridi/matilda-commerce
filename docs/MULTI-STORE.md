# Multi-Store: Brand → Market → Branch

## Hierarchy [Approved]

```text
Brand (e.g., Matilda Flower)
 └─ Market/Country (e.g., UAE)
     └─ Branch (physical location; may serve several brands)
```

## Brand

Independent per brand: domains; branding/visual identity; layouts; products & categories; product configurations; customers; carts; orders; coupons & promotions; payment gateway configurations; email/WhatsApp templates; SEO; analytics integrations; CMS content; business settings; enabled features.

Brand resolution: trusted domain-to-brand table in the backend. Never trust a store ID from the client. Strict data isolation enforced in the API and database ([DATABASE](DATABASE.md)). Customers are brand-specific by default; shared identity across brands only if explicitly approved later ([CUSTOMER-AUTH](CUSTOMER-AUTH.md)).

## Market

Per brand+market: country config, local currencies, local product pricing (no duplicating core product record), tax rules, languages, timezone, payment gateways, independent merchant accounts, product availability, delivery locations, legal policies, contact info, marketing config, localized SEO, order numbering and invoice requirements.

Expansion goal: new market = configuration, with code only for genuinely different payment/tax/legal/operational needs. **Initial activation: Matilda Flower in UAE only**; do not build functionality for inactive markets, but keep foundations ready. [Assumption] Default currency AED (observed on the live Flowers site, to be confirmed).

## Branch

Name/location; assigned brands; employees; hours; inventory; production capacity; delivery coverage; slots; order capacity; prep times; holidays/unavailable dates; contact; assignment rules; operational reports. A branch can serve multiple brands where required.

Order assignment inputs: delivery location, product availability, inventory, branch hours, delivery capacity, prep time, business rules. Authorized staff can manually assign/transfer between eligible branches. Every order stays tied to its brand, market and fulfillment branch ([ORDER-MANAGEMENT](ORDER-MANAGEMENT.md), [DELIVERY](DELIVERY.md)).

## Admin experience

Authorized employees switch between brands/markets/branches; Super Admin can view individual or combined business data ([ADMIN-PANEL](ADMIN-PANEL.md)). Combined views must still be assembled by the backend with explicit scope, never by client-side merging.

## Open questions

- Is a market a child of a brand (separate record per brand+market) or a global country entity linked to brands? [Proposed: global Country + BrandMarket config record.]
- Branch sharing across brands: shared stock pools or per-brand inventory at a shared branch?
- Whether the same legal entity/trade license applies to all brands (affects invoices/VAT) — the live Flowers site's footer reports one entity for the group (unverified).
