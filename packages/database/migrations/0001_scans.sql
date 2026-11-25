BEGIN;
CREATE TABLE domains (name text PRIMARY KEY);
CREATE TABLE scans (
  id uuid PRIMARY KEY,
  domain text NOT NULL REFERENCES domains(name),
  state text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  report jsonb
);
CREATE INDEX scans_domain_date ON scans(domain, requested_at);
CREATE TABLE scan_jobs (
  scan_id uuid PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  lease_until timestamptz,
  owner uuid,
  attempts integer NOT NULL DEFAULT 0
);
COMMIT;
