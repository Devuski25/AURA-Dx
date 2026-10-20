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
-- replaced rather than the column being loosened.
--
-- The constraint is named. It was created inline in the original schema, so
-- PostgreSQL named it `screenings_status_check`, and the error from a failed
-- run confirmed the name exactly. An earlier version of this file looked the
-- name up in pg_constraint by searching the definition text for the word
-- "status", and the lookup did not match -- so the constraint was never
-- dropped and the ADD then failed with "already exists". Looking up a name
-- that is already known is the kind of cleverness that only adds a way to be
-- wrong, so the name is simply stated here.

ALTER TABLE screenings
    DROP CONSTRAINT IF EXISTS screenings_status_check;

ALTER TABLE screenings
    ADD CONSTRAINT screenings_status_check
    CHECK (status IN ('completed', 'error', 'pending_review', 'analysing'));

-- Guard: the replacement constraint must exist and must accept every status
-- the product uses. The definition is read back rather than assumed, so a
-- constraint that was created with a different name, or that lost a value
-- somewhere, is caught here rather than at the first screening of the day.
DO $$
DECLARE
    def TEXT;
BEGIN
    SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'screenings'
      AND c.conname = 'screenings_status_check';

    IF def IS NULL THEN
        RAISE EXCEPTION
            'screenings_status_check was not created -- the status column would accept anything';
    END IF;

    IF def NOT LIKE '%completed%'
       OR def NOT LIKE '%error%'
       OR def NOT LIKE '%pending_review%'
       OR def NOT LIKE '%analysing%' THEN
        RAISE EXCEPTION
            'screenings_status_check does not accept every status -- definition is: %', def;
    END IF;
END $$;

-- A row in 'analysing' has no result yet, and that is the whole point of the
-- state: the verdict, the confidence and the probability vector are all
-- written by the background task when it lands. The constraint on
-- respiratory_result is left alone -- it already permits NULL, and a NULL
-- verdict is exactly what an unfinished screening should have.

COMMENT ON COLUMN screenings.status IS
    'completed = result available; analysing = inference still running; error = analysis failed; pending_review = result awaiting clinical review';
