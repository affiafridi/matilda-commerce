# Matilda Commerce

Multi-brand, multi-market, multi-branch commerce platform (modular monolith, pnpm monorepo).
Project rules: [CLAUDE.md](CLAUDE.md). Documentation index: [docs/README.md](docs/README.md).

**Status:** Phase 1 (Project Foundation) complete. No business modules exist yet.

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

Runs format check, lint, type-check, tests and production builds. Individually: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Database (Prisma)

Prisma is configured and connects to the Docker database (`/api/v1/health/ready` returns 200), but has **no models or migrations yet**; the schema must be designed and reviewed first ([docs/DATABASE.md](docs/DATABASE.md)). `prisma migrate status` reports "No migration found" until Phase 2.

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
