-- Adds the per-patient screening number and total.
--
-- WHY
-- ---
-- A patient can be screened as many times as clinically needed, and the
-- system already allows that -- nothing in the creation path blocks a second
-- screening of the same patient. What was missing was the numbering, so a
-- clinician could not tell which reading was the first, which was a
-- re-test after a poor recording, and which was a genuine change in the
-- patient's condition.
--
-- So two numbers are added to every screening:
--
--   screening_number        1 for the patient's earliest screening, 2 for the
--                            next, and so on.
--   patient_screening_count  how many screenings that patient has in total.
--
-- They are computed in the database with a window function rather than
-- stored on the row. A stored counter is a snapshot: it is wrong the moment a
-- screening is deleted, and two clinicians creating a screening for the same
-- patient at the same time can write the same number. A window function is
-- always correct and cannot drift.
--
-- The ordering is by created_at, then by id, so the sequence is stable even
-- when two screenings share a timestamp -- which they will, to the
-- millisecond, if a clinician records twice in a row.
--
-- The new columns are appended LAST, and only last. PostgreSQL matches a
-- replaced view's existing columns by POSITION, so a new column inserted
-- anywhere earlier would shift the ones after it and silently change what
-- every column means.

CREATE OR REPLACE VIEW screening_history_view AS
SELECT
    s.id,
    s.patient_id,
    s.clinic_id,
    s.clinician_id,
    s.audio_file_path,
    s.recording_paths,
    s.recording_scores,
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
    rev.full_name AS reviewed_by_name,
    -- Appended last, and only last. PostgreSQL matches a replaced view's
    -- existing columns by POSITION, so new columns cannot be inserted
    -- anywhere earlier without shifting the ones after them.
    s.interpretation_status,
    s.confidence_level,
    s.recommendation_code,
    s.decision_rule,
    s.decision_detail,
    s.band_metric,
    s.band_position,
    s.low_agreement,
    s.recordings_total,
    s.recordings_flagged,
    -- Which screening this is for the patient, and how many they have.
    ROW_NUMBER() OVER (
        PARTITION BY s.patient_id
        ORDER BY s.created_at, s.id
    ) AS screening_number,
    COUNT(*) OVER (
        PARTITION BY s.patient_id
    ) AS patient_screening_count
FROM screenings s
JOIN patients pat ON s.patient_id = pat.id
JOIN clinics c ON s.clinic_id = c.id
JOIN profiles clin ON s.clinician_id = clin.id
LEFT JOIN profiles rev ON s.reviewed_by = rev.id;

-- Guard: the two columns have to exist, and they have to be right. A
-- mis-partitioned window function would give every screening the number 1 and
-- no error at all, so the check is on the values, not just their presence.
DO $$
DECLARE
    bad_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'screening_history_view'
          AND column_name = 'screening_number'
    ) THEN
        RAISE EXCEPTION 'screening_number was not added to screening_history_view';
    END IF;

    -- Every screening must be numbered from 1 within its own patient, and the
    -- number can never exceed the count.
    SELECT count(*) INTO bad_count
    FROM screening_history_view
    WHERE screening_number < 1
       OR screening_number > patient_screening_count;

    IF bad_count > 0 THEN
        RAISE EXCEPTION
            'screening numbering is wrong for % row(s)', bad_count;
    END IF;
END $$;

-- The patient list gets the same number, so the picker can say how many
-- screenings a patient has without loading the screening history to find out.
--
-- That matters: the picker used to fetch every screening in the clinic purely
-- to draw four status badges, which meant the patient list could not appear
-- until the screening history had loaded. The count is a number on the patient
-- row, so it comes with the list.
--
-- A LEFT JOIN with a count, so a patient who has never been screened still
-- appears -- with a count of zero rather than being dropped.
CREATE OR REPLACE VIEW patient_list_view AS
SELECT
    p.id,
    p.clinic_id,
    p.clinician_id,
    p.full_name,
    p.date_of_birth,
    age_bracket(p.date_of_birth) AS age_bracket,
    p.gender,
    p.smoking_history,
    p.pack_years,
    p.past_respiratory_diseases,
    p.symptoms,
    p.created_at,
    p.updated_at,
    c.name AS clinic_name,
    prof.full_name AS clinician_name,
    -- Appended last, and only last. PostgreSQL matches a replaced view's
    -- existing columns by POSITION.
    COALESCE(sc.screening_count, 0) AS screening_count
FROM patients p
JOIN clinics c ON p.clinic_id = c.id
JOIN profiles prof ON p.clinician_id = prof.id
LEFT JOIN (
    SELECT patient_id, count(*)::int AS screening_count
    FROM screenings
    GROUP BY patient_id
) sc ON sc.patient_id = p.id;

-- Guard: the count column has to be there, and it must never be negative.
DO $$
DECLARE
    bad_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'patient_list_view'
          AND column_name = 'screening_count'
    ) THEN
        RAISE EXCEPTION 'screening_count was not added to patient_list_view';
    END IF;

    SELECT count(*) INTO bad_count
    FROM patient_list_view
    WHERE screening_count < 0;

    IF bad_count > 0 THEN
        RAISE EXCEPTION 'screening_count is negative on % patient row(s)', bad_count;
    END IF;
END $$;
