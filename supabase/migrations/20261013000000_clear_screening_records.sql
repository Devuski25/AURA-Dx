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
-- ---------------------------------------------------------------------------
-- Two PostgreSQL rules drive the shape of this script:
--
-- 1. TRUNCATE checks foreign keys at the SCHEMA level, not the row level.
--    `screenings.patient_id` has `REFERENCES patients(id)`, so emptying
--    screenings in one statement and then truncating patients in a second
--    statement still fails:
--
--        ERROR: cannot truncate a table referenced in a foreign key constraint
--        DETAIL: Table "screenings" references "patients".
--
--    Every table involved must appear in a SINGLE TRUNCATE statement, and
--    PostgreSQL then resolves the dependency internally. One statement is also
--    atomic, so there is no partial delete to recover from.
--
-- 2. VACUUM cannot run inside a transaction block. The Supabase SQL editor
--    submits everything inside an implicit transaction, so a VACUUM here fails
--    the whole script with:
--
--        ERROR: VACUUM cannot run inside a transaction block
--
--    It is therefore omitted entirely. Autovacuum reclaims the space on its own
--    within minutes. If you want it immediately, run it afterwards as a
--    separate statement in its own transaction — see the note at the bottom.
--
-- No CASCADE is used deliberately. CASCADE would silently truncate any table
-- added later that references these, which is not something to do implicitly.
-- If this ever fails on a foreign key, read the error, find out what was added,
-- and add it to the list deliberately.
-- ---------------------------------------------------------------------------

-- STEP 1 — what is about to go, and what stays.
-- A real SELECT rather than RAISE NOTICE, because the Supabase SQL editor does
-- not reliably render NOTICE messages in its results panel.
SELECT * FROM (
    SELECT 'screenings'  AS action, 'DELETE' AS what, count(*) AS rows FROM screenings
    UNION ALL
    SELECT 'patients',    'DELETE', count(*) FROM patients
    UNION ALL
    SELECT 'audit_logs',  'DELETE', count(*) FROM audit_logs
    UNION ALL
    SELECT 'profiles',    'KEEP',   count(*) FROM profiles
    UNION ALL
    SELECT 'clinics',     'KEEP',   count(*) FROM clinics
) AS plan ORDER BY action DESC, what DESC;

-- STEP 2 — delete. One statement, so the foreign keys resolve and the whole
-- thing is atomic. Note what is absent: profiles and clinics. Those are never
-- touched, which is the entire point of this migration.
TRUNCATE TABLE audit_logs, screenings, patients;

-- STEP 3 — confirm the result.
SELECT * FROM (
    SELECT 'screenings'  AS table_name, 'DELETE' AS action, count(*) AS rows FROM screenings
    UNION ALL
    SELECT 'patients',    'DELETE', count(*) FROM patients
    UNION ALL
    SELECT 'audit_logs',  'DELETE', count(*) FROM audit_logs
    UNION ALL
    SELECT 'profiles',    'KEEP',   count(*) FROM profiles
    UNION ALL
    SELECT 'clinics',     'KEEP',   count(*) FROM clinics
) AS result ORDER BY action DESC, table_name;

-- ---------------------------------------------------------------------------
-- OPTIONAL — reclaim disk space immediately.
-- This CANNOT go above: VACUUM will not run inside a transaction block, and the
-- SQL editor wraps a submission in one. Run it on its own, outside any explicit
-- BEGIN/COMMIT. Plain VACUUM is used rather than VACUUM FULL because FULL
-- takes an ACCESS EXCLUSIVE lock for the whole rewrite and blocks the backend
-- for as long as it runs.
--
--     VACUUM (ANALYZE) screenings;
--     VACUUM (ANALYZE) patients;
--     VACUUM (ANALYZE) audit_logs;
--
-- Skip it. Autovacuum will get there on its own and these tables are small.
-- ---------------------------------------------------------------------------