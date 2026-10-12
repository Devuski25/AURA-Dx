-- AURA-Dx v2.5 — multi-recording fusion, TB class retired
--
-- 1. Adds `recording_paths` so one screening row remembers all 3-5 stethoscope
--    takes that were fused into its verdict. `audio_file_path` stays as the
--    canonical (first) take for existing consumers.
-- 2. Drops the TB gatekeeper columns. The 1.5/2.5 pipeline classifies
--    Healthy / COPD / Pneumonia only.
-- 3. Rebuilds screening_history_view without the TB columns.
--
-- The view is also repaired here. The 20260801 camera_data migration recreated
-- it and in the process dropped `updated_at` and `smoking_history`. Both are
-- needed: ScreeningResponse requires `updated_at`, and GET /screenings selects
-- `smoking_history`. Either omission silently pushed list/detail reads onto the
-- base-table fallback.
--
-- camera_data is intentionally LEFT IN PLACE. The facial cough-detection feature
-- is gone, so the column is simply never written to any more. Dropping it is
-- deferred to a separate cleanup migration so this one carries no destructive
-- change to existing rows.

ALTER TABLE screenings
    ADD COLUMN IF NOT EXISTS recording_paths TEXT[];

-- Retire the TB gatekeeper columns. IF EXISTS throughout so this migration is
-- safe to re-run and safe on databases where they were never added.
ALTER TABLE screenings DROP COLUMN IF EXISTS tb_result;
ALTER TABLE screenings DROP COLUMN IF EXISTS tb_confidence;
ALTER TABLE screenings DROP COLUMN IF EXISTS tb_probabilities;

-- The view selects columns that no longer exist, so it has to be rebuilt.
DROP VIEW IF EXISTS screening_history_view;
CREATE VIEW screening_history_view AS
SELECT
    s.id,
    s.patient_id,
    s.clinic_id,
    s.clinician_id,
    s.audio_file_path,
    s.recording_paths,
    s.audio_duration_sec,
    s.respiratory_result,
    s.respiratory_confidence,
    s.respiratory_probabilities,
    s.camera_data,
    s.cascade_path,
    s.model_version,
    s.status,
    s.reviewed_by,
    s.reviewed_at,
    s.review_notes,
    s.created_at,
    s.updated_at,
    pat.full_name AS patient_name,
    pat.date_of_birth,
    age_bracket(pat.date_of_birth) AS age_bracket,
    pat.gender,
    pat.smoking_history,
    c.name AS clinic_name,
    clin.full_name AS clinician_name,
    rev.full_name AS reviewed_by_name
FROM screenings s
JOIN patients pat ON s.patient_id = pat.id
JOIN clinics c ON s.clinic_id = c.id
JOIN profiles clin ON s.clinician_id = clin.id
LEFT JOIN profiles rev ON s.reviewed_by = rev.id;
