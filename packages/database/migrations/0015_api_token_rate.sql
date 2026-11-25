BEGIN;
ALTER TABLE api_tokens
  ADD COLUMN request_minute bigint NOT NULL DEFAULT 0,
  ADD COLUMN request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0);
COMMIT;
