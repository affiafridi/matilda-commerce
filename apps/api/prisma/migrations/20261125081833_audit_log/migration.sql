-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'CUSTOMER', 'SYSTEM', 'GUEST');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILED');


-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "AuditActorType" NOT NULL,
    "actor_id" UUID,
    "brand_id" UUID,
    "market_id" UUID,
    "branch_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_brand_id_occurred_at_idx" ON "audit_log"("brand_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_type_actor_id_occurred_at_idx" ON "audit_log"("actor_type", "actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- ============================================================================
-- Hand-written section (step 2.5): the audit log is append-only and brand-scoped for reading.
-- ============================================================================

-- Runtime role may only add and read rows (belt); triggers block everyone, owner included (braces).
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM matilda_app;

CREATE FUNCTION forbid_audit_log_change() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER "audit_log_no_row_change" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_change();
CREATE TRIGGER "audit_log_no_truncate" BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_log_change();

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;

-- Anyone may append (the application decides what to record); reading follows the brand scope.
-- Rows without a brand are platform-level and visible to platform scope only. No UPDATE/DELETE policy exists.
CREATE POLICY "audit_log_append" ON "audit_log" FOR INSERT WITH CHECK (true);
CREATE POLICY "audit_log_read" ON "audit_log" FOR SELECT
  USING ("brand_id" = ANY (app_brand_ids()) OR app_is_platform());
