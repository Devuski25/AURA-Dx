-- ============================================================================
-- COUGHPH — PRODUCTION FIX #1 (post-schema-sync)
-- Project: zczzviyyrrrmzmvjyigx
-- Run in: Supabase Dashboard > SQL Editor > New query > Run
--
-- Fixes found during write-path verification:
--   1. patient_list_view / screening_history_view were missing updated_at,
--      causing GET /api/patients to 500 whenever rows existed.
--   2. handle_new_user() trigger did not assign clinic_id, so every new
--      signup got clinic_id=NULL and patient creation failed (NOT NULL).
-- ============================================================================

-- 1. RECREATE VIEWS (add updated_at so PatientResponse/ScreeningResponse parse)
DROP VIEW IF EXISTS patient_list_view;
DROP VIEW IF EXISTS screening_history_view;

CREATE VIEW patient_list_view AS
SELECT
    p.id, p.clinic_id, p.clinician_id, p.full_name, p.date_of_birth,
    age_bracket(p.date_of_birth) AS age_bracket, p.gender,
    p.smoking_history, p.pack_years, p.past_respiratory_diseases, p.symptoms,
    p.created_at, p.updated_at,
    c.name AS clinic_name, prof.full_name AS clinician_name
FROM patients p
JOIN clinics c ON p.clinic_id = c.id
JOIN profiles prof ON p.clinician_id = prof.id;

CREATE VIEW screening_history_view AS
SELECT
    s.id, s.patient_id, s.clinic_id, s.clinician_id, s.audio_file_path,
    s.audio_duration_sec, s.tb_result, s.tb_confidence, s.tb_probabilities,
    s.respiratory_result, s.respiratory_confidence, s.respiratory_probabilities,
    s.camera_data, s.cascade_path, s.model_version, s.status,
    s.reviewed_by, s.reviewed_at, s.review_notes, s.created_at, s.updated_at,
    pat.full_name AS patient_name, pat.date_of_birth,
    age_bracket(pat.date_of_birth) AS age_bracket, pat.gender,
    c.name AS clinic_name, clin.full_name AS clinician_name, rev.full_name AS reviewed_by_name
FROM screenings s
JOIN patients pat ON s.patient_id = pat.id
JOIN clinics c ON s.clinic_id = c.id
JOIN profiles clin ON s.clinician_id = clin.id
LEFT JOIN profiles rev ON s.reviewed_by = rev.id;

-- 2. FIX SIGNUP TRIGGER — assign every new user to the Default Clinic
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, status, clinic_id)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
        COALESCE(NEW.raw_user_meta_data ->> 'role', 'clinician'),
        'pending',
        '00000000-0000-0000-0000-000000000001'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- 3. SAFETY BACKFILL — any profile still without a clinic gets the Default
UPDATE profiles
SET clinic_id = '00000000-0000-0000-0000-000000000001'
WHERE clinic_id IS NULL;
