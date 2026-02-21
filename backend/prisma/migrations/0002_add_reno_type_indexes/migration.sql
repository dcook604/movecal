-- Add RENO value to MoveType enum
ALTER TYPE "MoveType" ADD VALUE IF NOT EXISTS 'RENO';

-- Add missing composite indexes from schema
CREATE INDEX IF NOT EXISTS "bookings_status_start_datetime_idx" ON "bookings"("status", "start_datetime");
CREATE INDEX IF NOT EXISTS "bookings_created_by_id_created_at_idx" ON "bookings"("created_by", "created_at");
