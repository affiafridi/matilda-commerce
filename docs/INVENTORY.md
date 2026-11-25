# Inventory Management

## Scope [Approved]

Product-level, variation-level and **branch-level** inventory; availability; low-stock alerts; out-of-stock handling; **stock reservations**; adjustments; movement history; transfers between branches; import/export; reporting; raw-material tracking and production-related consumption where required; made-to-order products with no fixed finished-goods stock.

## Principles

1. **Never oversell.** Stock changes happen inside database transactions using atomic conditional updates or row locks (`UPDATE ... SET available = available - n WHERE available >= n`) — [Proposed].
2. **Ledger-based:** current quantity is backed by an append-only `StockMovement` history (receipt, sale, reservation, release, adjustment, transfer out/in, production consumption, return) with actor, reason, reference.
3. **Reservations:** created at checkout start (or payment initiation), expire via BullMQ job, converted to a sale on confirmed payment, released on failure/cancel. Reservation window length is **[Open]**.
4. Inventory belongs to (variation or product, branch). A shared branch serving several brands: pooled vs per-brand allocation is **[Open]** ([MULTI-STORE](MULTI-STORE.md)).
5. Made-to-order items bypass finished-stock checks but are still bound by branch capacity, lead time and slot capacity ([DELIVERY](DELIVERY.md)).
6. Raw materials (flowers, flour, etc.) and recipes/consumption are an optional later layer; do not block earlier phases.

## Behaviors

- Low-stock thresholds per item/branch with alerts via [NOTIFICATIONS](NOTIFICATIONS.md).
- Out-of-stock: hide, show as unavailable, or allow backorder (configurable per product/brand) [Proposed].
- Transfers: request → in transit → received, with discrepancy handling; both sides logged.
- Availability for checkout is evaluated per candidate fulfillment branch; auto-assignment uses it ([ORDER-MANAGEMENT](ORDER-MANAGEMENT.md)).
- Import/export CSV with validation and dry-run.
- Reports: stock on hand, movements, valuation (if costs tracked — **[Open]**), shrinkage/wastage (important for flowers).

## Testing

Concurrency tests (parallel checkouts for the last unit), reservation expiry, transfer integrity — [TESTING](TESTING.md).

## Open

Wastage/perishability model for flowers (batches, expiry); cost tracking; reservation duration; inventory sync needs during WooCommerce migration.
