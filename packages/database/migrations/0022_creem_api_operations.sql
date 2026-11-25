BEGIN;

-- The provider owns the balance. This row holds an operation's replayable result
-- and the work needed to reconcile a timeout, meter event, or reversal.
CREATE TABLE creem_api_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 1 AND 160),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  customer_id text NOT NULL,
  account_id text NOT NULL,
  domain text NOT NULL,
  event_name text NOT NULL CHECK (event_name IN ('datadeal_scan_requested','datadeal_report_read')),
  amount integer NOT NULL CHECK (amount > 0),
  payload jsonb,
  result jsonb,
  transaction_id text UNIQUE,
  scan_id uuid UNIQUE REFERENCES scans(id) ON DELETE SET NULL,
  meter_requested_at timestamptz,
  metered_at timestamptz,
  refund_requested boolean NOT NULL DEFAULT false,
  refunded_at timestamptz,
  retry_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  UNIQUE(user_id, request_key)
);
CREATE INDEX creem_api_operations_pending ON creem_api_operations(retry_at)
WHERE result IS NULL OR (meter_requested_at IS NOT NULL AND metered_at IS NULL)
  OR (refund_requested AND refunded_at IS NULL);
COMMIT;
