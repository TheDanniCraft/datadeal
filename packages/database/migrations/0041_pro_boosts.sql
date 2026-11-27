BEGIN;
-- Pro includes a few free "skip the line" boosts each month.
CREATE TABLE pro_queue_boosts (
  scan_id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pro_queue_boosts_user ON pro_queue_boosts(user_id, created_at);
COMMIT;
