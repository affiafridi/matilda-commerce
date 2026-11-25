# Phase 2 Step 2.2: Tenancy Schema Draft (for owner review)

**Status: APPROVED and implemented** (migration `prisma/migrations/*_tenancy`). Deviations from this draft, made during implementation: (1) the RLS policies also admit `app_is_platform()` for Super Admin/system jobs (including the seed CLI, because FORCE RLS binds the owner role); (2) child tables (`market_currency`, `market_language`, `branch_market`) follow the `market` policy via EXISTS; (3) `resolve_brand_domain` raises and restores `app.platform` inside its body (a function-level `SET` on a custom parameter needs superuser); (4) `REVOKE INSERT, UPDATE, DELETE` on reference tables from `matilda_app`; (5) `branch` is visible through any visible `branch_market`, writable by platform scope only until `branches.manage` is delegated (step 2.7).

Scope: reference data and tenancy only (plan section 4.1: `currency`, `language`, `country`, `brand`, `brand_domain`, `market`, `market_currency`, `market_language`, `branch`, `branch_market`). Identity, RBAC, audit and customer tables get their own DDL at steps 2.4, 2.5, 2.6 and 2.8.

## 1. Spike result (decision D2-03: **GO** for row-level security)

Proved on 2026-11-25 against Docker PostgreSQL 17 with Prisma 7.10.1 + `@prisma/adapter-pg` and the least-privilege role `matilda_app` (test: `apps/api/src/database/rls-spike.int-spec.ts`, 7 tests, all passing):

- Context per request via `set_config('app.brand_ids', ..., true)` (transaction-local) inside an interactive Prisma transaction works.
- Only the permitted brands' rows are visible; with no context, **zero rows** (deny by default).
- `WITH CHECK` blocks inserting into another brand; cross-brand `UPDATE`/`DELETE` affect 0 rows.
- 60 concurrent transactions on a 3-connection pool alternating brands never saw each other's rows; plain queries afterwards saw nothing (no context leakage).
- `matilda_app` cannot disable RLS, change policies, drop or truncate tables, or run DDL; it is not superuser and does not bypass RLS (`FORCE ROW LEVEL SECURITY` also applies to the table owner).
- Rule that follows: **every tenant-owned query runs inside the data-access helper's transaction**; raw access to the pool for tenant tables is not exposed.

## 2. Proposed Prisma models (columns)

```prisma
enum TextDirection { LTR RTL }
enum ActiveStatus  { ACTIVE INACTIVE }                 // brand, branch, branch_market
enum MarketStatus  { DRAFT ACTIVE SUSPENDED }

model Currency {
  code             String @id @db.Char(3)              // ISO 4217
  name             String
  symbol           String
  minorUnitDigits  Int    @db.SmallInt                 // AED=2, KWD=3, JPY=0
  markets          MarketCurrency[]
  @@map("currency")
}

model Language {
  code        String        @id                         // 'en', 'ar'
  name        String
  nativeName  String
  direction   TextDirection
  markets     MarketLanguage[]
  @@map("language")
}

model Country {
  id           String   @id @default(uuid(7)) @db.Uuid
  iso2         String   @unique @db.Char(2)
  iso3         String   @unique @db.Char(3)
  name         String
  callingCode  String?
  markets      Market[]
  branches     Branch[]
  @@map("country")
}

model Brand {
  id               String       @id @default(uuid(7)) @db.Uuid
  slug             String       @unique                  // immutable; lowercase [a-z0-9-]
  name             String
  legalEntityName  String?
  status           ActiveStatus @default(ACTIVE)
  createdAt        DateTime     @default(now()) @db.Timestamptz
  updatedAt        DateTime     @updatedAt @db.Timestamptz
  domains          BrandDomain[]
  markets          Market[]
  @@map("brand")
}

model Market {
  id         String       @id @default(uuid(7)) @db.Uuid
  brandId    String       @db.Uuid
  countryId  String       @db.Uuid
  code       String                                     // 'ae'; used in URLs
  status     MarketStatus @default(DRAFT)
  timezone   String                                     // IANA, e.g. Asia/Dubai
  createdAt  DateTime     @default(now()) @db.Timestamptz
  updatedAt  DateTime     @updatedAt @db.Timestamptz
  brand      Brand        @relation(fields: [brandId], references: [id], onDelete: Restrict)
  country    Country      @relation(fields: [countryId], references: [id], onDelete: Restrict)
  currencies MarketCurrency[]
  languages  MarketLanguage[]
  domains    BrandDomain[]
  branches   BranchMarket[]
  @@unique([brandId, countryId])
  @@unique([brandId, code])
  @@unique([id, brandId])                                // target of composite FKs
  @@unique([id, countryId])
  @@map("market")
}

model MarketCurrency {
  marketId      String  @db.Uuid
  currencyCode  String  @db.Char(3)
  isDefault     Boolean @default(false)
  market        Market   @relation(fields: [marketId], references: [id], onDelete: Cascade)
  currency      Currency @relation(fields: [currencyCode], references: [code], onDelete: Restrict)
  @@id([marketId, currencyCode])
  @@map("market_currency")
}

model MarketLanguage {
  marketId      String  @db.Uuid
  languageCode  String
  isDefault     Boolean @default(false)
  sortOrder     Int     @default(0) @db.SmallInt
  market        Market   @relation(fields: [marketId], references: [id], onDelete: Cascade)
  language      Language @relation(fields: [languageCode], references: [code], onDelete: Restrict)
  @@id([marketId, languageCode])
  @@map("market_language")
}

model BrandDomain {
  id                  String  @id @default(uuid(7)) @db.Uuid
  brandId             String  @db.Uuid
  hostname            String  @unique                   // lowercase, no scheme/port/path
  marketId            String? @db.Uuid
  defaultLanguageCode String?
  isPrimary           Boolean @default(false)
  redirectToPrimary   Boolean @default(false)
  createdAt           DateTime @default(now()) @db.Timestamptz
  brand               Brand   @relation(fields: [brandId], references: [id], onDelete: Restrict)
  market              Market? @relation(fields: [marketId, brandId], references: [id, brandId])
  @@index([brandId])
  @@map("brand_domain")
}

model Branch {
  id         String       @id @default(uuid(7)) @db.Uuid
  code       String       @unique                        // short stable code, e.g. 'dxb-marina'
  name       String
  countryId  String       @db.Uuid
  addressLine1 String?
  addressLine2 String?
  city       String?
  area       String?
  latitude   Decimal?     @db.Decimal(9, 6)
  longitude  Decimal?     @db.Decimal(9, 6)
  phone      String?
  email      String?
  timezone   String
  status     ActiveStatus @default(ACTIVE)
  createdAt  DateTime     @default(now()) @db.Timestamptz
  updatedAt  DateTime     @updatedAt @db.Timestamptz
  country    Country      @relation(fields: [countryId], references: [id], onDelete: Restrict)
  markets    BranchMarket[]
  @@unique([id, countryId])
  @@index([countryId, status])
  @@map("branch")
}

model BranchMarket {
  branchId   String       @db.Uuid
  marketId   String       @db.Uuid
  countryId  String       @db.Uuid
  status     ActiveStatus @default(ACTIVE)
  branch     Branch @relation(fields: [branchId, countryId], references: [id, countryId], onDelete: Cascade)
  market     Market @relation(fields: [marketId, countryId], references: [id, countryId], onDelete: Cascade)
  @@id([branchId, marketId])
  @@index([marketId])
  @@map("branch_market")
}
```

Branch opening hours, capacity, delivery coverage and slots are **not** modeled here (Phase 4).

## 3. Hand-written SQL (cannot be expressed in Prisma)

Placed in the same migration as the tables, reviewed together.

```sql
-- Data hygiene
ALTER TABLE brand        ADD CONSTRAINT brand_slug_format   CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE brand_domain ADD CONSTRAINT domain_hostname_fmt CHECK (hostname = lower(hostname) AND hostname ~ '^[a-z0-9.-]+$');
ALTER TABLE market       ADD CONSTRAINT market_code_format  CHECK (code ~ '^[a-z]{2,8}$');
ALTER TABLE currency     ADD CONSTRAINT currency_code_upper CHECK (code = upper(code));
ALTER TABLE country      ADD CONSTRAINT country_iso_upper   CHECK (iso2 = upper(iso2) AND iso3 = upper(iso3));

-- Exactly-one-default style rules
CREATE UNIQUE INDEX market_currency_one_default ON market_currency (market_id) WHERE is_default;
CREATE UNIQUE INDEX market_language_one_default ON market_language (market_id) WHERE is_default;
CREATE UNIQUE INDEX brand_domain_one_primary    ON brand_domain (brand_id, COALESCE(market_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_primary;

-- Immutable brand slug
CREATE FUNCTION forbid_slug_change() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN IF NEW.slug <> OLD.slug THEN RAISE EXCEPTION 'brand.slug is immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER brand_slug_immutable BEFORE UPDATE ON brand FOR EACH ROW EXECUTE FUNCTION forbid_slug_change();
```

Not enforced in SQL (enforced in the service + tests): a market may be `ACTIVE` only with ≥1 currency, ≥1 language, exactly one default of each, and a valid timezone; domain `default_language_code` must be enabled for its market.

## 4. Row-level security on tenancy tables

Context variables set per request transaction by the data-access helper (never by clients):

| Variable | Meaning |
|---|---|
| `app.brand_ids` | Comma-separated brand ids the actor may see/act on (the resolved brand for storefront requests; the permitted set for staff) |
| `app.platform` | `on` only for actors holding a platform-scope assignment (Super Admin) or the `system` actor; allows seeing rows not tied to a brand (e.g. a branch not yet linked to a market) |

```sql
ALTER TABLE brand           ENABLE ROW LEVEL SECURITY; ALTER TABLE brand           FORCE ROW LEVEL SECURITY;
-- same two statements for: brand_domain, market, market_currency, market_language, branch_market, branch

CREATE POLICY brand_scope ON brand USING (id = ANY (app_brand_ids())) WITH CHECK (id = ANY (app_brand_ids()) OR app_is_platform());
CREATE POLICY brand_domain_scope ON brand_domain USING (brand_id = ANY (app_brand_ids())) WITH CHECK (brand_id = ANY (app_brand_ids()));
CREATE POLICY market_scope ON market USING (brand_id = ANY (app_brand_ids())) WITH CHECK (brand_id = ANY (app_brand_ids()));
-- market_currency / market_language / branch_market: USING/WITH CHECK via EXISTS on market for the same market_id
CREATE POLICY branch_scope ON branch
  USING (app_is_platform() OR EXISTS (SELECT 1 FROM branch_market bm JOIN market m ON m.id = bm.market_id
                                      WHERE bm.branch_id = branch.id AND m.brand_id = ANY (app_brand_ids())))
  WITH CHECK (app_is_platform());   -- creating/linking branches is a platform-level action unless a brand-scope role holds branches.manage (policy extended at step 2.7)

-- helpers (owner-owned, STABLE, read the GUCs defensively)
CREATE FUNCTION app_brand_ids() RETURNS uuid[] ... string_to_array(NULLIF(current_setting('app.brand_ids', true), ''), ',')::uuid[] ...
CREATE FUNCTION app_is_platform() RETURNS boolean ... COALESCE(current_setting('app.platform', true), '') = 'on' ...
```

**Domain resolution (chicken-and-egg):** the brand is unknown until the host is resolved, so the resolver calls a minimal `SECURITY DEFINER` function owned by `matilda_owner`:

```sql
CREATE FUNCTION resolve_brand_domain(p_host text)
RETURNS TABLE (brand_id uuid, brand_slug text, market_id uuid, market_code text, language_code text,
               is_primary boolean, redirect_to_primary boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ ... joins brand_domain/brand/market for exactly one lowercase hostname, only ACTIVE brands ... $$;
REVOKE ALL ON FUNCTION resolve_brand_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_brand_domain(text) TO matilda_app;
```

It returns one row for one host and never lists other brands. Global reference tables (`currency`, `language`, `country`) have no RLS: they hold no tenant data.

## 5. Indexes (beyond PKs/uniques above)

`brand_domain(brand_id)`, `market(brand_id)` via the unique pairs, `branch(country_id, status)`, `branch_market(market_id)`. Query plans are checked with `EXPLAIN` at step 2.7 when list endpoints exist.

## 6. Constraints proven by tests (step 2.2 acceptance)

Duplicate hostname rejected; uppercase hostname rejected; two primary domains for the same brand+market rejected; domain pointing at another brand's market rejected (composite FK); branch linked to a market in a different country rejected (composite FKs); second default currency/language rejected; brand slug change rejected; `matilda_app` sees only permitted brands' rows through every tenancy table, writes into another brand fail, and `resolve_brand_domain` returns only the requested host.

## 7. Points for your decision

1. **Branch visibility:** Brand-scoped staff see a branch only if it serves one of their brands; creating or linking branches is platform-level until `branches.manage` is delegated (step 2.7). OK?
2. **`app.platform` flag:** a single server-set flag lets platform-scope actors see unlinked rows. It is the one deliberate RLS exception, set only by the authorization layer and covered by tests. OK, or prefer no exception (every branch must be linked to a market at creation)?
3. **Market code** (`ae`) is unique per brand and used in URLs (`/ae/en`); confirm the 2–8 lowercase-letter rule.
4. **Branch `code`** is globally unique and stable (e.g. `dxb-marina`); confirm.
5. **Timezone** stored as IANA names on market and branch (validated in service); confirm both are needed.
6. **Seeded currencies/languages/countries:** AED, SAR, USD, EUR; `en`, `ar`; UAE (more added by configuration). Anything else for day one?
7. **Legal entity** per brand is a free-text field now (live sites suggest one shared entity); a proper legal-entity table can wait for invoicing (Phase 6).

After approval: step 2.2 adds the models to `schema.prisma`, creates the first migration (Prisma-generated tables + the SQL above in the same migration), the scoped data-access helper, constraint and isolation tests, and the dev seed for reference data. Rollback: the migration is the first one, so rollback is dropping and recreating the dev database; the production rollback procedure is documented before any production migration.
