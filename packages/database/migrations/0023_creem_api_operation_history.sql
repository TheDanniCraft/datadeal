BEGIN;
ALTER TABLE creem_api_operations
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN claim_until timestamptz;
CREATE INDEX creem_api_operation_history ON creem_api_operations(user_id, created_at DESC, id)
  WHERE transaction_id IS NOT NULL;
CREATE INDEX creem_api_unserved_reads ON creem_api_operations(claim_until)
  WHERE claim_until IS NOT NULL;
COMMIT;
