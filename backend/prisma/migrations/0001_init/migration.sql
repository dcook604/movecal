CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserRole" AS ENUM ('CONCIERGE', 'COUNCIL', 'PROPERTY_MANAGER');
CREATE TYPE "MoveType" AS ENUM ('MOVE_IN', 'MOVE_OUT', 'DELIVERY');
CREATE TYPE "BookingStatus" AS ENUM ('SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "NotifyEvent" AS ENUM ('APPROVED', 'REJECTED', 'SUBMITTED');

CREATE TABLE "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "role" "UserRole" NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "bookings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_by" UUID NOT NULL REFERENCES "users"("id"),
  "resident_name" TEXT NOT NULL,
  "resident_email" TEXT NOT NULL,
  "resident_phone" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "company_name" TEXT,
  "move_type" "MoveType" NOT NULL,
  "move_date" DATE NOT NULL,
  "start_datetime" TIMESTAMP NOT NULL,
  "end_datetime" TIMESTAMP NOT NULL,
  "elevator_required" BOOLEAN NOT NULL DEFAULT false,
  "loading_bay_required" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "status" "BookingStatus" NOT NULL DEFAULT 'SUBMITTED',
  "approved_by" UUID REFERENCES "users"("id"),
  "approved_at" TIMESTAMP,
  "public_unit_mask" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "bookings_start_datetime_idx" ON "bookings"("start_datetime");
CREATE INDEX "bookings_status_idx" ON "bookings"("status");
CREATE INDEX "bookings_move_date_idx" ON "bookings"("move_date");

CREATE TABLE "documents" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id" UUID NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "original_name" TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "uploaded_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "notification_recipients" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT,
  "email" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "notify_on" "NotifyEvent"[] NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "app_settings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "smtp_host" TEXT,
  "smtp_port" INTEGER,
  "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
  "smtp_username" TEXT,
  "smtp_password_encrypted" TEXT,
  "from_name" TEXT,
  "from_email" TEXT,
  "include_resident_contact_in_approval_emails" BOOLEAN NOT NULL DEFAULT false,
  "reminder_enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "audit_log" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" UUID NOT NULL REFERENCES "users"("id"),
  "action" TEXT NOT NULL,
  "booking_id" UUID REFERENCES "bookings"("id"),
  "metadata_json" JSONB,
  "timestamp" TIMESTAMP NOT NULL DEFAULT NOW()
);
