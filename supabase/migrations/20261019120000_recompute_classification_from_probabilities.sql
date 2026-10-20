-- Recompute the reported class from the reported probabilities.
--
-- THE BUG
-- -------
-- `fuse_clips` chose the reported class with two rules that were not the same
-- question as "which class is most likely":
--
--   1. a healthy threshold (0.61) re-applied to the FUSED mean, and
--   2. otherwise a pneumonia-beats-COPD comparison, which made COPD the
--      default.
--
-- Either could name a class the report was simultaneously showing as the least
-- likely. A real screening had a healthy mean of 0.60 -- one hundredth under
-- the threshold -- and was reported as COPD while its own probability table
-- read Healthy 60.0%, COPD 21.2%, Pneumonia 18.8%. The banner said COPD
-- DETECTED, the badge said COPD, the confidence meter said 21%, and the table
-- directly underneath showed Healthy on top: four parts of one page, three
-- different answers.
--
-- The fusion in packages/inference/inference_service.py now reports the class
-- with the highest probability, with the safety override still winning over the
-- mean. This migration brings the stored rows in line with it.
--
-- THE SAFETY OVERRIDE IS NOT AFFECTED
-- -----------------------------------
-- When a single recording cleared the pneumonia override threshold, that
-- recording decides the result regardless of the mean, so the mean can
-- legitimately point the other way. Those rows are left exactly as they are.
--
-- Rows with no probability vector are left alone; there is nothing to derive
-- from.
--
-- Ties break the same way the code does: Healthy, then Pneumonia, then COPD,
-- so a dead heat between the two pathological classes resolves to the more
-- urgent one.

WITH derived AS (
    SELECT
        s.id,
        (
            SELECT p.key
            FROM jsonb_each_text(COALESCE(s.respiratory_probabilities, '{}'::jsonb)) AS p(key, value)
            ORDER BY (p.value)::numeric DESC,
                     CASE p.key WHEN 'Healthy' THEN 0 WHEN 'Pneumonia' THEN 1 ELSE 2 END
            LIMIT 1
        ) AS best_class,
        (
            SELECT (p.value)::numeric
            FROM jsonb_each_text(COALESCE(s.respiratory_probabilities, '{}'::jsonb)) AS p(key, value)
            ORDER BY (p.value)::numeric DESC,
                     CASE p.key WHEN 'Healthy' THEN 0 WHEN 'Pneumonia' THEN 1 ELSE 2 END
            LIMIT 1
        ) AS best_prob,
        COALESCE(s.recording_scores -> 'fusion' ->> 'override_applied', '') AS override_applied
    FROM screenings s
)
UPDATE screenings s
SET
    respiratory_result = d.best_class,
    respiratory_confidence = d.best_prob
FROM derived d
WHERE s.id = d.id
  AND d.best_class IS NOT NULL
  AND d.override_applied = ''
  AND (
      s.respiratory_result IS DISTINCT FROM d.best_class
      OR s.respiratory_confidence IS DISTINCT FROM d.best_prob
  );

-- Guard: the class and its probability must now agree on every row that has
-- a probability vector, except the safety-override rows. This raises if the
-- repair did not fully take, rather than leaving the inconsistency in place
-- for the API layer to paper over.
DO $$
DECLARE
    bad_count INTEGER;
BEGIN
    SELECT count(*) INTO bad_count
    FROM screenings s
    WHERE COALESCE(s.respiratory_probabilities, '{}'::jsonb) <> '{}'::jsonb
      AND COALESCE(s.recording_scores -> 'fusion' ->> 'override_applied', '') = ''
      AND s.respiratory_result IS DISTINCT FROM (
          SELECT p.key
          FROM jsonb_each_text(s.respiratory_probabilities) AS p(key, value)
          ORDER BY (p.value)::numeric DESC,
                   CASE p.key WHEN 'Healthy' THEN 0 WHEN 'Pneumonia' THEN 1 ELSE 2 END
          LIMIT 1
      );

    IF bad_count > 0 THEN
        RAISE EXCEPTION
            'classification repair incomplete: % row(s) still report a class that is not their most likely class',
            bad_count;
    END IF;
END $$;
