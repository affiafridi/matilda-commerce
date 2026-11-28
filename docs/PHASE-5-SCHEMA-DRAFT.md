# Phase 5 Step 5.2: Cart, Order, Payment and Promotion Schema Draft (approved and implemented)

**Status: APPROVED by the owner on 2026-11-27 ("Approve as recommended", all questions as recommended) and IMPLEMENTED as migration `20261127100000_commerce`, applied to the development and test databases (101 database tests).** Deviations made during implementation: (1) the table count is 21, not 22 (the draft summed wrong); (2) a cart bundle choice references the `bundle_item` row (`bundle_item_id`, optional variation), and `bundle_item` gained `UNIQUE (id, brand_id)`; (3) cart options use one row per chosen value with a nullable text, and the early delivery hints on the cart (`delivery_area_id`, `slot_id`, `delivery_method_id`) carry no foreign key because the order step validates them again; (4) the order keeps catalog and delivery ids (`delivery_area_id`, `zone_id`, `slot_id`, `branch_id`) as plain snapshots, only the branch is checked to serve the brand; (5) a payment's amount must equal the order total (a deposit is a later `paid_minor`, Phase 6); (6) a saved address does not check the area against a market country, because a customer is per brand; the service validates it; (7) the order must contain a line and a subtotal equal to its lines to leave DRAFT, and a new order must start DRAFT, UNPAID and UNASSIGNED, so the service moves it to PENDING_PAYMENT inside the creating transaction; (8) a guest order may later be linked to a customer once. Original review text follows. This is the review gate of step 5.2 ([PHASE-5-PLAN.md](PHASE-5-PLAN.md)). After you approve (or change) it, I write the Prisma models and one migration, `commerce`, with hand-written SQL for constraints, triggers and row-level security, exactly as for the earlier schemas ([PHASE-2-SCHEMA-DRAFT.md](PHASE-2-SCHEMA-DRAFT.md), [PHASE-3-SCHEMA-DRAFT.md](PHASE-3-SCHEMA-DRAFT.md), [PHASE-4-SCHEMA-DRAFT.md](PHASE-4-SCHEMA-DRAFT.md)).

Decisions this draft relies on: D5-01 (quote recomputed at order creation), D5-02 (guest cart token), D5-03 (tax per market), D5-04 (order number), D5-05 (separate state machines, database trigger), D5-06 (snapshots), D5-07 (idempotency), D5-08 (encrypted payment config), D5-09 (CCAvenue), D5-10 (COD and manual), D5-11 (promotion rules), D5-12 (gifts as zero-price lines), D5-13 (abandoned carts), D5-14 (guest checkout), D5-15 (holds), D5-17 (one currency per cart). The list below is a design summary in Prisma style; the exact DDL is generated after approval.

## 1. Rules that apply to every table below

1. **Brand column on every row**, even on child tables, with composite keys `(id, brand_id)` against cross-brand links, as in Phases 3 and 4. All 22 tables are brand-keyed; none is global.
2. **Forced row-level security**, the same one policy per table: `USING (brand_id = ANY (app_brand_ids()) OR app_is_platform())` and the same `WITH CHECK`. No context means no rows. Customer-facing requests run with the brand resolved from the trusted host, never from a client value. A customer sees only their own cart and orders because the API filters by the signed-in customer or the guest token hash; this is an application rule on top of the brand isolation, and tests cover it.
3. **Money** is `integer` minor units plus a currency code that must be a currency of the market (composite key to `market_currency`). Basis points (`integer`, 10000 = 100 percent) for percentages. No floats.
4. **Snapshots are immutable.** `order_line`, `order_promotion`, `order_status_history` and `payment_event` reject `UPDATE` and `DELETE` by trigger (like `audit_log` and `stock_movement`). The order header allows updates only to the status columns and a few timestamps; amounts, contact, addresses and the delivery selection are frozen by trigger once the order leaves `DRAFT`.
5. **Status columns** are enums that match the shared contracts built in step 5.1 (`@matilda/validation`), and a test compares the lists. Allowed transitions are enforced by triggers as well as by the services (D5-05).
6. **Time**: instants are `timestamptz`; delivery dates are `date`; slot times are `time` local to the branch (D4-10).
7. **IDs** UUIDv7, `snake_case` through `@map`. Configuration rows use `ActiveStatus`; history rows are never deleted.
8. **Audit**: every payment configuration change, manual payment, promotion change and order status change by staff writes an audit row in the same transaction.
9. **Secrets**: payment credentials are stored only as `EncryptionService` envelopes (AES-256-GCM, key ring, the row id as additional authenticated data). No raw card data, no card numbers, no CVV exist in any column. Provider payloads are stored as a **sanitized summary** only (allow-listed fields).

## 2. Enums

```prisma
enum CartStatus          { OPEN CONVERTED ABANDONED MERGED }
enum OrderStatus         { DRAFT PENDING_PAYMENT CONFIRMED IN_PROGRESS COMPLETED ON_HOLD CANCELLED }
enum PaymentStatus       { UNPAID PENDING COD_PENDING PARTIALLY_PAID PAID FAILED PARTIALLY_REFUNDED REFUNDED }
enum FulfillmentStatus   { UNASSIGNED ASSIGNED OUT_FOR_DELIVERY DELIVERED FAILED_DELIVERY RETURNED PICKUP_READY PICKED_UP }
enum PaymentAttemptStatus{ INITIATED REDIRECTED SUCCEEDED FAILED EXPIRED }
enum PaymentProvider     { CCAVENUE COD MANUAL }
enum PromotionKind       { PERCENT_OFF FIXED_OFF FREE_DELIVERY FREE_GIFT }
enum PromotionScope      { ORDER PRODUCT CATEGORY COLLECTION }
enum PromotionAudience   { EVERYONE CUSTOMERS FIRST_ORDER }
enum OrderLineKind       { PRODUCT ADD_ON GIFT }
```

## 3. Carts

```prisma
model Cart {                               // one open cart per customer per brand, or per guest token
  id; brandId; marketId; currencyCode Char(3)
  customerId String?                       // null for a guest
  guestTokenHash String?                   // SHA-256 of the secret cookie value; the value is never stored
  status CartStatus @default(OPEN)
  deliveryAreaId String?; deliveryDate Date?; deliveryMethodId String?; slotId String?   // optional early choices
  couponCode String?                       // the one coupon, if any (D5-11)
  contactEmail String?; contactPhone String?                      // captured early for abandoned-cart tracking only
  lastActivityAt; abandonedAt?; convertedOrderId String?; createdAt; updatedAt
  @@unique([id, brandId])
  @@unique([brandId, customerId]) where status = 'OPEN' and customer_id is not null   // one open cart per customer
  @@unique([guestTokenHash]) where guest_token_hash is not null
  @@index([status, lastActivityAt])        // the abandoned-cart job
}
model CartLine {
  id; brandId; cartId; productId; variationId String?; quantity Int
  note String?                             // short, for example "no card"
  @@unique([id, brandId]) @@index([cartId, brandId])
}
model CartLineOption { lineId; brandId; optionId; valueId String?; text String?; @@index([lineId]) }
model CartLineAddon  { lineId; brandId; addonItemId; quantity Int; @@id([lineId, addonItemId]) }
model CartLineBundleChoice { lineId; brandId; groupId; productId; variationId String?; @@index([lineId]) }
```

- Checks: `quantity BETWEEN 1 AND 99`; exactly one of `customer_id`, `guest_token_hash` is set; text at most 500 characters; at most 50 lines per cart (trigger).
- A cart line names catalog rows by composite key to the same brand (`product`, `variation`, `option`, `addon_item`, bundle group). The **price is never stored on a cart line**: it is computed from the catalog on every read (D5-01).
- Cart status moves follow the shared machine (OPEN to CONVERTED, ABANDONED, MERGED; ABANDONED back to OPEN). Merging a guest cart into a customer cart marks the guest cart `MERGED`.
- The cookie value is a random 32-byte token; only its hash is stored, so a database read cannot take over a cart.

## 4. Orders

```prisma
model CustomerOrder {                      // "order" is a reserved word, so the table is customer_order
  id; brandId; marketId; number String     // brand prefix and sequence, for example MF-100245 (D5-04)
  status OrderStatus; paymentStatus PaymentStatus; fulfillmentStatus FulfillmentStatus
  customerId String?; guestEmail String?; guestPhone String?
  currencyCode Char(3)
  subtotalMinor Int; discountMinor Int; deliveryFeeMinor Int; taxMinor Int; totalMinor Int
  taxInclusive Boolean
  contactName; contactEmail; contactPhone                          // the buyer
  recipientName; recipientPhone                                    // may differ (gifts)
  deliveryAddress Json; billingAddress Json?                       // frozen copies
  deliveryAreaId; zoneId; deliveryMethodId; deliveryMethodKind DeliveryMethodKind
  deliveryDate Date; slotId; slotStart Time; slotEnd Time          // the chosen window, copied
  branchId String?                                                 // assigned by the Phase 4 service (D4-12)
  giftMessage String?; anonymousGift Boolean @default(false); instructions String?
  paymentConfigVersion Int?; paymentProvider PaymentProvider?; paymentMethod String?
  idempotencyKey String; couponCode String?
  placedAt; confirmedAt?; cancelledAt?; createdAt; updatedAt
  @@unique([id, brandId])
  @@unique([brandId, number])
  @@unique([brandId, idempotencyKey])
  @@index([brandId, status, createdAt]) @@index([brandId, customerId, createdAt]) @@index([branchId, deliveryDate])
}
model OrderLine {                          // immutable snapshot (D5-06)
  id; brandId; orderId; position Int; kind OrderLineKind
  productId String?; variationId String?   // kept for reports; no foreign key delete cascade
  name Json; sku String?                   // names in every language at order time
  options Json; addOns Json; bundleItems Json   // chosen values, with the names and prices that applied
  quantity Int; unitMinor Int; discountMinor Int; taxMinor Int; totalMinor Int
  @@unique([orderId, position])
}
model OrderPromotion {                     // which promotions and coupon applied, and for how much
  id; brandId; orderId; promotionId String?; couponCode String?; name Json; kind PromotionKind; amountMinor Int
}
model OrderStatusHistory {                 // append-only timeline for all three dimensions
  id; brandId; orderId; dimension String   // ORDER, PAYMENT or FULFILLMENT
  fromStatus String?; toStatus String; actorStaffId String?; actorCustomerId String?; reason String?; createdAt
  @@index([orderId, createdAt])
}
model OrderCounter {                       // per-brand sequence (D5-04)
  brandId @id; prefix String; nextValue Int
}
```

- Checks: every `*_minor >= 0`; `total_minor = subtotal_minor - discount_minor + delivery_fee_minor + (tax_minor when tax is not inclusive)`, so the stored total can never disagree with its parts; quantity at least 1 except a gift line, which is `unit_minor = 0`; `delivery_date >= placed_at::date` in the market time zone is checked by the service, not the database (the zone is a market value).
- Triggers: status transitions follow the shared machines; once the order leaves `DRAFT` the amount, contact, address and delivery columns cannot change; `order_line`, `order_promotion` and `order_status_history` are append-only; every status change inserts a history row (so a missing history row is impossible).
- `order_counter` is advanced with one atomic `UPDATE ... RETURNING` inside the order transaction. Numbers are unique and increasing but **not gapless**: a rolled-back order skips a number (D5-04).
- The order is created together with its stock reservation commit, slot reservation commit, payment row and `order_promotion` rows in one transaction.
- `branch_id` is a global branch, so the existing branch-serves-the-brand trigger from Phase 4 applies.

## 5. Payments

```prisma
model PaymentConfig {                      // one row per brand, market and provider version
  id; brandId; marketId; provider PaymentProvider; version Int
  status ActiveStatus                      // one ACTIVE row per (brand, market, provider)
  displayName Json; enabledMethods String[]  // for example ["card","apple_pay"]
  credentialsEncrypted String?             // EncryptionService envelope; null for COD and MANUAL
  credentialsLast4 String?                 // a masked hint shown in the admin, never the secret
  testMode Boolean @default(true)
  codZoneIds String[]; codMaxOrderMinor Int?   // COD per zone and cap (D5-10)
  createdById; createdAt
  @@unique([brandId, marketId, provider, version])
  @@unique([brandId, marketId, provider]) where status = 'ACTIVE'
}
model Payment {                            // the amount owed on an order, one per order (refund lines later)
  id; brandId; orderId; provider PaymentProvider; configId; configVersion Int
  currencyCode Char(3); amountMinor Int; paidMinor Int @default(0); refundedMinor Int @default(0)
  status PaymentStatus; createdAt; updatedAt
  @@unique([id, brandId]) @@unique([orderId])
  // CHECK paid_minor <= amount_minor, refunded_minor <= paid_minor
}
model PaymentAttempt {                     // each try with a provider
  id; brandId; paymentId; reference String // our reference sent to the provider, unique per brand
  status PaymentAttemptStatus; amountMinor Int; currencyCode Char(3)
  providerReference String?                // for example the CCAvenue tracking id
  requestSummary Json; verifiedSummary Json?   // allow-listed fields only, never card data
  idempotencyKey String; expiresAt; verifiedAt?; createdAt
  @@unique([brandId, reference]) @@unique([brandId, idempotencyKey])
}
model PaymentEvent {                       // idempotent callback and webhook log
  id; brandId; paymentId String?; provider; eventKey String   // provider event or tracking id
  kind String; accepted Boolean; summary Json; receivedAt
  @@unique([brandId, provider, eventKey])  // the same callback cannot be applied twice
}
```

- A **refund reuses the config of the original payment** through `config_id` and `config_version` (rule 8). A config row is never edited in place: changing credentials inserts a new version and deactivates the old one, so earlier payments still point at the credentials that took them. Old encrypted credentials are kept until the owner decides a retention rule; they are never returned by any API.
- `credentials_encrypted` is written only by a service that has checked `settings.manage_payments` with step-up. The API returns `credentials_last4`, the provider, the test mode flag and the enabled methods only. A test fails if any response or log line contains the credential value.
- `payment_event`'s unique key makes a repeated provider callback a no-op in the database, not just in code; the confirmation of an order and the insert of its event happen in one transaction.
- Payment success is set only by the server-side verification service after the provider confirms (never from the browser return alone). Triggers refuse any jump the shared payment machine does not allow, for example `UNPAID` to `REFUNDED`.

## 6. Promotions and coupons

```prisma
model Promotion {
  id; brandId; code String                 // internal code, unique per brand
  kind PromotionKind; scope PromotionScope
  percentBps Int?; fixedMinor Int?; currencyCode Char(3)?; giftProductId String?; giftVariationId String?
  maxDiscountMinor Int?                    // cap for a percentage
  minSubtotalMinor Int @default(0); audience PromotionAudience @default(EVERYONE)
  priority Int; combinable Boolean @default(false)       // D5-11
  startsAt Timestamptz?; endsAt Timestamptz?
  usageLimit Int?; perCustomerLimit Int?; usedCount Int @default(0)
  requiresCoupon Boolean @default(false); status ActiveStatus
  @@unique([id, brandId]) @@unique([brandId, code]) @@index([brandId, status, priority])
}
model PromotionTranslation { promotionId; brandId; language; name; description?; @@id([promotionId, language]) }
model PromotionMarket   { promotionId; brandId; marketId; @@id([promotionId, marketId]) }   // none = all markets of the brand
model PromotionTarget   { promotionId; brandId; productId String?; categoryId String?; collectionId String? }
model Coupon {
  id; brandId; promotionId; code String    // stored upper-case, unique per brand
  usageLimit Int?; usedCount Int @default(0); status ActiveStatus
  @@unique([brandId, code])
}
model PromotionUsage {                     // one row per order that used a promotion
  id; brandId; promotionId; couponId String?; orderId; customerId String?; amountMinor Int; createdAt
  @@unique([orderId, promotionId])
}
```

- Checks: exactly the value column matching `kind` is set (`PERCENT_OFF` needs `percent_bps BETWEEN 1 AND 10000`; `FIXED_OFF` needs `fixed_minor > 0` and a currency; `FREE_GIFT` needs a gift product; `FREE_DELIVERY` none); `ends_at > starts_at`; limits positive; `used_count <= usage_limit`. A `PRODUCT`, `CATEGORY` or `COLLECTION` scope needs at least one target (trigger).
- **Usage counting is atomic**: the order transaction runs `UPDATE promotion SET used_count = used_count + 1 WHERE used_count < usage_limit` (and the same for the coupon). Two orders racing for the last use cannot both succeed; the loser gets a clear error and the cart is repriced without the coupon (D5-11).
- A gift product is a zero-price order line that reserves its own stock (D5-12).
- No promotion, coupon or discount rule is seeded in any tier.

## 7. Saved addresses (optional, question 3)

```prisma
model CustomerAddress {
  id; brandId; customerId; label String?; recipientName; phone; line1; line2?; areaId; city?; notes?
  isDefault Boolean; createdAt; updatedAt
  @@unique([id, brandId])
  // area_id must belong to the market country; at most one default per customer
}
```

## 8. Row-level security (all 22 tables)

Same statements as Phase 4 section 9, applied to every table. `matilda_app` gets only `SELECT, INSERT, UPDATE, DELETE` through the existing default privileges, minus update and delete on the append-only tables (blocked by trigger). Provider callbacks run in a brand scope resolved from the brand-specific callback URL on the brand's own domain, then verified with the provider before any change.

## 9. Indexes

All foreign key columns are indexed (a test lists any that are not). Hot paths: `customer_order (brand_id, number)` for lookups, `(brand_id, idempotency_key)` for duplicate-order prevention, `(brand_id, customer_id, created_at)` for "my orders", `(brand_id, status, created_at)` for the admin list, `cart (guest_token_hash)` and `(brand_id, customer_id)` for cart lookup, `cart (status, last_activity_at)` for the abandoned-cart job, `payment_attempt (brand_id, reference)` for callbacks, `payment_event (brand_id, provider, event_key)`, `coupon (brand_id, code)`, `promotion (brand_id, status, priority)`.

## 10. Seed and tests

- **Seed**: nothing in any tier. No payment configuration, promotion, coupon or order number prefix is created for you; the order counter row is created when a brand's first prefix is set in the admin (question 2).
- **Migration tests** (database-backed): every table has `brand_id`, enabled and forced RLS and exactly one policy; no context returns zero rows; brand A cannot read, insert, update or delete brand B rows (matrix over all 22 tables); each composite key rejects a cross-brand reference; each check constraint and trigger has a passing and failing case (total arithmetic, frozen snapshots, append-only tables, illegal status jumps, one active config per brand-market-provider, promotion usage cap, payment never over-paid, one open cart per customer); concurrency tests for order number allocation, coupon use and duplicate callbacks; enum lists match the shared contracts. Existing suites stay green.

## 11. Questions for the owner

1. **Order and cart tables live in the order module, payment in its own.** No decision needed; noted so the names match [ORDER-MANAGEMENT](ORDER-MANAGEMENT.md). The table `customer_order` is used because `order` is a reserved SQL word.
2. **Order number format.** Draft: brand prefix, dash, a sequence starting at 100000 (for example `MF-100001`, `MC-100001`, `CM-100001`), unique per brand and not gapless. Please confirm the three prefixes or give your own, and whether numbers should start at 100000 or continue from the old WooCommerce sites. **Recommendation: as drafted, starting at 100000.**
3. **Saved addresses in this phase.** Section 7 adds an address book for signed-in customers now, since checkout needs addresses. The alternative is to store addresses only on the order and add the address book with the storefront account pages (Phase 8). **Recommendation: include it now** (small, and the storefront then only calls the API).
4. **One payment row per order.** Draft: one `payment` per order with several attempts, and partial or split payments handled later with refund lines in Phase 6. If you need two payments on one order (a deposit then a balance) in Phase 5, the `UNIQUE (order_id)` is dropped now. **Recommendation: one per order; deposits are Phase 6 manual payments on the same row (`paid_minor` grows).**
5. **Old credentials retention.** Superseded encrypted credentials are kept (so refunds can use the original config) until you set a retention rule. **Recommendation: keep.**
6. **Frozen order totals in the database.** The total-equals-parts check and the frozen-snapshot trigger make a tampered order impossible at the database level, but a Phase 6 staff correction of an order (for example changing an address after payment) then needs an explicit audited "amendment" path rather than a plain update. **Recommendation: yes, freeze; amendments are built in Phase 6.**
7. **Abandoned cart privacy.** The cart keeps a captured email or phone only for tracking; no message is sent in Phase 5. **Recommendation: keep, delete the contact when the cart is converted, abandoned for over 90 days or the customer asks.**
8. **Permissions** (step 5.1) are unchanged by this schema.

## 12. Implementation plan once approved

1. Prisma models and migration `commerce`: generated tables, then hand-written SQL for partial and expression indexes, check constraints, triggers, append-only rules and row-level security. Apply to development and test databases, regenerate the client.
2. The database integration tests in section 10.
3. Docs: `DATABASE.md`, `PROGRESS.md`, `CHANGELOG.md`, `TESTING.md`, `CART-AND-CHECKOUT.md`, `PAYMENTS.md`, `ORDER-MANAGEMENT.md`; then stop for review of the 5.2 results before step 5.3.
