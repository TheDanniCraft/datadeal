BEGIN;
-- One local currency: points. Creem only takes payment for a point pack; the
-- balance lives in report_point_accounts and every change in report_point_ledger.
CREATE TABLE point_pack_purchases (
  order_id text PRIMARY KEY CHECK (char_length(order_id) BETWEEN 1 AND 100),
  -- Kept after account deletion so the same order can never be granted again.
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  points integer NOT NULL CHECK (points > 0),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  refunded_at timestamptz,
  -- A refund never drives the balance below zero: this is what it removed.
  refunded_points integer CHECK (refunded_points >= 0),
  CHECK ((refunded_at IS NULL) = (refunded_points IS NULL))
);
CREATE INDEX point_pack_purchase_account ON point_pack_purchases(user_id, created_at DESC);

-- Developer API requests paid with points. One row per (account, Idempotency-Key)
-- holds the request hash and the response to replay.
CREATE TABLE point_api_operations (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 1 AND 160),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  domain text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('report_read', 'scan')),
  points integer NOT NULL CHECK (points > 0),
  response jsonb NOT NULL,
  scan_id uuid UNIQUE REFERENCES scans(id) ON DELETE SET NULL,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_key),
  CHECK (kind = 'scan' OR (scan_id IS NULL AND refunded_at IS NULL))
);
CREATE INDEX point_api_operation_account ON point_api_operations(user_id, created_at DESC, id DESC);

-- Remaining balances in the earlier local credit ledger become points (x100).
-- Balances held in Creem's Customer Credits wallet cannot be read from here.
INSERT INTO report_point_accounts(user_id)
SELECT user_id FROM api_credit_entries GROUP BY user_id HAVING sum(delta) > 0
ON CONFLICT DO NOTHING;
WITH balances AS (
  SELECT user_id, sum(delta)::integer * 100 AS points
  FROM api_credit_entries GROUP BY user_id
  HAVING sum(delta) > 0 AND sum(delta) <= 20000000
), converted AS (
  INSERT INTO report_point_ledger(id, user_id, delta, operation, reference_id)
  SELECT md5('credit-conversion:' || user_id)::uuid, user_id, points,
    'credit_conversion', md5('credit-conversion:' || user_id)::uuid
  FROM balances
  ON CONFLICT (operation, reference_id) DO NOTHING
  RETURNING user_id, delta
)
UPDATE report_point_accounts account SET balance = account.balance + converted.delta
FROM converted WHERE account.user_id = converted.user_id;
COMMIT;
