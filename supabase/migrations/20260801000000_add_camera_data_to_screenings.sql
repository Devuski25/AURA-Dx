-- COUGHPH v1 — Add camera/facial cough-detection data to screenings
-- Fused camera (MediaPipe face-mesh mouth-opening) + audio cough detection summary,
-- produced client-side in the Step 2 "Record" wizard. Stored as JSONB so the
-- schema stays flexible while the feature evolves.

ALTER TABLE screenings
    ADD COLUMN IF NOT EXISTS camera_data JSONB;

-- Keep the history view in sync so camera data survives reads through the view.
DROP VIEW IF EXISTS screening_history_view;
CREATE VIEW screening_history_view AS
SELECT
    s.id,
    s.patient_id,
    s.clinic_id,
    s.clinician_id,
    s.audio_file_path,
    s.audio_duration_sec,
    s.tb_result,
    s.tb_confidence,
    s.tb_probabilities,
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
    pat.full_name AS patient_name,
    pat.date_of_birth,
    age_bracket(pat.date_of_birth) AS age_bracket,
    pat.gender,
    c.name AS clinic_name,
    clin.full_name AS clinician_name,
    rev.full_name AS reviewed_by_name
FROM screenings s
JOIN patients pat ON s.patient_id = pat.id
JOIN clinics c ON s.clinic_id = c.id
JOIN profiles clin ON s.clinician_id = clin.id
LEFT JOIN profiles rev ON s.reviewed_by = rev.id;
