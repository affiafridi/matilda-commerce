-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "RoleKind" AS ENUM ('SYSTEM', 'CUSTOM');

-- CreateTable
CREATE TABLE "staff_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "status" "StaffStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission" (
    "key" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "RoleKind" NOT NULL DEFAULT 'CUSTOM',
    "system_key" TEXT,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_key")
);

-- CreateTable
CREATE TABLE "staff_role_assignment" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "brand_id" UUID,
    "market_id" UUID,
    "branch_id" UUID,
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "staff_role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_system_key_key" ON "role"("system_key");

-- CreateIndex
CREATE INDEX "staff_role_assignment_staff_user_id_idx" ON "staff_role_assignment"("staff_user_id");

-- CreateIndex
CREATE INDEX "staff_role_assignment_role_id_idx" ON "staff_role_assignment"("role_id");

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permission"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_market_id_brand_id_fkey" FOREIGN KEY ("market_id", "brand_id") REFERENCES "market"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "staff_role_assignment_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written section (step 2.4): hygiene, system-role immutability, scope consistency.
-- ============================================================================

ALTER TABLE "staff_user" ADD CONSTRAINT "staff_user_email_format"
  CHECK ("email" = lower("email") AND position('@' in "email") > 1);
CREATE UNIQUE INDEX "staff_user_email_lower_key" ON "staff_user" (lower("email"));
CREATE INDEX "staff_user_status_idx" ON "staff_user" ("status");

ALTER TABLE "permission" ADD CONSTRAINT "permission_key_format"
  CHECK ("key" ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$');

ALTER TABLE "role" ADD CONSTRAINT "role_system_key_matches_kind"
  CHECK (("kind" = 'SYSTEM') = ("system_key" IS NOT NULL));
CREATE UNIQUE INDEX "role_custom_name_key" ON "role" (lower("name")) WHERE "kind" = 'CUSTOM';

ALTER TABLE "staff_role_assignment" ADD CONSTRAINT "assignment_market_needs_brand"
  CHECK ("market_id" IS NULL OR "brand_id" IS NOT NULL);
CREATE INDEX "assignment_active_staff_idx" ON "staff_role_assignment" ("staff_user_id") WHERE "revoked_at" IS NULL;

-- The permission catalog is owned by code and synced by the owner role; the runtime role only reads it.
REVOKE INSERT, UPDATE, DELETE ON "permission" FROM matilda_app;

-- System roles (the 12 templates) are immutable for the runtime role: only the owner-run sync may change them.
CREATE FUNCTION forbid_runtime_system_role_change() RETURNS trigger LANGUAGE plpgsql AS
$$
DECLARE is_system boolean;
BEGIN
  IF current_user <> 'matilda_app' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_TABLE_NAME = 'role' THEN
    is_system := COALESCE(OLD."kind", NEW."kind") = 'SYSTEM' OR COALESCE(NEW."kind", OLD."kind") = 'SYSTEM';
  ELSE
    SELECT r."kind" = 'SYSTEM' INTO is_system FROM "role" r WHERE r."id" = COALESCE(NEW."role_id", OLD."role_id");
  END IF;
  IF COALESCE(is_system, false) THEN
    RAISE EXCEPTION 'system roles are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "role_system_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "role"
  FOR EACH ROW EXECUTE FUNCTION forbid_runtime_system_role_change();
CREATE TRIGGER "role_permission_system_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "role_permission"
  FOR EACH ROW EXECUTE FUNCTION forbid_runtime_system_role_change();

-- A branch-scoped assignment must name a branch that actually serves the brand/market.
-- SECURITY DEFINER + temporary platform scope: the check must see every row regardless of the caller's brand context.
CREATE FUNCTION check_assignment_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS
$$
DECLARE
  prev text := COALESCE(current_setting('app.platform', true), '');
  ok boolean := true;
BEGIN
  IF NEW."branch_id" IS NOT NULL AND (NEW."market_id" IS NOT NULL OR NEW."brand_id" IS NOT NULL) THEN
    PERFORM set_config('app.platform', 'on', true);
    SELECT EXISTS (
      SELECT 1 FROM "branch_market" bm JOIN "market" m ON m."id" = bm."market_id"
      WHERE bm."branch_id" = NEW."branch_id"
        AND (NEW."market_id" IS NULL OR bm."market_id" = NEW."market_id")
        AND (NEW."brand_id" IS NULL OR m."brand_id" = NEW."brand_id")
    ) INTO ok;
    PERFORM set_config('app.platform', prev, true);
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'assignment scope is inconsistent: branch does not serve the given brand/market'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "assignment_scope_consistent" BEFORE INSERT OR UPDATE ON "staff_role_assignment"
  FOR EACH ROW EXECUTE FUNCTION check_assignment_scope();
