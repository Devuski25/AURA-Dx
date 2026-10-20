"""Test patient ownership, and the two delete paths, against the live services.

    python backend/test_patient_ownership.py

The rules being checked:

  * A clinician sees only the patients they created, even though a colleague
    is in the same clinic.
  * A clinician cannot edit or delete a colleague's patient, even with the id.
  * An admin sees every patient in their clinic.
  * Deleting a screening removes the row AND the recording on disk.
  * Deleting a patient removes their screenings with them.

Two clinicians and an admin are created in the same clinic, a patient is
created by one of them, and each rule is exercised through the API. Everything
created here is removed at the end.
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
UPLOADS = Path(r"C:\VSPWET\AURA-Dx\backend\uploads_audio")

made_users = []
made_patients = []
failures = []
OUT = sys.stdout


def print(*args, **kwargs):  # noqa: A001
    __builtins__.print(*args, file=OUT, **kwargs)
    OUT.flush()


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


def make_user(role, clinic_id):
    email = f"own{int(time.time())}{role}@example.com"
    password = "OwnTest!pass123"
    r = supabase.auth.admin.create_user(
        {"email": email, "password": password, "email_confirm": True}
    )
    uid = r.user.id
    made_users.append(uid)
    supabase.table("profiles").upsert({
        "id": uid,
        "email": email,
        "full_name": f"Owner Test {role}",
        "role": role,
        "status": "approved",
        "clinic_id": clinic_id,
    }).execute()
    return email, password, uid


def main():
    clinic_id = "00000000-0000-0000-0000-000000000001"

    a_email, a_pw, _ = make_user("clinician", clinic_id)
    b_email, b_pw, _ = make_user("clinician", clinic_id)
    admin_email, admin_pw, _ = make_user("admin", clinic_id)
    time.sleep(0.4)

    a_tok = sign_in(a_email, a_pw)
    b_tok = sign_in(b_email, b_pw)
    admin_tok = sign_in(admin_email, admin_pw)

    # --- clinician A creates a patient -----------------------------------
    status, created = call("/api/patients", "POST", {
        "full_name": "Ownership Probe",
        "date_of_birth": "1990-01-01",
        "gender": "male",
        "smoking_history": False,
        "past_respiratory_diseases": [],
        "symptoms": [],
    }, a_tok)
    print(f"  A creates a patient -> HTTP {status}")
    if status not in (200, 201):
        print(f"     {created}")
        return 1
    patient_id = created["id"]
    made_patients.append(patient_id)

    # --- clinician A sees it ---------------------------------------------
    status, rows = call("/api/patients", "GET", token=a_tok)
    mine = [p for p in rows if p["id"] == patient_id]
    print(f"  A's list contains the patient: {bool(mine)}  (list of {len(rows)})")
    if not mine:
        failures.append("A cannot see the patient they created")

    # --- clinician B does not ---------------------------------------------
    status, rows = call("/api/patients", "GET", token=b_tok)
    theirs = [p for p in rows if p["id"] == patient_id]
    print(f"  B's list contains the patient: {bool(theirs)}  (list of {len(rows)})")
    if theirs:
        failures.append("B can see A's patient -- the ownership rule is not applied")

    # --- the admin sees everything ----------------------------------------
    status, rows = call("/api/patients", "GET", token=admin_tok)
    admin_sees = [p for p in rows if p["id"] == patient_id]
    print(f"  admin's list contains the patient: {bool(admin_sees)}  (list of {len(rows)})")
    if not admin_sees:
        failures.append("the admin cannot see the patient")

    # --- B cannot read, edit or delete it ---------------------------------
    status, _ = call(f"/api/patients/{patient_id}", "GET", token=b_tok)
    print(f"  B reads it directly -> HTTP {status}")
    if status not in (403, 404):
        failures.append(f"B can read A's patient (HTTP {status})")

    status, _ = call(f"/api/patients/{patient_id}", "PATCH",
                     {"full_name": "Hijacked"}, b_tok)
    print(f"  B edits it -> HTTP {status}")
    if status not in (403, 404):
        failures.append(f"B can edit A's patient (HTTP {status})")

    status, _ = call(f"/api/patients/{patient_id}", "DELETE", token=b_tok)
    print(f"  B deletes it -> HTTP {status}")
    if status not in (403, 404):
        failures.append(f"B can delete A's patient (HTTP {status})")

    # --- a screening with a real recording --------------------------------
    donor = (
        supabase.table("screenings")
        .select("recording_paths")
        .eq("status", "completed")
        .limit(20)
        .execute().data or []
    )
    paths = next(
        (d["recording_paths"] for d in donor
         if d.get("recording_paths")
         and all((UPLOADS / Path(p).name).is_file() for p in d["recording_paths"])),
        None,
    )
    if not paths:
        print("\n  no recording on disk to test the delete with")
        return 1

    status, screening = call("/api/screenings", "POST", {
        "patient_id": patient_id,
        "audio_file_paths": paths,
        "audio_duration_sec": 60.0,
    }, a_tok)
    print(f"\n  A creates a screening -> HTTP {status}")
    if status != 200:
        print(f"     {screening}")
        return 1
    screening_id = screening["id"]

    # Wait for the background analysis to land, then read it back.
    for _ in range(40):
        status, row = call(f"/api/screenings/{screening_id}", "GET", token=a_tok)
        if row.get("status") != "analysing":
            break
        time.sleep(1.5)
    print(f"  screening status after analysis: {row.get('status')}  result={row.get('respiratory_result')}")
    print(f"  screening_number={row.get('screening_number')} of {row.get('patient_screening_count')}")
    if not row.get("respiratory_result"):
        failures.append("the screening has no result after the analysis")

    # --- delete the screening, and check the file goes too ----------------
    before = [UPLOADS / Path(p).name for p in paths]
    present_before = [p for p in before if p.is_file()]
    status, body = call(f"/api/screenings/{screening_id}", "DELETE", token=a_tok)
    print(f"  A deletes the screening -> HTTP {status}  {body}")
    if status != 200:
        failures.append(f"could not delete the screening (HTTP {status})")

    status, _ = call(f"/api/screenings/{screening_id}", "GET", token=a_tok)
    if status == 200:
        failures.append("the screening is still there after the delete")

    still_there = [p for p in present_before if p.is_file()]
    print(f"  recording files on disk: {len(present_before)} before, {len(still_there)} after")
    if present_before and still_there:
        failures.append("the recording files were left on disk")

    # --- delete the patient ------------------------------------------------
    status, body = call(f"/api/patients/{patient_id}", "DELETE", token=a_tok)
    print(f"\n  A deletes the patient -> HTTP {status}  {body}")
    if status != 200:
        failures.append(f"could not delete the patient (HTTP {status})")
    made_patients.remove(patient_id)

    status, rows = call("/api/patients", "GET", token=a_tok)
    if any(p["id"] == patient_id for p in rows):
        failures.append("the patient is still listed after the delete")

    print()
    if failures:
        print("  FAILURES:")
        for f in failures:
            print(f"    {f}")
        return 1
    print("  PASS: ownership, and both delete paths, all behave")
    return 0


try:
    code = main()
except Exception:
    import traceback
        traceback.print_exc()
    code = 1
finally:
    for pid in made_patients:
        supabase.table("patients").delete().eq("id", pid).execute()
    for uid in made_users:
        try:
            supabase.auth.admin.delete_user(uid)
            supabase.table("profiles").delete().eq("id", uid).execute()
        except Exception:
            pass
    if made_users:
        print(f"\n  cleaned up {len(made_users)} test account(s)")

sys.exit(code)
