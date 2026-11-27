# Phase 4 Step 4.2: Inventory and Delivery Schema Draft (for owner review)

**Status: APPROVED by the owner on 2026-11-26 ("Approve as recommended", all eight questions as recommended) and IMPLEMENTED as migration `20261126131309_inventory_delivery`, applied to the development and test databases.** Deviations made during implementation: (1) `delivery_closure` additionally refuses a row that names both a market and a branch; (2) the overselling check uses `COALESCE(..., false)` because a plain `OR` with a NULL setting would let overselling through (found by the new tests); (3) a branch zone and a slot also require the branch to be linked to the zone's or slot's market; (4) transfer lines reuse the stock shape trigger (no bundles); (5) the seven emirates are seeded in the reference tier. Original review text follows. This was the review gate of step 4.2 ([PHASE-4-PLAN.md](PHASE-4-PLAN.md)). After you approve (or change) it, I write the Prisma models and one migration, `inventory_delivery`, with hand-written SQL for constraints, triggers and row-level security, exactly as for the tenancy and catalog schemas ([PHASE-2-SCHEMA-DRAFT.md](PHASE-2-SCHEMA-DRAFT.md), [PHASE-3-SCHEMA-DRAFT.md](PHASE-3-SCHEMA-DRAFT.md)).

Decisions this draft relies on: D4-01 (stock per brand and branch), D4-02 (ledger), D4-03 (reservation window), D4-04 (made-to-order), D4-05 (out of stock), D4-06 (bundles and add-ons), D4-07 (location tree), D4-08 (delivery charge), D4-09 and D4-10 (cutoffs, local time), D4-11 (slot capacity), D4-12 (assignment), D4-13 (restrictions). The list below is a design summary in Prisma style; the exact DDL is generated after approval.

## 1. Rules that apply to every table below

1. **Brand column on every brand-keyed row** (21 of the 23 tables). `brand_id uuid NOT NULL` even on child tables, so isolation is a direct check. The two location reference tables are global, like `country`.
2. **Composite keys against cross-brand links.** References use `(id, brand_id)` pairs: `market`, `product`, `variation`, `category` and `collection` already have `UNIQUE (id, brand_id)`. New parents (`delivery_zone`, `delivery_method`, `delivery_slot`, `stock_level`, `stock_reservation`, `stock_transfer`) get the same, so a child can never point at another brand's parent.
3. **Branches are global rows** (`branch` has no `brand_id`; `branch_market` links it to markets). A brand-keyed row that names a branch is checked by a trigger: the branch must be linked, through `branch_market`, to a market of that brand. Removing a link later does not delete history, it blocks new rows (question 3).
4. **Row-level security, forced**, with the same one-policy-per-table pattern as the catalog: `USING (brand_id = ANY (app_brand_ids()) OR app_is_platform())` and the same `WITH CHECK`. No context means no rows. Branch scope (a Branch Manager sees one branch) is enforced in the API by `assertCan`, as it is for staff assignments today, because the database context carries brands only.
5. **Money** is `integer` minor units plus a currency code that must be a currency of the market (composite key to `market_currency`). Quantities are `integer` whole units. No floats.
6. **Time**: opening hours, slots and cutoffs are `time` (local wall clock) read in the branch time zone; closures and delivery days are `date`; instants are `timestamptz` (D4-10).
7. **IDs** UUIDv7, timestamps `timestamptz`, `snake_case` through `@map`. Soft delete is not used here: configuration rows have a `status` (active or inactive) and history rows are never deleted.
8. **Audit**: every configuration change and every manual stock change writes an audit row in the same transaction (existing audit module). The stock ledger is the audit of stock itself.
9. **Nothing hardcoded to a brand, branch, category or area.** There are no default zones, slots, hours or cutoffs in the schema or seed.

## 2. Enums

```prisma
enum DeliveryAreaLevel   { EMIRATE CITY AREA }
enum DeliveryMethodKind  { SAME_DAY NEXT_DAY SCHEDULED }
enum RestrictionTarget   { PRODUCT CATEGORY COLLECTION }
enum RestrictionCondition{ AREA ZONE DATE_RANGE WEEKDAY METHOD }
enum AssignmentRuleKind  { COVERS_AREA HAS_STOCK OPEN_IN_TIME PRIORITY CLOSEST LEAST_LOADED }
enum StockMovementType   { RECEIPT ADJUSTMENT_IN ADJUSTMENT_OUT SALE RETURN TRANSFER_OUT TRANSFER_IN WASTAGE PRODUCTION_CONSUMPTION }
enum OutOfStockBehavior  { HIDE SHOW_UNAVAILABLE ALLOW_BACKORDER }
enum ReservationStatus   { ACTIVE COMMITTED RELEASED EXPIRED }
enum TransferStatus      { REQUESTED IN_TRANSIT RECEIVED CANCELLED }
```

They match the shared contracts built in step 4.1 (`@matilda/validation`), and a test compares the two lists.

## 3. Locations (global reference data, no brand column)

```prisma
model DeliveryArea {
  id         String            @id @default(uuid(7)) @db.Uuid
  countryId  String            @map("country_id") @db.Uuid
  parentId   String?           @map("parent_id") @db.Uuid
  level      DeliveryAreaLevel
  code       String            // lower-case, e.g. "dubai", "jumeirah"
  sortOrder  Int               @default(0) @map("sort_order")
  status     ActiveStatus      @default(ACTIVE)
  @@unique([countryId, code])
  @@unique([id, countryId])
  @@index([parentId])
  @@map("delivery_area")
}
model DeliveryAreaTranslation { areaId String; language String; name String; @@id([areaId, language]) @@map("delivery_area_translation") }
```

- Tree rules (trigger): the parent is in the same country; level order is EMIRATE then CITY then AREA (an area may sit directly under an emirate); no cycles.
- Same treatment as `country` and `currency`: no row-level security, readable by the application role; changes are made by platform staff only through the API (permission `delivery.manage` over the platform scope).

## 4. Delivery configuration (brand-keyed)

```prisma
model DeliveryZone {                       // a named group of areas, per brand and market
  id String @id; brandId String; marketId String; code String; sortOrder Int; status ActiveStatus
  @@unique([id, brandId]) @@unique([id, marketId]) @@unique([brandId, marketId, code])
  // FK (market_id, brand_id) -> market
}
model DeliveryZoneTranslation { zoneId; brandId; language; name; @@id([zoneId, language]) }
model DeliveryZoneArea {                   // which areas a zone covers
  zoneId; brandId; marketId; areaId
  @@id([zoneId, areaId])
  @@unique([marketId, areaId])             // an area belongs to at most one zone per market
}
model BranchZone {                         // which branch serves which zone, in priority order
  brandId; branchId; zoneId; priority Int
  @@id([branchId, zoneId]) @@index([zoneId, priority])
}
model DeliveryMethod {                     // same day, next day, scheduled; per brand and market
  id; brandId; marketId; kind DeliveryMethodKind; code String; status ActiveStatus; sortOrder Int
  @@unique([id, brandId]) @@unique([brandId, marketId, code])
}
model DeliveryMethodTranslation { methodId; brandId; language; name; @@id([methodId, language]) }
model ZoneCharge {                         // fee per zone and method, in a market currency
  id; brandId; marketId; zoneId; methodId; currencyCode Char(3)
  feeMinor Int; minimumOrderMinor Int @default(0); freeOverMinor Int?
  @@unique([zoneId, methodId, currencyCode])
  // FK (market_id, currency_code) -> market_currency; zone and method must be in the same market
}
```

- Checks: `fee_minor >= 0`, `minimum_order_minor >= 0`, `free_over_minor IS NULL OR free_over_minor > 0`.
- A zone is for one market, so a zone cannot mix markets or currencies. Zone areas must belong to the market's country (trigger).

## 5. Branch calendar and slots (brand-keyed)

```prisma
model BranchHours {                        // opening ranges of one weekday; several rows allow a lunch break
  id; brandId; branchId; weekday Int(0-6); startTime Time; endTime Time
  @@index([brandId, branchId, weekday])
  // CHECK end_time > start_time; EXCLUDE no overlap per (brand, branch, weekday)
}
model DeliveryClosure {                    // holidays and disabled dates
  id; brandId; marketId String?; branchId String?; closedOn Date; reason String?
  // branch set = that branch closed; market set only = whole market; both empty = whole brand
  @@unique([brandId, coalesce(marketId), coalesce(branchId), closedOn])   // expression index
}
model DeliverySlot {                       // a delivery window with capacity, at a branch
  id; brandId; marketId; branchId; zoneId String?; weekday Int(0-6)
  startTime Time; endTime Time; capacity Int
  cutoffTime Time; cutoffDaysBefore Int @default(0)   // 0 = same day as delivery, 1 = the day before
  methods DeliveryMethodKind[]; status ActiveStatus
  @@unique([id, brandId])
  @@index([brandId, branchId, weekday])
}
```

- Checks: `end_time > start_time`, `capacity > 0`, `cutoff_days_before BETWEEN 0 AND 14`, `cardinality(methods) > 0`. A same-day slot's cutoff time must be before its start time (trigger), otherwise the slot could never be bookable.
- `branch_hours` overlap is prevented by an exclusion constraint on a time range, which needs the `btree_gist` extension created by the owner role in the migration, the same way `pg_trgm` was added (question 4).
- A slot with `zone_id` applies only to that zone; without it the slot applies to every zone the branch serves.

## 6. Restrictions and assignment rules (brand-keyed)

```prisma
model DeliveryRestriction {
  id; brandId; marketId
  target RestrictionTarget; productId String?; categoryId String?; collectionId String?
  condition RestrictionCondition
  areaId String?; zoneId String?; dateFrom Date?; dateTo Date?; weekday Int?; methodKind DeliveryMethodKind?
  note String?; status ActiveStatus
  @@index([brandId, marketId, status])
}
model BranchAssignmentRule {
  id; brandId; marketId; kind AssignmentRuleKind; position Int; status ActiveStatus
  @@unique([marketId, position])
}
```

- Checks: exactly the target column that matches `target` is set; exactly the condition column(s) that match `condition` are set (`DATE_RANGE` needs both dates with `date_to >= date_from`); `weekday` is 0 to 6. Products, categories and collections use composite keys to the brand.
- No free-form rule language (D4-13); a new condition kind is a code change with a migration.

## 7. Inventory (brand-keyed)

```prisma
model InventorySetting {                   // one row per brand (D4-03, D4-05)
  brandId String @id; reservationMinutes Int @default(15); maxExtensions Int @default(1)
  defaultOutOfStock OutOfStockBehavior @default(SHOW_UNAVAILABLE)
}
model StockLevel {                         // one row per (branch, product) or (branch, variation)
  id; brandId; branchId; productId; variationId String?
  onHand Int @default(0); reserved Int @default(0); lowStockThreshold Int @default(0)
  outOfStock OutOfStockBehavior?           // null = the brand default
  updatedAt
  @@unique([id, brandId])
  @@unique([branchId, productId]) where variation_id IS NULL
  @@unique([branchId, variationId]) where variation_id IS NOT NULL
}
model StockMovement {                      // append-only ledger
  id; brandId; stockLevelId; type StockMovementType; quantity Int
  onHandAfter Int; reservedAfter Int
  reason String?; referenceType String?; referenceId String?
  transferId String?; actorStaffId String?; createdAt
  @@index([stockLevelId, createdAt])
}
```

- Checks: `on_hand >= 0`, `reserved >= 0`, `low_stock_threshold >= 0`, and **`reserved <= on_hand OR out_of_stock = 'ALLOW_BACKORDER'`**: the database itself refuses overselling for any product that does not allow backorder, whatever the application does.
- Trigger: a variable product's stock row must name one of its variations and a simple product's must not; a bundle has no stock row (components carry the stock, D4-06); made-to-order products may have none (D4-04).
- `stock_movement` is append-only (update and delete are blocked by trigger, as for `audit_log`). `quantity > 0`; the sign comes from the type. `on_hand_after` and `reserved_after` make the ledger self-checking: a test rebuilds every level from its movements.

## 8. Reservations and transfers (brand-keyed)

```prisma
model StockReservation {
  id; brandId; marketId; status ReservationStatus @default(ACTIVE)
  checkoutRef String            // opaque id of the checkout or cart, set in Phase 5
  expiresAt DateTime; extendedCount Int @default(0)
  committedAt DateTime?; releasedAt DateTime?; createdAt
  @@unique([id, brandId]) @@index([status, expiresAt])
}
model StockReservationLine { reservationId; brandId; stockLevelId; quantity Int; @@id([reservationId, stockLevelId]) }
model SlotDay {                            // booked count of one slot on one date (the lock row)
  brandId; slotId; deliveryDate Date; booked Int @default(0)
  @@id([slotId, deliveryDate])
}
model SlotReservation {
  id; brandId; slotId; deliveryDate Date; units Int @default(1)
  status ReservationStatus; checkoutRef String; expiresAt DateTime; createdAt
  @@index([status, expiresAt]) @@index([slotId, deliveryDate])
}
model StockTransfer {
  id; brandId; fromBranchId; toBranchId; status TransferStatus @default(REQUESTED)
  note String?; requestedById, shippedAt?, receivedAt?, createdAt
  @@unique([id, brandId])
}
model StockTransferLine {
  transferId; brandId; productId; variationId String?
  quantityRequested Int; quantityShipped Int?; quantityReceived Int?; discrepancyNote String?
  @@id([transferId, productId, variationId])   // via a unique index on the three columns
}
```

- Checks: `quantity > 0`, `units > 0`, `expires_at > created_at`, `extended_count >= 0`, `from_branch_id <> to_branch_id`, `booked >= 0`.
- Capacity is enforced atomically in the service by one conditional statement (`UPDATE slot_day SET booked = booked + n WHERE booked + n <= (SELECT capacity ...)`); the same pattern as stock. Status moves are limited by the allowed transitions (a trigger refuses, for example, a `RECEIVED` transfer going back).
- Both transfer sides are written to the ledger as `TRANSFER_OUT` and `TRANSFER_IN` with the same `transfer_id`.
- `checkout_ref` carries no foreign key on purpose: the cart and order tables do not exist until Phases 5 and 6.

## 9. Row-level security policy (all brand-keyed tables)

```sql
ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "<table>" FORCE ROW LEVEL SECURITY;
CREATE POLICY "<table>_scope" ON "<table>"
  USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())
  WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform());
```

Applied to all 21 brand-keyed tables. `matilda_app` receives only `SELECT, INSERT, UPDATE, DELETE` through the existing default privileges, except that `stock_movement` has update and delete blocked by trigger. The public availability reads in step 4.10 use the same helper with the brand resolved from the trusted domain.

## 10. Indexes

- Foreign key columns are all indexed; a migration test lists any that are not.
- Hot paths: `stock_level (branch_id, product_id)` and `(branch_id, variation_id)` (unique, above), `stock_level (brand_id, branch_id)` for the branch stock list, `stock_movement (stock_level_id, created_at)`, `stock_reservation (status, expires_at)` for the expiry job, `slot_day (slot_id, delivery_date)` (primary key), `delivery_slot (brand_id, branch_id, weekday)`, `delivery_zone_area (market_id, area_id)` (unique) for address to zone lookup, `branch_zone (zone_id, priority)`, `delivery_restriction (brand_id, market_id, status)`, `delivery_closure` by date.

## 11. Seed and tests

- **Seed**: nothing in the brand-keyed tables in any tier. For `delivery_area` I propose the seven UAE emirates only (names are fixed public facts); cities and areas come from the list you approve or are entered in the admin (question 2). No zones, slots, hours, charges or cutoffs are seeded.
- **Migration tests** (database-backed, like the catalog): every brand-keyed table has `brand_id`, enabled and forced RLS and exactly one policy; no context returns zero rows; brand A cannot read, insert, update or delete brand B rows in any table (matrix over all 21); every composite foreign key rejects a cross-brand reference; each check constraint and trigger has a passing and a failing case (including overselling refused, ledger append-only, overlapping hours refused, branch not serving the brand refused, area in another country refused); the ledger rebuild test; enum lists match the shared contracts. Existing suites stay green.

## 12. Questions for the owner

1. **Per-brand hours at a shared branch.** Opening hours, slots and stock are keyed by brand and branch, so a kitchen shared by Flower and Cake can have different hours and capacity per brand. If you would rather have one set of physical branch hours for all brands, `branch_hours` and `delivery_closure` become branch-level tables with their own handling of brand isolation. **Recommendation: per brand and branch** (consistent with D4-01).
2. **Location data.** Seed only the seven emirates, with cities and areas entered in the admin or imported from a list you approve; or seed a full Dubai (and Sharjah and Abu Dhabi) area list now. **Recommendation: emirates only, then your list.** Please also confirm Arabic names for the emirates are wanted.
3. **Branch must serve the brand.** A trigger rejects new rows for a branch that has no market of that brand. If a branch later stops serving a market, existing history stays and new rows are blocked. The alternative is a separate `brand_branch` table that states the link directly. **Recommendation: use the trigger, no new table.**
4. **`btree_gist` extension** (created by the owner role) to prevent overlapping opening hours in the database. The alternative is a check in the service only. **Recommendation: use it.**
5. **Slot cutoff model.** A cutoff is a local time plus "days before" (0 = same day). This covers "order before 12:00 for a slot today" and "order before 18:00 the day before". More complex rules (different cutoffs per weekday) are expressed as different slot rows. **Recommendation: as drafted.**
6. **Overselling guard in the database.** The check `reserved <= on_hand` unless the stock row allows backorder. **Recommendation: yes.** Without it overselling is prevented only by service code.
7. **Slot capacity unit.** Capacity counts orders (one unit per order). If a cake order should use several units (a large wedding cake), the reservation `units` column already allows it. **Recommendation: orders, with `units` available.**
8. **Permissions** (from step 4.1) are unchanged by this schema.

## 13. Implementation plan once approved

1. Prisma models and migration `inventory_delivery`: generated tables, then hand-written SQL for the extension, partial and expression indexes, exclusion constraint, check constraints, triggers and RLS. Apply to development and test databases, regenerate the client.
2. The database integration tests in section 11.
3. Docs: `DATABASE.md`, `PROGRESS.md`, `CHANGELOG.md`, `TESTING.md`, `INVENTORY.md`, `DELIVERY.md`; then stop for review of the 4.2 results before step 4.3.
