-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED');

-- CreateEnum
CREATE TYPE "CustomerTokenType" AS ENUM ('VERIFY_EMAIL', 'RESET');

-- CreateTable
CREATE TABLE "customer" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "preferred_language" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "marketing_consent_at" TIMESTAMPTZ,
    "marketing_consent_source" TEXT,
    "deletion_requested_at" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_session" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "customer_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_token" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "CustomerTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_brand_id_status_idx" ON "customer"("brand_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_brand_id_email_key" ON "customer"("brand_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_id_brand_id_key" ON "customer"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_session_token_hash_key" ON "customer_session"("token_hash");

-- CreateIndex
CREATE INDEX "customer_session_customer_id_idx" ON "customer_session"("customer_id");

-- CreateIndex
CREATE INDEX "customer_session_expiry_idx" ON "customer_session"("absolute_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_token_token_hash_key" ON "customer_token"("token_hash");

-- CreateIndex
CREATE INDEX "customer_token_customer_id_type_idx" ON "customer_token"("customer_id", "type");

-- CreateIndex
CREATE INDEX "customer_token_expiry_idx" ON "customer_token"("expires_at");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_session" ADD CONSTRAINT "customer_session_customer_id_brand_id_fkey" FOREIGN KEY ("customer_id", "brand_id") REFERENCES "customer"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_token" ADD CONSTRAINT "customer_token_customer_id_brand_id_fkey" FOREIGN KEY ("customer_id", "brand_id") REFERENCES "customer"("id", "brand_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written section (step 2.8)
-- ============================================================================

ALTER TABLE "customer" ADD CONSTRAINT "customer_email_lower" CHECK ("email" = lower("email"));
ALTER TABLE "customer" ADD CONSTRAINT "customer_deletion_consistent"
  CHECK ("status" <> 'DELETION_REQUESTED' OR "deletion_requested_at" IS NOT NULL);
CREATE INDEX "customer_session_active_idx" ON "customer_session" ("customer_id") WHERE "revoked_at" IS NULL;

-- Row-level security: every customer table is brand-scoped like the tenancy tables.
ALTER TABLE "customer"         ENABLE ROW LEVEL SECURITY; ALTER TABLE "customer"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_session" ENABLE ROW LEVEL SECURITY; ALTER TABLE "customer_session" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_token"   ENABLE ROW LEVEL SECURITY; ALTER TABLE "customer_token"   FORCE ROW LEVEL SECURITY;

CREATE POLICY "customer_scope" ON "customer"
  USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())
  WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform());
CREATE POLICY "customer_session_scope" ON "customer_session"
  USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())
  WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform());
CREATE POLICY "customer_token_scope" ON "customer_token"
  USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform())
  WITH CHECK ("brand_id" = ANY (app_brand_ids()) OR app_is_platform());
