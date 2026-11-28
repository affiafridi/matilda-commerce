# Cart and Checkout

**Rule [Approved]:** all prices, discounts, inventory availability and delivery restrictions are recalculated and validated by the backend. Never trust frontend-submitted prices or payment-success information.

## Cart [Approved]

Persistent customer carts; guest carts; merge after login; variations; customization data; add-ons; bundles; quantity management; coupons; automatic promotions; free/gift products; abandoned cart tracking and recovery; stock and delivery-capacity reservations.

Carts are brand-scoped (and market-scoped for currency/pricing).

## Checkout [Approved]

Guest and registered checkout; saved addresses; separate billing and delivery details; recipient name/contact; gift message; anonymous gifting (hide sender); delivery date/time selection; order instructions; payment method selection; delivery charges; tax calculation; order confirmation.

## Pricing pipeline [Proposed]

1. Resolve brand/market/currency from context.
2. Load authoritative base/variation prices (market price, scheduled sale).
3. Apply option and add-on price modifiers.
4. Evaluate automatic promotions and gifts, then coupons, using defined stacking/priority rules ([CMS-AND-MARKETING](CMS-AND-MARKETING.md)).
5. Compute delivery charge from zone, then taxes per market rules.
6. Return a server-signed **cart/checkout quote** with totals and line breakdown; recomputed at order creation. Money handled as integer minor units ([DATABASE](DATABASE.md)).

**Implemented for steps 2 and 3 (Phase 5 step 5.3, `apps/api/src/modules/pricing`).** A pure engine (`pricing-engine.ts`, no database) prices cart lines from catalog data that `QuoteService` loads inside the caller's brand-scoped transaction. Client-sent prices are never read; the contract has no price field on a cart line. Rules:

- A product is buyable only when it is published, inside its publish window, sold in the cart's market and not deleted; otherwise `PRODUCT_UNAVAILABLE`. A product or variation with no market price in the cart currency is `NO_PRICE`.
- Unit price is the variation's market price (variable products) or the product's (simple and bundle), using the sale price only inside its window, plus option deltas (per group and per choice, none means no surcharge).
- Option groups validate required, min and max, text length, ISO dates and `showWhen` rules (a group hidden by a rule must not be sent). Add-ons validate group limits and per-item maximum; an add-on with no market price is not sold there. Add-on quantity is multiplied by the parent line quantity and add-ons become their own quote lines.
- Bundles are priced at the bundle's own price. Components with a fixed variation are snapshotted; variable components need a `bundleChoices` entry with an active variation.
- All problems of all lines are reported together as 422 `CART_INVALID` with `lines.<index>.<field>` paths. Totals use integer minor units. Discounts, delivery fee and tax are zero until steps 5.5 and 5.6.

**Cart rules (Phase 5 step 5.4).** The cart stores no price. Identity is the signed-in customer's session or the guest cookie (`matilda_cart`, HttpOnly, SameSite=Lax, hash stored, 30 days); an id sent by the client is never used to find a cart. Adding a line validates it alone (422 `CART_LINE_INVALID`, paths relative to the line); reading re-prices the whole cart and reports unbuyable lines as `issues`. Limits: 50 lines, 99 per line, the product minimum and maximum. A cart has one market and currency; carts of different markets are never merged. Sign-in merges the guest cart into the customer cart.

**Promotion rules (Phase 5 step 5.5, D5-11, D5-12).** Automatic promotions apply by priority (lower first), then at most one coupon. `combinable = false` means the promotion applies only when nothing else has and nothing applies after it. Each discount comes off what is left and is spread over the eligible lines (add-ons follow their product); a gift is a zero-price `GIFT` line that exists only while its condition holds. A coupon code is kept on the cart and judged again on every read and at checkout. Usage limits are read when quoting and claimed atomically when the order is created (step 5.8). Category promotions match a product's direct categories, not sub-categories.

**Delivery fee, tax and signed quote (Phase 5 step 5.6, D5-01, D5-03).** The fee is the active zone's charge for the chosen area and method, waived by a free-delivery promotion or the zone's free-over amount, with a minimum order reported as a problem. Tax is the market's `tax_rate_bps`, inclusive or exclusive, per line and on the delivery fee, rounded half away from zero; the rate is zero until finance confirms it. The cart view carries an HMAC signature and a 15-minute expiry. A signature only shows that the numbers came from this server a moment ago; order creation recomputes everything and refuses when the total changed.

## Order placement flow [Proposed]

Validate cart → validate delivery date/slot/zone/restrictions ([DELIVERY](DELIVERY.md)) → reserve stock and slot capacity ([INVENTORY](INVENTORY.md)) → create order in `pending_payment` with snapshots (idempotency key) → initiate payment ([PAYMENTS](PAYMENTS.md)) → on verified payment, confirm order and convert reservations; on failure/expiry, release and allow retry. COD/manual/advance paths adjust the payment status, not the order lifecycle ([ORDER-MANAGEMENT](ORDER-MANAGEMENT.md)).

## Delivery-aware cart rules

Product- and category-specific lead times and restrictions, location-based product restrictions, same-day/next-day rules and cutoffs must be evaluated when the delivery date/area change, with clear storefront messaging when items become unavailable.

## Abandoned carts

Tracked for guests (with email/phone captured at checkout) and customers; recovery messages via [NOTIFICATIONS](NOTIFICATIONS.md) only with consent; recovery link restores cart with re-validated prices.

## Open

Reservation duration; promotion stacking policy; minimum order amount per zone; whether guests can pay with COD; tax display (inclusive vs exclusive) for AED/UAE VAT — to be confirmed with finance.
