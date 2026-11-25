# Progress

Last updated: 2026-11-25

## Current phase

**Phase 1 — Project Foundation: implemented and verified locally. Awaiting owner approval before Phase 2.** No business modules, authentication, products, orders, checkout or payments exist. No storefront/admin design has been done.

## Completed

### Phase 0 — Planning and Documentation (complete)

- [x] `CLAUDE.md` and all 32 `docs/` files written and cross-checked.
- [x] Public read-only audits of the Flower and Cake sites (text only) recorded in [FEATURE-PARITY](FEATURE-PARITY.md). Brand name and domains corrected (D-002, D-013).

### Phase 1 — Project Foundation

- [x] pnpm workspace monorepo (`apps/*`, `packages/*`), Git repository initialized (no commits made), `.gitignore`, `.gitattributes`, `.editorconfig`, `.npmrc`.
- [x] Strict TypeScript via shared presets (`@matilda/config`).
- [x] `apps/api`: NestJS 11, URI-versioned `/api/v1`, Helmet, CORS allow-list, Zod-validated environment, Pino structured logging with request ids and redaction, global exception filter producing the standard error body, Zod validation pipe, Swagger UI at `/api/docs`, health endpoints, lazy `PrismaService`.
- [x] Prisma 7 configured (`prisma.config.ts`, empty `schema.prisma` with generator + datasource only, `@prisma/adapter-pg`). **No models, no migrations.**
- [x] `apps/storefront` (port 3000) and `apps/admin` (port 3001): Next.js 16 App Router, Tailwind CSS 4, a single unstyled status page that calls the API through `@matilda/api-client`. No design.
- [x] Shared packages: `config`, `types`, `validation`, `api-client` (working); `ui`, `commerce` (empty by design).
- [x] ESLint 9 (flat config) + Prettier, root scripts (`pnpm check`).
- [x] `.env.example` for API, storefront and admin; `docker-compose.yml` for local PostgreSQL (and optional Redis).
- [x] Initial tests: API unit (env, Zod pipe) and HTTP tests (health, error body, request id); package and frontend `node:test` tests.
- [x] Root `README.md` with run commands.

### Verification results (2026-11-25, Windows, Node 24.13, pnpm 10.34.9)

| Check | Result |
|---|---|
| `pnpm format:check` | pass |
| `pnpm lint` | pass |
| `pnpm typecheck` (all 10 projects) | pass |
| `pnpm test` | pass: API 6 unit + 4 HTTP; validation 2; storefront 2; admin 2 |
| `pnpm build` (packages, API, both Next apps) | pass |
| `pnpm dev` runtime check | API, storefront, admin all started on 4000/3000/3001; both frontends rendered "matilda-api 0.1.0: ok" from the live API; Swagger UI and JSON served; CORS allowed `localhost:3000`, rejected an unknown origin; 404 returned the standard error body |

### Database verification (2026-11-25, after Docker Desktop was installed)

| Check | Result |
|---|---|
| Docker PostgreSQL 17 container (`matilda-postgres`) started via `pnpm docker:up`, healthy | pass; published on **host port 5434** |
| Persistent named volume `matilda-commerce_matilda_postgres_data` | pass: a test row survived `docker compose down` and `up`; the test table was then dropped |
| Prisma connectivity (`prisma migrate status` connected to `matilda_dev` at `localhost:5434`) | pass (reports "No migration found", expected: no models yet) |
| API readiness `/api/v1/health/ready` through Prisma `SELECT 1` | pass: HTTP 200, `database: ok` |
| Full `pnpm check` after the change | pass (exit 0) |

## Known issues / not verified

- **Port deviation:** you asked for port 5433, but native PostgreSQL 18 already listens on 5433 (and PostgreSQL 16 on 5432), so the Docker database uses 5434. Change `POSTGRES_PORT` (root `.env`) and `DATABASE_URL` (`apps/api/.env`) to use another port. The native services were not touched.
- No migrations or models exist, so schema migration behavior is untested.
- Redis container (`pnpm docker:redis:up`) is defined but untested; no Redis code exists.
- `packages/validation` tests print a harmless Node warning about module type.
- Swagger UI under Helmet's default CSP was not visually checked in a browser (the endpoints respond 200).
- `pnpm install` reports ignored build scripts for `@scarf/scarf` and `@parcel/watcher` (non-essential; left unapproved).
- No Git commit has been made.

## Development phases

| Phase | Status |
|---|---|
| 0 Planning and Documentation | Complete |
| 1 Project Foundation | **Complete and fully verified — awaiting approval** |
| 2–12 | Pending (not authorized) |

## Next step

Owner reviews Phase 1 and explicitly approves Phase 2 (Multi-Store and Access Foundation). See [DECISIONS](DECISIONS.md) for open questions that block Phase 2 schema design.
