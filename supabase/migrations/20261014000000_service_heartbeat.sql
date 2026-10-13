-- Service heartbeat, so the frontend can tell "crashed" from "switched off".
--
-- The problem this solves: if the backend is unreachable, the frontend cannot ask
-- it how it is. All it can conclude is "no answer". But a Mini PC that was shut
-- down deliberately and one that froze mid-request look identical to the browser.
--
-- The Mini PC writes a row here every 60 seconds. The frontend reads it directly
-- from Supabase, which stays reachable regardless of backend state, so it can
-- show "last seen 3 minutes ago".
--
-- One row, always overwritten. This is a liveness signal, not a history log --
-- if an outage needs reconstructing, the logs on the Mini PC are the source.

CREATE TABLE IF NOT EXISTS public.service_status (
    id             BOOLEAN PRIMARY KEY DEFAULT true,
    checked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    backend        TEXT NOT NULL DEFAULT 'unknown',
    database       TEXT NOT NULL DEFAULT 'unknown',
    inference      TEXT NOT NULL DEFAULT 'unknown',
    inference_version TEXT,
    CONSTRAINT service_status_singleton CHECK (id)
);

-- Allow the anon role to read it. This is deliberately public and deliberately
-- near-useless to an attacker: it exposes component liveness and a model
-- version string, nothing about the host, the schema, or any credential.
GRANT SELECT ON public.service_status TO anon;
GRANT SELECT ON public.service_status TO authenticated;

-- The service writes it with the service_role key, which bypasses RLS.
-- Seed a row so the frontend has something to read before the first heartbeat.
INSERT INTO public.service_status (id, checked_at, backend, database, inference)
VALUES (true, now(), 'unknown', 'unknown', 'unknown')
ON CONFLICT (id) DO NOTHING;