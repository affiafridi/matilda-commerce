# Phase 2 Plan: Multi-Store and Access Foundation

**Status: APPROVED by the owner on 2026-11-25 (all decisions D2-01 to D2-20 as recommended). Implementation in progress: step 2.1 done; steps 2.2 to 2.11 done; the owner approved Phase 2 as complete on 2026-11-25)** ([PHASE-2-SCHEMA-DRAFT.md](PHASE-2-SCHEMA-DRAFT.md)). Step 2.6 was approved; the design brief was approved at 2.9 and the finished step stops for owner review. Phase 3 is out of scope. Live status: [PROGRESS.md](PROGRESS.md).

Related: [ROADMAP](ROADMAP.md) · [MULTI-STORE](MULTI-STORE.md) · [ROLES-AND-PERMISSIONS](ROLES-AND-PERMISSIONS.md) · [CUSTOMER-AUTH](CUSTOMER-AUTH.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [API](API.md) · [ADMIN-PANEL](ADMIN-PANEL.md) · [DESIGN-SYSTEM](DESIGN-SYSTEM.md) · [DECISIONS](DECISIONS.md)

## 1. Goal and boundaries

**Goal:** a secure, tested foundation that answers three questions on every request: *which brand/market is this?* (tenancy), *who is this?* (authentication) and *may they do this here?* (authorization with brand/market/branch scope) — with every sensitive action audited.

**In scope**
- Reference data, brands, domains, countries, markets (currencies/languages), branches and their links.
- Staff authentication (password + mandatory TOTP 2FA, sessions, lockout, step-up), staff/role/permission management.
- Registered-customer authentication (API) and the guest actor.
- 12 role templates, custom roles, granular permissions, scoped assignments.
- Tenant isolation at application level and, subject to a spike, PostgreSQL row-level security (RLS).
- Audit logging; seed strategy; Super Admin bootstrap.
- Admin shell: login/2FA, permission-based navigation, brand/market/branch switchers, management screens for the entities above.
- DB-backed integration, authorization and isolation test suites.

**Out of scope (later phases)**
- Products, inventory, delivery rules, carts, orders, payments, CMS/SEO content, notifications beyond an email port with a dev adapter.
- Storefront UI, customer-facing account screens, and storefront theming (Phase 8). Phase 2 delivers customer auth as API + tests only.
- Branch opening hours, capacity, delivery slots (Phase 4); saved customer addresses (need Phase 4 delivery locations); phone/SMS verification (provider undecided); social login; staff SSO.
- Payment configuration entities (Phase 5), though the permission keys are reserved now.

## 2. Phase 1 baseline (what exists)

NestJS 11 API with `/api/v1`, Zod env, Pino request-id logging, global exception filter and `ZodValidationPipe`, Helmet, CORS allow-list, lazy `PrismaService` (Prisma 7.10.1 + `@prisma/adapter-pg`, **no models**), health/readiness, Swagger. Next.js 16 storefront (3000) and admin (3001) with one unstyled status page each. Shared packages: `config`, `types`, `validation`, `api-client` (+ empty `ui`, `commerce`). Docker PostgreSQL 17 on host port **5434** with a persistent volume (unchanged). Tests: Jest (API) and `node:test` (packages/frontends).

Gaps Phase 2 must fill: DB-backed test strategy, per-request tenant/actor context, cookie handling, hand-written SQL migrations (Prisma cannot express partial indexes, check constraints, RLS or triggers).

## 3. Architecture

### 3.1 Request pipeline (every API request)

```text
Request → request-id/logging → TenantResolver (host → brand/market/language)
        → ActorResolver (staff session | customer session | guest)
        → CSRF/Origin check (cookie-authenticated mutations)
        → Guards: Authenticated → Permission+Scope (+ StepUp for sensitive)
        → Controller → Service → scoped data access (brand/market/branch + RLS)
        → Audit (success/failure of sensitive actions) → standard error filter
```

A request-scoped `RequestContext` (AsyncLocalStorage) carries: `requestId`, resolved `brand`, `market`, `language`, `actor` (`staff | customer | guest | system`), and the effective **scope** (see 3.4). Services never accept a brand/market/branch id from the client without validating it against this context.

### 3.2 Domain-to-brand mapping [Approved requirement, mechanism Proposed]

- `brand_domain.hostname` (unique, lowercase) maps to a brand, optionally pinning a default market and language (e.g. `matildaflower.com` → Matilda Flower / UAE / en). `www` and alias hosts are rows with `is_primary = false` and redirect to the primary.
- Resolution uses the **trusted host only**: `Host` from a trusted reverse proxy, or (when the browser talks to the API through the Next.js server, see D2-02) a host header set by the Next.js server and authenticated with an internal shared secret. A client-supplied brand/store id is never accepted; unknown hosts get `404 UNKNOWN_BRAND`.
- Public storefront endpoints resolve the brand from the host; admin endpoints do not use the host for brand (admin is one central host) and instead use the validated **admin context** (3.5).
- Resolved mappings are cached in-process with short TTL and explicit invalidation on domain/brand change (Redis shared cache arrives when a second API instance exists).
- Local development uses `*.localhost` hostnames (`flower.localhost`, `cake.localhost`, `cookies.localhost`) that browsers resolve to 127.0.0.1, so brand switching can be tested without hosts-file edits.

### 3.3 Tenancy model

`Brand → Market (brand × country) → Branch` with branches linked to markets (a branch may serve several brands/markets in the **same country**).

- **Market** = a brand's presence in a country (`UNIQUE(brand_id, country_id)`), owning currencies, languages, timezone and status. The same country appears once in `country`, referenced by many brands' markets (proposal P-003 from DECISIONS).
- **Branch** has a country and is linked to markets through `branch_market`. DB-enforced rule: the branch's country must equal the market's country (composite FKs, see 4).
- Business rules from MULTI-STORE honored: only Matilda Flower/UAE is activated initially; Cake and Cookies exist as brands (inactive) so the foundation is proven multi-brand from day one without launching them.

### 3.4 Authorization model

- **Permission** keys are defined in code (`resource.action`, e.g. `products.publish`, `settings.manage_payments`) as the single catalog; a sync step upserts them into `permission` and flags **sensitive** ones. Every endpoint declares `@RequirePermission('key')`; a test fails the build if a protected route lacks it.
- **Roles**: 12 `SYSTEM` templates (seeded, not editable, clonable) plus `CUSTOM` roles (full CRUD by `roles.manage`). Roles are permission sets only; scope lives on the assignment.
- **Assignments**: `(staff_user, role, brand?, market?, branch?)`. A null field means "any". Examples: Super Admin = all null; Branch Manager of Dubai Marina = branch set; Catalog Manager for Flower only = brand set; Order Coordinator for Cake/UAE = brand+market.
- **Effective check** for an action on a target `(brandId, marketId?, branchId?)`: allowed if any assignment whose role has the permission matches the target, where each non-null assignment field must equal the corresponding target field (and the target must carry that field). Evaluated server-side on every request by one `AuthorizationService`; pure function with an exhaustive matrix test.
- **List endpoints** receive the actor's permitted scope set and filter in the query (and via RLS), never post-filter.
- **Safeguards:** at least one active Super Admin must always exist; a staff user cannot grant permissions they do not hold or escalate beyond their own scope; sensitive actions require recent 2FA (**step-up**); all grants/revocations are audited.
- Rider/production "own records only" rules (record-level ownership) are modeled when orders exist (Phase 6); Phase 2 reserves the pattern (`@RequirePermission(..., { ownership })`).

### 3.5 Admin context (switchers)

The admin selects Brand / Market / Branch (or "All" where permitted). The frontend sends the selection on each request as explicit headers (`X-Admin-Brand`, `X-Admin-Market`, `X-Admin-Branch`, using slugs/ids). The API **validates every value against the actor's assignments**; "All brands" is honored only for actors with platform/multi-brand scope and only on endpoints explicitly marked combined-capable. `GET /admin/me/context` returns exactly what the actor may switch between, so the UI never offers an unauthorized option. The last selection is a per-viewer convenience stored in the browser; it is never trusted.

### 3.6 Authentication design [Proposed]

| Aspect | Proposal |
|---|---|
| Mechanism | **Opaque server-side sessions** stored in PostgreSQL (hashed token), delivered as `HttpOnly; Secure; SameSite=Lax` cookies (`__Host-` prefix where the host allows). Chosen over JWT because instant revocation and per-session auditing are required |
| Realms | Separate cookies, tables, guards and rate limits for staff and customers; a staff cookie is meaningless to customer routes and vice-versa |
| Passwords | Argon2id (`argon2` package), per-hash salt, tuned cost, optional pepper from env; breached/weak password check by length + denylist (min 12 chars staff, 10 customers) |
| Staff 2FA | **Mandatory TOTP** with confirmed enrollment, 10 single-use hashed recovery codes, secrets encrypted at rest with AES-256-GCM using an env master key with key versioning |
| Staff lifecycle | Invited by an authorized staff user (single-use hashed token); first login forces password set + 2FA enrollment; deactivation revokes all sessions |
| Session policy (proposed) | Staff: idle 30 min, absolute 12 h, step-up valid 10 min. Customer: rolling 30 days idle, absolute 90 days. Revoke-all on password change/reset |
| Brute force | Per-account and per-IP+account counters in the DB (5 failures → 15 min lock, exponential), plus `@nestjs/throttler` per route; uniform error messages and timing to prevent account enumeration |
| CSRF | Cookie-authenticated mutations require an `Origin`/`Referer` allow-list match plus a double-submit token header; CORS stays an explicit allow-list |
| Customer | Register, email verification, login/logout, forgot/reset password, `me` get/update, deletion request. Customers are **brand-scoped** (`UNIQUE(brand_id, lower(email))`) and can only ever authenticate against the brand resolved from the host |
| Guest | No account. Phase 2 provides the `guest` actor type, public brand-resolved endpoints, and the guard rules (guests can never reach `/customer` or `/admin`). Guest cart/tracking tokens arrive with carts/orders (Phase 5/6) |
| Email delivery | A `MailPort` interface with a dev adapter that logs/captures messages. A real provider is chosen with Notifications (Phase 6); see D2-11 for how invites work until then |

### 3.7 Isolation: three layers

1. **Application:** every tenant-owned repository requires a context-derived brand (and market where relevant); no unscoped query helpers exist for those tables (lint rule + review checklist).
2. **Database (proposed, gated by a spike):** PostgreSQL **RLS** on every table carrying `brand_id`. The API connects as a non-owner role `matilda_app` (no `BYPASSRLS`); a different role runs migrations. Each request transaction sets `SET LOCAL app.brand_ids = '<uuid>,<uuid>'` (the actor's permitted brands, or the single resolved brand) and policies check `brand_id = ANY(...)`. Platform-wide jobs use an explicit, audited `system` context.
3. **Tests:** a generated test enumerates all tables with `brand_id`, asserts RLS is enabled and policies exist, and runs cross-brand read/write attempts for every endpoint family.

If the spike (step 2.2) shows RLS is impractical with Prisma 7's adapter/pooling, fall back to layers 1+3 plus composite foreign keys, and record the decision (D2-03).

## 4. Database design (proposal; final DDL reviewed at step 2.2 before any migration)

Conventions: `snake_case` tables via `@@map`; UUIDv7 primary keys generated in the app (time-ordered, index-friendly; D2-04); `timestamptz` UTC; `created_at/updated_at`; status columns as PostgreSQL enums; no hard deletes for brands/markets/branches/staff (deactivate); emails stored with a `lower()` unique index. Prisma schema for the columns; **hand-written SQL migration sections** for partial indexes, check constraints, triggers, RLS and role grants.

### 4.1 Reference and tenancy

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `currency` | `code` PK (ISO 4217), `name`, `symbol`, `minor_unit_digits` | check `char_length(code)=3` |
| `language` | `code` PK (`en`,`ar`), `name`, `native_name`, `direction` (LTR/RTL) | |
| `country` | `id`, `iso2` unique, `iso3` unique, `name`, `calling_code` | |
| `brand` | `id`, `slug` unique (immutable), `name`, `legal_entity_name?`, `status` (ACTIVE/INACTIVE) | unique `lower(slug)` |
| `brand_domain` | `id`, `brand_id` FK, `hostname` unique, `market_id?`, `default_language_code?`, `is_primary`, `redirect_to_primary` | check `hostname = lower(hostname)`; partial unique: one primary per `(brand_id, market_id)`; FK `(market_id, brand_id) → market(id, brand_id)` |
| `market` | `id`, `brand_id` FK, `country_id` FK, `code` (e.g. `ae`), `status` (DRAFT/ACTIVE/SUSPENDED), `timezone` (IANA) | `UNIQUE(brand_id, country_id)`, `UNIQUE(brand_id, code)`, `UNIQUE(id, brand_id)`, `UNIQUE(id, country_id)` |
| `market_currency` | `market_id`, `currency_code`, `is_default` | PK `(market_id, currency_code)`; partial unique `(market_id) WHERE is_default` |
| `market_language` | `market_id`, `language_code`, `is_default`, `sort_order` | PK `(market_id, language_code)`; partial unique default |
| `branch` | `id`, `code` unique, `name`, `country_id` FK, address fields, `phone`, `email`, `timezone`, `status` | `UNIQUE(id, country_id)`; index `(country_id, status)` |
| `branch_market` | `branch_id`, `market_id`, `country_id`, `status` | PK `(branch_id, market_id)`; FK `(branch_id, country_id) → branch(id, country_id)`; FK `(market_id, country_id) → market(id, country_id)` (DB guarantees same country); index `(market_id)` |

Activation rule (service + check): a market becomes ACTIVE only with ≥1 currency, ≥1 language, each with exactly one default, and a timezone.

### 4.2 Identity

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `staff_user` | `id`, `email`, `full_name`, `phone?`, `status` (INVITED/ACTIVE/SUSPENDED/DEACTIVATED), `password_hash?`, `must_change_password`, `mfa_enrolled_at?`, `failed_login_count`, `locked_until?`, `last_login_at?` | unique `lower(email)`; index `(status)` |
| `staff_mfa_totp` | `staff_user_id` PK/FK, `secret_ciphertext`, `key_version`, `confirmed_at?` | |
| `staff_recovery_code` | `id`, `staff_user_id`, `code_hash`, `used_at?` | index `(staff_user_id) WHERE used_at IS NULL` |
| `staff_session` | `id`, `staff_user_id`, `token_hash` unique, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at?`, `mfa_verified_at?`, `step_up_until?`, `ip`, `user_agent` | index `(staff_user_id) WHERE revoked_at IS NULL` |
| `staff_token` | `id`, `staff_user_id`, `type` (INVITE/RESET), `token_hash` unique, `expires_at`, `used_at?` | |
| `customer` | `id`, `brand_id` FK, `email`, `email_verified_at?`, `phone?`, `password_hash`, `full_name`, `preferred_language?`, `status`, marketing-consent fields, `deletion_requested_at?`, lockout fields | unique `(brand_id, lower(email))`; `UNIQUE(id, brand_id)`; index `(brand_id, status)`; **RLS** |
| `customer_session` | like `staff_session` plus `brand_id`; FK `(customer_id, brand_id) → customer(id, brand_id)` | **RLS** |
| `customer_token` | verification / password-reset tokens, same shape, with `brand_id` | **RLS** |

### 4.3 Authorization and audit

| Table | Key columns | Constraints / indexes |
|---|---|---|
| `permission` | `key` PK, `group`, `description`, `is_sensitive` | synced from code |
| `role` | `id`, `name`, `description`, `kind` (SYSTEM/CUSTOM), `system_key?` unique, `is_locked` | unique `lower(name)` for custom; system rows immutable via trigger |
| `role_permission` | `role_id`, `permission_key` | PK both columns; FK to `permission` |
| `staff_role_assignment` | `id`, `staff_user_id`, `role_id`, `brand_id?`, `market_id?`, `branch_id?`, `granted_by`, `created_at`, `revoked_at?`, `expires_at?` | FK `(market_id, brand_id) → market(id, brand_id)` (ties market to its brand when both set); check "market set ⇒ brand set"; partial index `(staff_user_id) WHERE revoked_at IS NULL`; branch-vs-brand/market consistency enforced in the service and verified by a trigger |
| `audit_log` | `id` bigint identity, `occurred_at`, `actor_type` (STAFF/CUSTOMER/SYSTEM/GUEST), `actor_id?`, `brand_id?`, `market_id?`, `branch_id?`, `action`, `target_type`, `target_id?`, `outcome` (SUCCESS/DENIED/FAILED), `before jsonb?`, `after jsonb?` (redacted), `ip`, `user_agent`, `request_id` | **append-only**: `UPDATE/DELETE/TRUNCATE` blocked by trigger and revoked from `matilda_app`; indexes `(occurred_at)`, `(brand_id, occurred_at)`, `(actor_type, actor_id, occurred_at)`, `(target_type, target_id)` |

### 4.4 Roles and grants

`matilda_owner` runs migrations; `matilda_app` is the API's runtime role (DML only, no DDL, no `BYPASSRLS`); local Docker creates both through an init script so local mirrors production. Test database `matilda_test` is created by the same script.

## 5. Role templates (seeded, immutable; clonable)

The 12 templates from [ROLES-AND-PERMISSIONS](ROLES-AND-PERMISSIONS.md). Phase 2 **defines the permission catalog and default permission sets for all 12** (including keys for features that do not exist yet, e.g. `products.*`, `orders.*`, `refunds.*`, `finance.*`, `delivery.*`, `inventory.*`) so later phases only attach endpoints. Only Phase 2 resources are functional now: `brands`, `markets`, `branches`, `staff` (`users.manage`), `roles` (`roles.manage`), `audit.view`, `settings`, `customers.view`. Default sets must be reviewed and signed off by the owner (D2-08) before seeding to production. Sensitive keys (`refunds.approve`, `settings.manage_payments`, `finance.export`, `roles.manage`, `users.manage`, data exports) require step-up.

## 6. API surface (Phase 2)

All under `/api/v1`, documented in Swagger by surface tag. `P` = permission, `S` = step-up required.

**Storefront (public, brand from host)**
- `GET /storefront/context` — brand public config (name, slug, markets, languages, currencies, theme key). No secrets, no other brands.

**Staff auth (`/admin/auth`)**
- `POST login` → creates a pre-MFA session; `POST mfa/verify`; `POST mfa/enroll/start|confirm`; `POST mfa/recovery`; `POST logout`; `POST logout-all`; `POST step-up`; `POST password/forgot|reset`; `POST invite/accept`; `POST password/change`; `GET /admin/me`; `GET /admin/me/context`.

**Admin management** (each `P` per key; mutations audited; sensitive ones `S`)
- Brands: `GET/POST/PATCH /admin/brands` (`brands.view/manage`); domains: `GET/POST/PATCH/DELETE /admin/brands/:id/domains`.
- Countries/reference: `GET /admin/countries|currencies|languages` (read-only seeded data).
- Markets: `GET/POST/PATCH /admin/markets`; `PUT /admin/markets/:id/currencies|languages`; `POST /admin/markets/:id/activate|suspend`.
- Branches: `GET/POST/PATCH /admin/branches`; `PUT /admin/branches/:id/markets`; deactivate.
- Staff: `GET/POST/PATCH /admin/staff`; `POST :id/invite|suspend|reactivate|revoke-sessions`; `GET/POST/DELETE :id/assignments`.
- Roles: `GET/POST/PATCH/DELETE /admin/roles` (system roles read-only; `POST :id/clone`); `GET /admin/permissions`.
- Audit: `GET /admin/audit-logs` (`audit.view`, scoped, filterable, paginated, never editable).
- Customers (read-only support view): `GET /admin/customers` (`customers.view`, brand-scoped).

**Customer (`/customer`, brand from host)**
- `POST auth/register|login|logout|verify-email|forgot-password|reset-password`; `GET/PATCH /customer/me`; `POST /customer/me/deletion-request`.

All list endpoints use the shared pagination/filter/sort contract; errors use the standard `ApiErrorBody`; mutating endpoints accept `Idempotency-Key` where retry safety matters (invite, create).

## 7. Admin app plan (design-gated)

Phase 2 builds the **shell and management screens only**, no dashboards or analytics. Because [DESIGN-SYSTEM](DESIGN-SYSTEM.md) forbids generic output, **no admin UI is built before the owner approves a short design brief** (step 2.9): neutral enterprise token set (not brand-themed), type/spacing/density scale, nav model, and wireframes of: login + 2FA, shell with switchers, a data table with filters/bulk actions, a form page, a drawer, empty/error/loading states.

- **Layout:** left navigation grouped as in ADMIN-PANEL (Overview, Commerce, Operations, Marketing and Content, Finance, Administration); only groups/items the actor's permissions allow are rendered (convenience only; the API enforces). Not-yet-built modules are hidden, not stubbed.
- **Top bar:** brand switcher, market switcher (filtered to the brand), branch switcher (filtered to the market), account menu (security, sign out). Combined "All" option only for platform-scope actors. Switching invalidates cached queries.
- **Screens in Phase 2:** sign in, 2FA verify/enroll, accept invite, forgot/reset password, account security; Brands (+domains), Markets, Branches, Employees (+assignments), Roles/Permissions matrix, Audit log, Customers (read-only list).
- **Libraries introduced here (not before):** shadcn/ui (restyled), TanStack Query + Table, React Hook Form + Zod resolver. Zustand only if the switcher state needs it beyond React context (decision D2-09).
- Accessibility (WCAG 2.2 AA, keyboard), loading/empty/error states, confirmation dialogs for destructive actions, English UI (Arabic admin is out of scope; D2-17).

## 8. Seed strategy

Three tiers, all idempotent (upsert by natural key), run by one CLI (`pnpm --filter @matilda/api db:seed -- --tier=...`):

1. **Reference (all environments):** currencies (AED, SAR, USD, EUR, etc.), languages (en, ar), countries (UAE; others added by config), permission catalog sync, the 12 system roles and their permission sets.
2. **Bootstrap (staging/production, run once, explicit):** brands (Matilda Flower active; Matilda Cake, Cookies by Matilda inactive), their real domains, the UAE market for Matilda Flower (AED, en+ar, `Asia/Dubai`, status per owner), **no fake branches**; branches are created by the owner in the admin (list pending, D2-12). Cake/Cookies UAE markets are created DRAFT so they exist for tests but cannot trade.
3. **Development only (refuses to run with `NODE_ENV=production`):** the three brands with `*.localhost` domains, UAE market for each, clearly named `[TEST]` branches, a few `[TEST]` staff covering the 12 roles with random per-run passwords printed once to the console, and test customers. Never reused outside development.

**Super Admin setup:** `pnpm --filter @matilda/api cli create-super-admin --email <email>` creates an INVITED platform-scope Super Admin and prints a one-time invite link (or sets a one-time temporary password read from a prompt, never from a file or default). First sign-in forces password change and TOTP enrollment; recovery codes are shown once. No default credentials exist anywhere in the repo, seeds, docs or Docker config. The command is audited (actor `SYSTEM`) and refuses to create a second Super Admin unless an existing one is active or `--force-recovery` is used (also audited).

## 9. Audit logging

- `AuditService.record()` writes in the same transaction as the change it describes, so a change without an audit row cannot commit.
- **Always audited:** login success/failure/lock, MFA enroll/verify/failure/reset, logout-all, password change/reset, step-up, invite/accept, role create/update/delete/clone, permission-set change, assignment grant/revoke, staff create/suspend/deactivate, brand/domain/market/branch create/update/status, payment-config and data-export keys (when they exist), permission denials on sensitive routes, customer register/login failure/deletion request, Super Admin bootstrap.
- Redaction: passwords, tokens, secrets, recovery codes and full emails of other users are never stored in `before/after`; PII kept to what support needs.
- Append-only enforced by trigger and grants; retention policy and optional hash-chaining for tamper evidence are decisions (D2-18). Visible via `audit.view`, scoped like any other data.

## 10. Implementation steps, dependencies and acceptance criteria

Order: 2.1 → 2.2 → (2.3, 2.4 in parallel) → 2.5 → 2.6 → (2.7, 2.8 in parallel) → 2.9 (design review can start after 2.4) → 2.10 → 2.11. Each step ends green on `pnpm check`, updates docs (`PROGRESS`, `CHANGELOG`, `DECISIONS`) and stops for review when marked ⛔.

### 2.1 Foundations and test infrastructure — depends on: approvals D2-01…D2-07
- Request context (AsyncLocalStorage), `MailPort` + dev adapter, encryption helper (AES-256-GCM, key versions), cookie/CSRF utilities, standard permission-key typing, env additions (`APP_ENCRYPTION_KEY`, cookie settings, trusted-proxy secret).
- Docker: init script creating `matilda_owner`, `matilda_app` and `matilda_test`; migration runner using the owner role; Jest DB integration setup (migrate fresh DB per run, transaction-rollback per test).
- **Acceptance:** `pnpm docker:up` yields both roles and a test DB; an integration test runs against `matilda_test`; `matilda_app` cannot run DDL (proved by test); env validation rejects missing keys in staging/production; no existing Phase 1 test regresses.

### 2.2 Tenancy schema, RLS spike and scoped data access ⛔ — depends on: 2.1
- Spike first (time-boxed): prove RLS with Prisma 7 + `@prisma/adapter-pg` using `SET LOCAL` in interactive transactions and a non-owner role; measure overhead; record go/no-go (D2-03).
- Then reference data, brand, domain, country, market (+currency/language), branch, branch_market tables with all constraints/indexes in 4.1, and the scoped repository layer.
- **Acceptance:** DDL reviewed by the owner before migrating; migration applies cleanly on an empty DB and from the seed; constraint tests prove: duplicate hostname rejected, branch/market country mismatch rejected, two defaults rejected, market-brand mismatch on a domain rejected; RLS (if go) denies cross-brand reads/writes for `matilda_app`; reversal/rollback procedure documented.

### 2.3 Tenant resolution and storefront context — depends on: 2.2
- `TenantResolver` + cache + invalidation, trusted-host handling, `GET /storefront/context`, `*.localhost` dev domains, per-brand CORS from `brand_domain`.
- **Acceptance:** each seeded domain resolves to the right brand/market/language; unknown/inactive brand → 404; a forged brand header/query is ignored; response never includes another brand's data; unit + HTTP tests cover alias → primary redirect and cache invalidation.

### 2.4 Permission catalog, roles and authorization engine — depends on: 2.2
- Permission catalog (typed), sync routine, 12 role templates and default sets, custom roles, assignments schema, `AuthorizationService`, `@RequirePermission` decorator and `PermissionsGuard`, "every protected route declares a permission" test.
- **Acceptance:** exhaustive matrix tests (permission × scope: platform/brand/market/branch × matching/non-matching targets) pass; role-name checks are absent (lint/grep test); escalation, last-Super-Admin, and system-role-immutability rules proven by tests.

### 2.5 Audit logging — depends on: 2.2 (parallel with 2.4)
- `audit_log`, append-only trigger/grants, `AuditService`, interceptor for denials, query endpoint service layer.
- **Acceptance:** UPDATE/DELETE/TRUNCATE on `audit_log` fail even as `matilda_app`; an audited change rolls back with its audit row; redaction tests prove no secrets in stored JSON; pagination/filter indexes verified with `EXPLAIN`.

### 2.6 Staff authentication ⛔ — depends on: 2.1, 2.4, 2.5
- Argon2id, sessions, TOTP + recovery codes, lockout, invite/reset flows, CSRF, step-up, session revocation, Super Admin CLI.
- **Acceptance:** auth test suite (section 11) green; cookie flags verified; login without completed 2FA grants no admin access; deactivation/revoke-all invalidates sessions immediately; error responses identical for unknown vs wrong credentials; Super Admin created via CLI can complete invite → password → 2FA → login; no default credentials anywhere (repo scan).

### 2.7 Admin management APIs — depends on: 2.6
- Brands/domains, markets, branches, staff, assignments, roles/permissions, audit-log query, customers read-only, `GET /admin/me` and `/me/context`, admin-context header validation.
- **Acceptance:** every endpoint has permission + scope tests (allowed, wrong scope, wrong permission, unauthenticated, wrong realm); sensitive actions demand step-up; every mutation writes an audit row; Swagger shows all routes with correct tags; list endpoints return only in-scope rows.

### 2.8 Customer authentication and guest actor — depends on: 2.3, 2.5 (parallel with 2.7)
- Customer tables with RLS, register/verify/login/logout/reset/me/deletion-request, guest actor rules.
- **Acceptance:** same email can register separately on two brands and cannot log in across brands; a customer session cannot call `/admin` or another brand's `/customer`; enumeration-safe responses; verification and reset tokens are single-use and expire; guest hits to `/customer` or `/admin` return 401/403; isolation tests green.

### 2.9 Admin design brief and app shell ⛔ — depends on: 2.6 (brief may start after 2.4)
- Owner reviews and approves the design brief (section 7) **before** implementation; then shell, auth screens, navigation model, API client wiring, session/CSRF handling, same-origin proxy (per D2-02).
- **Acceptance:** owner approval of the brief recorded in DECISIONS; login → 2FA → shell works end to end on `localhost:3001`; navigation shows only permitted items per role; keyboard-navigable; Lighthouse accessibility checks pass on shell pages.

### 2.10 Switchers and management screens — depends on: 2.7, 2.9
- Brand → market → branch switchers wired to `/me/context`, screens for brands/domains, markets, branches, employees/assignments, roles/permissions, audit log, customers.
- **Acceptance:** a Branch Manager sees only their branch and cannot switch to others (UI and API); Super Admin can switch to "All"; a scoped Catalog Manager sees no Finance items; forged context headers are rejected by the API (tested); Playwright E2E covers sign-in, switching, role CRUD, assignment and audit visibility (Playwright introduced here).

### 2.11 Hardening, verification and documentation — depends on: all
- Full isolation and security suites, dependency audit, load smoke on login/authorization, seed tiers verified on clean DB, docs updated ([API], [DATABASE], [SECURITY], [TESTING], [DEPLOYMENT], [ROADMAP], [PROGRESS], [CHANGELOG], [DECISIONS]).
- **Acceptance:** `pnpm check` and DB-backed suites green from a clean clone + `pnpm docker:up`; cross-brand matrix has zero leaks; manual security checklist (section 11) signed off; open issues listed honestly; stop for owner approval before Phase 3.

## 11. Testing strategy

| Area | Tests |
|---|---|
| Authorization | Full permission × scope matrix; role templates match approved sets; escalation and lockout-prevention rules; route-coverage test (no unprotected route) |
| Staff auth | Wrong/unknown credentials uniformity, lockout and unlock, TOTP window and replay, recovery-code single use, session idle/absolute expiry, revoke-all, step-up expiry, cookie flags, CSRF rejection, invite/reset token reuse/expiry |
| Customer auth | Brand binding, cross-brand login denial, verification/reset token rules, deletion request, rate limiting |
| Isolation | Brand A actor/customer attempts against every brand B resource via IDs, filters, bulk endpoints and headers; RLS catalog test; composite-FK tests; market/branch scope tests |
| Tenancy | Domain resolution, aliases, inactive brands, forged headers, cache invalidation |
| Audit | Append-only enforcement, same-transaction guarantee, redaction, denial logging |
| Seed | Idempotency, dev-only guard, no default credentials |
| Admin UI | Navigation by role, switcher validity, accessibility checks, Playwright E2E |
| Security | `pnpm audit`, secret scanning, header checks, Argon2 parameter benchmark |

## 12. Decisions requiring your approval

| ID | Decision | Recommendation | Impact if different |
|---|---|---|---|
| D2-01 | Session model | Server-side opaque sessions in PostgreSQL, HttpOnly cookies (not JWT) | JWT would need a revocation list; weakens "revoke immediately" |
| D2-02 | Browser ↔ API topology | Next.js frontends proxy `/api/*` to the API (same-origin cookies, simpler CSRF); the API trusts the frontend's host header only with an internal secret | Direct cross-origin calls need a shared cookie domain per brand and wider CORS; changes DEPLOYMENT/Nginx |
| D2-03 | RLS as second isolation layer | Yes, gated by a 2.2 spike with a documented fallback | Without RLS isolation relies on app code + tests |
| D2-04 | Primary keys | UUIDv7 generated in the app | UUIDv4 (random index fragmentation) or bigint ids (guessable) |
| D2-05 | New backend dependencies | `argon2`, `otplib`, `cookie-parser`, `@nestjs/throttler`, `nestjs-cls` (or hand-rolled AsyncLocalStorage), `uuid`; TOTP QR via a small library. Redis not required yet | Fewer libraries = more hand-written security code |
| D2-06 | Staff are global users; customers are per-brand | Confirm (matches approved docs) | Shared customers would change the schema and privacy model |
| D2-07 | Custom roles are global definitions, scoped at assignment | Yes (simpler, reusable) | Brand-owned roles add a `brand_id` and complicate sharing |
| D2-08 | Default permission sets for the 12 roles | I draft; **you review and sign off** before production seeding | Wrong defaults are a security risk |
| D2-09 | Admin UI libraries and state | shadcn/ui (restyled), TanStack Query/Table, React Hook Form; React context for switchers (no Zustand yet) | |
| D2-10 | 2FA policy | Mandatory TOTP for all staff, including riders/production; configurable per role later | Lighter policy for riders is a business-risk decision |
| D2-11 | Email in Phase 2 | `MailPort` + dev adapter; until a provider exists the Super Admin shares invite links manually | Choosing a provider now pulls Notifications work forward |
| D2-12 | Real branch list | You provide names/locations/serving brands before bootstrap seeding; dev uses `[TEST]` branches | Without it only dev data exists |
| D2-13 | Admin context via explicit headers validated server-side | Yes | Alternative (context stored in session) is less explicit and harder to test |
| D2-14 | Guest scope | Phase 2 = actor type + public resolution only; guest tokens with carts in Phase 5 | |
| D2-15 | Customer auth UI | API only in Phase 2; screens in Phase 8 | |
| D2-16 | Session lifetimes, lockout, password length (3.6) | Accept proposed values | Tune to your policy |
| D2-17 | Admin language | English only in Phase 2; Arabic admin deferred | Arabic admin requires RTL admin work |
| D2-18 | Audit retention and tamper evidence | Retain indefinitely in DB for now; revisit hash-chaining in Phase 10 | Retention law may require limits |
| D2-19 | Test database approach | Separate `matilda_test` DB in Docker, fresh migration per run | |
| D2-20 | Playwright introduced at step 2.10 | Yes | Delay shifts UI verification to manual |

## 13. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Prisma 7 + RLS + connection pooling interplay (`SET LOCAL` per transaction, long-lived connections leaking context) | Medium / High | Spike first; wrapper that always uses a transaction; tests that a pooled connection cannot inherit a previous brand; fallback documented |
| R2 | Prisma cannot express partial indexes, checks, triggers, RLS | Certain / Medium | Hand-written SQL migrations reviewed by you; a schema-drift check in CI |
| R3 | Authorization bugs (scope matching) leak data or lock out admins | Medium / High | Pure, exhaustively tested engine; deny by default; route-coverage test; second-person review of the matrix |
| R4 | Cross-origin cookie/CSRF mistakes between frontends and API | Medium / High | D2-02 same-origin proxy; CSRF tests; cookie flag tests |
| R5 | Brand resolved from a spoofable header | Low / Critical | Trusted-host rule with internal secret; tests with forged headers |
| R6 | Account lockout abuse (attacker locks a Super Admin) | Medium / Medium | Locks are time-boxed; IP+account counters; break-glass CLI recovery (audited) |
| R7 | Lost 2FA device locks out staff | High / Medium | Recovery codes; audited admin reset requiring another privileged user; Super Admin CLI recovery |
| R8 | Placeholder permissions for unbuilt features drift from real needs | Medium / Medium | Permission catalog is code-owned; later phases add keys through reviewed migrations; sign-off at D2-08 |
| R9 | Scope creep into admin design and dashboards | Medium / Medium | Design gate at 2.9; Phase 2 screens limited to listed entities |
| R10 | Over-modeling (markets, branch links) before Phase 4 needs are known | Medium / Medium | Only fields needed now; opening hours/capacity deferred; schema reviewed at 2.2 |
| R11 | Dev data or default credentials reaching production | Low / Critical | Dev tier refuses production, no default credentials, secret scan in CI |
| R12 | Timeline: Phase 2 is the largest foundation phase | High / Medium | Steps are independently shippable; owner gates at 2.2, 2.6, 2.9 |

## 14. Missing business information needed

1. Initial branch list (names, addresses, hours, which brands each serves) and branch managers.
2. The people who will be staff on day one, their roles and scopes (to sanity-check role defaults).
3. Owner's email for the Super Admin invite (not stored in the repo) and whether more than one Super Admin is required.
4. Real hostnames per environment (staging/production) for all three brands, including `www` and legacy domains.
5. Market defaults for UAE: default language(s) per brand (en first, ar second?), currency AED, timezone `Asia/Dubai` confirmation.
6. Whether Matilda Cake and Cookies should be visible in the admin switcher before launch (as inactive).
7. Password, 2FA and session policies from D2-10/D2-16; rider and production device-sharing realities.
8. Privacy/consent wording and retention for customer data (account deletion handling).
9. Any additional staff roles you already know you need beyond the 12.

## 15. Not changing

Docker PostgreSQL stays on host port **5434**; approved stack and architecture (modular monolith, API-only database access) are unchanged; Phase 3 and any storefront design remain unstarted.
