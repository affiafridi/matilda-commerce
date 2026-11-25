# Changelog

Records important project changes. Newest first.

## 2026-11-25 — Phase 2, step 2.11 (hardening and verification)

- Security: `effect` pinned to 3.22.5 (fixes GHSA-7589-6fvf-x4pw); `pnpm audit --prod` is clean.
- Added `apps/api/scripts/load-smoke.mjs` (local load smoke for login and authorization paths).
- Verified migrations and the three seed tiers on a clean database (idempotent); no secrets in the repository; response headers checked.
- Admin: page content now uses the full width (removed fixed maximum widths); scope switchers have a chevron.
- Owner approved step 2.10 and then Phase 2 as a whole.

## 2026-11-25 — Phase 2, step 2.10 (switchers and management screens)

- Admin: brand → market → branch switchers (validated by the API through `X-Admin-Brand`), and the screens for brands and domains, markets, branches, employees and assignments, roles and permissions, audit log and customers; all navigation items now built and permission-filtered.
- Tests: Playwright introduced (D2-20) with 9 end-to-end tests on the test database; admin unit tests for the scope model.
- Fixed: inviting an employee now opens the new employee's page.
- Owner approved step 2.9 ("approve").

## 2026-11-25 — Phase 2, step 2.9 (admin design and app shell)

- Owner approved the admin design brief with the final direction (neutral, Inter, 4 to 6px radii, collapsible sidebar, dark-mode and RTL ready); see D2-21 and `docs/design/admin-brief.html`.
- Admin app: sign-in, two-factor verify/enrol, recovery codes, accept invite, forgot/reset password, account security, shell and navigation model, step-up dialog, same-origin API proxy, CSRF handling.
- API: `POST /api/v1/admin/auth/csrf` re-issues the session CSRF token after a page reload (Origin-checked, cookie required).
- Dependencies (admin): `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `lucide-react`, `@fontsource-variable/inter`, `axe-core` (dev).
- Tests: 14 admin unit tests (HTTP client retry rules, safe redirects, navigation filtering); one new integration test for the CSRF route (173 integration tests in total).

## 2026-11-25 — Phase 2, step 2.8 (customer authentication)

### Added
- Migration `customer_auth`: `customer`, `customer_session`, `customer_token` with row-level security, per-brand unique email and composite brand keys.
- `modules/customer-auth`: register, verify email, login/logout, forgot/reset/change password, profile, deletion request; `CustomerSessionGuard`.
- `GET /admin/customers` and `/admin/customers/:id` (read-only support view).

### Changed
- `passwordProblems` accepts a minimum length (customers: 10, staff: 12); `AuthAttemptService` is exported for the customer realm.

### Notes
- Anonymization after a deletion request is deferred (needs retention rules from the owner).

## 2026-11-25 — Phase 2, step 2.7 (admin management APIs)

### Added
- `modules/admin`: REST endpoints for brands and domains, markets, branches (and market links), staff, assignments, roles, the permission catalog, audit-log query and `/admin/me/context` (see PROGRESS for rules).
- `AuthorizationService.dbScopeForAny`, `AssignmentService.assertGrantable`.

### Changed
- `PermissionsGuard` loads the actor's grants for staff-only routes too.
- Input validation for brand slug, market code and branch code now mirrors the database check constraints.

### Notes
- Customers read-only endpoint waits for the customer tables (step 2.8).

## 2026-11-25 — Phase 2, step 2.6 (staff authentication)

### Added
- Migration `staff_auth`: staff password hash, MFA state, `staff_mfa_totp`, `staff_recovery_code`, `staff_session`, `staff_token` (invite/reset), `auth_attempt`; an ACTIVE account must have a password (check constraint).
- `modules/staff-auth`: login, mandatory TOTP enrollment/verification, recovery codes, step-up, logout/logout-all, password change/forgot/reset, invite acceptance, `GET /admin/me` and `/admin/auth/session`.
- Super Admin bootstrap CLI `db:create-super-admin` (one-time invitation link, no default credentials, audited).
- Env: `PASSWORD_PEPPER` (required in staging/production), `ADMIN_BASE_URL`. Dependencies: argon2, otplib, qrcode, cookie-parser, @nestjs/throttler.

### Changed
- `PermissionsGuard` authenticates the staff session cookie, checks Origin and CSRF on mutations, and enforces step-up for sensitive permissions; added `@AuthenticatedStaff()`.
- Jest configs share `jest.shared.cjs` so the ESM-only otplib dependencies run under Jest.

### Notes
- Review gate: stop for owner review before step 2.7. See PROGRESS for known issues.

## 2026-11-25 — Phase 2, step 2.5 (audit logging)

### Added
- Migrations `audit_log` and `audit_log_paging_indexes`: `audit_log` with no foreign keys, append-only for everyone (runtime role lacks UPDATE/DELETE/TRUNCATE; triggers block row changes and TRUNCATE even for the owner; forced row-level security has INSERT-anything and brand-scoped SELECT policies, so brand-less rows are platform-only).
- `AuditService`: `record(tx, …)` writes inside the caller's transaction (rolls back with the change), `recordStandalone` for denials (never throws), `query` with filters and keyset paging, scoped by `dbScopeFor(grants, 'audit.view')`. Redaction masks secrets by key name and email addresses, and bounds size.
- `access.denied` rows: from `PermissionsGuard` for sensitive permissions and from a global interceptor for denials raised inside protected handlers.
- Role create/update/delete/clone and assignment grant/revoke now write audit rows; `RoleService`/`AssignmentService` take the acting staff id.
- Request context now carries client IP and user agent.

### Notes
- No HTTP endpoint exposes the audit log yet (admin APIs, step 2.7). Retention is indefinite for now (D2-18).
- Test databases can only be emptied through the owner-only `resetAuditLog` test helper.

## 2026-11-25 — Phase 2, step 2.4 (permissions and authorization)

### Added
- Migration `access_control`: `staff_user` (core columns; credentials/MFA/sessions in 2.6), `permission`, `role`, `role_permission`, `staff_role_assignment`. DB rules: lowercase unique email, unique custom role names, system roles and permissions read-only for `matilda_app` (trigger and grants), assignment brand/market/branch consistency trigger.
- Typed permission catalog and the 12 system role templates (`modules/iam/permissions`); `syncAccessControl` (owner role; also run by the seed CLI).
- `AuthorizationService`, scope algebra (null = any), global fail-closed `PermissionsGuard`, `@RequirePermission` / `@PublicRoute`, `RoleService` (custom roles, clone, escalation checks), `AssignmentService` (scope and escalation checks, last-Super-Admin protection with an advisory lock).
- Tests: permission x scope matrix, no-role-name-in-code check, every-route-declares-access check.

### Notes
- Step-up enforcement for sensitive keys and audit rows for grants/role changes arrive with 2.6 and 2.5; the guard currently reads the staff actor from the request context, which authentication (2.6) will fill.
- Staff tables have no row-level security (staff are global, D2-06); access is controlled by permissions and scope in the services.

## 2026-11-25 — Phase 2, step 2.3 (tenant resolution)

### Added
- `GET /api/v1/storefront/context`: public brand config (brand, current market, ACTIVE markets, currencies, languages, theme key, alias redirect target) resolved from the request host only; unknown hosts and inactive brands return 404 `TENANT_NOT_FOUND`; responses are `no-store`.
- `TenantResolver` (in-process cache: 60 s hits, 10 s misses; `invalidateHost/Brand/All` to be called by domain management in step 2.7), `TenantGuard`, trusted-host handling (`X-Forwarded-Host` honoured only with `X-Matilda-Proxy-Secret` = `TRUSTED_PROXY_SECRET`), per-brand CORS from `brand_domain`, shared `StorefrontContext` types.

### Notes
- The cache is per API instance; a shared (Redis) cache or pub/sub invalidation is needed before running several instances.
- Local testing: `*.localhost` hosts resolve to loopback, e.g. `curl http://flower.localhost:4000/api/v1/storefront/context` after `db:seed dev`.

## 2026-11-25 — Phase 2, step 2.2 (tenancy schema)

### Added
- Prisma models and first migration `tenancy`: currency, language, country, brand, market, market_currency, market_language, brand_domain, branch, branch_market; check constraints, partial unique indexes, immutable brand slug, composite foreign keys (domain→market same brand, branch↔market same country).
- Row-level security (FORCE) on all tenancy tables, `app_brand_ids()`/`app_is_platform()`, SECURITY DEFINER `resolve_brand_domain(host)`; reference data read-only for `matilda_app`.
- `withScope()` scoped data-access helper; seed CLI (`pnpm --filter @matilda/api db:seed [reference|bootstrap|dev]`); `db:deploy`; tenancy integration tests (29 DB tests in total) with migrations applied by Jest global setup.

### Notes
- Deviations from the approved draft are listed at the top of PHASE-2-SCHEMA-DRAFT.md.

## 2026-11-25 — Phase 2, step 2.1 (foundations)

### Added
- Owner-approved Phase 2 plan (`docs/PHASE-2-PLAN.md`) and decisions D2-01 to D2-20 recorded in DECISIONS.md.
- Local PostgreSQL least-privilege roles (`matilda_owner`, `matilda_app`) and `matilda_test` database via `infrastructure/postgres/bootstrap.{sql,mjs}`; `pnpm db:bootstrap`, `pnpm test:int`, `pnpm check:full`.
- API: request context (`nestjs-cls`), `EncryptionService` (AES-256-GCM, key ring), token/cookie/CSRF utilities, `MailPort` + console adapter, UUIDv7 helper, permission-key type; env additions (`MIGRATION_DATABASE_URL`, `TEST_*`, `APP_ENCRYPTION_KEYS`, `APP_ENCRYPTION_ACTIVE_KEY`, `TRUSTED_PROXY_SECRET`).
- DB integration tests (role privileges; RLS spike with Prisma 7: GO).
- `docs/PHASE-2-SCHEMA-DRAFT.md`: tenancy DDL draft awaiting owner review.

### Changed
- The API now connects as `matilda_app` (no DDL, no RLS bypass); Prisma CLI uses `MIGRATION_DATABASE_URL`. Developers must re-run `pnpm docker:up` (or `pnpm db:bootstrap`) and refresh `apps/api/.env` from `.env.example`.

## 2026-11-25 — Phase 1: Project Foundation

### Added
- pnpm monorepo, Git repo (uncommitted), shared TypeScript presets, ESLint 9 + Prettier, root scripts (`pnpm check`).
- `apps/api` (NestJS 11): versioned `/api/v1`, health and readiness endpoints, Swagger at `/api/docs`, Zod-validated env, Pino logging with request ids, standard error filter, Zod validation pipe, Helmet, CORS allow-list, lazy Prisma service.
- Prisma 7 configuration (no models, no migrations).
- `apps/storefront` (3000) and `apps/admin` (3001): Next.js 16 + Tailwind 4 status pages calling the API.
- Packages: `@matilda/config`, `types`, `validation`, `api-client`, `ui` (empty), `commerce` (empty).
- `.env.example` files, `docker-compose.yml` (local Postgres, optional Redis), root `README.md`.
- Initial tests (API unit + HTTP, packages, frontends).

### Docker database (later same day)
- Docker PostgreSQL 17 with persistent named volume on host port 5434 (5433 was occupied by a native PostgreSQL 18), root `.env.example`, `pnpm docker:up|down|logs|redis:up` scripts, `DATABASE_URL` configured; Prisma connectivity and volume persistence verified; readiness returns 200.

### Decisions
- D-014 to D-020 recorded in DECISIONS.md (NestJS 11, Prisma 7.10.1, TypeScript 5.9, compiled shared packages, API conventions, test tooling, local DB).

### Notes
- Database connectivity not verified (see PROGRESS.md). Existing websites were not touched.

## 2026-11-25 — Phase 0 documentation

### Added
- `CLAUDE.md` project entry point.
- Complete documentation set in `docs/` (32 files): README, PROJECT-OVERVIEW, REQUIREMENTS, TECH-STACK, ARCHITECTURE, FOLDER-STRUCTURE, DATABASE, API, MULTI-STORE, ROLES-AND-PERMISSIONS, CUSTOMER-AUTH, PRODUCT-ENGINE, INVENTORY, CART-AND-CHECKOUT, PAYMENTS, DELIVERY, ORDER-MANAGEMENT, MULTILINGUAL, ADMIN-PANEL, SEO, CMS-AND-MARKETING, NOTIFICATIONS, DESIGN-SYSTEM, SECURITY, PERFORMANCE, TESTING, DEPLOYMENT, FEATURE-PARITY, ROADMAP, PROGRESS, DECISIONS, CHANGELOG.

### Cake audit (later same day)
- Added "Observed on the Cake site" section and design findings to FEATURE-PARITY.md from a public read-only audit; updated PROGRESS.md.

### Changed
- Brand name corrected to "Matilda Flower" (singular) everywhere (DECISIONS D-013).
- Domains corrected per owner: Matilda Flower → `matildaflower.com`; Cookies by Matilda → `cookiesbymatilda.com` (see DECISIONS D-002).

### Notes
- No application code, dependencies, schema, migrations, or infrastructure were created. Existing websites were not modified.
