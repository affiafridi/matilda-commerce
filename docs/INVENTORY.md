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

## Implemented (Phase 4 step 4.7)

Stock rows are per branch and per simple product or variation; a bundle or a variable product has no row of its own. On-hand changes only through a ledger movement written in the same transaction after the row is locked. Manual movements are receipt, adjustment in or out, wastage and stocktake; sales, returns, transfers and production consumption come from their own flows. A brand default of backorder is written on the row because the database must know it; moving the default away from backorder leaves those rows as they are, so staff change them per row. Routes: [API.md](API.md).

## Implemented (Phase 4 step 4.8): reservations

A checkout takes a hold on stock rows and/or one delivery-slot place, keyed by its checkout reference (one open hold per reference). The hold lasts the brand's `reservationMinutes`; it can be extended until `created + window x (maxExtensions + 1)`. Stock is held by raising `reserved` with a single conditional update (`on_hand - reserved >= quantity`, or the row allows backorder), so concurrent checkouts cannot hold the same unit; the slot place is a counter per slot and date that cannot pass capacity. Holding and releasing write no ledger rows; confirming (after payment, Phase 5) lowers `on_hand` and `reserved` and writes a SALE movement referencing the order, and a slot place stays booked. Release and expiry give stock and places back. A repeating `reservation-expiry` job (every 60 s, BullMQ, needs `REDIS_URL`) frees holds that ran out; without Redis the API starts with a warning, and confirming an expired hold is refused either way. There is no public route: the checkout calls the service. Staff can list open holds and release a stuck one. Routes: [API.md](API.md).

## Implemented (Phase 4 step 4.9): transfers

A transfer moves stock between two branches of one brand in four states: requested, in transit, received, or cancelled (only before shipping). Requesting moves nothing. Shipping takes the shipped quantity (default: the requested quantity, never more) out of the sending branch with a `TRANSFER_OUT` ledger row; the sender needs enough unreserved stock. Receiving adds the counted quantity to the receiving branch with a `TRANSFER_IN` row, creating that branch's stock row when it has none. When the counted quantity differs from what was shipped a note is required, the line shows the difference, and the list can be filtered by `discrepancy`. The transfer row is locked while it changes state, so a repeated or parallel call changes nothing twice, and the database enforces the allowed state changes. Permissions: `inventory.transfer` over the sending branch to request or ship, over the receiving branch to receive, over either to cancel; `inventory.view` over either branch to read. Routes: [API.md](API.md).

## Implemented (Phase 4 step 4.12): admin screens

Stock (track an item, record receipts, adjustments and wastage, stocktake, per-item rules, history, brand settings), Transfers (request, ship, receive with the difference note, cancel), and Reservations (list and release). The delivery screens (zones, methods and charges, slots, restrictions, branch calendar, assignment and tester) are described in [DELIVERY.md](DELIVERY.md).

## Testing

Concurrency tests (parallel checkouts for the last unit), reservation expiry, transfer integrity — [TESTING](TESTING.md).

## Open

Wastage/perishability model for flowers (batches, expiry); cost tracking; reservation duration; inventory sync needs during WooCommerce migration.
