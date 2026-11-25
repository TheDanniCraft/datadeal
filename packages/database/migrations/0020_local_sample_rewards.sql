BEGIN;
ALTER TABLE scan_reward_receipts DROP CONSTRAINT scan_reward_receipts_provider_check;
ALTER TABLE scan_reward_receipts ADD CONSTRAINT scan_reward_receipts_provider_check
  CHECK (provider IN ('google_ad_manager', 'local_sample'));
COMMIT;
