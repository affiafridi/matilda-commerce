# Changelog

Records important project changes. Newest first.

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
