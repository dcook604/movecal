ALTER TABLE "app_settings"
  ADD COLUMN "unpaid_payment_reminder_enabled" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "bookings"
  ADD COLUMN "last_payment_reminder_sent_at" TIMESTAMPTZ;
