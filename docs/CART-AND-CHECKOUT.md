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

## Order placement flow [Proposed]

Validate cart → validate delivery date/slot/zone/restrictions ([DELIVERY](DELIVERY.md)) → reserve stock and slot capacity ([INVENTORY](INVENTORY.md)) → create order in `pending_payment` with snapshots (idempotency key) → initiate payment ([PAYMENTS](PAYMENTS.md)) → on verified payment, confirm order and convert reservations; on failure/expiry, release and allow retry. COD/manual/advance paths adjust the payment status, not the order lifecycle ([ORDER-MANAGEMENT](ORDER-MANAGEMENT.md)).

## Delivery-aware cart rules

Product- and category-specific lead times and restrictions, location-based product restrictions, same-day/next-day rules and cutoffs must be evaluated when the delivery date/area change, with clear storefront messaging when items become unavailable.

## Abandoned carts

Tracked for guests (with email/phone captured at checkout) and customers; recovery messages via [NOTIFICATIONS](NOTIFICATIONS.md) only with consent; recovery link restores cart with re-validated prices.

## Open

Reservation duration; promotion stacking policy; minimum order amount per zone; whether guests can pay with COD; tax display (inclusive vs exclusive) for AED/UAE VAT — to be confirmed with finance.
