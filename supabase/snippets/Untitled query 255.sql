-- First check if profile exists
SELECT * FROM profiles WHERE id = (SELECT id FROM auth.users WHERE email = 'rheincama@gmail.com');

-- If missing, create it (no email column)
INSERT INTO profiles (id, full_name, role, status)
SELECT id, raw_user_meta_data->>'full_name', 'clinician', 'pending'
FROM auth.users
WHERE email = 'rheincama@gmail.com'
ON CONFLICT (id) DO NOTHING;

-- Then promote
UPDATE profiles SET role = 'admin', status = 'approved' 
WHERE id = (SELECT id FROM auth.users WHERE email = 'rheincama@gmail.com');

UPDATE profiles
SET role = 'admin', status = 'approved'
WHERE id = '1bbf71a4-bbb6-4491-81ac-fb19509da4d9';