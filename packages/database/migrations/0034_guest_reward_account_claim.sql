BEGIN;
-- Older browser grants do not record whether an account also received the
-- purchase. Keep their existing access until expiry without reissuing it.
ALTER TABLE scan_reward_grants
  ADD COLUMN account_claim_available boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT account_claim_requires_guest
    CHECK (NOT account_claim_available OR holder_hash IS NOT NULL);
COMMIT;
