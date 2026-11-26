BEGIN;
-- www.example.com and example.com are one site. Fold every www. site name
-- into the bare domain, where the rest still has a dot (never www.com).
INSERT INTO domains (name)
  SELECT substr(name, 5) FROM domains
  WHERE name LIKE 'www.%' AND position('.' in substr(name, 5)) > 0
  ON CONFLICT DO NOTHING;
DELETE FROM watchlists w
  WHERE w.domain LIKE 'www.%'
    AND EXISTS (
      SELECT 1 FROM watchlists x
      WHERE x.user_id = w.user_id AND x.domain = substr(w.domain, 5)
    );
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'domain'
      AND table_name <> 'domains'
  LOOP
    EXECUTE format(
      'UPDATE %I SET domain = substr(domain, 5)
       WHERE domain LIKE ''www.%%'' AND position(''.'' in substr(domain, 5)) > 0',
      t.table_name
    );
  END LOOP;
END $$;
UPDATE scans SET report = jsonb_set(report, '{domain}', to_jsonb(domain))
  WHERE report IS NOT NULL AND report->>'domain' IS DISTINCT FROM domain;
DELETE FROM domains d
  WHERE d.name LIKE 'www.%'
    AND NOT EXISTS (SELECT 1 FROM scans s WHERE s.domain = d.name)
    AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.domain = d.name);
COMMIT;
