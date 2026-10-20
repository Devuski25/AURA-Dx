"""How long does each API call take?

The app feels slow to open, and "slow" is not an actionable report. This times
the endpoints the app actually calls when a clinician opens a page, so the
work goes where the time is rather than where it looks like it should be.

The backend is queried with the service-role key, which bypasses RLS, so the
numbers here are the floor: the browser's own calls do the same work and then
some.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import supabase  # noqa: E402
from config import settings  # noqa: E402

API = "https://api.auradx.xyz"
# The local backend, so the measurement is of the backend and not of the
# tunnel's round trip to Cloudflare. Both are worth knowing about; they are
# separate numbers.
LOCAL = "http://127.0.0.1:8001"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def call(path, token=None, repeats=5, base=None):
    base = base or API
    headers = {"User-Agent": UA}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    times = []
    size = 0
    for _ in range(repeats):
        req = urllib.request.Request(base + path, headers=headers)
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                times.append(time.time() - t0)
                size = len(raw)
        except Exception as e:
            times.append(time.time() - t0)
            return None, size, repr(e)[:120]
    return times, size, None


def make_account(role="super_admin"):
    import time as _t
    email = f"perf{_t.time()}{role}@example.com"
    password = "PerfTest!pass123"
    for _ in range(4):
        try:
            r = supabase.auth.admin.create_user(
                {"email": email, "password": password, "email_confirm": True})
            break
        except Exception:
            _t.sleep(3)
    else:
        raise RuntimeError("could not create an account")
    uid = r.user.id
    clinic = supabase.table("clinics").select("id").limit(1).execute().data[0]["id"]
    supabase.table("profiles").upsert({
        "id": uid, "email": email, "full_name": "Perf", "role": role,
        "status": "approved", "clinic_id": clinic,
    }).execute()
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        data=body,
        headers={"Content-Type": "application/json",
                 "apikey": settings.supabase_anon_key})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return uid, json.loads(resp.read())["access_token"]


def main():
    uid, token = make_account()

    pat = supabase.table("patients").select("id").limit(1).execute().data
    scr = supabase.table("screenings").select("id").limit(1).execute().data
    paths = [
        ("the dashboard's counts", "/api/metrics/summary"),
        ("the screening list", "/api/screenings"),
        ("the patient list", "/api/patients"),
        ("the users list", "/api/users"),
        ("the service health", "/api/status"),
    ]
    if pat:
        paths.append(("one patient's record", f"/api/patients/{pat[0]['id']}"))
    if scr:
        paths.append(("one screening's record", f"/api/screenings/{scr[0]['id']}"))
        paths.append(("one screening's PDF", f"/api/screenings/{scr[0]['id']}/pdf"))

    print(f"  {'endpoint':<26} {'fastest':>9} {'median':>9} {'slowest':>9}   size")
    print("  " + "-" * 66)
    for label, path in paths:
        times, size, err = call(path, token=token, base=LOCAL)
        if times is None:
            print(f"  {label:<26}  ERROR {err}")
            continue
        s = sorted(times)
        print(f"  {label:<26} {min(s):>8.3f}s {s[len(s)//2]:>8.3f}s {max(s):>8.3f}s"
              f"   {size/1024:>7.1f} KB")

    print("\n  the same calls through the Cloudflare tunnel:")
    for label, path in paths:
        times, size, err = call(path, token=token, base=API)
        if times is None:
            print(f"  {label:<26}  ERROR {err}")
            continue
        s = sorted(times)
        print(f"  {label:<26} {min(s):>8.3f}s {s[len(s)//2]:>8.3f}s {max(s):>8.3f}s"
              f"   {size/1024:>7.1f} KB")

    # How many rows are behind the slow ones?
    n_screen = supabase.table("screenings").select("id", count="exact").execute().count
    n_pat = supabase.table("patients").select("id", count="exact").execute().count
    print(f"\n  the list endpoints are serving {n_screen} screening(s) and {n_pat} patient(s)")

    # Cleanup.
    try:
        supabase.table("profiles").delete().eq("id", uid).execute()
    except Exception:
        pass
    for _ in range(4):
        try:
            supabase.auth.admin.delete_user(uid)
            break
        except Exception:
            time.sleep(2)
    print("  cleaned up")


try:
    main()
finally:
    pass
