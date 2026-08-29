
INSERT INTO clinics (id, name, phone, email, is_active)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Clinic', '+1234567890', 'clinic@coughph.local', true)
ON CONFLICT (id) DO NOTHING;

UPDATE profiles SET clinic_id = '00000000-0000-0000-0000-000000000001' WHERE clinic_id IS NULL;