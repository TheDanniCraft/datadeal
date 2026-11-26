BEGIN;
-- "Keep me updated": a signed-in visitor pays report points each day to have
-- a site rescanned weekly and to keep every new report of it open.
CREATE TABLE site_monitors (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  domain text NOT NULL REFERENCES domains(name) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The last day already paid for; null until the first charge.
  paid_through date,
  PRIMARY KEY (user_id, domain)
);
CREATE INDEX site_monitors_domain ON site_monitors(domain);
COMMIT;
