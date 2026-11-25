# Matilda Commerce

Multi-brand, multi-market, multi-branch commerce platform (modular monolith, pnpm monorepo).
Project rules: [CLAUDE.md](CLAUDE.md). Documentation index: [docs/README.md](docs/README.md).

**Status:** Phase 1 complete; Phase 2 (Multi-Store and Access Foundation) in progress, steps 2.1-2.2 done. No business modules exist yet.

## Prerequisites

- Node.js 22.12+ (developed on 24)
- pnpm 10.34.9 (`npm i -g pnpm@10.34.9`, or `corepack enable`)
- Docker Desktop (provides the local PostgreSQL 17 container; data lives in a persistent Docker volume)
- Redis on `6379` only when a feature needs it (`pnpm docker:redis:up`)

> Native PostgreSQL services on this machine use ports 5432 and 5433, so the Docker database is published on **host port 5434** (container port stays 5432).

## First-time setup

```bash
pnpm install
```

```bash
cp apps/api/.env.example apps/api/.env
cp apps/storefront/.env.example apps/storefront/.env.local
cp apps/admin/.env.example apps/admin/.env.local
```

The example `DATABASE_URL` already matches the Docker database defaults. To change the user, password, database or port, copy the root `.env.example` to `.env`, edit it, and update `DATABASE_URL` in `apps/api/.env` to match. Env files are git-ignored; never commit real secrets.

## Start the development environment

```bash
pnpm docker:up
```

```bash
pnpm build:packages
```

```bash
pnpm dev
```

## Stop the development environment

Press `Ctrl+C` in the terminal running `pnpm dev`, then:

```bash
pnpm docker:down
```

`docker:down` removes the container but **keeps the data** (named volume `matilda-commerce_matilda_postgres_data`). Other commands: `pnpm docker:logs` (follow database logs). To delete all local database data on purpose: `docker compose down -v`.

| App | URL |
|---|---|
| Storefront | http://localhost:3000 |
| Admin | http://localhost:3001 |
| API | http://localhost:4000/api/v1 |
| Swagger UI | http://localhost:4000/api/docs |
| Liveness | http://localhost:4000/api/v1/health |
| Readiness (checks DB) | http://localhost:4000/api/v1/health/ready |

Run one app: `pnpm dev:api`, `pnpm dev:storefront`, `pnpm dev:admin`.

## Quality checks

```bash
pnpm check
```

Runs format check, lint, type-check, tests and production builds (no database needed). `pnpm test:int` runs the database integration tests against `matilda_test` (needs `pnpm docker:up`); `pnpm check:full` runs both. After pulling Phase 2 changes, run `pnpm docker:up` once (it creates the `matilda_app` / `matilda_owner` roles) and refresh `apps/api/.env` from `apps/api/.env.example`, filling the two secret placeholders. Individually: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Database (Prisma)

Prisma connects to the Docker database as the least-privilege role `matilda_app`; migrations run as `matilda_owner`. Phase 2 step 2.2 added the tenancy schema ([docs/PHASE-2-SCHEMA-DRAFT.md](docs/PHASE-2-SCHEMA-DRAFT.md)). After `pnpm docker:up`: `pnpm --filter @matilda/api db:deploy`, `pnpm build`, then `pnpm --filter @matilda/api db:seed dev` (local data) or `db:seed bootstrap` (real brands/domains only).

**First admin (step 2.6):** there are no default credentials. After seeding, create the first Super Admin with `pnpm --filter @matilda/api db:create-super-admin -- --email you@your-domain --name "Your Name"`. It prints a one-time link (valid 72 hours) to `ADMIN_BASE_URL/accept-invite?token=...`; the person sets a password and enrolls an authenticator app. In staging/production set `PASSWORD_PEPPER` (32+ random characters; keep it secret and stable, because changing it invalidates all passwords).

```bash
pnpm db:generate
```

## Layout

```text
apps/api         NestJS API (Prisma, Swagger, Pino)
apps/storefront  Next.js storefront (port 3000)
apps/admin       Next.js admin (port 3001)
packages/*       config, types, validation, api-client, ui, commerce
docs/            requirements, architecture, decisions, progress
```
