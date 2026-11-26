BEGIN;
-- Why a scan failed, when we know: "blocked" means the site served the
-- scanner a bot challenge or block page instead of its homepage.
ALTER TABLE scans
  ADD COLUMN failure text CHECK (failure IN ('blocked'));
COMMIT;
