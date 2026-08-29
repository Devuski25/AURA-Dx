-- ============================================================================
-- CLEAN RESET + PROFILES TABLE + TRIGGERS + RLS
-- Run this in Supabase SQL Editor to reset and set up auth schema
-- ============================================================================

-- 1. DROP APPLICATION TABLES (preserves auth.* system tables)
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS public.screenings CASCADE;
DROP TABLE IF EXISTS public.patients CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- 2. CREATE PROFILES TABLE (synced with auth.users via trigger)
-- ----------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'clinician' CHECK (role IN ('clinician', 'admin', 'super_admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'deleted')),
  clinic_id UUID,
  phone TEXT,
  specialization TEXT,
  license_number TEXT,
  last_login_at TIMESTAMPTZ,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. TRIGGER: SYNC auth.users -> public.profiles ON SIGNUP
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  is_first_user BOOLEAN;
  assigned_role TEXT := 'clinician';
  assigned_status TEXT := 'pending';
BEGIN
  -- Check if this is the very first user in the system
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO is_first_user;

  IF is_first_user THEN
    assigned_role := 'super_admin';
    assigned_status := 'approved';
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    status,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    assigned_role,
    assigned_status,
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. TRIGGER: UPDATE updated_at ON PROFILE CHANGES
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. HELPER FUNCTIONS: ADMIN CHECKS FOR RLS POLICIES
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER functions bypass RLS to check profiles table directly
-- MUST be created BEFORE policies that reference them

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'super_admin')
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role = 'super_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 6. RLS POLICIES FOR PROFILES
-- ----------------------------------------------------------------------------

-- Superadmin: full access to all profiles
CREATE POLICY "superadmin_full_access" ON public.profiles
  FOR ALL USING (public.is_super_admin());

-- Admin: can read all, update clinician profiles (not superadmin)
CREATE POLICY "admin_read_all" ON public.profiles
  FOR SELECT USING (public.is_admin());

CREATE POLICY "admin_update_clinicians" ON public.profiles
  FOR UPDATE USING (public.is_admin() AND role != 'super_admin');

-- Users: can read and update their own profile
CREATE POLICY "user_own_profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "user_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND role = 'clinician');

-- Allow authenticated users to create their own profile (fallback for OAuth when trigger misses)
CREATE POLICY "user_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND role = 'clinician' AND status = 'pending');

-- 7. PATIENTS TABLE (example protected resource)
-- ----------------------------------------------------------------------------

CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_patients_all" ON public.patients
  FOR ALL USING (public.is_super_admin());

CREATE POLICY "admin_clinic_patients" ON public.patients
  FOR ALL USING (
    public.is_admin()
    AND (EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND (p.clinic_id = patients.clinic_id OR public.is_admin())
    ))
  );

CREATE POLICY "clinician_own_patients" ON public.patients
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'clinician'
      AND p.id = patients.created_by
    )
  );

-- 7. SCREENINGS TABLE (example protected resource)
-- ----------------------------------------------------------------------------

CREATE TABLE public.screenings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  clinician_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  audio_url TEXT,
  result JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.screenings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_screenings_all" ON public.screenings
  FOR ALL USING (public.is_super_admin());

CREATE POLICY "clinician_own_screenings" ON public.screenings
  FOR ALL USING (
    clinician_id = auth.uid()
  );

-- 8. HELPER FUNCTION: GET CURRENT USER ROLE (for client-side checks)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;