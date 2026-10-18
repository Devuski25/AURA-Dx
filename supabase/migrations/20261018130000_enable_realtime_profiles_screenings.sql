-- Add `profiles` to the supabase_realtime publication.
--
-- Admin.tsx has subscribed to postgres_changes on public.profiles since it was
-- written, with the comment "Live updates: refresh the users list whenever
-- profiles change". It has never fired, because a table only emits change events
-- if it is in the supabase_realtime publication, and nothing in this migrations
-- directory ever added it. Nothing errors: a channel with a filter matching no
-- table just stays silent.
--
-- What that left in place was polling -- useCachedData's 60s revalidate, plus a
-- refetch on window focus -- so the approval queue did eventually update. Just
-- not on approval. An admin approving someone would sit looking at a stale list.
--
-- `screenings` is added for the same reason: the Dashboard's "Recent Screenings"
-- panel is shared cache key "screenings" with the Screening wizard, and a
-- clinician who screens in one tab currently sees nothing in the other until
-- the TTL lapses.
--
-- REPLICA IDENTITY DEFAULT means only INSERT/UPDATE/DELETE are emitted, not the
-- full old row on UPDATE. That is what is wanted here -- the refetch re-reads
-- the row anyway, so sending the previous row would be wasted bandwidth.
--
-- RLS still applies per subscriber: a change is only delivered to a client whose
-- policies permit reading that row. So this does not leak profiles across roles,
-- it only removes the "the filter matches nothing" failure.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'screenings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.screenings;
  END IF;
END $$;

-- Fail loudly rather than silently, same reasoning as the SECURITY DEFINER
-- guard in 20261018120000. A subscription that quietly matches nothing is
-- indistinguishable from a quiet database, and that is how the missing
-- publication survived unnoticed.
--
-- FOREACH, not `FOR t IN SELECT unnest(ARRAY[...]) LOOP`. That form is a syntax
-- error -- a FOR-IN-SELECT loop needs a row variable or a list of scalars, and
-- bare `unnest(...)` returns a set of anonymous scalars rather than a table,
-- so PostgreSQL rejects it with 42601. FOREACH walks an array directly and is
-- the construct that was wanted here all along.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'screenings'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      RAISE EXCEPTION
        'Table public.% is not in the supabase_realtime publication. The '
        'Admin users list and the Dashboard screenings panel subscribe to it '
        'and will receive no events.', t;
    END IF;
  END LOOP;
END $$;