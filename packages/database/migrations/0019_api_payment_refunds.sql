BEGIN;
ALTER TABLE api_credit_entries DROP CONSTRAINT api_credit_entries_kind_check;
ALTER TABLE api_credit_entries DROP CONSTRAINT api_credit_entries_check;
ALTER TABLE api_credit_entries ADD CONSTRAINT api_credit_entries_kind_check
  CHECK (kind IN ('purchase', 'usage', 'scan_refund', 'payment_refund'));
ALTER TABLE api_credit_entries ADD CONSTRAINT api_credit_entries_check CHECK (
  (kind = 'purchase' AND delta > 0 AND request_hash IS NULL AND response IS NULL AND scan_id IS NULL)
  OR (kind = 'usage' AND delta < 0 AND request_hash IS NOT NULL AND response IS NOT NULL)
  OR (kind = 'scan_refund' AND delta > 0 AND request_hash IS NULL AND response IS NULL AND scan_id IS NOT NULL)
  OR (kind = 'payment_refund' AND delta < 0 AND request_hash IS NULL AND response IS NULL AND scan_id IS NULL)
);
COMMIT;
