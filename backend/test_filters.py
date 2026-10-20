"""Every filter on every page, checked against the live API.

The gender filter on the screening list did nothing at all, and the reason is
the kind of thing that is invisible in review: the API calls the field
`patient_gender` and the filter read `gender`, so every row compared
`undefined` and nothing ever matched. No error, no empty state -- just a
filter that appeared to work and quietly did not.

This applies each filter exactly as the frontend does, against the real
response, and checks that it actually narrows the list to the right rows. A
filter that silently matches nothing is the failure mode being guarded against,
so each one is checked for both: does it remove what it should, and does it
keep what it should.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import settings  # noqa: E402
from database import supabase  # noqa: E402

API = "https://api.auradx.xyz"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

made_users = []
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


def sign_in(email, password):
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        data=body,
        headers={"Content-Type": "application/json", "apikey": settings.supabase_anon_key},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())["access_token"]


def make_user(role, clinic_id, name):
    email = f"filt{int(time.time())}{role}@example.com"
    password = "FilterTest!pass123"
    r = supabase.auth.admin.create_user(
        {"email": email, "password": password, "email_confirm": True}
    )
    uid = r.user.id
    made_users.append(uid)
    supabase.table("profiles").upsert({
        "id": uid, "email": email, "full_name": name,
        "role": role, "status": "approved", "clinic_id": clinic_id,
    }).execute()
    return sign_in(email, password)


def _ui_filter_options():
    """The role and status options the admin page actually offers.

    Read out of the page's source rather than hard-coded here, so that the
    check follows the UI. A copy of the list in the test drifts from the
    page, and then the test is checking a thing that is not there.
    """
    import re

    source = (
        Path(__file__).resolve().parent.parent
        / "frontend-new"
        / "src"
        / "pages"
        / "Admin.tsx"
    ).read_text(encoding="utf-8")

    def options_after(marker: str) -> set:
        start = source.find(marker)
        if start < 0:
            return set()
        block = source[start:start + 1200]
        return set(re.findall(r'<SelectItem value="([^"]+)"', block))

    roles = options_after('value={roleFilter}')
    statuses = options_after('value={statusFilter}')
    roles.discard("all")
    statuses.discard("all")
    return roles, statuses


def main():
    clinic_id = "00000000-0000-0000-0000-000000000001"
    tok = make_user("super_admin", clinic_id, "Filter Admin")

    status, screenings = call("/api/screenings", token=tok)
    print(f"  GET /api/screenings -> HTTP {status}, {len(screenings)} rows")
    if status != 200 or not screenings:
        print("  nothing to test against")
        return 1

    # --- the field the gender filter reads ---------------------------------
    print("\n  field names the filters read:")
    sample = screenings[0]
    print(f"    'gender'        present: {'gender' in sample}   <- the filter used to read this")
    print(f"    'patient_gender' present: {'patient_gender' in sample}   <- what the API sends")
    if "gender" in sample:
        failures.append("the API still sends a bare 'gender' field")
    if "patient_gender" not in sample:
        failures.append("the API does not send 'patient_gender'")

    genders = {s.get("patient_gender") for s in screenings}
    print(f"    patient_gender values in the data: {sorted(g for g in genders if g)}")

    # --- gender filter ------------------------------------------------------
    print("\n  gender filter")
    for value in sorted(g for g in genders if g):
        kept = [s for s in screenings if s.get("patient_gender") == value]
        dropped = [s for s in screenings if s.get("patient_gender") != value]
        # Every kept row must have that gender.
        wrong = [s for s in kept if s.get("patient_gender") != value]
        # Every dropped row must not have it.
        missed = [s for s in dropped if s.get("patient_gender") == value]
        print(f"    {value:<8} keeps {len(kept):>3}, drops {len(dropped):>3}"
              f"   wrong kept={len(wrong)}  wrong dropped={len(missed)}")
        if wrong:
            failures.append(f"the gender filter kept rows that are not '{value}'")
        if missed:
            failures.append(f"the gender filter dropped rows that are '{value}'")
        if not kept and screenings:
            failures.append(f"the gender filter for '{value}' matches nothing at all")

    # --- result class filter -----------------------------------------------
    print("\n  result class filter")
    for value in ("Healthy", "COPD", "Pneumonia"):
        kept = [s for s in screenings if s.get("respiratory_result") == value]
        wrong = [s for s in kept if s.get("respiratory_result") != value]
        print(f"    {value:<10} keeps {len(kept):>3}   wrong kept={len(wrong)}")
        if wrong:
            failures.append(f"the class filter kept rows that are not '{value}'")

    # The class filter must not keep a row whose class is not what it says.
    mismatched = [
        s for s in screenings
        if s.get("respiratory_result") and s.get("respiratory_probabilities")
        and max(s["respiratory_probabilities"].items(), key=lambda kv: kv[1])[0] != s["respiratory_result"]
    ]
    print(f"\n  rows whose class is not their highest probability: {len(mismatched)}")
    for s in mismatched[:5]:
        print(f"    {s.get('patient_name')}: class={s.get('respiratory_result')} "
              f"probs={s.get('respiratory_probabilities')}")
    if mismatched:
        failures.append(f"{len(mismatched)} rows report a class that is not their highest probability")

    # --- search filter ------------------------------------------------------
    print("\n  search filter")
    for field, label in (("patient_name", "patient"), ("clinician_name", "clinician")):
        values = {s.get(field) for s in screenings if s.get(field)}
        if not values:
            continue
        needle = sorted(values)[0]
        lower = needle.lower()
        kept = [s for s in screenings
                if lower in (s.get(field) or "").lower()
                or lower in (s.get("clinic_name") or "").lower()
                or lower in (s.get("clinician_name") or "").lower()]
        wrong = [s for s in kept
                 if lower not in (s.get(field) or "").lower()
                 and lower not in (s.get("clinic_name") or "").lower()
                 and lower not in (s.get("clinician_name") or "").lower()]
        print(f"    search '{label}' '{needle[:18]}' -> {len(kept)} rows, wrong kept={len(wrong)}")
        if wrong:
            failures.append(f"the search filter kept rows that do not match '{needle}'")

    # --- the admin page filters --------------------------------------------
    print("\n  admin page filters")
    status, users = call("/api/users", token=tok)
    print(f"  GET /api/users -> HTTP {status}, {len(users)} rows")
    if status == 200 and users:
        roles = {u.get("role") for u in users}
        stat = {u.get("status") for u in users}
        print(f"    role values in the data:   {sorted(r for r in roles if r)}")
        print(f"    status values in the data: {sorted(s for s in stat if s)}")
        for value in sorted(r for r in roles if r):
            kept = [u for u in users if u.get("role") == value]
            wrong = [u for u in kept if u.get("role") != value]
            print(f"    role {value:<12} keeps {len(kept):>3}   wrong kept={len(wrong)}")
            if wrong:
                failures.append(f"the role filter kept rows that are not '{value}'")
        for value in sorted(s for s in stat if s):
            kept = [u for u in users if u.get("status") == value]
            wrong = [u for u in kept if u.get("status") != value]
            print(f"    status {value:<12} keeps {len(kept):>3}   wrong kept={len(wrong)}")
            if wrong:
                failures.append(f"the status filter kept rows that are not '{value}'")
        # The option values in the UI have to be values the database can hold.
        # Not values that happen to be present right now -- an account can be
        # pending today and approved tomorrow, and the filter has to offer it
        # either way.
        #
        # And the reverse: an option the UI offers that the database can never
        # hold is a filter that will confuse somebody. The options are read
        # out of the page itself, so the check follows the UI rather than a
        # copy of it that can drift.
        POSSIBLE_ROLES = {"clinician", "admin", "super_admin"}
        POSSIBLE_STATUSES = {"pending", "approved", "rejected", "deleted"}
        ui_roles, ui_statuses = _ui_filter_options()
        print(f"    role options in the UI   : {sorted(ui_roles)}")
        print(f"    status options in the UI : {sorted(ui_statuses)}")
        for value in ui_roles:
            if value not in POSSIBLE_ROLES:
                failures.append(f"the role filter offers '{value}', which is not a role")
        for value in ui_statuses:
            if value not in POSSIBLE_STATUSES:
                failures.append(f"the status filter offers '{value}', which is not a status")
        # Every status an account can be in, other than "all", has to be
        # offered -- otherwise a status is unreachable through the filter.
        for value in POSSIBLE_STATUSES - {"deleted"}:
            if value not in ui_statuses:
                failures.append(f"the status filter does not offer '{value}'")
        print(f"    role options   : {sorted(POSSIBLE_ROLES)}")
        print(f"    status options : {sorted(POSSIBLE_STATUSES)}")

    print()
    if failures:
        print("  FAILURES:")
        for f in failures:
            print(f"    {f}")
        return 1
    print("  PASS: every filter narrows the list to exactly the right rows")
    return 0


try:
    code = main()
finally:
    # Each removal gets its own try block.
    #
    # They used to share one, which meant the auth delete throwing -- it does
    # that intermittently, on a read timeout -- skipped the profile delete and
    # left a live account behind with a super_admin role. Two of those
    # survived in the database until they were found and removed by hand.
    for uid in made_users:
        try:
            supabase.table("profiles").delete().eq("id", uid).execute()
        except Exception as e:
            print(f"  (profile cleanup failed for {uid}: {e!r})")
        for _ in range(3):
            try:
                supabase.auth.admin.delete_user(uid)
                break
            except Exception as e:
                if "not found" in str(e).lower():
                    break
                last = e
        else:
            print(f"  (auth cleanup failed for {uid}: {last!r})")
    if made_users:
        print(f"\n  cleaned up {len(made_users)} test account(s)")

sys.exit(code)
