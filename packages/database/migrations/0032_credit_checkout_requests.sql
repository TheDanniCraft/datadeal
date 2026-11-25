BEGIN;
-- Older receipts acquire a request reference only when their signed checkout is replayed.
CREATE TABLE creem_credit_checkout_requests (
  request_id uuid PRIMARY KEY,
  order_id text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
COMMIT;
