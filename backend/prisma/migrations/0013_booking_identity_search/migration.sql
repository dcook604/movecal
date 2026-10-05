-- Normalized identity columns for admin history search / cross-unit matching
ALTER TABLE "bookings" ADD COLUMN "resident_phone_norm" TEXT;
ALTER TABLE "bookings" ADD COLUMN "resident_email_norm" TEXT;
ALTER TABLE "bookings" ADD COLUMN "unit_norm" TEXT;

-- Backfill (mirrors utils/identity.ts)
UPDATE "bookings" SET
  "resident_phone_norm" = CASE
    WHEN length(regexp_replace("resident_phone", '\D', '', 'g')) = 11
         AND regexp_replace("resident_phone", '\D', '', 'g') LIKE '1%'
      THEN substr(regexp_replace("resident_phone", '\D', '', 'g'), 2)
    WHEN length(regexp_replace("resident_phone", '\D', '', 'g')) >= 7
      THEN regexp_replace("resident_phone", '\D', '', 'g')
    ELSE NULL
  END,
  "resident_email_norm" = CASE WHEN position('@' in "resident_email") > 0 THEN lower(btrim("resident_email")) ELSE NULL END,
  "unit_norm" = upper(regexp_replace("unit", '[^A-Za-z0-9]', '', 'g'));

CREATE INDEX "bookings_resident_phone_norm_idx" ON "bookings"("resident_phone_norm");
CREATE INDEX "bookings_resident_email_norm_idx" ON "bookings"("resident_email_norm");
CREATE INDEX "bookings_unit_norm_idx" ON "bookings"("unit_norm");

CREATE TABLE "shared_contacts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shared_contacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shared_contacts_kind_value_key" ON "shared_contacts"("kind", "value");
