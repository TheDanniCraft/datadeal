BEGIN;
CREATE TABLE privacy_profiles (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  preference text NOT NULL CHECK (preference IN ('standard', 'data_minimization'))
);
COMMIT;
