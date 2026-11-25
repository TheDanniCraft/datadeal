BEGIN;
CREATE TABLE watchlists (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  domain text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, domain)
);
COMMIT;
