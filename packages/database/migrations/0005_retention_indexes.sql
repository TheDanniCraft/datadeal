BEGIN;
CREATE INDEX session_expires_at ON session("expiresAt");
CREATE INDEX verification_expires_at ON verification("expiresAt");
CREATE INDEX auth_rate_limit_last_request ON "rateLimit"("lastRequest");
COMMIT;
