-- DropIndex
DROP INDEX "audit_log_actor_type_actor_id_occurred_at_idx";

-- DropIndex
DROP INDEX "audit_log_brand_id_occurred_at_idx";

-- CreateIndex
CREATE INDEX "audit_log_brand_id_id_idx" ON "audit_log"("brand_id", "id");

-- CreateIndex
CREATE INDEX "audit_log_actor_type_actor_id_id_idx" ON "audit_log"("actor_type", "actor_id", "id");
