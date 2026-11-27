# Delivery Management

**Rule [Approved]:** all delivery rules are configurable from the admin panel. Nothing is hardcoded for specific branches, categories or locations.

## Location model [Approved]

Country → Emirate/Province → City → Area. Delivery zones group areas (many-to-many), per brand/market/branch coverage.

## Capabilities [Approved]

- Zone-based delivery charges; delivery coverage; minimum order amounts.
- Same-day, next-day and scheduled delivery; delivery dates.
- Configurable time slots with **slot capacity**.
- Branch opening hours; preparation times; order cutoff times.
- Product-, category- and location-specific restrictions.
- Disabled dates and holidays.
- Automatic branch assignment; manual assignment; branch reassignment.
- Rider assignment; delivery status updates; customer tracking links.
- Proof of delivery; delivery confirmation; delivery reports.

## Availability evaluation [Proposed]

For a cart + delivery address + requested date, compute available dates/slots as the intersection of:
1. Zone coverage and zone/slot configuration for the brand/market.
2. Earliest ready time = order time + max(preparation/lead time of each item, incl. customized-product lead times) adjusted for branch opening hours.
3. Cutoff time rules for same-day/next-day.
4. Product/category/location restrictions (e.g., item not deliverable to area X or on date Y).
5. Branch holidays/unavailable dates and global disabled dates.
6. Remaining slot capacity and branch production/order capacity.
7. Inventory at candidate branches.

The result drives checkout options and is **re-validated server-side on order creation**; slot capacity is reserved transactionally ([INVENTORY](INVENTORY.md) for the same pattern).

## Branch assignment [Proposed]

Rules engine over eligible branches: covers location → has stock/capacity → open/able to prepare in time → priority/closest/least loaded. Manual override by authorized staff with audit; reassignment re-validates eligibility and notifies production.

## Implemented (Phase 4 steps 4.10 and 4.11): availability and assignment

**Availability** (`AvailabilityService`, public reads `GET /delivery/areas`, `POST /delivery/availability`, `POST /delivery/stock-status`; routes in [API.md](API.md)). For a cart, an area and a start date it returns the dates and slots a shopper may choose, or why none: `AREA_NOT_COVERED`, `RESTRICTED`, `NO_BRANCH_CAN_SERVE`, `NO_SLOTS`. The cart is checked first (product and variation exist, quantities in range), then coverage (area to zone), then restrictions (product, its category and ancestors, collections, and bundle components), then each branch serving the zone: stock for every line, the earliest ready time (preparation plus lead minutes, started when the branch is next open and rolled into opening hours), closures, the slot grid with its cutoff and capacity per date, and the method kinds the date allows (today: same day; tomorrow: next day then scheduled; later: scheduled). A method is offered in a zone only when a charge exists for it; its fee, minimum order and free-over level come from that charge. All times are local to the branch. Results are never cached across customers, and the public answer carries no branch ids or quantities.

**Assignment** (`AssignmentService`, admin routes under `/admin/brands/:brandId/delivery`). Eligibility (covers the area, has the stock, open in time, free slot place) is always enforced by the availability service. The market's ordered rules only rank eligible branches: zone priority, closest (needs customer coordinates; skipped without them) and least loaded (orders already booked for the date). With no rules, zone priority decides. Staff can preview the choice, and a person with `delivery.assign` can assign a different eligible branch with a reason; the override is audited. The order flow of Phases 5 and 6 will call the same functions.

## Riders and tracking [Proposed]

Rider sees only own assigned deliveries (mobile-first view in `/api/v1/delivery/`): address/map link, contact, status steps (assigned → picked up → out for delivery → delivered/failed), proof of delivery (photo/signature/OTP — **[Open]**). Customer tracking link shows status without exposing private data ([ORDER-MANAGEMENT](ORDER-MANAGEMENT.md), [NOTIFICATIONS](NOTIFICATIONS.md)).

## Integrations

Maps/geocoding provider: Google Maps or approved alternative — **[Open]**.

## Observed (requires verification)

Flowers site text states "Delivered Anywhere in Dubai!" and free delivery (summary-level observation). Cake delivery rules not yet audited ([FEATURE-PARITY](FEATURE-PARITY.md)).

## Open

Same-day cutoff times; slot granularity; delivery to other emirates; rider employment model (in-house vs third-party); live GPS tracking need; Arabic address handling.
