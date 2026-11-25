BEGIN;
CREATE TABLE scan_request_limits (
  bucket text PRIMARY KEY,
  hour timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits > 0)
);
CREATE INDEX scan_request_limits_hour ON scan_request_limits(hour);
COMMIT;
