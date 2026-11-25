BEGIN;
ALTER TABLE creem_api_operations ADD COLUMN reversal_id text UNIQUE;
COMMIT;
