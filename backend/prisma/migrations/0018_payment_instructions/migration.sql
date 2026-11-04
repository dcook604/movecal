-- Free-text payment instructions (fees, where/how to pay) shown to residents
ALTER TABLE "app_settings" ADD COLUMN "payment_instructions" TEXT;
