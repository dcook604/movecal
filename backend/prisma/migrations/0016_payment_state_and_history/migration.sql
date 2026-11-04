-- Explicit payment / approval state on bookings
CREATE TYPE "PaymentStatus" AS ENUM ('NONE', 'PAID', 'REFUNDED');
CREATE TYPE "ApprovalSource" AS ENUM ('PAYMENT', 'MANUAL', 'AUTO');

ALTER TABLE "bookings"
  ADD COLUMN "payment_status" "PaymentStatus" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "approval_source" "ApprovalSource",
  ADD COLUMN "status_reason" TEXT;

-- Ledger: invoice date for date-proximity matching, reversal tracking
ALTER TABLE "payments_ledger"
  ADD COLUMN "invoice_date" TIMESTAMPTZ,
  ADD COLUMN "reversed_at" TIMESTAMPTZ;

-- Settings: configurable payment notification recipient + persisted poll cursor
ALTER TABLE "app_settings"
  ADD COLUMN "payment_notify_email" TEXT,
  ADD COLUMN "invoice_ninja_cursor" TIMESTAMPTZ;

-- One payment can approve at most one booking. Remove any historical duplicates
-- (keeping the earliest approval per invoice) so the unique index can be created.
DELETE FROM "move_approvals" a
USING "move_approvals" b
WHERE a."invoice_id" = b."invoice_id"
  AND (a."approved_at", a."id") > (b."approved_at", b."id");

CREATE UNIQUE INDEX "move_approvals_invoice_id_key" ON "move_approvals"("invoice_id");
CREATE INDEX "move_approvals_move_request_id_idx" ON "move_approvals"("move_request_id");

-- Backfill from existing data
UPDATE "bookings" SET "payment_status" = 'PAID', "approval_source" = 'PAYMENT'
WHERE "id"::text IN (SELECT "move_request_id" FROM "move_approvals");

UPDATE "bookings" SET "approval_source" = 'AUTO'
WHERE "status" = 'APPROVED' AND "approval_source" IS NULL AND "move_type" = 'OPEN_HOUSE';

UPDATE "bookings" SET "approval_source" = 'MANUAL'
WHERE "status" = 'APPROVED' AND "approval_source" IS NULL;

-- Preserve existing behaviour: payment confirmations used to be hardcoded to this address.
UPDATE "app_settings" SET "payment_notify_email" = 'dcook@spectrum4.ca' WHERE "payment_notify_email" IS NULL;
