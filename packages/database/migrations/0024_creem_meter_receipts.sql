BEGIN;
ALTER TABLE creem_api_operations ADD COLUMN meter_warning_codes text[];
COMMENT ON COLUMN creem_api_operations.metered_at IS 'Time Creem acknowledged event ingestion. Meter aggregation is asynchronous.';
COMMENT ON COLUMN creem_api_operations.meter_warning_codes IS 'Warnings returned with the ingestion receipt. Empty means none returned; null means no warning information recorded.';
COMMIT;
