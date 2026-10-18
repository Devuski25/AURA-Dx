-- Make tb_result_archived nullable.
--
-- Symptom: every screening save fails.
--
--     POST /api/screenings -> 500
--     postgrest: 23502 null value in column "tb_result_archived"
--                of relation "screenings" violates not-null constraint
--
-- Cause: 20261012000000_multi_recording_fusion_retire_tb.sql retired the
-- tuberculosis class by RENAMING the columns rather than dropping them, to
-- keep the historical values:
--
--     ALTER TABLE screenings RENAME COLUMN tb_result TO tb_result_archived;
--
-- A rename carries the column's constraints with it. The original definition
-- was `tb_result TEXT NOT NULL CHECK (tb_result IN ('TB', 'Non-TB'))`, so the
-- renamed column is still NOT NULL with no default -- and the insert in
-- routes/api.py stopped supplying it the moment the model stopped returning it.
--
-- So this has been broken since the TB class was retired: the model runs, the
-- verdict is produced, and the row cannot be written. Nothing in the app
-- surfaces that as a configuration problem -- it arrives as a bare 500 on the
-- save step, after the clinician has already recorded every take.
--
-- tb_confidence and tb_probabilities were nullable to begin with (initial
-- schema lines 79-80), so only tb_result needs this.
--
-- The column is left in place rather than dropped. That was the original
-- intent of the retirement migration -- archived, not erased -- and historical
-- rows still carry real values from when the pipeline produced them.

ALTER TABLE public.screenings
    ALTER COLUMN tb_result_archived DROP NOT NULL;

-- Also relax the enum CHECK. It is harmless on its own -- a NULL passes any
-- CHECK -- but leaving a constraint that reads `IN ('TB','Non-TB')` on a
-- column named "..._archived" invites the next reader to assume it is still
-- live, which is the exact misreading that produced this bug.
ALTER TABLE public.screenings
    DROP CONSTRAINT IF EXISTS screenings_tb_result_check;

-- Fail loudly rather than leaving the symptom in place. If this runs and the
-- column is still NOT NULL, every future screening save fails the same way and
-- nothing else points at why.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'screenings'
      AND column_name = 'tb_result_archived'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION
      'screenings.tb_result_archived is still NOT NULL. Inserts that omit it '
      'will fail with 23502. Check that this migration ran to completion.';
  END IF;
END $$;