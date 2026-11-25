BEGIN;
ALTER TABLE api_credit_entries ADD COLUMN scan_id uuid;
ALTER TABLE api_credit_entries DROP CONSTRAINT api_credit_entries_kind_check;
ALTER TABLE api_credit_entries DROP CONSTRAINT api_credit_entries_check;
ALTER TABLE api_credit_entries ADD CONSTRAINT api_credit_entries_kind_check
  CHECK (kind IN ('purchase', 'usage', 'scan_refund'));
ALTER TABLE api_credit_entries ADD CONSTRAINT api_credit_entries_check CHECK (
  (kind = 'purchase' AND delta > 0 AND request_hash IS NULL AND response IS NULL AND scan_id IS NULL)
  OR (kind = 'usage' AND delta < 0 AND request_hash IS NOT NULL AND response IS NOT NULL)
  OR (kind = 'scan_refund' AND delta > 0 AND request_hash IS NULL AND response IS NULL AND scan_id IS NOT NULL)
);
UPDATE api_credit_entries e
SET scan_id = s.id
FROM scans s
WHERE e.kind = 'usage' AND e.response = jsonb_build_object('id', s.id);
CREATE UNIQUE INDEX api_credit_scan_entry
  ON api_credit_entries(scan_id, kind) WHERE scan_id IS NOT NULL;
INSERT INTO api_credit_entries(user_id, kind, reference, delta, scan_id)
SELECT e.user_id, 'scan_refund', s.id::text, -e.delta, s.id
FROM api_credit_entries e JOIN scans s ON s.id = e.scan_id
WHERE e.kind = 'usage' AND s.state = 'failed';
COMMIT;
