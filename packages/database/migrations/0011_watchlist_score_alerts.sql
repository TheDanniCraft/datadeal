BEGIN;
ALTER TABLE alerts DROP CONSTRAINT alerts_document_count_check;
ALTER TABLE alerts
  ADD COLUMN score_before integer,
  ADD COLUMN score_after integer,
  ADD CONSTRAINT alerts_document_count_check CHECK (document_count >= 0),
  ADD CONSTRAINT alerts_score_change_check CHECK (
    (score_before IS NULL AND score_after IS NULL AND document_count > 0) OR
    (score_before IS NOT NULL AND score_after IS NOT NULL AND
      score_before BETWEEN 0 AND 100 AND score_after BETWEEN 0 AND 100 AND score_before <> score_after)
  );
COMMIT;
