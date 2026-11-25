BEGIN;
CREATE TABLE creem_sandbox_credit_products (
  product_id text PRIMARY KEY CHECK (product_id <> '')
);
COMMIT;
