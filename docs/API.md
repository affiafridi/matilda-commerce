# API

NestJS REST API, versioned, documented with Swagger/OpenAPI. Only the API accesses the database.

## Surfaces [Approved]

```text
/api/v1/storefront/     public catalog, cart, checkout, content (brand-resolved by domain)
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
- Media (step 3.9, permission `media.manage` over the brand): `POST /media` (multipart form with `file` and optional `altText`, English) returns the asset with its variants (`THUMBNAIL` 320, `MEDIUM` 800, `LARGE` 1600 pixels wide); `GET /media?limit&offset`; `GET /media/:id`; `PUT /media/:id/alt` (`translations: [{language, altText}]`, English required); `DELETE /media/:id` (204). `GET/PUT /products/:id/media` (`items: [{mediaAssetId, isPrimary?}]`, at most 30, order = display order) and `PUT /products/:id/variations/:variationId/media` (`mediaAssetId` or `null`). Errors: 400 `FILE_REQUIRED`; 413 `FILE_TOO_LARGE`; 409 `DUPLICATE_MEDIA`, `MEDIA_IN_USE`; 422 `UNSUPPORTED_IMAGE`, `ALT_REQUIRED`, `MEDIA_NOT_FOUND`, `MEDIA_NOT_READY`, `DUPLICATE_MEDIA_ITEM`, `PRIMARY_MEDIA_CONFLICT`, `ENGLISH_REQUIRED`.
- Public pictures (step 3.9): `GET /api/v1/media/:brandId/:assetId/:kind` with `kind` = `thumbnail`, `medium` or `large`. No sign-in; only the resized WebP variants are served (never the original), with `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: cross-origin`. A changed picture is a new asset, so the long cache is safe.
- Bundles (step 3.8): `GET/PUT /products/:id/bundle` (`products.view` / `products.edit`; bundle products only). Body `items: [{productId, variationId?, quantity, sortOrder}]`. The bundle's price is its own fixed per-market price (`/prices`). Errors (422): `NOT_BUNDLE`, `COMPONENT_SELF`, `COMPONENT_NOT_FOUND`, `COMPONENT_INVALID`, `DUPLICATE_COMPONENT`, `VARIATION_REQUIRED`, `VARIATION_NOT_FOUND`, `VARIATION_NOT_ALLOWED`. Deleting a product or variation used as a component or add-on answers 409 (`PRODUCT_IN_USE`, `VARIATION_IN_USE`).
- A product with no market is sold nowhere. Variations (3.5), prices (3.6), options (3.7), add-ons and bundles (3.8) and media (3.9) attach to products later; step 3.5 and 3.6 will add their requirements to publishing.

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
