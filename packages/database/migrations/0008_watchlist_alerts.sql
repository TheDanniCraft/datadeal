BEGIN;
ALTER TABLE watchlists ADD COLUMN document_alerts boolean NOT NULL DEFAULT true;
CREATE TABLE alerts (
  scan_id uuid PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  domain text NOT NULL REFERENCES domains(name),
  created_at timestamptz NOT NULL DEFAULT now(),
  document_count integer NOT NULL CHECK (document_count > 0)
);
CREATE INDEX alerts_domain_date ON alerts(domain, created_at DESC);
COMMIT;
