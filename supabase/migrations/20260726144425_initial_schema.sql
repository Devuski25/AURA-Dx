-- COUGHPH v1 — Initial Schema
-- Multi-clinic ready from day one with RLS policies

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CLINICS
-- ============================================
CREATE TABLE clinics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    email TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- PROFILES (extends auth.users)
-- ============================================
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('clinician', 'admin')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    phone TEXT,
    specialization TEXT,
    license_number TEXT,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- PATIENTS
-- ============================================
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    clinician_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    full_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
    smoking_history BOOLEAN DEFAULT false,
    pack_years NUMERIC(4,1),
    past_respiratory_diseases TEXT[],
    symptoms TEXT[],
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Age bracket helper function for patient queries
CREATE OR REPLACE FUNCTION age_bracket(dob DATE) RETURNS TEXT AS $$
BEGIN
    RETURN CASE
        WHEN date_part('year', age(dob)) <= 12 THEN '0-12'
        WHEN date_part('year', age(dob)) <= 21 THEN '13-21'
        WHEN date_part('year', age(dob)) <= 35 THEN '22-35'
        ELSE '35+'
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- SCREENINGS
-- ============================================
CREATE TABLE screenings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    clinician_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    audio_file_path TEXT,
    audio_duration_sec NUMERIC(6,2),
    tb_result TEXT NOT NULL CHECK (tb_result IN ('TB', 'Non-TB')),
    tb_confidence NUMERIC(5,2),
    tb_probabilities JSONB,
    respiratory_result TEXT CHECK (respiratory_result IN ('Healthy', 'Pneumonia', 'COPD')),
    respiratory_confidence NUMERIC(5,2),
    respiratory_probabilities JSONB,
    cascade_path TEXT NOT NULL,
    model_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'error', 'pending_review')),
    reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- AUDIT LOGS (login/logout + screening actions)
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    clinic_id UUID REFERENCES clinics(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_profiles_clinic_id ON profiles(clinic_id);
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_patients_clinic_id ON patients(clinic_id);
CREATE INDEX idx_patients_clinician_id ON patients(clinician_id);
CREATE INDEX idx_patients_created_at ON patients(created_at DESC);
CREATE INDEX idx_screenings_patient_id ON screenings(patient_id);
CREATE INDEX idx_screenings_clinic_id ON screenings(clinic_id);
CREATE INDEX idx_screenings_clinician_id ON screenings(clinician_id);
CREATE INDEX idx_screenings_created_at ON screenings(created_at DESC);
CREATE INDEX idx_screenings_tb_result ON screenings(tb_result);
CREATE INDEX idx_screenings_respiratory_result ON screenings(respiratory_result);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_clinic_id ON audit_logs(clinic_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- CLINICS: admin sees all; clinician see own clinic
CREATE POLICY "clinics_admin_all" ON clinics
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "clinics_own_clinic" ON clinics
    FOR SELECT TO authenticated
    USING (
        id IN (
            SELECT clinic_id FROM profiles
            WHERE profiles.id = auth.uid()
        )
    );

-- PROFILES: users see own profile; admin sees all; admin sees own clinic
CREATE POLICY "profiles_own" ON profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());

CREATE POLICY "profiles_admin_all" ON profiles
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid()
            AND p.role = 'admin'
        )
    );

CREATE POLICY "profiles_admin_clinic" ON profiles
    FOR SELECT TO authenticated
    USING (
        clinic_id IN (
            SELECT clinic_id FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "profiles_admin_manage" ON profiles
    FOR UPDATE TO authenticated
    USING (
        clinic_id IN (
            SELECT clinic_id FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- PATIENTS: clinicians see own patients; admin see clinic patients
CREATE POLICY "patients_own" ON patients
    FOR ALL TO authenticated
    USING (clinician_id = auth.uid());

CREATE POLICY "patients_clinic_admin" ON patients
    FOR SELECT TO authenticated
    USING (
        clinic_id IN (
            SELECT clinic_id FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "patients_admin_all" ON patients
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- SCREENINGS: clinicians see own; admin see clinic
CREATE POLICY "screenings_own" ON screenings
    FOR ALL TO authenticated
    USING (clinician_id = auth.uid());

CREATE POLICY "screenings_clinic_admin" ON screenings
    FOR SELECT TO authenticated
    USING (
        clinic_id IN (
            SELECT clinic_id FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "screenings_admin_all" ON screenings
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- AUDIT_LOGS: admin sees all; admin sees clinic; clinician sees own
CREATE POLICY "audit_logs_own" ON audit_logs
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "audit_logs_clinic_admin" ON audit_logs
    FOR SELECT TO authenticated
    USING (
        clinic_id IN (
            SELECT clinic_id FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

CREATE POLICY "audit_logs_admin_all" ON audit_logs
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- ============================================
-- TRIGGERS FOR updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_clinics_updated_at BEFORE UPDATE ON clinics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_screenings_updated_at BEFORE UPDATE ON screenings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SEED DEFAULT CLINIC
-- ============================================
INSERT INTO clinics (id, name, address, phone, email, is_active)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Default Clinic',
    '123 Main St, City',
    '+1234567890',
    'clinic@coughph.local',
    true
) ON CONFLICT (id) DO NOTHING;

-- ============================================
-- HELPER VIEW: Patient list with age bracket
-- ============================================
CREATE VIEW patient_list_view AS
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
    prof.full_name AS clinician_name
FROM patients p
JOIN clinics c ON p.clinic_id = c.id
JOIN profiles prof ON p.clinician_id = prof.id;

-- ============================================
-- HELPER VIEW: Screening history with patient info
-- ============================================
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
    c.name AS clinic_name,
    clin.full_name AS clinician_name,
    rev.full_name AS reviewed_by_name
FROM screenings s
JOIN patients pat ON s.patient_id = pat.id
JOIN clinics c ON s.clinic_id = c.id
JOIN profiles clin ON s.clinician_id = clin.id
LEFT JOIN profiles rev ON s.reviewed_by = rev.id;