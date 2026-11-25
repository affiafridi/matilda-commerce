# Folder Structure

**Status (Phase 1):** the monorepo skeleton below now exists. Implemented so far: `apps/api` (`src/{common,config,database,modules/health}`, `prisma/`), `apps/storefront` and `apps/admin` (only `src/app` and `src/lib`; no components, features, stores or themes yet), `packages/{config,types,validation,api-client,ui,commerce}`, `docker-compose.yml`, root configs. `infrastructure/` and `apps/storefront/src/themes/*` are not created yet. The tree shows the full intended structure.

```text
matilda-commerce/
├── apps/
│   ├── storefront/
│   │   ├── src/
│   │   │   ├── app/            # App Router routes ([country]/[lang]/...)
│   │   │   ├── components/     # shared, brand-neutral components
│   │   │   ├── features/       # product, cart, checkout, account, search
│   │   │   ├── hooks/
│   │   │   ├── services/       # API calls
│   │   │   ├── stores/         # Zustand
│   │   │   ├── lib/
│   │   │   ├── i18n/           # next-intl messages (en, ar)
│   │   │   └── themes/
│   │   │       ├── flowers/
│   │   │       ├── cakes/
│   │   │       └── cookies/
│   │   └── public/
│   ├── admin/
│   └── api/
│       ├── prisma/
│       └── src/
│           ├── modules/
│           ├── common/
│           └── config/
├── packages/
│   ├── commerce/      # shared commerce UI/hooks/utilities (no authoritative business logic)
│   ├── ui/            # design primitives, token plumbing
│   ├── types/         # shared types / DTO contracts
│   ├── validation/    # shared Zod schemas
│   ├── api-client/    # typed API client
│   └── config/        # eslint, tsconfig, tailwind presets
├── infrastructure/    # Docker, Nginx, deployment definitions
├── docs/
├── CLAUDE.md
├── pnpm-workspace.yaml
├── package.json
└── docker-compose.yml
```

## Rules

- Dependency direction: apps → packages; packages never import apps. Storefront and admin never import API internals; they share contracts via `types`/`validation`/`api-client`.
- Themes contain presentation only: tokens, layouts, section variants, copy defaults. No pricing, stock, tax or delivery rules.
- Brand-specific code is isolated in `themes/*`; adding a brand should not require editing shared commerce code.
- Backend modules follow [ARCHITECTURE.md](ARCHITECTURE.md); each module owns its controllers, services, DTOs, and tests.
- [Open] Whether the shipped admin uses `packages/ui` or shadcn components copied into `apps/admin` — decide at Phase 2.
