BEGIN;
-- Scans run in a visitor's private browser window by the extension, for
-- sites that block the server's scanner. A result is published once two
-- different people's uploads agree on the stable facts.
CREATE TABLE browser_scan_uploads (
  id uuid PRIMARY KEY,
  domain text NOT NULL REFERENCES domains(name),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  facts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  scan_id uuid REFERENCES scans(id) ON DELETE SET NULL
);
CREATE INDEX browser_scan_uploads_domain ON browser_scan_uploads (domain, created_at);
ALTER TABLE scan_jobs ADD COLUMN upload_id uuid REFERENCES browser_scan_uploads(id);
COMMIT;
