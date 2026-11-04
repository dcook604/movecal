-- bookings.edit_token is used by the resident self-service flow but was never created by a
-- migration (production got it out-of-band). IF NOT EXISTS makes this a no-op there and
-- repairs fresh databases.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "edit_token" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_edit_token_key" ON "bookings"("edit_token");
