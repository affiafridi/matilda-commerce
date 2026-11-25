-- CreateEnum
CREATE TYPE "StaffTokenType" AS ENUM ('INVITE', 'RESET');

-- AlterTable
ALTER TABLE "staff_user" ADD COLUMN     "last_login_at" TIMESTAMPTZ,
ADD COLUMN     "mfa_enrolled_at" TIMESTAMPTZ,
ADD COLUMN     "password_hash" TEXT;

-- CreateTable
CREATE TABLE "staff_mfa_totp" (
    "staff_user_id" UUID NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ,
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_mfa_totp_pkey" PRIMARY KEY ("staff_user_id")
);

-- CreateTable
CREATE TABLE "staff_recovery_code" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_session" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "mfa_verified_at" TIMESTAMPTZ,
    "step_up_until" TIMESTAMPTZ,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "staff_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_token" (
    "id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "type" "StaffTokenType" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_attempt" (
    "key_hash" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lock_level" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_failure_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempt_pkey" PRIMARY KEY ("key_hash")
);

-- CreateIndex
CREATE INDEX "staff_recovery_code_staff_user_id_idx" ON "staff_recovery_code"("staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_session_token_hash_key" ON "staff_session"("token_hash");

-- CreateIndex
CREATE INDEX "staff_session_staff_user_id_idx" ON "staff_session"("staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_token_token_hash_key" ON "staff_token"("token_hash");

-- CreateIndex
CREATE INDEX "staff_token_staff_user_id_type_idx" ON "staff_token"("staff_user_id", "type");

-- AddForeignKey
ALTER TABLE "staff_mfa_totp" ADD CONSTRAINT "staff_mfa_totp_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_recovery_code" ADD CONSTRAINT "staff_recovery_code_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_session" ADD CONSTRAINT "staff_session_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_token" ADD CONSTRAINT "staff_token_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Hand-written section (step 2.6)
-- ============================================================================

-- A staff member cannot be ACTIVE without a password; INVITED accounts have none yet.
ALTER TABLE "staff_user" ADD CONSTRAINT "staff_user_active_needs_password"
  CHECK ("status" <> 'ACTIVE' OR "password_hash" IS NOT NULL);

CREATE INDEX "staff_session_active_idx" ON "staff_session" ("staff_user_id") WHERE "revoked_at" IS NULL;
CREATE INDEX "staff_session_expiry_idx" ON "staff_session" ("absolute_expires_at");
CREATE UNIQUE INDEX "staff_recovery_code_hash_key" ON "staff_recovery_code" ("staff_user_id", "code_hash");
CREATE INDEX "staff_token_expiry_idx" ON "staff_token" ("expires_at");

ALTER TABLE "auth_attempt" ADD CONSTRAINT "auth_attempt_non_negative"
  CHECK ("failures" >= 0 AND "lock_level" >= 0);
