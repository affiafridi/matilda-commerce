-- CreateEnum
CREATE TYPE "TextDirection" AS ENUM ('LTR', 'RTL');

-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "currency" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "minor_unit_digits" SMALLINT NOT NULL,

    CONSTRAINT "currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "language" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "native_name" TEXT NOT NULL,
    "direction" "TextDirection" NOT NULL,

    CONSTRAINT "language_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "country" (
    "id" UUID NOT NULL,
    "iso2" CHAR(2) NOT NULL,
    "iso3" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "calling_code" TEXT,

    CONSTRAINT "country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_entity_name" TEXT,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'DRAFT',
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_currency" (
    "market_id" UUID NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "market_currency_pkey" PRIMARY KEY ("market_id","currency_code")
);

-- CreateTable
CREATE TABLE "market_language" (
    "market_id" UUID NOT NULL,
    "language_code" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "market_language_pkey" PRIMARY KEY ("market_id","language_code")
);

-- CreateTable
CREATE TABLE "brand_domain" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "market_id" UUID,
    "default_language_code" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "redirect_to_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_id" UUID NOT NULL,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "area" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "phone" TEXT,
    "email" TEXT,
    "timezone" TEXT NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_market" (
    "branch_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "country_id" UUID NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "branch_market_pkey" PRIMARY KEY ("branch_id","market_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "country_iso2_key" ON "country"("iso2");

-- CreateIndex
CREATE UNIQUE INDEX "country_iso3_key" ON "country"("iso3");

-- CreateIndex
CREATE UNIQUE INDEX "brand_slug_key" ON "brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "market_brand_id_country_id_key" ON "market"("brand_id", "country_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_brand_id_code_key" ON "market"("brand_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "market_id_brand_id_key" ON "market"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_id_country_id_key" ON "market"("id", "country_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_domain_hostname_key" ON "brand_domain"("hostname");

-- CreateIndex
CREATE INDEX "brand_domain_brand_id_idx" ON "brand_domain"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_code_key" ON "branch"("code");

-- CreateIndex
CREATE INDEX "branch_country_id_status_idx" ON "branch"("country_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "branch_id_country_id_key" ON "branch"("id", "country_id");

-- CreateIndex
CREATE INDEX "branch_market_market_id_idx" ON "branch_market"("market_id");

-- AddForeignKey
ALTER TABLE "market" ADD CONSTRAINT "market_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market" ADD CONSTRAINT "market_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_currency" ADD CONSTRAINT "market_currency_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_currency" ADD CONSTRAINT "market_currency_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_language" ADD CONSTRAINT "market_language_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_language" ADD CONSTRAINT "market_language_language_code_fkey" FOREIGN KEY ("language_code") REFERENCES "language"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_domain" ADD CONSTRAINT "brand_domain_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_domain" ADD CONSTRAINT "brand_domain_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_market" ADD CONSTRAINT "branch_market_branch_id_country_id_fkey" FOREIGN KEY ("branch_id", "country_id") REFERENCES "branch"("id", "country_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_market" ADD CONSTRAINT "branch_market_market_id_country_id_fkey" FOREIGN KEY ("market_id", "country_id") REFERENCES "market"("id", "country_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written section (docs/PHASE-2-SCHEMA-DRAFT.md sections 3-4, approved).
-- Requires the runtime role `matilda_app` to exist (created by pnpm db:bootstrap locally;
-- by infrastructure provisioning in staging/production).
-- ============================================================================

-- Data hygiene -----------------------------------------------------------------
ALTER TABLE "brand"        ADD CONSTRAINT "brand_slug_format"    CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "brand_domain" ADD CONSTRAINT "domain_hostname_fmt"  CHECK ("hostname" = lower("hostname") AND "hostname" ~ '^[a-z0-9.-]+$');
ALTER TABLE "market"       ADD CONSTRAINT "market_code_format"   CHECK ("code" ~ '^[a-z]{2,8}$');
ALTER TABLE "currency"     ADD CONSTRAINT "currency_code_upper"  CHECK ("code" = upper("code"));
ALTER TABLE "country"      ADD CONSTRAINT "country_iso_upper"    CHECK ("iso2" = upper("iso2") AND "iso3" = upper("iso3"));
ALTER TABLE "branch"       ADD CONSTRAINT "branch_code_format"   CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- At most one default currency / language per market; one primary domain per brand+market --
CREATE UNIQUE INDEX "market_currency_one_default" ON "market_currency" ("market_id") WHERE "is_default";
CREATE UNIQUE INDEX "market_language_one_default" ON "market_language" ("market_id") WHERE "is_default";
CREATE UNIQUE INDEX "brand_domain_one_primary" ON "brand_domain"
  ("brand_id", COALESCE("market_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "is_primary";

-- Immutable brand slug ----------------------------------------------------------
CREATE FUNCTION forbid_brand_slug_change() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  IF NEW."slug" <> OLD."slug" THEN RAISE EXCEPTION 'brand.slug is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "brand_slug_immutable" BEFORE UPDATE ON "brand"
  FOR EACH ROW EXECUTE FUNCTION forbid_brand_slug_change();

-- Reference data is read-only for the runtime role ------------------------------
REVOKE INSERT, UPDATE, DELETE ON "currency", "language", "country" FROM matilda_app;

-- Request context helpers (set per transaction by the data-access layer) ----------
CREATE FUNCTION app_brand_ids() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT COALESCE(string_to_array(NULLIF(current_setting('app.brand_ids', true), ''), ',')::uuid[], ARRAY[]::uuid[]) $$;

CREATE FUNCTION app_is_platform() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.platform', true), '') = 'on' $$;

-- Row-level security ------------------------------------------------------------
ALTER TABLE "brand"           ENABLE ROW LEVEL SECURITY; ALTER TABLE "brand"           FORCE ROW LEVEL SECURITY;
ALTER TABLE "brand_domain"    ENABLE ROW LEVEL SECURITY; ALTER TABLE "brand_domain"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "market"          ENABLE ROW LEVEL SECURITY; ALTER TABLE "market"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "market_currency" ENABLE ROW LEVEL SECURITY; ALTER TABLE "market_currency" FORCE ROW LEVEL SECURITY;
ALTER TABLE "market_language" ENABLE ROW LEVEL SECURITY; ALTER TABLE "market_language" FORCE ROW LEVEL SECURITY;
ALTER TABLE "branch_market"   ENABLE ROW LEVEL SECURITY; ALTER TABLE "branch_market"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "branch"          ENABLE ROW LEVEL SECURITY; ALTER TABLE "branch"          FORCE ROW LEVEL SECURITY;

CREATE POLICY "brand_scope" ON "brand"
  USING ("id" = ANY (app_brand_ids()) OR app_is_platform())
  WITH CHECK ("id" = ANY (app_brand_ids()) OR app_is_platform());

CREATE POLICY "brand_domain_scope" ON "brand_domain"
  USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())
  WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform());

CREATE POLICY "market_scope" ON "market"
  USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())
  WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform());

-- Child tables follow their market (the market policy is evaluated for the invoking role).
CREATE POLICY "market_currency_scope" ON "market_currency"
  USING (EXISTS (SELECT 1 FROM "market" m WHERE m."id" = "market_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "market" m WHERE m."id" = "market_id"));

CREATE POLICY "market_language_scope" ON "market_language"
  USING (EXISTS (SELECT 1 FROM "market" m WHERE m."id" = "market_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "market" m WHERE m."id" = "market_id"));

CREATE POLICY "branch_market_scope" ON "branch_market"
  USING (EXISTS (SELECT 1 FROM "market" m WHERE m."id" = "market_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "market" m WHERE m."id" = "market_id"));

-- A branch is visible when it serves a visible market; creating branches is platform-level
-- until `branches.manage` is delegated (policy extended at plan step 2.7).
CREATE POLICY "branch_scope" ON "branch"
  USING (app_is_platform() OR EXISTS (SELECT 1 FROM "branch_market" bm WHERE bm."branch_id" = "branch"."id"))
  WITH CHECK (app_is_platform());

-- Domain resolution (the brand is unknown until the host is resolved) --------------
-- SECURITY DEFINER runs as the table owner, which FORCE ROW LEVEL SECURITY still binds, so the
-- function raises app.platform for the duration of its single query and restores the previous
-- value before returning (a function-level SET of a custom parameter needs superuser).
CREATE FUNCTION resolve_brand_domain(p_host text)
RETURNS TABLE (
  brand_id uuid, brand_slug text, market_id uuid, market_code text,
  language_code text, is_primary boolean, redirect_to_primary boolean
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE prev text := COALESCE(current_setting('app.platform', true), '');
BEGIN
  PERFORM set_config('app.platform', 'on', true);
  RETURN QUERY
    SELECT d."brand_id", b."slug", d."market_id", m."code", d."default_language_code",
           d."is_primary", d."redirect_to_primary"
    FROM "brand_domain" d
    JOIN "brand" b ON b."id" = d."brand_id"
    LEFT JOIN "market" m ON m."id" = d."market_id"
    WHERE d."hostname" = lower(p_host) AND b."status" = 'ACTIVE';
  PERFORM set_config('app.platform', prev, true);
END $$;
REVOKE ALL ON FUNCTION resolve_brand_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_brand_domain(text) TO matilda_app;
