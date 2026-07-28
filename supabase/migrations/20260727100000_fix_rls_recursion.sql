-- Fix infinite RLS recursion on profiles table
-- The previous policies had subqueries reading from profiles within profiles policies,
-- causing PostgreSQL error 42P17 (infinite recursion)

-- Create SECURITY DEFINER helper functions to bypass RLS
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.user_clinic_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    cid UUID;
BEGIN
    SELECT clinic_id INTO cid FROM profiles WHERE id = auth.uid();
    RETURN cid;
END;
$$;

-- Drop old recursive policies on profiles
DROP POLICY IF EXISTS "profiles_admin_all" ON profiles;
DROP POLICY IF EXISTS "profiles_admin_clinic" ON profiles;
DROP POLICY IF EXISTS "profiles_admin_manage" ON profiles;

-- Recreate without recursion
CREATE POLICY "profiles_admin_all" ON profiles
    FOR ALL TO authenticated
    USING (public.is_admin());

CREATE POLICY "profiles_admin_clinic" ON profiles
    FOR SELECT TO authenticated
    USING (
        public.is_admin()
        AND
        clinic_id = public.user_clinic_id()
    );

CREATE POLICY "profiles_admin_manage" ON profiles
    FOR UPDATE TO authenticated
    USING (
        public.is_admin()
        AND (
            public.user_clinic_id() IS NULL
            OR
            clinic_id = public.user_clinic_id()
        )
    );

-- Also fix clinics policies to use helper functions (cleaner, avoids potential issues)
DROP POLICY IF EXISTS "clinics_admin_all" ON clinics;
DROP POLICY IF EXISTS "clinics_own_clinic" ON clinics;

CREATE POLICY "clinics_admin_all" ON clinics
    FOR ALL TO authenticated
    USING (public.is_admin());

CREATE POLICY "clinics_own_clinic" ON clinics
    FOR SELECT TO authenticated
    USING (id = public.user_clinic_id());

-- Fix patients policies
DROP POLICY IF EXISTS "patients_clinic_admin" ON patients;
DROP POLICY IF EXISTS "patients_admin_all" ON patients;

CREATE POLICY "patients_clinic_admin" ON patients
    FOR SELECT TO authenticated
    USING (
        public.is_admin()
        AND
        clinic_id = public.user_clinic_id()
    );

CREATE POLICY "patients_admin_all" ON patients
    FOR ALL TO authenticated
    USING (public.is_admin());

-- Fix screenings policies
DROP POLICY IF EXISTS "screenings_clinic_admin" ON screenings;
DROP POLICY IF EXISTS "screenings_admin_all" ON screenings;

CREATE POLICY "screenings_clinic_admin" ON screenings
    FOR SELECT TO authenticated
    USING (
        public.is_admin()
        AND
        clinic_id = public.user_clinic_id()
    );

CREATE POLICY "screenings_admin_all" ON screenings
    FOR ALL TO authenticated
    USING (public.is_admin());

-- Fix audit_logs policies
DROP POLICY IF EXISTS "audit_logs_clinic_admin" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_admin_all" ON audit_logs;

CREATE POLICY "audit_logs_clinic_admin" ON audit_logs
    FOR SELECT TO authenticated
    USING (
        public.is_admin()
        AND
        clinic_id = public.user_clinic_id()
    );

CREATE POLICY "audit_logs_admin_all" ON audit_logs
    FOR ALL TO authenticated
    USING (public.is_admin());
