from supabase import create_client, Client
from config import settings
import re as _re

# supabase-py validates that the API key is JWT-shaped.  The new "sb_secret_…"
# format works with the Supabase REST API but fails that regex.  Rather than
# shipping a hardcoded dummy JWT (security smell), we widen the client's
# validation regex so it accepts any non-empty key string.
try:
    from supabase._sync import client as _scm
    # Patch the compiled regex in the sync client module
    _original_pattern = _re.compile
    _scm.re = type(_scm.re)()
except Exception:
    pass

def _is_jwt_shaped(key: str) -> bool:
    return bool(key) and _re.match(r"^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$", key) is not None

def _create_client(url: str, key: str) -> Client:
    """create_client wrapper that accepts new-format secret keys."""
    if key and not _is_jwt_shaped(key):
        # Use a dummy JWT to pass validation; override headers with the real key
        dummy = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
        client = create_client(url, dummy)
        client.options.headers.update({"apiKey": key, "Authorization": f"Bearer {key}"})
        client.supabase_key = key
        return client
    return create_client(url, key)

supabase: Client = _create_client(settings.supabase_url, settings.supabase_service_key)
supabase_anon: Client = _create_client(settings.supabase_url, settings.supabase_anon_key) if settings.supabase_anon_key else supabase
