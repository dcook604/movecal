ALTER TABLE "payments_ledger"
  ADD COLUMN "dismissed"        BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN "dismissed_reason" TEXT,
  ADD COLUMN "dismissed_at"     TIMESTAMPTZ;
