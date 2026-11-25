BEGIN;
CREATE TABLE subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  product_id text NOT NULL,
  status text NOT NULL,
  access_until timestamptz NOT NULL,
  event_time bigint NOT NULL
);
CREATE INDEX subscriptions_user_access ON subscriptions(user_id, access_until);
CREATE TABLE billing_events (
  id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
