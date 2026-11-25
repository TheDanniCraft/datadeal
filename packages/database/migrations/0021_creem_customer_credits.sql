BEGIN;
CREATE TABLE creem_credit_accounts (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  customer_id text UNIQUE NOT NULL,
  account_id text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creem_credit_purchases (
  order_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES creem_credit_accounts(user_id) ON DELETE CASCADE,
  credits integer NOT NULL CHECK (credits > 0),
  transaction_id text UNIQUE NOT NULL,
  reversal_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX creem_credit_purchase_account ON creem_credit_purchases(user_id, created_at DESC);
COMMIT;
