BEGIN;
CREATE TABLE scan_analyses (
  scan_id uuid PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  result jsonb NOT NULL
);
CREATE INDEX scan_analyses_input_hash ON scan_analyses(input_hash);
COMMIT;
