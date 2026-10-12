-- AURA-Dx — clear all screening records, keep every account
--
-- ⚠️  DESTRUCTIVE. This deletes every patient and every screening result.
--     Run it only when you actually want a clean slate.
--
-- WHAT SURVIVES
--   auth.users              every login, including Google-OAuth accounts
--   profiles                every clinician and admin account
--   clinics                 clinic records the accounts belong to
--   email_verification_codes
--
-- WHAT IS DELETED
--   patients                all patient records
--   screenings              all screening results, including the archived
--                           TB columns from the v2.5 migration
--   audit_logs              all activity log entries
--
-- Deletion order respects the foreign keys:
--   audit_logs  -> nothing depends on it
--   screenings  -> references patients
--   patients    -> references clinics and profiles
-- Deleting in that order means nothing has to be cascade-forced and no account
-- is ever touched.
--
-- The archived TB result columns go with the rows they belong to, which is
-- what was intended — they only ever described the screenings being removed.

BEGIN;

-- Report what is about to go, so there is a record of the deletion itself.
DO $$
DECLARE
    n_patients BIGINT;
    n_screenings BIGINT;
    n_audit BIGINT;
BEGIN
    SELECT count(*) INTO n_patients FROM patients;
    SELECT count(*) INTO n_screenings FROM screenings;
    SELECT count(*) INTO n_audit FROM audit_logs;

    RAISE NOTICE 'Deleting % screenings, % patients, % audit log entries',
        n_screenings, n_patients, n_audit;
    RAISE NOTICE 'Keeping all clinics, profiles and auth.users accounts';
END $$;

TRUNCATE TABLE audit_logs;
TRUNCATE TABLE screenings;
TRUNCATE TABLE patients;

-- Reclaim the space rather than leaving the files on disk for the vacuum to
-- hold on to.
VACUUM (FULL) audit_logs;
VACUUM (FULL) screenings;
VACUUM (FULL) patients;

COMMIT;

DO $$
DECLARE
    n_patients BIGINT;
    n_screenings BIGINT;
    n_profiles BIGINT;
BEGIN
    SELECT count(*) INTO n_patients FROM patients;
    SELECT count(*) INTO n_screenings FROM screenings;
    SELECT count(*) INTO n_profiles FROM profiles;
    RAISE NOTICE 'Done. % patients, % screenings, % accounts remain',
        n_patients, n_screenings, n_profiles;
END $$;