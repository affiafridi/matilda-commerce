# API

NestJS REST API, versioned, documented with Swagger/OpenAPI. Only the API accesses the database.

## Surfaces [Approved]

```text
/api/v1/storefront/     public catalog, cart, checkout, content (brand-resolved by domain)
/api/v1/cart            guest and customer cart (Phase 5 step 5.4): GET, POST lines, PATCH/DELETE lines/:id, PATCH contact, PUT/DELETE coupon
/api/v1/admin/brands/:brandId/promotions   promotions and coupons (Phase 5 step 5.5)
/api/v1/admin/          staff operations (brand/market/branch scoped)
/api/v1/customer/       authenticated customer account
/api/v1/production/     production staff views
/api/v1/delivery/       delivery manager / rider operations
/api/v1/webhooks/       inbound provider callbacks (signature-verified)
/api/v1/integrations/   external/system integrations (API-key or OAuth, scoped)
```

Each surface has its own guards, DTOs and rate limits. Staff and customer authentication never share a realm.

## Standards [Approved]

- REST conventions, proper HTTP status codes, consistent error envelope (code, message, field errors, request id).
- Request validation (Zod/DTO); response validation where appropriate; never expose internal DB models or unnecessary sensitive data.
- Pagination, filtering, sorting, searching on list endpoints (cursor or offset — **[Open]**).
- Authentication + granular permission guards + brand/market/branch scope on every protected route.
- Rate limiting (Redis), brute-force protection on auth.
- **Idempotency keys** for checkout, payment initiation, refunds, order creation.
- Database transactions for multi-step writes; efficient queries — no `SELECT *`, no N+1.
- Structured logging (Pino) with request ids, no secrets/PII.
- Webhook signature verification, replay protection, idempotent handling.
- Swagger/OpenAPI generated per surface; kept current.
- Business logic in services, not controllers.

## Implemented in Phase 1

- Base path `/api/v1`; `GET /api/v1/health` (liveness) and `GET /api/v1/health/ready` (readiness; 503 when the database is unreachable). Both are public and exempt from request logging.
- Swagger UI `/api/docs` and JSON `/api/docs-json` (enabled by default outside production; `SWAGGER_ENABLED` overrides).
- Standard error body (`ApiErrorBody` in `@matilda/types`): `statusCode`, `code`, `message`, optional `errors[{path,message}]`, `requestId`, `timestamp`, `path`. Unknown errors return `INTERNAL_ERROR` with no internals; details go to logs only.
- `X-Request-Id` is accepted (8–64 chars `[\w-]`) or generated, echoed on every response, and attached to logs.
- Input validation uses `ZodValidationPipe` with schemas from `@matilda/validation` (`VALIDATION_FAILED` with per-field errors).
- Helmet security headers; CORS restricted to `CORS_ORIGINS`.
- Not implemented yet: surface prefixes (`/storefront`, `/admin`, ...), authentication, authorization guards, tenant resolution, rate limiting, idempotency, pagination helpers beyond the shared query schema.

## Admin management API (Phase 2 step 2.7)

`POST /api/v1/admin/auth/csrf` issues a fresh per-session CSRF token for the current session cookie (needed after a page reload; Origin-checked, response unreadable cross-site); the old token stops working.

All under `/api/v1/admin`, cookie-authenticated, tagged `admin-*` in Swagger. Reads need the `*.view` permission, writes the `*.manage` one (sensitive ones also need a fresh step-up). Out-of-scope records answer 404 and lists are filtered to scope. List responses for staff are paginated (`page`, `pageSize`); the audit log uses keyset paging (`before`, `limit`, response `nextBefore`).

| Area | Routes |
|---|---|
| Context | `GET /me`, `GET /me/context` (optional `X-Admin-Brand`) |
| Brands | `GET/POST /brands`, `GET/PATCH /brands/:id`, `GET/POST /brands/:id/domains`, `PATCH/DELETE /brands/:id/domains/:domainId` |
| Markets | `GET/POST /markets`, `GET/PATCH /markets/:id` |
| Branches | `GET/POST /branches`, `GET/PATCH /branches/:id`, `PUT/DELETE /branches/:id/markets/:marketId` |
| Staff | `GET/POST /staff`, `GET/PATCH /staff/:id`, `POST /staff/:id/invite`, `PATCH /staff/:id/status`, `POST /staff/:id/assignments`, `DELETE /assignments/:id` |
| Access | `GET /permissions`, `GET/POST /roles`, `GET/PATCH/DELETE /roles/:id`, `POST /roles/:id/clone` |
| Audit | `GET /audit` |

## Catalog admin API (Phase 3 step 3.3)

All under `/api/v1/admin/brands/:brandId/catalog`, cookie-authenticated like the rest of the admin API. The brand is part of the path and is authorized by the server: reads need `products.view` and writes `taxonomy.manage` over that brand (a market- or branch-scoped grant cannot edit brand-wide catalog data); a record of another brand answers 404. Lists are paginated (`page`, `pageSize`) and support `search`; taxonomy lists also take `status`. Validation errors answer 400, business-rule errors 422, conflicts 409.

| Area | Routes |
|---|---|
| Taxonomy (`:kind` = `categories`, `collections` or `tags`) | `GET/POST /:kind`, `GET/PATCH/DELETE /:kind/:id`, `PUT/DELETE /:kind/:id/translations/:language` |
| Attributes | `GET/POST /attributes`, `GET/PATCH/DELETE /attributes/:id`, `PUT/DELETE /attributes/:id/translations/:language` |
| Attribute values | `POST /attributes/:id/values`, `PATCH/DELETE /attributes/:id/values/:valueId`, `PUT/DELETE /attributes/:id/values/:valueId/translations/:language` |

- Create takes `translations` (English required, one per language); a missing `slug` is built from the name (`SLUG_REQUIRED` when the name has no letters or digits). Same slug in the same language answers `SLUG_TAKEN` (409).
- Categories accept `parentId`; `CATEGORY_TREE_INVALID` (422) for a cycle or more than 4 levels, `PARENT_NOT_FOUND`, `CATEGORY_HAS_CHILDREN` and `CATEGORY_IN_USE` (409) on delete.
- Attributes: `KEY_TAKEN` (409), `ATTRIBUTE_IN_USE` and `ATTRIBUTE_VALUE_IN_USE` (409) when products use them, `COLOUR_NOT_ALLOWED` (422) for colours on non-colour attributes. Deleting the English translation answers `ENGLISH_REQUIRED` (422).
- Deletes are soft. Changed or deleted slugs of categories and collections are kept as redirect history; tags have no public URL and keep none.
- Audit actions: `category|collection|tag.create|update|delete|translation.set|translation.delete`, `attribute.create|update|delete|translation.*|value.*`.

### Products (Phase 3 step 3.4)

Under the same base path, `/products`. Same authorization model; each action needs its own permission over the brand: `products.view` (list, get), `products.create`, `products.edit` (details, translations, taxonomy, availability), `products.delete`, `products.publish` (publish, unpublish, archive and setting `publishAt` or `unpublishAt`).

| Action | Route |
|---|---|
| List, create | `GET/POST /products` (list filters: `search`, `status`, `type`, `categoryId`, `page`, `pageSize`) |
| Read, edit, delete | `GET/PATCH/DELETE /products/:id` |
| Translations | `PUT/DELETE /products/:id/translations/:language` |
| Categories, collections, tags, primary category | `PUT /products/:id/taxonomy` (replaces all) |
| Markets and branches | `PUT /products/:id/availability` (replaces all) |
| Status | `POST /products/:id/publish`, `/unpublish`, `/archive` |

- A product is created as a draft whatever status is sent. Responses include `visibility` (`draft`, `scheduled`, `live`, `expired`, `archived`), derived from status and the publish window, and the ids of its categories, collections, tags, markets and branches.
- Errors: `SKU_TAKEN`, `SLUG_TAKEN` (409); `SKU_NOT_ALLOWED`, `QUANTITY_INVALID`, `SCHEDULE_INVALID`, `NOT_PUBLISHABLE`, `TYPE_LOCKED`, `MARKET_NOT_FOUND`, `BRANCH_NOT_AVAILABLE`, `CATEGORY_NOT_FOUND`, `COLLECTION_NOT_FOUND`, `TAG_NOT_FOUND`, `ENGLISH_REQUIRED` (422); `PRODUCT_IN_USE` (409, bundle component or add-on).
- Attributes and variations (step 3.5), all under `/products/:id` with `products.view` to read and `products.edit` to change:

| Action | Route |
|---|---|
| Attributes of a product | `GET/PUT /attributes` (replaces all: `attributeId`, `drivesVariations`, `visible`, `sortOrder`, `valueIds`) |
| Variations | `GET /variations`, `POST /variations/generate` (`skuPrefix`), `POST /variations` (`sku`, `values` as attributeId to valueId), `PATCH /variations` (bulk `items`), `PATCH/DELETE /variations/:variationId` |

  Errors: `NOT_VARIABLE`, `NO_VARIATION_ATTRIBUTES`, `TOO_MANY_VARIATIONS`, `COMBINATION_INVALID`, `SKU_INVALID`, `ATTRIBUTE_NOT_FOUND`, `VALUE_NOT_FOUND`, `DUPLICATE_ATTRIBUTE` (422); `SKU_TAKEN`, `COMBINATION_EXISTS`, `ATTRIBUTE_IN_USE_BY_VARIATIONS`, `VALUE_IN_USE_BY_VARIATIONS`, `VARIATION_IN_USE` (409). A variation's price, image and stock come in steps 3.6, 3.9 and Phase 4.
- Prices (step 3.6), under `/products/:id`: `GET /prices` (`products.view`), `PUT /prices` (`pricing.edit`; replaces all; body `prices: [{marketId, currency, regular, sale?, saleStartsAt?, saleEndsAt?, variationId?}]`, amounts in minor units such as fils), `DELETE /prices/:priceId` (`pricing.edit`), `GET /price-preview?marketId=&at=` (`products.view`; returns per item `regular`, `sale`, `effective`, `onSale` and a plain decimal `display`). `variationId` is required for variable products and not allowed for others. Errors: `VARIATION_REQUIRED`, `VARIATION_NOT_ALLOWED`, `VARIATION_NOT_FOUND`, `DUPLICATE_PRICE`, `MARKET_NOT_FOUND`, `CURRENCY_NOT_IN_MARKET` (422), amounts that are not whole non-negative numbers or a sale not below the regular price (400). Display formatting with symbols and locale belongs to the storefront.
- Customization options (step 3.7): `GET /products/:id/options` (`products.view`) and `PUT /products/:id/options` (`products.edit`; also `pricing.edit` when any option price changes). Body `groups: [{key, type, required, minSelect, maxSelect, maxLength, sortOrder, translations:[{language,label,helpText}], choices:[{key, sortOrder, translations, prices}], prices:[{marketId,currency,delta}], showWhen:[{groupKey, operator: FILLED|EQUALS|NOT_EQUALS, choiceKey}]}]`. The whole list replaces the current one; options and choices are matched by `key`. Errors (422): `ENGLISH_REQUIRED`, `DUPLICATE_OPTION_KEY`, `DUPLICATE_CHOICE_KEY`, `CHOICES_REQUIRED`, `CHOICES_NOT_ALLOWED`, `MAX_LENGTH_NOT_ALLOWED`, `SELECTION_LIMITS_INVALID`, `PRICE_TARGET_INVALID`, `DUPLICATE_PRICE`, `RULE_TARGET_NOT_FOUND`, `RULE_INVALID`, `RULE_CYCLE`, `MARKET_NOT_FOUND`, `CURRENCY_NOT_IN_MARKET`. Options never change a SKU or stock; the storefront and checkout apply the visibility rules and charges in later phases.
- Add-ons (step 3.8): `GET /products/:id/addons` (`products.view`), `PUT /products/:id/addons` (`products.edit`; also `pricing.edit` when an add-on price changes). Body `groups: [{key, required, minSelect, maxSelect, sortOrder, translations, items:[{kind: INLINE|PRODUCT, key?, productId?, variationId?, maxQuantity, sortOrder, translations, prices:[{marketId,currency,delta}]}]}]`. Inline items have a key, an English label and prices; product items name a simple product, or a variation of a variable product, and take that product's own price (no `prices`). Errors (422): `DUPLICATE_ADDON_KEY`, `DUPLICATE_ADDON_ITEM`, `ADDON_ITEM_INVALID`, `PRICE_NOT_ALLOWED`, `SELECTION_LIMITS_INVALID`, `ADDON_SELF`, `ADDON_PRODUCT_NOT_FOUND`, `ADDON_PRODUCT_INVALID`, `VARIATION_REQUIRED`, `VARIATION_NOT_FOUND`, `VARIATION_NOT_ALLOWED`, plus the price errors of options.
- Public catalog (step 3.10, no sign-in, brand and market from the request host): `GET /api/v1/catalog/categories` (tree), `/collections`, `/products?category&collection&tag&q&sort=featured|newest|price_asc|price_desc&page&limit` (limit at most 48, default 24; response `{language,total,page,limit,items}`) and `/products/:slug`. Common query: `language` (a language of the market; otherwise 400 `UNSUPPORTED_LANGUAGE`) and, only on brand-wide domains, `market` (market code). Errors: 404 `TENANT_NOT_FOUND` (unknown host), `MARKET_REQUIRED`, `MARKET_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `COLLECTION_NOT_FOUND`, `TAG_NOT_FOUND`. Prices are `{currency, amount (minor units), regular, onSale, display, from?}`; `from` is true for a variable product's lowest price. Product detail adds `images`, `categories`, `tags`, `attributes`, `variations` (id, price, picture, chosen values), `options`, `addons`, `bundle` and `alternates` (slug in each language). Cache-Control is `public, max-age=30, stale-while-revalidate=60`, `Vary: Host, X-Forwarded-Host`.
- Media (step 3.9, permission `media.manage` over the brand): `POST /media` (multipart form with `file` and optional `altText`, English) returns the asset with its variants (`THUMBNAIL` 320, `MEDIUM` 800, `LARGE` 1600 pixels wide); `GET /media?limit&offset`; `GET /media/:id`; `PUT /media/:id/alt` (`translations: [{language, altText}]`, English required); `DELETE /media/:id` (204). `GET/PUT /products/:id/media` (`items: [{mediaAssetId, isPrimary?}]`, at most 30, order = display order) and `PUT /products/:id/variations/:variationId/media` (`mediaAssetId` or `null`). Errors: 400 `FILE_REQUIRED`; 413 `FILE_TOO_LARGE`; 409 `DUPLICATE_MEDIA`, `MEDIA_IN_USE`; 422 `UNSUPPORTED_IMAGE`, `ALT_REQUIRED`, `MEDIA_NOT_FOUND`, `MEDIA_NOT_READY`, `DUPLICATE_MEDIA_ITEM`, `PRIMARY_MEDIA_CONFLICT`, `ENGLISH_REQUIRED`.
- Public pictures (step 3.9): `GET /api/v1/media/:brandId/:assetId/:kind` with `kind` = `thumbnail`, `medium` or `large`. No sign-in; only the resized WebP variants are served (never the original), with `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: cross-origin`. A changed picture is a new asset, so the long cache is safe.
- Bundles (step 3.8): `GET/PUT /products/:id/bundle` (`products.view` / `products.edit`; bundle products only). Body `items: [{productId, variationId?, quantity, sortOrder}]`. The bundle's price is its own fixed per-market price (`/prices`). Errors (422): `NOT_BUNDLE`, `COMPONENT_SELF`, `COMPONENT_NOT_FOUND`, `COMPONENT_INVALID`, `DUPLICATE_COMPONENT`, `VARIATION_REQUIRED`, `VARIATION_NOT_FOUND`, `VARIATION_NOT_ALLOWED`. Deleting a product or variation used as a component or add-on answers 409 (`PRODUCT_IN_USE`, `VARIATION_IN_USE`).
- A product with no market is sold nowhere. Variations (3.5), prices (3.6), options (3.7), add-ons and bundles (3.8) and media (3.9) attach to products later; step 3.5 and 3.6 will add their requirements to publishing.

## Delivery API (Phase 4 step 4.3)

- Locations (shared tree, no brand): `GET /admin/delivery/areas?countryIso2&parentId&level` (`delivery.view`), `GET /admin/delivery/areas/:id`; platform staff only (`delivery.manage` with no brand scope): `POST` (`countryIso2, parentId?, level EMIRATE|CITY|AREA, code, sortOrder, status, translations[{language,name}]`), `PATCH /:id` (`code, sortOrder, status`), `PUT/DELETE /:id/translations/:language`, `DELETE /:id` (204). Errors: 422 `ENGLISH_REQUIRED`, `DUPLICATE_LANGUAGE`, `UNKNOWN_COUNTRY`, `PARENT_NOT_FOUND`, `AREA_TREE_INVALID` (an emirate is the top, a city sits under an emirate, an area under an emirate or a city); 409 `AREA_CODE_TAKEN`, `AREA_IN_USE` (sub-locations, zone coverage or restrictions exist).
- Zones (over the brand in the path): `GET /admin/brands/:brandId/delivery/zones?marketId` and `/:id` (`delivery.view`); `POST` (`marketId, code, sortOrder, status, translations`), `PATCH /:id`, `PUT/DELETE /:id/translations/:language`, `PUT /:id/areas` (`areaIds`, replaces coverage), `PUT /:id/branches` (`branches:[{branchId, priority}]`, replaces serving branches), `DELETE /:id` (204) all need `delivery.manage`. A zone is `{id, marketId, code, sortOrder, status, translations, areaIds, branches}`. Errors: 404 `MARKET_NOT_FOUND`, `ZONE_NOT_FOUND`; 409 `ZONE_CODE_TAKEN`, `AREA_ALREADY_COVERED` (a location is in one zone per market), `ZONE_IN_USE` (charges, slots or restrictions exist); 422 `ENGLISH_REQUIRED`, `AREA_NOT_FOUND`, `AREA_COUNTRY_MISMATCH`, `BRANCH_NOT_FOUND` (also for a branch of another brand), `BRANCH_NOT_AVAILABLE` (branch not linked to the zone's market), `DUPLICATE_BRANCH`. Every write is audited (`delivery.area.*`, `delivery.zone.*`).

### Calendar, methods and charges (step 4.4)

All under `/admin/brands/:brandId/delivery`. Reads need `delivery.view`; the calendar writes need `branches.calendar`; methods and charges need `delivery.manage` (sensitive, step-up). The service checks the permission again over the record's own scope.

- Hours: `GET branches/:branchId/hours` returns `{branchId, timezone, days:[{weekday 0-6 (0 = Sunday), ranges:[{start,end}]}]}` for all seven days (closed days have no ranges). `PUT` replaces the week with `days` (HH:mm local time, up to four ranges per day, no overlaps, each weekday once). A branch the brand does not serve is 404. Hours belong to the brand, so a branch shared by two brands keeps separate hours for each.
- Closures: `GET closures?from&to&marketId&branchId` (dates `YYYY-MM-DD`), `POST closures {closedOn, marketId?, branchId?, reason?}` (not both market and branch; none means the whole brand), `DELETE closures/:id` (204). Brand and market closures need `delivery.manage`; a branch closure needs `branches.calendar` (or `delivery.manage`) over that branch.
- Methods: `GET methods?marketId`, `GET/PATCH/DELETE methods/:id`, `POST methods {marketId, kind SAME_DAY|NEXT_DAY|SCHEDULED, code, sortOrder, status, translations}`, `PUT/DELETE methods/:id/translations/:language`. Errors: 422 `ENGLISH_REQUIRED`; 409 `METHOD_CODE_TAKEN`, `METHOD_IN_USE` (it has charges); 404 `MARKET_NOT_FOUND`.
- Charges: `GET charges?zoneId&methodId`, `POST charges {zoneId, methodId, currencyCode, feeMinor, minimumOrderMinor = 0, freeOverMinor?}`, `PATCH charges/:id`, `DELETE charges/:id`. Amounts are whole minor units (no fractions or negatives); `freeOverMinor` cannot be below `minimumOrderMinor`. Errors: 422 `MARKET_MISMATCH`, `CURRENCY_NOT_IN_MARKET`, `THRESHOLD_BELOW_MINIMUM`; 409 `CHARGE_EXISTS`. Fees are applied by the backend at checkout (later phases), never taken from the client.
- Audit actions: `delivery.hours.put`, `delivery.closure.create|delete`, `delivery.method.*`, `delivery.charge.*`.

### Slots (step 4.5)

`/admin/brands/:brandId/delivery/slots`: `GET ?marketId&branchId&zoneId&weekday` and `GET /:id` (`delivery.view`); `POST`, `PATCH /:id`, `DELETE /:id` (204) need `delivery.manage`. A slot is `{id, marketId, branchId, zoneId|null, weekday 0-6, startTime, endTime, capacity, cutoffTime, cutoffDaysBefore 0-14, methods[SAME_DAY|NEXT_DAY|SCHEDULED], status}`; times are local `HH:mm` in the branch time zone, capacity is whole orders per date, and `zoneId` empty means every zone the branch serves. Errors: 422 `SLOT_RANGE_INVALID`, `SLOT_CUTOFF_INVALID` (same-day cutoff must be before the start), `DUPLICATE_METHOD_KIND`, `MARKET_MISMATCH`, `BRANCH_NOT_AVAILABLE`; 409 `SLOT_EXISTS`, `SLOT_IN_USE` (bookings on record; set it inactive); 404 `MARKET_NOT_FOUND`, `BRANCH_NOT_FOUND`, `ZONE_NOT_FOUND`, `SLOT_NOT_FOUND`. Audit: `delivery.slot.create|update|delete`.

### Restrictions (step 4.6)

`/admin/brands/:brandId/delivery/restrictions`: `GET ?marketId&target&targetId&condition&status` and `GET /:id` (`delivery.view`); `POST`, `PATCH /:id` (only `note` and `status`), `DELETE /:id` (204) need `delivery.manage` (sensitive, step-up). A restriction means the target cannot be delivered when the condition matches. Body: `{marketId, target PRODUCT|CATEGORY|COLLECTION, targetId, condition, note?, status}` plus the field of the condition: `AREA` with `areaId`, `ZONE` with `zoneId`, `DATE_RANGE` with `dateFrom` and `dateTo` (`YYYY-MM-DD`, end not before start), `WEEKDAY` with `weekday` 0-6, `METHOD` with `methodKind`. To change what a rule does, delete it and add another. Errors: 404 `MARKET_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `COLLECTION_NOT_FOUND`, `ZONE_NOT_FOUND`, `AREA_NOT_FOUND`, `RESTRICTION_NOT_FOUND`; 422 `MARKET_MISMATCH`, `AREA_COUNTRY_MISMATCH`. Deleting a zone or location that restrictions use answers 409 (`ZONE_IN_USE`, `AREA_IN_USE`). Audit: `delivery.restriction.create|update|delete`.

### Inventory: stock levels and ledger (step 4.7)

All under `/admin/brands/:brandId/inventory`. The route permission gates entry; the service checks `inventory.view` / `inventory.adjust` over the brand and over the branch of each stock row.

- `GET settings` (`inventory.view`), `PUT settings` (`inventory.adjust` over the whole brand): `{reservationMinutes 1-240, maxExtensions 0-5, defaultOutOfStock HIDE|SHOW_UNAVAILABLE|ALLOW_BACKORDER}`. Moving the default to `ALLOW_BACKORDER` also sets it on rows that follow the default (`rowsSetToBackorder` in the answer).
- `GET stock?branchId&productId&variationId&low&page&pageSize` returns `{items, page, pageSize, total}`; a row is `{id, branchId, productId, variationId, onHand, reserved, available, lowStockThreshold, low, outOfStock, effectiveOutOfStock}`. `POST stock {branchId, productId, variationId?, lowStockThreshold?, outOfStock?}` starts tracking at zero; `GET/PATCH stock/:id` (`lowStockThreshold`, `outOfStock`; 409 `STOCK_RESERVED` when backorder cannot be switched off yet).
- `POST stock/:id/movements {type RECEIPT|ADJUSTMENT_IN|ADJUSTMENT_OUT|WASTAGE, quantity, reason, referenceType?, referenceId?}` (reason required except for receipts) and `POST stock/:id/count {counted, reason}` return `{movement, stock}`. `GET stock/:id/movements?limit&before` returns `{items, next}` newest first.
- Errors: 404 `STOCK_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `BRANCH_NOT_FOUND`; 409 `STOCK_ROW_EXISTS`, `INSUFFICIENT_STOCK`, `STOCK_RESERVED`; 422 `STOCK_SHAPE_INVALID` (bundle, variable product without variation, simple product with variation), `BRANCH_NOT_AVAILABLE`, `QUANTITY_TOO_LARGE`, `NO_CHANGE`. Audit: `inventory.stock.create|update|<movement type>`, `inventory.settings.put`.

### Inventory: reservations (step 4.8)

Under `/admin/brands/:brandId/inventory/reservations`; both routes need brand-wide inventory permissions (a branch-scoped manager gets 403).

- `GET ?status=ACTIVE|COMMITTED|RELEASED|EXPIRED&limit` (`inventory.view`) returns `{stock: [{checkoutRef, status, expiresAt, lines: [{stockLevelId, quantity}]}], slots: [{checkoutRef, status, slotId, date, units, expiresAt}]}`.
- `POST :checkoutRef/release` (`inventory.adjust`) frees an open hold; 404 when nothing is open. Audit `inventory.reservation.release`.
- Service contract for the checkout (Phase 5, no HTTP route): `hold({brandId, marketId, checkoutRef, lines[], slot?{slotId, date, units}})`, `extend`, `confirm(brandId, checkoutRef, orderRef)`, `release`, `expireDue`. Errors: 404 `STOCK_NOT_FOUND`, `SLOT_NOT_FOUND`, `MARKET_NOT_FOUND`, `RESERVATION_NOT_FOUND`; 409 `INSUFFICIENT_STOCK`, `SLOT_FULL`, `RESERVATION_EXISTS`, `RESERVATION_EXPIRED`, `EXTENSION_LIMIT`; 422 `SLOT_DATE_MISMATCH`.

### Inventory: transfers (step 4.9)

Under `/admin/brands/:brandId/inventory/transfers`. Route entry needs `inventory.view` (reads) or `inventory.transfer` (writes); the service then checks the permission over the branch concerned.

- `GET ?status=REQUESTED|IN_TRANSIT|RECEIVED|CANCELLED&branchId&discrepancy=true` and `GET :id`. A transfer is `{id, fromBranchId, toBranchId, status, note, shippedAt, receivedAt, createdAt, hasDiscrepancy, lines: [{id, productId, variationId, quantityRequested, quantityShipped, quantityReceived, discrepancy, difference, discrepancyNote}]}`.
- `POST {fromBranchId, toBranchId, note?, lines: [{productId, variationId?, quantity}]}` requests a transfer (1 to 100 distinct items, branches differ).
- `POST :id/ship {lines?: [{lineId, quantity}]}` (default: all requested quantities), `POST :id/receive {lines?: [{lineId, quantity, note?}]}` (default: the shipped quantities), `POST :id/cancel {reason?}`.
- Errors: 409 `TRANSFER_STATE`, `INSUFFICIENT_STOCK`, `STOCK_RESERVED`; 404 `STOCK_NOT_FOUND`; 422 `SHIPPED_EXCEEDS_REQUESTED`, `NOTHING_TO_SHIP`, `DISCREPANCY_NOTE_REQUIRED`, `QUANTITY_TOO_LARGE`. Audit: `inventory.transfer.request|ship|receive|cancel`.

### Delivery: availability, assignment and the tester (steps 4.10 and 4.11)

Public reads (brand from the host, `Cache-Control: no-store`, no branch ids or quantities in the answers):

- `GET /delivery/areas` the areas the market delivers to, with names in the shopper's language.
- `POST /delivery/availability {areaId, lines: [{productId, variationId?, quantity}], from?, days?}` (1 to 50 lines, 1 to 31 days, default 14) returns `{deliverable, reason, zoneId, dates: [{date, slots: [{slotId, start, end, method: {id, kind}, currencyCode, feeMinor, minimumOrderMinor, freeOverMinor}]}]}`. `reason` is `AREA_NOT_COVERED`, `RESTRICTED`, `NO_BRANCH_CAN_SERVE`, `NO_SLOTS` or null. 404 `PRODUCT_NOT_FOUND`, `VARIATION_NOT_FOUND`, `AREA_NOT_FOUND`; 422 `QUANTITY_OUT_OF_RANGE`.
- `POST /delivery/stock-status {lines}` returns `AVAILABLE`, `LOW` or `UNAVAILABLE` per line.

Admin, under `/admin/brands/:brandId/delivery`:

- `GET assignment-rules?marketId` returns `{marketId, rules: [{id, kind, position, status, ranks}]}`; `PUT assignment-rules {marketId, rules: [{kind, status}]}` replaces the list (`delivery.manage`, audited as `delivery.assignment_rules.put`). Kinds: `COVERS_AREA`, `HAS_STOCK`, `OPEN_IN_TIME` (always on) and `PRIORITY`, `CLOSEST`, `LEAST_LOADED` (ranking).
- `POST availability-test {marketId, areaId, lines, from?, days?}` the same answer a shopper would get, plus the branches able to serve it (`delivery.view`).
- `POST assignment/preview {marketId, areaId, lines, date, slotId?, location?, branchId?}` returns `{chosenBranchId, reason, rules, ranking: [{branchId, priority, loadBooked, distanceMeters}], check?}`. 409 `NO_ELIGIBLE_BRANCH`, `SLOT_UNAVAILABLE`.
- `POST assignment/override {marketId, areaId, lines, date, slotId?, branchId, reason, reference?}` (`delivery.assign`) returns `{branchId, automaticBranchId, changed}`; 422 `BRANCH_NOT_ELIGIBLE`; audit `delivery.assignment.override`.

## Customer API (Phase 2 step 2.8)

Brand comes from the host only. Cookie `matilda_customer`; mutations need a same-brand `Origin` and, when signed in, the `X-CSRF-Token` returned by login.

| Route | Notes |
|---|---|
| `POST /customer/auth/register` | 202 always (enumeration-safe) |
| `POST /customer/auth/verify-email` | `{token}`, single-use, 24 h |
| `POST /customer/auth/login` | 200 + cookie + `csrfToken`; uniform 401; 429 after repeated failures |
| `POST /customer/auth/forgot-password` | 202 always |
| `POST /customer/auth/reset-password` | `{token, password}`, single-use, 1 h, revokes sessions |
| `GET/PATCH /customer/me` | profile and marketing consent |
| `POST /customer/auth/logout`, `/customer/me/verification-email`, `/customer/me/password`, `/customer/me/deletion-request` | signed in |
| `GET /admin/customers[/:id]` | staff, `customers.view`, brand-wide or platform scope |

## Tenant resolution [Approved]

Brand is derived from the trusted domain→brand mapping (and authenticated context). Headers/body/query IDs for brand are ignored or validated against the resolved context. See [MULTI-STORE](MULTI-STORE.md).

## Authorization [Approved]

Guard checks: (1) authenticated actor type, (2) required permission(s), (3) the target record's brand/market/branch inside the actor's assigned scope. Sensitive actions (refund approval, payment config, role changes, data export) require additional controls and audit entries ([SECURITY](SECURITY.md)).

## Versioning [Proposed]

URL major versions (`/v1`); additive changes within a version; deprecation window before removal.

## Open

Cursor vs offset pagination defaults; public API-key scheme for integrations; rate limit numbers; GraphQL is **not** planned.
