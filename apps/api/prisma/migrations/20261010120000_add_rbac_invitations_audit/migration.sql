-- Role-based access control, invitations, and the audit log.
--
-- Additive and non-destructive throughout. In particular:
--
--   * `owner` and `staff` are untouched, so every existing user keeps exactly
--     the access they had before this migration;
--   * the `Role` enum only gains values, it loses none;
--   * no user, receipt, invoice or customer row is read, rewritten or deleted.
--
-- PostgreSQL 11+ allows several ADD VALUE in one transaction; the new values
-- are simply not usable until the transaction commits, and nothing below uses
-- them.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'admin';
ALTER TYPE "Role" ADD VALUE 'viewer';

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'staff',
    "token_hash" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_business_id_created_at_idx" ON "invitations"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- One live invitation per address per organization. Re-inviting the same
-- person revokes the old row at the route level and issues a new token.
CREATE UNIQUE INDEX "invitations_business_id_email_key" ON "invitations"("business_id", "email");

-- CreateIndex
CREATE INDEX "audit_events_business_id_created_at_idx" ON "audit_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_business_id_action_idx" ON "audit_events"("business_id", "action");

-- CreateIndex
CREATE INDEX "audit_events_resource_type_resource_id_idx" ON "audit_events"("resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict: deleting the user who sent an invitation must not silently erase
-- the record that they did.
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Cascade: an organization's audit trail belongs to it.
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: an audit entry must outlive the person who made it.
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;