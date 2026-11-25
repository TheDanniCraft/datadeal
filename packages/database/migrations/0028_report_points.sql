BEGIN;
CREATE TABLE report_point_accounts (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK(balance >= 0)
);
CREATE TABLE report_point_ledger (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK(delta <> 0),
  operation text NOT NULL,
  reference_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation, reference_id)
);
CREATE INDEX report_point_activity ON report_point_ledger(user_id, created_at DESC);
CREATE TABLE report_reward_offers (
  id uuid PRIMARY KEY,
  scan_id uuid NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  browser_hash text NOT NULL CHECK(browser_hash ~ '^[0-9a-f]{64}$'),
  offer text NOT NULL CHECK(offer IN ('unlock','points','flight','choice')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','choose','ready','flying','banked','missed','points','unlocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  target integer CHECK(target BETWEEN 1 AND 1000),
  endpoint double precision CHECK(endpoint >= 1),
  launched_at timestamptz,
  continued_at timestamptz,
  payout integer CHECK(payout BETWEEN 0 AND 1000),
  CHECK(offer IN ('unlock','choice') OR user_id IS NOT NULL)
);
CREATE INDEX report_reward_account ON report_reward_offers(user_id, created_at DESC);
COMMIT;
