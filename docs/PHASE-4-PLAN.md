# Phase 4 Plan: Inventory and Delivery Foundation

**Status: COMPLETE and approved by the owner on 2026-11-27 ("Approve Phase 4, start Phase 5"). Original status: DRAFT for owner review (2026-11-26).** Phase 3 was approved by the owner on 2026-11-26 ("Approve Phase 3, start Phase 4"). As in Phases 2 and 3, work starts at step 4.1 only after you approve this plan and its decisions (D4-01 to D4-16).

Labels: **[Approved]** is from the owner's master prompt; **[Proposed]** needs review; **[Open]** is unresolved.

## 1. Scope [Approved]

From the roadmap: branch inventory, reservations, delivery zones and slots, preparation times, restrictions and branch assignment ([INVENTORY](INVENTORY.md), [DELIVERY](DELIVERY.md)). All delivery rules are configurable in the admin; nothing is hardcoded to a brand, branch, category or area. Cake and Flower rules must both fit the same engine.

### Out of scope (later phases)

Cart, final price, promotions, checkout and payments (Phase 5); orders, production workflow, riders, proof of delivery, tracking links, invoices and refunds (Phase 6); notifications delivery (low-stock alerts are recorded as events here, sent by the notification layer); storefront screens (Phase 8); raw-material and recipe tracking, stock import and WooCommerce stock sync (later, see D4-14); live GPS tracking.

What Phase 4 **does** provide to Phase 5 and 6: a transactional stock and reservation service, a delivery availability service ("which dates and slots can this cart go to this address, from which branch"), slot capacity reservation, and branch assignment, all backend-authoritative and re-validated at order creation.

## 2. What already exists and is reused

Brand, market and branch tenancy with row-level security and `withScope`; permission and scope guards with step-up; audit log; the admin shell and screen kit; Playwright E2E. From Phase 3: product operational fields (`prep_time_minutes`, `lead_time_minutes`, `made_to_order`, `min_quantity`, `max_quantity`), `product_branch` (allowed branches), `variation` (own SKU), `bundle_item` (components for stock deduction) and add-on products.

Important existing fact: **branches are global rows linked to markets** (`branch`, `branch_market`), not owned by one brand. Inventory and delivery data are therefore keyed by brand **and** branch (D4-01).

## 3. Domain model [Proposed]

| Group | Entities | Notes |
|---|---|---|
| Locations | `delivery_area` (tree: emirate, city, area) per country, with translations | Country, Emirate/Province, City, Area per [DELIVERY](DELIVERY.md). Reference data managed in admin by platform staff; seeded for the UAE only from a file the owner approves. |
| Zones | `delivery_zone` (brand, market), `delivery_zone_area` (many to many), `branch_zone` (which branch serves which zone, with priority) | Zone-based charges and coverage. |
| Charges | `zone_charge` (zone, delivery method, fee in minor units, minimum order, free-delivery threshold) | Money as integer minor units per market currency. |
| Methods and slots | `delivery_method` (same day, next day, scheduled; brand and market), `delivery_slot` (zone or branch, weekday, start, end, capacity, cutoff) | Slot granularity is data, not code. |
| Branch calendar | `branch_hours` (weekday ranges), `branch_closure` (holidays, unavailable dates), `global_closure` (brand or market wide disabled dates) | Time zone from the branch. |
| Restrictions | `delivery_restriction` (target: product, category or collection; condition: area, zone, date range, weekday, slot, method) | Replaces the `restriction references` of Phase 3 with rows, never code. |
| Inventory | `stock_level` (brand, branch, variation or product, on hand, reserved, low-stock threshold, backorder policy), `stock_movement` (append-only ledger) | Available = on hand minus reserved. Made-to-order skips finished stock (D4-04). |
| Reservations | `stock_reservation` (+ lines) with expiry; `slot_reservation` | Created at checkout start in Phase 5; expiry through a job. |
| Transfers | `stock_transfer` (+ lines): requested, in transit, received, with discrepancy | Both sides in the ledger. |
| Assignment | `branch_assignment_rule` (ordered rules per brand and market) | Covers location, has stock, open in time, priority, closest or least loaded. |

All tables carry `brand_id` (except global location reference data), composite keys, forced row-level security, and are written only through `withScope` and the permission guards.

## 4. Services [Proposed]

- **Stock service:** `adjust`, `receive`, `reserve`, `release`, `commit`, `transfer`. Every change is one transaction using an atomic conditional update (`UPDATE ... WHERE available >= n`) plus a ledger row. Concurrency tests prove the last unit cannot be sold twice.
- **Delivery availability service:** a pure, tested function over (cart lines, address area, date range) returning dates and slots, intersecting zone coverage, earliest ready time (max prep and lead time of the lines, within branch hours), cutoffs, restrictions, closures, slot capacity and stock at candidate branches, in the order given in [DELIVERY](DELIVERY.md). Phase 5 calls the same function to re-validate.
- **Branch assignment service:** applies the ordered rules to eligible branches; manual override and reassignment re-validate eligibility and are audited.
- **Expiry job:** BullMQ and Redis (first real use; the approved stack already includes them) releases expired reservations. Redis is required in tests for this step only.

## 5. Permissions [Proposed]

Existing keys are reused where they fit (`inventory.view`; the Catalog Manager already holds it). New keys are added in step 4.1: `inventory.adjust`, `inventory.transfer`, `delivery.view`, `delivery.manage` (areas, zones, charges, slots, restrictions), `branches.calendar` (hours and closures for one's own branch, scoped by branch). Stock changes and transfers are scoped to the branch; delivery configuration is scoped to brand and market. Branch Managers get stock and calendar rights for their own branch only; sensitive changes (charges, restrictions, assignment rules) need step-up. Role names are never used for authorization.

## 6. API [Proposed]

Admin REST under `/api/v1/admin/brands/:brandId/inventory/*` and `/delivery/*` with the same pattern as the catalog (permission plus scope on every call, validation with Zod, audit entries). Storefront-facing read endpoints (delivery availability for a cart and address, stock availability flag) are public, resolved from the trusted host, never trusting client prices or store ids, and cached with brand, market and language in the key; stock numbers are never exposed publicly, only "available / unavailable / low".

## 7. Admin screens [Proposed]

Inventory (stock by branch with adjust drawer, movement history, transfers, low-stock list), delivery areas and zones, charges, slots with capacity, branch hours and closures, restrictions, branch assignment rules, and an **availability tester** (pick products, an area and a date; see dates, slots and the chosen branch with the reasons for exclusions). Same restrained admin style as the Phase 3 screens.

## 8. Steps and gates

| Step | Work | Gate |
|---|---|---|
| 4.1 | Foundations: permissions and role defaults, shared types and validation, module skeletons, fixtures (a Dubai flower branch and a cake branch with different hours, zones and slots), Redis and BullMQ wiring for tests | |
| 4.2 | **Inventory and delivery schema draft** with RLS plan, then migration and seed after approval | **Owner reviews DDL** |
| 4.3 | Locations and zones API (areas, zones, coverage, branch to zone) | Built; not yet reviewed by the owner |
| 4.4 | Branch calendar (hours, closures) and delivery methods, charges and minimum orders | Built; not yet reviewed by the owner |
| 4.5 | Slots with capacity and cutoffs | Built; not yet reviewed by the owner |
| 4.6 | Restrictions (product, category, collection by area, date, weekday, method) | Built; not yet reviewed by the owner |
| 4.7 | Stock levels, adjustments and the movement ledger | Built; not yet reviewed by the owner |
| 4.8 | Reservations (stock and slot), expiry job, concurrency tests | Built; not yet reviewed by the owner |
| 4.9 | Transfers between branches with discrepancy handling | Built; not yet reviewed by the owner |
| 4.10 | Delivery availability service and public read API | Built; not yet reviewed by the owner |
| 4.11 | Branch assignment rules and manual reassignment | Built; not yet reviewed by the owner |
| 4.12 | Admin screens and Playwright E2E, including the availability tester | Built; **owner reviews screens** |
| 4.13 | Hardening: isolation matrix for every new table, route coverage, audit, concurrency and performance checks, dependency audit, docs | Done; **owner approval before Phase 5** |

Every step ends green on `pnpm check` and the database suites, updates the docs (`PROGRESS`, `CHANGELOG`, `DECISIONS`, `API`, `DATABASE`, `TESTING`, `ROADMAP`, `INVENTORY`, `DELIVERY`) and does not start the next step or phase without your approval.

## 9. Decisions needing your approval

| ID | Decision | Recommendation | Impact if different |
|---|---|---|---|
| D4-01 | Inventory ownership | Stock rows are keyed by brand, branch and variation or product. A shared branch holds **separate stock per brand** (no pooling) | Pooling a shared flower and cake kitchen needs allocation rules and cross-brand deduction |
| D4-02 | Ledger | Append-only `stock_movement`; stock levels are only changed with a ledger row in the same transaction | A mutable counter cannot be audited or rebuilt |
| D4-03 | Reservation window | 15 minutes from checkout start, extended once when payment begins (value is a per-brand setting, not code) | Too short loses carts; too long hides stock |
| D4-04 | Made-to-order | Made-to-order products skip finished stock but are still bound by lead time, branch hours and **slot capacity** | Unlimited orders on one slot overload production |
| D4-05 | Out of stock | Per product and per brand: hide, show unavailable, or allow backorder; default show unavailable | Wrong default hides or oversells products |
| D4-06 | Bundles and add-ons | Bundles deduct each component; add-on products consume their own stock; inline priced options never touch stock (as D3-06 and D3-08) | Inconsistent deduction oversells |
| D4-07 | Location model | Country, emirate, city, area as one tree with translations; UAE seeded from an owner-approved list; zones group areas | A flat area list cannot express emirate-level rules |
| D4-08 | Delivery charge | Fee per zone and method in the market currency, optional minimum order and free-delivery threshold; calculated by the backend only | Client-side fees can be tampered with |
| D4-09 | Cutoffs and slots | Cutoff times and slot grids are configuration per zone or branch; no default is hardcoded. Seed values come from the owner | Hardcoded times break the first new branch |
| D4-10 | Time handling | Slots and hours stored as local time with the branch time zone; instants stored as `timestamptz` | Mixed zones break same-day logic |
| D4-11 | Slot capacity | A slot has a number of orders or units; reservation is transactional with the same pattern as stock | Overbooked slots |
| D4-12 | Branch assignment | Ordered rules (covers area, has stock, open in time, priority, then closest or least loaded); closest needs coordinates, so geocoding is optional and **no maps provider is added in Phase 4** (distance from stored branch coordinates only) | A maps API adds cost and a vendor decision |
| D4-13 | Restrictions | Data rows with a small fixed set of conditions (area or zone, date range, weekday, method); no free-form rule language | Rule languages become unmaintainable |
| D4-14 | Deferred | Raw materials and recipes, batches and expiry for flowers, stock valuation and costs, CSV import and export, live GPS, rider features | Pulling them in delays the foundation |
| D4-15 | Background jobs | BullMQ with Redis (already in the approved stack) for reservation expiry; no other queue use in this phase | A cron table in the database is possible but weaker |
| D4-16 | Availability cache | Availability results are not cached across customers; only static configuration (zones, slots) is cached, keyed by brand, market and language | Caching dynamic capacity shows stale slots |
| D4-17 | Transfers | A transfer moves nothing when requested. Shipping takes the shipped quantity out of the sender (ledger `TRANSFER_OUT`); receiving adds the counted quantity to the receiver (`TRANSFER_IN`, creating its stock row if needed). A difference between shipped and received needs a note and is flagged. Cancelling is possible only before shipping. The database enforces the allowed state changes | Stock is never created or lost silently, and a transfer in transit is visible on both branches |
| D4-18 | Availability | An item is ready at preparation plus lead minutes; a cart is ready at the latest of its items. Production starts when the branch is next open and the ready time is rolled into opening hours. A branch with no hours produces nothing. A method is offered in a zone only when a charge exists for it. Today gets same-day methods, tomorrow next-day then scheduled, later dates scheduled. Customers never see branch ids or quantities | Predictable dates that follow real opening hours, and no internal data leaks to shoppers |
| D4-19 | Assignment | A branch is eligible only if it covers the area, has the stock, is open in time and has a free slot place; this is always enforced. The ordered rules only rank eligible branches (zone priority, closest, least loaded). With no rules, zone priority decides. Closest needs customer coordinates (no maps provider yet) and is skipped without them. A manual assignment must be an eligible branch, needs a reason and is audited | Rules can reorder branches but can never send an order to a branch that cannot make it |

## 10. Information I need from you (does not block drafting)

1. **Real branches**: names, addresses, coordinates (or areas served), opening hours and which brands each serves (still outstanding from Phase 2).
2. **Delivery rules**: emirates and areas covered at launch, same-day cutoff times, slot length (for example 2 hours), delivery charges and free-delivery thresholds, per brand. Flowers currently says "Delivered Anywhere in Dubai!" and free delivery (to be verified).
3. **Cake rules**: lead times and capacity per day for custom cakes, any dates or areas where cakes cannot be delivered.
4. Pooled or separate stock for a branch shared by two brands (D4-01).
5. Reservation window and out-of-stock behaviour you prefer (D4-03, D4-05).
6. Whether flowers need batch and expiry tracking at launch (D4-14).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Overselling under concurrent checkouts | Atomic conditional updates, ledger in the same transaction, parallel-checkout tests at 4.8 |
| Delivery rules become code | Everything is rows editable in admin; the availability service is a pure function over configuration; tester screen in 4.12 |
| Time zone and cutoff mistakes | Branch time zone on every calculation; tests around midnight, daylight differences and closures |
| Reservation leaks (never released) | Expiry job plus a reconciliation test and an admin list of open reservations |
| Over-modelling before real rules are known | Only the conditions in D4-13; schema review at 4.2 with your real branch data if available |
| Cross-brand leakage at shared branches | Brand-keyed rows, forced RLS and the isolation matrix at 4.13 |
| Slow availability checks | Indexed lookups, per-request limits on date range, performance check at 4.13 |
