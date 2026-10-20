-- Adds the 'analysing' status to a screening.
--
-- WHY
-- ---
-- A screening used to be written only after the inference had finished, so the
-- browser sat on a POST for the whole run -- up to two and a half minutes for a
-- five-take batch on the Mini PC's CPU. A clinician who navigated away during
-- that window never saw the result, and could easily re-record and create a
-- second screening from the same takes.
--
-- The row is now written FIRST, with the status 'analysing', and the inference
-- runs afterwards as a background task that fills in the result. That gives
-- the client a row to poll, lets the clinician leave and come back, and makes
-- an in-flight screening visible in the list instead of invisible.
--
-- The status is part of the column's CHECK constraint, so the constraint is
-- replaced rather than the column being loosened. The name is looked up
-- rather than assumed, because an inline CHECK in the original schema was
-- auto-named and a later migration could have renamed it.

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT c.conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'screenings'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%status%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE screenings DROP CONSTRAINT %I', constraint_name);
    END IF;

    ALTER TABLE screenings
        ADD CONSTRAINT screenings_status_check
        CHECK (status IN ('completed', 'error', 'pending_review', 'analysing'));
END $$;

-- A row in 'analysing' has no result yet, and that is the whole point of the
-- state: the verdict, the confidence and the probability vector are all
-- written by the background task when it lands. The constraint on
-- respiratory_result is left alone -- it already permits NULL, and a NULL
-- verdict is exactly what an unfinished screening should have.

COMMENT ON COLUMN screenings.status IS
    'completed = result available; analysing = inference still running; error = analysis failed; pending_review = result awaiting clinical review';
