-- Backfill profiles.clinic_id where it is NULL.
--
-- Symptom: an admin signing in to User Management saw 3 of 4 accounts. The
-- fourth -- Pesuelo, Mark Louie A., an approved clinician -- was in the table
-- the whole time and simply not returned.
--
-- Cause: list_users scopes non-super-admins with `eq("clinic_id", <caller's>)`.
-- A profile whose own clinic_id is NULL never matches that, so it is invisible
-- to every admin and visible only to the super admin, who carries no filter.
--
-- Why it is NULL: this row predates the trigger's clinic assignment.
-- 20261013001000_restore_signup_trigger_clinic.sql restored it for new signups
-- precisely because profiles were being created with clinic_id = NULL, and the
-- header of that migration notes the consequence was "patient creation then
-- fails for every new signup". Nobody backfilled the rows that already existed.
--
-- This is a single-clinic deployment -- _resolve_clinic_id falls back to the
-- single configured clinic for exactly this reason -- so "earliest clinic" is
-- the same clinic the trigger assigns, and assigning it here cannot put anyone
-- in the wrong clinic.
--
-- Also covers the adjacent trap: an admin whose OWN clinic_id is NULL used to
-- produce `eq("clinic_id", None)`, which matches nothing, so such an admin saw
-- an empty page. list_users now falls back through _resolve_clinic_id instead,
-- so this backfill is belt-and-braces rather than the only thing preventing it.

DO $$
DECLARE
  default_clinic UUID;
  repaired INTEGER;
BEGIN
  SELECT id INTO default_clinic
  FROM public.clinics
  ORDER BY created_at ASC
  LIMIT 1;

  IF default_clinic IS NULL THEN
    RAISE WARNING 'No clinic row exists; nothing to backfill. Every profile stays NULL.';
    RETURN;
  END IF;

  UPDATE public.profiles
     SET clinic_id = default_clinic,
         updated_at = NOW()
   WHERE clinic_id IS NULL;

  GET DIAGNOSTICS repaired = ROW_COUNT;
  RAISE NOTICE 'Backfilled % profile(s) to clinic %', repaired, default_clinic;
END $$;

-- Fail loudly rather than leaving the symptom in place. If this runs and any
-- profile is still NULL, the backfill did not do what it claims and an admin
-- will still be missing accounts with nothing pointing at why.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE clinic_id IS NULL) THEN
    RAISE EXCEPTION
      'Profiles still exist with a NULL clinic_id. Admins scope on clinic_id and '
      'will not see these accounts. Assign them a clinic before continuing.';
  END IF;
END $$;