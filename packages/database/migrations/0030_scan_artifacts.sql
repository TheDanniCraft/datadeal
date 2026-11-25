BEGIN;
CREATE TABLE scan_artifacts (
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  version smallint NOT NULL CHECK (version > 0),
  content text NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 65536),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  PRIMARY KEY (scan_id, version)
);
CREATE INDEX scan_artifacts_expiry ON scan_artifacts(expires_at);
COMMIT;
