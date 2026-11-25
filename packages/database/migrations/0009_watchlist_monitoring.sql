BEGIN;
CREATE INDEX watchlists_monitoring_domain ON watchlists(domain, user_id) WHERE document_alerts;
COMMIT;
