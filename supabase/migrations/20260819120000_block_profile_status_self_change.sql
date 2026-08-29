-- Block non-admin users from changing their own profile status.
--
-- The `user_update_own` RLS policy only restricted `role` in its WITH CHECK,
-- so any user could UPDATE profiles SET status='approved' and bypass the
-- pending-approval gate. Admins (via the anon-key JWT) and the backend
-- service role must still be able to approve/reject accounts.
--
-- auth.uid() IS NULL => service-role update (backend), trusted -> allowed.
-- auth.uid() set but not admin => real user, cannot change status.

CREATE OR REPLACE FUNCTION public.prevent_profile_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Cannot change account status';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_status_change ON public.profiles;
CREATE TRIGGER prevent_profile_status_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_status_change();