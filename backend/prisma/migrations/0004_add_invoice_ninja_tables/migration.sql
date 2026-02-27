CREATE TABLE "payments_ledger" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL UNIQUE,
  "billing_period" TEXT NOT NULL,
  "fee_type" TEXT NOT NULL,
  "unit" TEXT,
  "paid_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "move_approvals" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "move_request_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL REFERENCES "payments_ledger"("invoice_id"),
  "billing_period" TEXT NOT NULL,
  "approved_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
