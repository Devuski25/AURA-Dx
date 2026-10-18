-- Restore SECURITY DEFINER on public.handle_new_user().
--
-- Symptom: every registration fails. POST /auth/v1/signup returns HTTP 500 with
-- "Database error saving new user", and no auth.users row and no profiles row
-- are created. Reproduced against production on 2026-10-18.
--
-- Cause: 20261013001000_restore_signup_trigger_clinic.sql redefined the trigger
-- function to add the clinic assignment, and in doing so dropped the trailing
-- SECURITY DEFINER. Every previous definition in this directory carried it:
--
--     001_clean_reset_and_profiles.sql .......... SECURITY DEFINER
--     20260827000000_persist_registration_fields  SECURITY DEFINER
--     20261013001000_restore_signup_trigger_clinic  <-- missing
--
-- Why that breaks signup rather than merely weakening it: the trigger fires on
-- INSERT into auth.users, which GoTrue performs as `supabase_auth_admin`. That
-- role can write auth.users but has no INSERT grant on public.profiles, and
-- profiles is under RLS. Without SECURITY DEFINER the function body runs with
-- the invoker's rights, so the INSERT is denied, the signup transaction rolls
-- back, and Supabase surfaces the underlying error as the generic 500 above.
--
-- The fix is one keyword. Two supporting changes:
--
--   * SET search_path = public. A SECURITY DEFINER function executes with its
--     owner's rights, so an unpinned search_path lets anyone who can create an
--     object in a schema on that path shadow a name the function resolves. The
--     body already qualifies everything as public.profiles / public.clinics, so
--     pinning costs nothing.
--
--   * The guard block at the end. This bug was invisible for as long as it
--     existed: no migration failed, no test failed, nothing logged. The trigger
--     simply stopped working at runtime. The DO block turns that into a loud
--     migration-time failure if a future migration drops the clause again.
--
-- Everything else is carried over verbatim from 20261013001000: the first-user
-- rule, the earliest-clinic resolution, and phone/specialization/license_number
-- from raw_user_meta_data.

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
    NOW(),
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Re-create the trigger rather than trusting it survived. The earlier migration
-- did not touch the trigger at all, so it is almost certainly present and this
-- is a no-op -- but "the trigger exists" is the other half of signup working, and
-- a migration that repairs the function should leave both halves correct even if
-- someone dropped the trigger by hand.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Fail loudly if this ever regresses, rather than at a user's registration.
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