-- ===========================================================================
-- Clears the clinical data so the system can start from a clean slate.
--
--   *** RUN THIS BY HAND. IT DELETES PATIENTS AND SCREENINGS. ***
--
-- It is deliberately NOT a numbered migration. Migrations run in order on
-- every setup, and a destructive statement sitting in that chain is a trap for
-- whoever deploys this next. This file does nothing until a person runs it.
--
-- WHAT IT DELETES
--   * every screening
--   * every patient
--   * the audit-log rows for both
--
-- WHAT IT KEEPS, AND WHY
--   * profiles -- the clinicians, the admins, the super admin. These are the
--     accounts people log in with. Deleting them would leave nobody able to
--     use the system, and their names are the attribution on every patient
--     and every screening.
--   * clinics
--   * service_status -- the heartbeat row
--   * auth.users -- the sign-in records
--
-- The order matters. screenings cascade from patients, so the screenings have
-- to go first or the patients cannot be deleted. The reverse is refused by the
-- foreign keys: patients.clinician_id and screenings.clinician_id are
-- ON DELETE RESTRICT, and both point at profiles.
--
-- BEFORE YOU RUN IT
--   The audio files are on the Mini PC's disk, not in the database, so this
--   script cannot remove them. Delete them separately or the disk will fill
--   up:
--
--     Remove-Item C:\VSPWET\AURA-Dx\backend\uploads_audio\* -Force
--
--   Nothing here can be undone. There is no backup of a deleted screening.
-- ===========================================================================

BEGIN;

-- How much is about to go, printed before anything is touched.
DO $$
DECLARE
    n_screenings INTEGER;
    n_patients INTEGER;
BEGIN
    SELECT count(*) INTO n_screenings FROM screenings;
    SELECT count(*) INTO n_patients FROM patients;
    RAISE NOTICE 'About to delete % screening(s) and % patient(s).', n_screenings, n_patients;
END $$;

-- The screenings first. They cascade from the patients.
DELETE FROM screenings;

-- Now the patients, which nothing is left pointing at.
DELETE FROM patients;

-- The audit log is a record of what happened, so the entries for the rows
-- that just went are removed with them. Without this the log would name
-- patients that no longer exist.
DELETE FROM audit_logs
WHERE entity_id IN (
    SELECT id FROM patients WHERE id IS NOT NULL
) OR action IN ('screening_create', 'screening_analyse', 'patient_create');

COMMIT;

-- How much actually went.
DO $$
DECLARE
    n_screenings INTEGER;
    n_patients INTEGER;
    n_profiles INTEGER;
BEGIN
    SELECT count(*) INTO n_screenings FROM screenings;
    SELECT count(*) INTO n_patients FROM patients;
    SELECT count(*) INTO n_profiles FROM profiles;
    RAISE NOTICE 'Done. % screening(s), % patient(s) remain.', n_screenings, n_patients;
    RAISE NOTICE '% profile(s) kept -- the clinicians, admins and super admin.', n_profiles;
END $$;
