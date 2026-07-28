-- Fix profiles_admin_manage RLS policy to allow super_admin (null clinic_id) to update profiles
-- Without this, super_admin with clinic_id = null can't update any profile because
-- clinic_id = null evaluates to NULL (falsy) in SQL

DROP POLICY IF EXISTS "profiles_admin_manage" ON profiles;
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
