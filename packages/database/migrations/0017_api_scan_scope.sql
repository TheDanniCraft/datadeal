BEGIN;
ALTER TABLE api_tokens DROP CONSTRAINT api_tokens_scope_check;
ALTER TABLE api_tokens ADD CONSTRAINT api_tokens_scope_check
  CHECK (scope IN ('reports:read', 'scans:request'));
COMMIT;
