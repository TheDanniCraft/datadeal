BEGIN;
CREATE TABLE api_credit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('purchase', 'usage')),
  delta integer NOT NULL,
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 1 AND 160),
  request_hash text CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, reference),
  CHECK (
    (kind = 'purchase' AND delta > 0 AND request_hash IS NULL AND response IS NULL)
    OR (kind = 'usage' AND delta < 0 AND request_hash IS NOT NULL AND response IS NOT NULL)
  )
);
CREATE UNIQUE INDEX api_credit_purchase_reference
  ON api_credit_entries(reference) WHERE kind = 'purchase';
CREATE INDEX api_credit_account_activity
  ON api_credit_entries(user_id, created_at DESC, id DESC);
COMMIT;
