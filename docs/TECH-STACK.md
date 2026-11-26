# Tech Stack

[Approved] Fully custom platform. Use stable, compatible production versions **at the time development begins** (versions are intentionally not pinned here). Introduce each dependency only when its functionality is needed; avoid overengineering.

## Core

| Technology | Purpose | Introduced |
|---|---|---|
| Next.js (App Router) | Storefront and admin | Phase 1 |
| NestJS | Backend REST API | Phase 1 |
| TypeScript (strict) | All code | Phase 1 |
| PostgreSQL | Primary database | Phase 1 |
| Prisma | ORM | Phase 1 |
| Tailwind CSS | Styling | Phase 1 |
| shadcn/ui | Customizable admin components (must be adapted, not left default) | Phase 2 |
| pnpm workspaces | Monorepo | Phase 1 |

## Supporting

| Technology | Purpose | Likely phase |
|---|---|---|
| Zod | Schema/input validation (shared in `packages/validation`) | 1–2 |
| TanStack Query | API fetching/caching | 2–3 |
| TanStack Table | Admin tables | 2–3 |
| React Hook Form | Forms | 2–3 |
| Zustand | Client state | 5/8 |
| next-intl | i18n, RTL | 2/8 |
| Redis | Cache, rate limiting | 2–5 |
| BullMQ | Jobs, schedules | 4–6 |
| Motion | Storefront animation (restrained) | 8 |
| TipTap | CMS rich text | 7 |
| Recharts | Charts | 9 |
| Cloudflare R2 | Media/files | 3 |
| CCAvenue | Payments | 5 |
| Swagger/OpenAPI | API docs | 1 |
| Socket.IO | Real-time where required | 6 |
| Pino | Logging | 1 |
| Sentry | Error monitoring | 10 (or earlier on staging) |
| Jest | Unit/integration tests | 1 |
| Playwright | E2E tests | 5+ |
| Docker, Nginx, GitHub Actions | Containers, proxy, CI/CD | 1 / 10 |
| Cloudflare | DNS, CDN, WAF | 10 |

Phase numbers are **[Proposed]**; see [ROADMAP.md](ROADMAP.md).

## Installed in Phase 1 (exact versions are in each `package.json`)

| Area | Choice |
|---|---|
| Runtime / package manager | Node 22.12+ (developed on 24), pnpm 10.34.9 |
| API | NestJS 11 (`@nestjs/core`, `common`, `platform-express`, `swagger`), `nestjs-pino` + `pino`, `helmet`, `reflect-metadata`, `rxjs` |
| Database | Prisma 7.10.1, `@prisma/client`, `@prisma/adapter-pg`, `pg` (no models yet) |
| Frontends | Next.js 16.4.6, React 19, Tailwind CSS 4 (`@tailwindcss/postcss`) |
| Shared | Zod 4 (`@matilda/validation`) |
| Tooling | TypeScript 5.9, ESLint 9 (flat config) + `typescript-eslint` + `eslint-config-next`, Prettier 3 |
| Testing | Jest 30 + ts-jest + supertest (API); `node:test` (packages, frontends) |

**Installed in Phase 4 step 4.1:** BullMQ (Redis connection through its own client). **Not yet installed (introduced when needed):** TanStack Query/Table, React Hook Form, Zustand, next-intl, shadcn/ui, Motion, TipTap, Recharts, Socket.IO, Sentry, Playwright, Argon2 library. See [DECISIONS](DECISIONS.md) D-014 to D-020 for version rationale.

## Rules

- No unapproved technologies without owner discussion ([DECISIONS.md](DECISIONS.md)).
- Argon2id for password hashing (library choice to be decided at Phase 2).
- Package choices for tax, PDF invoices, mapping, email, SMS, WhatsApp providers are **[Open]**.
- Rejected: WooCommerce, Shopify, Medusa.js as backend; microservices at this stage.
