BEGIN;
-- A watched site is rechecked on a schedule its watcher picks (every N days
-- or a cron) and each recheck is paid when it runs, not as a daily fee.
ALTER TABLE site_monitors
  ADD COLUMN schedule jsonb NOT NULL DEFAULT '{"kind":"days","days":1}'::jsonb,
  ADD COLUMN next_check_at timestamptz NOT NULL DEFAULT now(),
  DROP COLUMN paid_through;
CREATE INDEX site_monitors_due ON site_monitors(next_check_at);
COMMIT;
