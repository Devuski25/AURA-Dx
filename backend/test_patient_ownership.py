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


def _inference_is_up() -> bool:
    """Is the inference service answering?

    It listens on 127.0.0.1:8000 on this machine. A health check is enough --
    the question is whether it can be reached, not whether it is happy.
    """
    try:
        req = urllib.request.Request("http://127.0.0.1:8000/health")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception:
        return False


def _write_synthetic_wav(path: Path, seconds: float = 6.0, rate: int = 16000) -> None:
    """A short mono 16 kHz wav for the inference service to chew on.

    It is a low hum with a tremolo and a little noise, rather than silence,
    because silence can be rejected by the pre-processing before the model
    ever sees it. The model always produces a verdict for anything that gets
    that far, which is all this test needs.
    """
    import math
    import random
    import struct
    import wave

    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = bytearray()
        for i in range(int(rate * seconds)):
            t = i / rate
            v = 0.22 * math.sin(2 * math.pi * 120 * t) * (
                1 + 0.4 * math.sin(2 * math.pi * 3 * t)
            )
            v += 0.04 * random.uniform(-1, 1)
            v = max(-1.0, min(1.0, v))
            frames += struct.pack("<h", int(v * 32767))
        w.writeframes(bytes(frames))


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

    # --- the owner can open their own patient's record ---------------------
    #
    # This is the page the list's "View details" opens, and it was the one
    # that was returning a 500 for its own owner: the endpoint built the
    # response by spreading a list of rows as keyword arguments. Every other
    # check here was about what B and the admin could do, and the owner's own
    # read was never called -- so the page could be broken for the only
    # person who uses it and every test would still pass.
    status, body = call(f"/api/patients/{patient_id}", "GET", token=a_tok)
    print(f"  A opens their own patient -> HTTP {status}")
    if status != 200:
        failures.append(f"A cannot open their own patient's record (HTTP {status})")
    else:
        if body.get("id") != patient_id:
            failures.append("A's own patient record is the wrong patient")
        # The field is `full_name` -- the patient list and the record both use
        # it, and a record page with no name on it is a broken page.
        if not body.get("full_name"):
            failures.append(
                f"A's own patient record has no name: {sorted(body.keys())}"
            )
        elif body["full_name"] != "Ownership Probe":
            failures.append(
                f"A's own patient record has the wrong name: {body.get('full_name')!r}"
            )
        if not body.get("date_of_birth"):
            failures.append("A's own patient record has no date of birth")
        if body.get("age_bracket") is None:
            failures.append("A's own patient record has no age bracket")

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

    # --- a screening with a recording of its own ----------------------------
    #
    # The test used to borrow an existing screening's recording, so it could
    # only run when a real recording happened to be on disk. After a reset,
    # with the audio directory cleared, it printed "no recording on disk" and
    # stopped -- and everything after that point, including the delete paths
    # and the analysis, never ran at all. A test that quietly skips its own
    # middle is worse than no test.
    #
    # The audio is synthesised here instead. The file belongs to the test, so
    # it cannot touch a patient's recording, and it is the same file the
    # delete paths are then checked against.
    probe_name = f"ownership_probe_{int(time.time() * 1000)}.wav"
    probe_path = UPLOADS / probe_name
    _write_synthetic_wav(probe_path)
    paths = [f"uploads_audio\\{probe_name}"]

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
        # A dead inference service is not a bug in this code, and reporting it
        # as one sends you hunting the wrong thing. The inference service
        # dies on this machine -- a Windows socket failure that leaves the
        # process resident -- and the analysis then fails with it.
        inference_up = _inference_is_up()
        if not inference_up:
            print("  SKIP: the inference service is not running, so the analysis")
            print("        cannot complete. Start the stack and run this again.")
        else:
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
        try:
            supabase.table("patients").delete().eq("id", pid).execute()
        except Exception:
            pass
    # The profile and the auth user are removed independently, so that the
    # auth call timing out -- which it does intermittently on this project --
    # cannot leave a live account behind.
    for uid in made_users:
        try:
            supabase.table("profiles").delete().eq("id", uid).execute()
        except Exception:
            pass
        for _ in range(3):
            try:
                supabase.auth.admin.delete_user(uid)
                break
            except Exception as e:
                if "not found" in str(e).lower():
                    break
    if made_users:
        print(f"\n  cleaned up {len(made_users)} test account(s)")

sys.exit(code)
