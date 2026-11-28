# Phase 5 Plan: E-commerce and Checkout

**Status: APPROVED by the owner on 2026-11-27 ("Approve, start 5.1"); steps 5.1 to 5.5 are done; step 5.6 (delivery fee, tax and signed quote) is next.** Phase 4 was approved by the owner on 2026-11-27 ("Approve Phase 4, start Phase 5"). Because this phase handles money, work starts at step 5.1 only after you approve this plan and its decisions (D5-01 to D5-18), and step 5.2 stops for your review of the schema.

Labels: **[Approved]** is from the owner's master prompt; **[Proposed]** needs review; **[Open]** is unresolved.

## 1. Scope [Approved]

From the roadmap: cart, promotions, coupons, guest and customer checkout, payment integrations, order creation and payment verification ([CART-AND-CHECKOUT](CART-AND-CHECKOUT.md), [PAYMENTS](PAYMENTS.md), the promotion engine in [CMS-AND-MARKETING](CMS-AND-MARKETING.md)).

Non-negotiable rules that apply to every step: all prices, discounts, taxes, delivery fees, stock and delivery rules are recalculated by the backend; payment success is decided only by server-side verification with the provider; money is integer minor units; order and payment state changes follow controlled state machines; orders keep historical snapshots; payment secrets are encrypted and never reach the frontend or the logs; no raw card data is ever stored.

### Out of scope (later phases)

Order management screens, manual orders, production workflow, invoices, refunds and customer notifications (Phase 6); CMS, banners, SEO, loyalty points, gift cards, referrals, birthday reminders and abandoned-cart recovery messages (Phase 7); all storefront screens (Phase 8); finance reports (Phase 9).

What Phase 5 **does** provide to later phases: authoritative carts, quotes and orders with snapshots, a payment framework with a CCAvenue provider, and a promotion engine, all as backend APIs plus the admin screens needed to configure and verify them. The storefront in Phase 8 only calls these APIs.

## 2. What already exists and is reused

Tenancy with row-level security and `withScope`; staff permissions with scope and step-up; customer authentication and sessions (brand-specific); the audit log; the encryption service with a key ring (built for payment credentials); the catalog engine (market prices, scheduled sales, variations, options, add-ons, bundles, price preview); the inventory service with stock and slot reservations (hold, extend, confirm, release, expiry); the delivery availability and assignment services; BullMQ jobs; the admin shell and Playwright E2E.

## 3. Domain model [Proposed]

| Group | Entities | Notes |
|---|---|---|
| Carts | `cart` (brand, market, currency, customer or guest token, status), `cart_line` (product, variation, quantity, option selections, add-ons, bundle choices, gift flag) | A guest cart is found by a secret token (hash stored). A customer has one open cart per brand. |
| Quotes | not stored as rows; a signed, expiring quote is returned by the pricing engine | Recomputed at order creation (D5-01). |
| Orders | `customer_order` (brand, market, number, status, payment status, fulfillment status, totals, currency, contact, addresses, delivery selection, branch, gift message, instructions, idempotency key), `order_line` (snapshot of name, SKU, options, unit price, tax, discount), `order_status_history` | Snapshots never change after creation. Order number is unique per brand. |
| Payments | `payment_config` (brand, market, provider, encrypted credentials, version, enabled methods), `payment` (order, amount, currency, provider, config version, status), `payment_attempt` (reference, request and verified response summary), `payment_event` (idempotent callback log) | Refunds later reuse the config version of the original payment. |
| Promotions | `promotion` (brand, schedule, priority, stacking, usage limits, conditions, actions), `coupon` (code unique per brand, promotion link), `promotion_usage` (order, customer, amount) | Usage counted in the same transaction as the order. |
| Abandoned carts | timestamps and captured contact on the cart; no messages sent | Recovery messages are Phase 7. |

All tables carry `brand_id` with composite keys and forced row-level security. Customer-facing access always resolves the brand from the trusted host and never from a client-sent id.

## 4. Services [Proposed]

- **Pricing engine:** a pure, tested function from (cart, market, customer, delivery selection, date) to a quote with line breakdown, discounts, delivery fee, tax and total. It reuses the catalog price preview. The quote carries an HMAC signature and an expiry; a signature is a convenience for the client, not trust: the order step recomputes everything.
- **Cart service:** add, change and remove lines with validation against product rules (min and max quantity, options, add-ons, bundles), merge a guest cart into a customer cart after sign-in, and re-validate when the delivery date or area changes.
- **Promotion engine:** evaluates automatic promotions and then at most one coupon with a defined priority, stacking and exclusivity order (D5-11); free gifts are added by the engine as zero-price lines.
- **Checkout service:** validates the cart, delivery date, slot, zone and restrictions through the availability service, holds stock and the slot through the reservation service, and creates the order in `pending_payment` with an idempotency key.
- **Payment framework:** the `PaymentProvider` interface from [PAYMENTS](PAYMENTS.md) (initiate, verify, webhook, refund and status signatures), attempts recorded apart from the order, idempotent callback processing in the same transaction as order confirmation.
- **Providers:** CCAvenue (hosted redirect), cash on delivery, and manual payments recorded by staff.
- **Jobs:** abandoned-cart marking and expired pending-payment orders release their holds (BullMQ, already in use).

## 5. Permissions [Proposed]

New keys in step 5.1: `orders.view` (read-only in this phase), `promotions.view`, `promotions.manage`, `payments.view`, and `settings.manage_payments` (already described in [PAYMENTS](PAYMENTS.md); step-up required). Payment configuration is scoped to brand and market; staff see masked credentials only. Role names are never used for authorization.

## 6. API [Proposed]

Customer-facing REST under `/api/v1/cart`, `/api/v1/checkout`, `/api/v1/orders` and `/api/v1/payments` (brand from the host, cookie for guest and customer carts, CSRF and same-origin checks as the customer authentication). Admin REST under `/api/v1/admin/brands/:brandId/promotions`, `/payments/configs` and a read-only `/orders`. Provider callbacks and webhooks use brand-specific URLs on the brand's own domain and are verified server-side before anything changes.

## 7. Admin screens [Proposed]

Payment settings per brand and market (provider, enabled methods, masked credentials with step-up to change, a test connection), promotions and coupons (conditions, actions, schedule, usage, status), and a **read-only orders list and detail** to verify what checkout produced (full order management is Phase 6). Same plain-language, aligned style as the Phase 4 screens after your usability review.

## 8. Steps and gates

| Step | Work | Gate |
|---|---|---|
| 5.1 | Foundations: permissions and role defaults, shared contracts (cart, quote, order, payment, state machines), module skeletons, fixtures | **Done** (2026-11-27) |
| 5.2 | **Cart, order, payment and promotion schema draft** with row-level security plan, then migration after approval | **Owner reviews DDL**: draft approved as recommended 2026-11-27 and **done**: migration `commerce` (21 tables, [PHASE-5-SCHEMA-DRAFT.md](PHASE-5-SCHEMA-DRAFT.md)) |
| 5.3 | Pricing engine (quote) over market prices, variations, options, add-ons and bundles | **Done**: pure engine `pricing/pricing-engine.ts` plus `QuoteService` (22 unit and 18 database tests); discounts, delivery fee and tax join in 5.5 and 5.6 |
| 5.4 | Cart API for guests and customers, merge after sign-in, validation | **Done**: `/api/v1/cart` (read, add, change, remove, contact), guest cookie, merge at sign-in (28 database tests) |
| 5.5 | Promotion and coupon engine with admin API | **Done**: pure engine, evaluator, staff API under `/admin/brands/:brandId/promotions`, coupon routes on the cart (19 unit and 37 database tests) |
| 5.6 | Delivery fee and tax in the quote, signed quote | |
| 5.7 | Checkout: contact, addresses, recipient, gift message, delivery date and slot, holds | |
| 5.8 | Order creation: idempotent, snapshots, order number, state machine, assignment | |
| 5.9 | Payment framework, encrypted per-brand and market config, cash on delivery and manual payments | |
| 5.10 | CCAvenue provider (hosted redirect, encrypted request, verified response) in test mode | **Needs your merchant test credentials** |
| 5.11 | Payment verification and order confirmation, failed-payment recovery, expiry job, abandoned-cart tracking | |
| 5.12 | Admin screens and Playwright E2E | **Owner reviews screens** |
| 5.13 | Hardening: isolation matrix, route coverage, double-order, double-payment and coupon-race tests, security review, dependency audit, docs | **Owner approval before Phase 6** |

Every step ends green on `pnpm check` and the database suites, updates the docs (`PROGRESS`, `CHANGELOG`, `DECISIONS`, `API`, `DATABASE`, `TESTING`, `ROADMAP`, `CART-AND-CHECKOUT`, `PAYMENTS`) and does not start the next step or phase without your approval, unless you tell me to build several steps before you review.

## 9. Decisions needing your approval

| ID | Decision | Recommendation | Impact if different |
|---|---|---|---|
| D5-01 | Quote and re-validation | The backend returns a signed, expiring quote; order creation recomputes everything and refuses (returning the new quote) if the total changed | Trusting a client total allows tampering |
| D5-02 | Cart identity | Guest carts use a random secret token in an httpOnly cookie, brand-specific, stored hashed; a customer has one open cart per brand; on sign-in the guest cart is merged by adding quantities and re-validating | Shared carts across brands break A-004 |
| D5-03 | Tax | Tax rules are per market configuration and support inclusive or exclusive prices; the launch value (UAE VAT, assumed 5 percent and inclusive) is **[Open]** until finance confirms | A wrong default shows wrong totals |
| D5-04 | Order number | Per-brand sequence with a brand prefix, unique per brand, not guaranteed gapless | Gapless numbers need a locking sequence and slow checkout |
| D5-05 | State machines | Separate order, payment and fulfillment statuses; allowed transitions are enforced in the service and by a database trigger, as for transfers | One mixed status becomes ambiguous |
| D5-06 | Snapshots | Order lines store name, SKU, options, unit price, tax and discount; the order stores addresses, contact, delivery selection and the payment config version | Later catalog edits would rewrite history |
| D5-07 | Idempotency | Order creation and payment initiation take an idempotency key with a unique constraint; callbacks are deduplicated by provider reference | Double clicks and retried callbacks create duplicates |
| D5-08 | Secrets | Provider credentials use the existing envelope encryption; staff see masked values; changes need `settings.manage_payments` and step-up and are audited | Plain credentials in the database are a breach risk |
| D5-09 | CCAvenue | Hosted redirect with the encrypted request and response per CCAvenue's published method using the platform's built-in cryptography (no new dependency); success only after server-side verification, never the browser return alone; built against test mode until you provide credentials | Browser-trusted success allows free orders |
| D5-10 | COD and manual | Cash on delivery is a per-market and per-zone setting; the order is confirmed with the payment still pending; manual payments are recorded by staff with a reference and audit | COD for everyone invites fake orders |
| D5-11 | Promotion rules | Automatic promotions apply by priority, then at most one coupon per order; each promotion says whether it can combine; usage limits are counted in the order transaction | Unlimited stacking erodes margin |
| D5-12 | Free gifts | A gift is added by the engine as a zero-price line, reserves its own stock, and is removed when the condition no longer holds | Manual gifts are not auditable |
| D5-13 | Abandoned carts | Only tracked in this phase (timestamps, captured email and phone); recovery messages wait for notifications and consent | Messaging without consent breaks the rules |
| D5-14 | Guest checkout | Allowed with email and phone; the guest can later create an account; guest payment methods follow D5-10 | Forcing accounts lowers conversion |
| D5-15 | Holds | Checkout start holds stock and the slot with the existing reservation service; success commits them, failure or expiry releases them | Holding stock without limit hides sales |
| D5-16 | Deferred | Refunds, invoices, notifications, loyalty, gift cards, referrals, storefront screens, abandoned-cart messages | Pulling them in delays checkout |
| D5-17 | Currency | One currency per cart and order: the market's currency | Mixed currency carts complicate tax and payment |
| D5-18 | Reading orders | Phase 5 ships only a read-only admin order view; full order management is Phase 6 | Building management twice |

## 10. Information I need from you (does not block drafting)

1. **CCAvenue**: for each brand, whether a merchant account exists, and test (sandbox) credentials for at least Matilda Flower when we reach step 5.10; the domains and return URLs to register.
2. **Tax**: whether UAE VAT is 5 percent, whether product prices already include it, and how it should appear on the receipt.
3. **Cash on delivery**: allowed for guests or only for signed-in customers, and for which areas.
4. **Promotions at launch**: which kinds you need first (coupon percentage, fixed amount, free delivery, free gift, bundle discount) and whether coupons can combine with sale prices.
5. **Minimum order amount** per zone and any maximum order value.
6. **Gift message and anonymous gifting**: length limit and wording rules.
7. Still outstanding from Phase 4: real branches, delivery rules and cutoffs, cake lead times.

## 11. Risks

| Risk | Mitigation |
|---|---|
| A client-altered price or fake payment success | Backend-only pricing, recompute at order creation, verify payments with the provider, tests that send tampered totals and forged callbacks |
| Double orders or double payments | Idempotency keys, unique constraints, transactional callback handling, parallel-request tests |
| Coupon overuse in a race | Usage counted atomically with the order, parallel redemption tests |
| Stock or slot held forever | Existing expiry job, order-expiry job and a reconciliation test |
| Leaked credentials | Envelope encryption, masked display, step-up, audit, log redaction tests |
| Cross-brand data in carts or orders | Brand from the host only, forced row-level security, the isolation matrix at 5.13 |
| Wrong tax or totals | Integer minor units, rounding rule written down and tested, finance sign-off on the tax setting |
| Provider outage or changed API | Provider interface, test mode, status reconciliation job |
