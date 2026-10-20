"""Call every GET endpoint on the live API and report any that 500.

A 500 on a page the clinician visits is a broken app, and it is invisible
until someone opens that page. The one that started this was the patient's
record page: `PatientResponse(**res.data)` where `.limit(1)` had returned a
list. The endpoint had been wrong since the workspace consolidation, and
nothing caught it, because every review of it looked at the code and the code
read fine.

So this walks the live OpenAPI spec, calls every GET route with real ids
where it can work them out, and fails on any 500.

A 404 is expected for some routes -- a missing record is a 404, not a
failure. A 403 is expected where the role is wrong. Only a 500 is a bug.
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
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

failures = []


def call(path, method="GET", body=None, token=None):
    headers = {"Content-Type": "application/json", "User-Agent": UA}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": repr(e)}


made_users = []


def sign_in(email, password):
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        data=body,
        headers={"Content-Type": "application/json",
                 "apikey": settings.supabase_anon_key},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["access_token"]


def make_user(role, name):
    """A real account to call the API with.

    The sweep needs a signed-in caller, and it needs one for more than one
    role -- the ownership rules mean an admin sees a patient that a clinician
    does not, so a route can be broken for one role and fine for another.
    """
    email = f"sweep{int(time.time())}{role}@example.com"
    password = "SweepTest!pass123"
    for _ in range(4):
        try:
            r = supabase.auth.admin.create_user(
                {"email": email, "password": password, "email_confirm": True}
            )
            break
        except Exception:
            time.sleep(3)
    else:
        raise RuntimeError("could not create a sweep account")
    uid = r.user.id
    made_users.append(uid)
    clinic = supabase.table("clinics").select("id").limit(1).execute().data[0]["id"]
    supabase.table("profiles").upsert({
        "id": uid, "email": email, "full_name": name, "role": role,
        "status": "approved", "clinic_id": clinic,
    }).execute()
    return sign_in(email, password)


def main():
    # Real signed-in callers. The sweep runs as more than one role, because
    # the ownership rules mean a route can be broken for a clinician and fine
    # for an admin, and vice versa.
    tokens = {
        "clinician": make_user("clinician", "Sweep Clinician"),
        "super_admin": make_user("super_admin", "Sweep Super Admin"),
    }

    status, spec = call("/openapi.json")
    if status != 200:
        print(f"  could not read the OpenAPI spec: HTTP {status}")
        return 1

    # Real ids to put in the paths.
    pat = supabase.table("patients").select("id").limit(1).execute().data
    scr = supabase.table("screenings").select("id").limit(1).execute().data
    usr = supabase.table("profiles").select("id").limit(1).execute().data
    ids = {
        "patient_id": pat[0]["id"] if pat else "00000000-0000-0000-0000-000000000001",
        "screening_id": scr[0]["id"] if scr else "00000000-0000-0000-0000-000000000001",
        "user_id": usr[0]["id"] if usr else "00000000-0000-0000-0000-000000000001",
    }

    gets = [p for p, ops in spec.get("paths", {}).items() if "get" in ops]
    print(f"  GET routes in the spec: {len(gets)}")

    for role, token in tokens.items():
        print(f"\n  --- as {role} ---")
        for path in sorted(gets):
            call_path = path
            for name, value in ids.items():
                call_path = call_path.replace("{" + name + "}", value)
            # Any parameter left unfilled would 422, which is not what this is
            # looking for.
            if "{" in call_path:
                continue

            code, body = call(call_path, token=token)
            detail = ""
            if code >= 500:
                detail = str(body)[:300]
                failures.append((role, call_path, code, detail))
            mark = "OK " if code < 500 else "FAIL"
            print(f"    [{mark}] GET {call_path:<54} HTTP {code}")
            if detail:
                print(f"           {detail}")

    print()
    if failures:
        print(f"  FAIL: {len(failures)} endpoint(s) returned a server error")
        for role, path, code, detail in failures:
            print(f"    [{role}] {path} -> HTTP {code}")
            print(f"      {detail}")
        return 1
    print("  PASS: no endpoint returned a server error")
    return 0


try:
    code = main()
except Exception:
    import traceback
    traceback.print_exc()
    code = 1
finally:
    for uid in made_users:
        try:
            supabase.table("profiles").delete().eq("id", uid).execute()
        except Exception:
            pass
        for _ in range(3):
            try:
                supabase.auth.admin.delete_user(uid)
                break
            except Exception:
                time.sleep(2)
    if made_users:
        print(f"\n  cleaned up {len(made_users)} sweep account(s)")

sys.exit(code)
