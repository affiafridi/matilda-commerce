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
