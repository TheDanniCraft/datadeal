BEGIN;
CREATE TABLE api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 80),
  scope text NOT NULL DEFAULT 'reports:read' CHECK (scope = 'reports:read'),
  token_hash text UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK ((token_hash IS NULL) = (revoked_at IS NOT NULL))
);
CREATE INDEX api_tokens_owner_created ON api_tokens(user_id, created_at DESC, id);
COMMIT;
