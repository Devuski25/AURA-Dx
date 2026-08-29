-- Email verification OTP codes (pre-registration email gate)
-- Stores a short-lived, hashed 6-digit code per email. Backed by the backend
-- service role; no RLS needed (never exposed to anon clients).

CREATE TABLE IF NOT EXISTS public.email_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email
  ON public.email_verification_codes (email);

-- RLS on: only the service role (backend) can access this table. Authenticated
-- and anon clients are blocked. The service role bypasses RLS, so backend
-- inserts/reads still work.
ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;
