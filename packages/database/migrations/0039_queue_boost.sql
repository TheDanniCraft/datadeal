BEGIN;
-- A visitor can spend report points to move a waiting scan to the front.
ALTER TABLE scan_jobs
  ADD COLUMN boosted boolean NOT NULL DEFAULT false;
COMMIT;
