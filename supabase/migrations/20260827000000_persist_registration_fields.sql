-- Persist optional registration fields (phone, specialization, license_number)
-- into public.profiles via the signup trigger. These fields are passed from
-- AuthContext.signUp through auth.users.raw_user_meta_data and were previously
-- dropped. First-user role/status logic is preserved unchanged.

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
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NULLIF(NEW.raw_user_meta_data->>'specialization', ''),
    NULLIF(NEW.raw_user_meta_data->>'license_number', ''),
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
