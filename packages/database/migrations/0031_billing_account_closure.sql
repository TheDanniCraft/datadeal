BEGIN;
ALTER TABLE "user" ADD COLUMN billing_closing boolean NOT NULL DEFAULT false;
COMMIT;
