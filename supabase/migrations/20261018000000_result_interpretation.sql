-- Interpretation of the model scores: a verdict a clinician can act on.
--
-- Additive only. Existing rows get NULL and are read as legacy, so this can be
-- applied to a database with real screening history and nothing is rewritten.
--
-- The prose itself is deliberately NOT stored. `recommendation_code` is a key
-- like 'COPD_HIGH' into shared/clinical_copy.json, which the React app and the
-- PDF generator both read. Storing sentences would mean a migration every time
-- a clinician-facing message is reworded, and two copies of the wording that
-- would drift apart.

ALTER TABLE public.screenings
    ADD COLUMN IF NOT EXISTS interpretation_status TEXT
        CHECK (interpretation_status IS NULL
               OR interpretation_status IN ('HEALTHY', 'COPD', 'PNEUMONIA', 'ATYPICAL_OOD')),
    ADD COLUMN IF NOT EXISTS confidence_level TEXT
        CHECK (confidence_level IS NULL
               OR confidence_level IN ('HIGH', 'MODERATE', 'LOW')),
    ADD COLUMN IF NOT EXISTS recommendation_code TEXT,
    ADD COLUMN IF NOT EXISTS decision_rule TEXT,
    ADD COLUMN IF NOT EXISTS decision_detail TEXT,
    ADD COLUMN IF NOT EXISTS band_metric TEXT,
    ADD COLUMN IF NOT EXISTS band_position DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS low_agreement BOOLEAN,
    ADD COLUMN IF NOT EXISTS recordings_total INTEGER,
    ADD COLUMN IF NOT EXISTS recordings_flagged INTEGER;

COMMENT ON COLUMN public.screenings.interpretation_status IS
    'Verdict after interpreting the fused scores. NULL on rows created before '
    'the interpretation layer; those are read as legacy and shown without a '
    'confidence level.';

COMMENT ON COLUMN public.screenings.recommendation_code IS
    'Key into shared/clinical_copy.json, e.g. COPD_HIGH. Prose is not stored so '
    'that rewording a clinical message needs no migration.';

COMMENT ON COLUMN public.screenings.decision_rule IS
    'Which rule produced the verdict: safety_override, majority_healthy_confident, '
    'majority_healthy, borderline_healthy, conditional_copd_high, '
    'conditional_copd_moderate or conditional_undecidable. Shown so a result '
    'can explain itself instead of only asserting itself.';

COMMENT ON COLUMN public.screenings.decision_detail IS
    'Plain-English account of how the verdict was reached, written by the '
    'inference service. Prose, not a stable key, so it is display-only: never '
    'parsed, and safe to ignore if the wording changes.';

COMMENT ON COLUMN public.screenings.low_agreement IS
    'True when the individual recordings disagreed (spread > 0.20 on the Stage 2 '
    'pneumonia probabilities). Distinct from a low score: this points at '
    'technique or site placement rather than the model being unsure.';

-- The screening history view lists its columns explicitly rather than `SELECT *`,
-- so new screenings columns do not reach it automatically. Every API read of
-- screening history goes through this view, which means leaving it alone would
-- make the new columns unreachable -- the selects in backend/routes/api.py name
-- them and would fail with "column does not exist".
--
-- CREATE OR REPLACE VIEW cannot change a view's column order or add columns in
-- the middle, so the new ones are appended at the end of the screenings block.
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

-- Screening list filters. The Admin users page already filters by status; this
-- gives the screenings list the same shape, and the atypical bucket needs to be
-- selectable or it becomes a result clinicians see but cannot find.
CREATE INDEX IF NOT EXISTS screenings_interpretation_status_idx
    ON public.screenings (interpretation_status)
    WHERE interpretation_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS screenings_created_at_desc_idx
    ON public.screenings (created_at DESC);
