BEGIN;
-- The last recheck a watcher paid for. A new watch has none, so its first
-- check is always paid, even when someone else scanned the site recently.
ALTER TABLE site_monitors ADD COLUMN charged_at timestamptz;
UPDATE site_monitors SET charged_at = created_at;

-- Alert emails: each account is emailed about a scan at most once.
CREATE TABLE alert_deliveries (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Null when delivery was attempted but not confirmed; it is not retried.
  sent_at timestamptz,
  PRIMARY KEY (user_id, scan_id)
);

-- Watches that ended on their own. Points are not involved here; the row
-- only lets the Library say why a watch stopped and offer to start again.
CREATE TABLE watch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  domain text NOT NULL REFERENCES domains(name) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('stopped_insufficient')),
  schedule jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX watch_events_account ON watch_events(user_id, created_at DESC);
COMMIT;
