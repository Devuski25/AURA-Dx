-- Restore the signup trigger's clinic assignment in the migration history.
--
-- Production got this fix from the one-off `supabase/production_fix1.sql`
-- script, which was run directly in the Supabase dashboard and never folded
-- back into a migration. The trigger was later redefined by
-- 20260827000000_persist_registration_fields to persist phone/specialization/
-- license_number, and that version does not assign clinic_id either.
--
-- Consequence: rebuilding a database from `migrations/` alone produces a trigger
-- that inserts new profiles with clinic_id = NULL. `patients.clinic_id` is
-- NOT NULL, so patient creation then fails for every new signup.
--
-- This migration reconciles the two so the migration directory reproduces
-- production. It keeps the first-user rule and the optional registration fields
-- from 20260827 exactly as they were, and adds the clinic assignment back.
--
-- The clinic is resolved as the earliest-created clinic rather than hardcoding
-- a UUID, so a database with a differently-seeded default clinic still works.
-- If no clinic exists the profile is still created, with a NULL clinic_id,
-- which preserves the old behaviour instead of failing the signup outright.

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
$$ LANGUAGE plpgsql;