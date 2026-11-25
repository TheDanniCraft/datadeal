BEGIN;
CREATE TABLE scan_reward_receipts (
  provider text NOT NULL CHECK (provider = 'google_ad_manager'),
  receipt_hash text NOT NULL CHECK (receipt_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (provider, receipt_hash)
);
CREATE TABLE scan_reward_grants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  holder_hash text CHECK (holder_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  CHECK (
    (user_id IS NOT NULL AND holder_hash IS NULL AND expires_at IS NULL)
    OR (user_id IS NULL AND holder_hash IS NOT NULL AND expires_at IS NOT NULL)
  ),
  UNIQUE (scan_id, user_id),
  UNIQUE (scan_id, holder_hash)
);
CREATE INDEX scan_reward_grants_expiry ON scan_reward_grants(expires_at)
  WHERE expires_at IS NOT NULL;
CREATE INDEX scan_reward_grants_user ON scan_reward_grants(user_id)
  WHERE user_id IS NOT NULL;
COMMIT;
