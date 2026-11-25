BEGIN;
CREATE TABLE pro_checkout_requests (
  request_id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('live','test')),
  checkout_id text NOT NULL UNIQUE,
  subscription_id text UNIQUE,
  customer_id text,
  order_id text UNIQUE,
  CHECK ((subscription_id IS NULL) = (customer_id IS NULL)),
  CHECK (order_id IS NULL OR subscription_id IS NOT NULL)
);
COMMIT;
