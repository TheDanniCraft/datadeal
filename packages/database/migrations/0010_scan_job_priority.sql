BEGIN;
ALTER TABLE scan_jobs ADD COLUMN priority boolean NOT NULL DEFAULT false;
COMMIT;
