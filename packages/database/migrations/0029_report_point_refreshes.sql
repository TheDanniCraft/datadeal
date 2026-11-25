BEGIN;
-- Keep the receipt after scan-history pruning so a retried request stays idempotent.
CREATE TABLE report_point_refreshes (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  domain text NOT NULL,
  scan_id uuid NOT NULL UNIQUE,
  cost integer NOT NULL CHECK (cost > 0),
  PRIMARY KEY (user_id, request_id)
);
COMMIT;
