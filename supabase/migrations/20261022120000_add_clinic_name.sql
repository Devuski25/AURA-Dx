-- Replace the clinician's licence number with the clinic or hospital they work at.
--
-- Why: registration asked for a PRC licence number, which is a Philippine
-- professional identifier and was optional anyway. The clinic is the thing the
-- rest of the app is actually organised around -- a patient belongs to a
-- clinician, and a clinician belongs to a clinic -- and it is the field an admin
-- reviewing a pending account wants to see. Every account so far left the
-- licence blank, so nothing is lost by moving the question.
--
-- Two halves:
--
--   1. The column itself. `license_number` is NOT dropped. The data is still
--      there, the API still returns it, and dropping a column is the one change
--      here that cannot be undone by running a later migration. It simply has
--      no field in the UI any more.
--
--   2. The signup trigger. Registration sends the clinic through
--      auth.users.raw_user_meta_data, and handle_new_user copies the fields it
--      knows about into public.profiles. A column that the trigger never reads
--      is a column that stays empty, so the function has to be replaced in the
--      same migration -- otherwise the new field on the form saves nothing.
--
-- Everything else in the function is carried over verbatim from
-- 20261018120000_restore_signup_trigger_security_definer.sql, including the
-- clause that migration exists to restore. SECURITY DEFINER is not optional
-- here: the trigger fires on INSERT into auth.users as `supabase_auth_admin`,
-- which has no INSERT grant on public.profiles. Without it every registration
-- fails with "Database error saving new user", which is what happened on
-- 2026-10-18.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS clinic_name TEXT;

COMMENT ON COLUMN public.profiles.clinic_name IS
  'The clinic or hospital the account works at, as entered at registration. Free text: it is a label, not a foreign key to public.clinics.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  is_first_user BOOLEAN;
  assigned_role TEXT := 'clinician';
  assigned_status TEXT := 'pending';
  default_clinic_id UUID;
BEGIN
  -- Check if this is the very first user in the system
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO is_first_user;

  IF is_first_user THEN
    assigned_role := 'super_admin';
    assigned_status := 'approved';
  END IF;

  -- Earliest clinic stands in for the seeded default.
  SELECT id INTO default_clinic_id
  FROM public.clinics
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    role,
    status,
    clinic_id,
    phone,
    specialization,
    license_number,
    clinic_name,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    assigned_role,
    assigned_status,
    default_clinic_id,
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NULLIF(NEW.raw_user_meta_data->>'specialization', ''),
    NULLIF(NEW.raw_user_meta_data->>'license_number', ''),
    NULLIF(NEW.raw_user_meta_data->>'clinic_name', ''),
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-create the trigger rather than trusting it survived.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Fail loudly now if the function above ever loses its rights, rather than at
-- somebody's registration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_new_user'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION
      'handle_new_user() is not SECURITY DEFINER. Signup will fail with HTTP 500 '
      '"Database error saving new user". Re-add the clause before continuing.';
  END IF;
END $$;
