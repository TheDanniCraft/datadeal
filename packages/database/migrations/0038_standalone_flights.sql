BEGIN;
-- A paper-plane flight earned from an ad on the points page belongs to no
-- report. Only signed-in flights can stand alone; unlocks need their scan.
ALTER TABLE report_reward_offers
  ALTER COLUMN scan_id DROP NOT NULL,
  ADD CONSTRAINT report_reward_offer_scan
    CHECK (scan_id IS NOT NULL OR (offer = 'flight' AND user_id IS NOT NULL));
COMMIT;
