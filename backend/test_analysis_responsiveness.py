"""Is the API responsive while a screening is being analysed?

Background analysis exists so a clinician can submit a screening, walk off to
another patient, and come back to the result. That only works if the API
stays responsive while the analysis runs. If the analysis starves the event
loop, the clinician is met by a spinning page and gives up -- which is the
exact thing the feature was meant to prevent.

So this starts a screening and measures the API's response time throughout,
against the local backend rather than through the tunnel, so a slow tunnel is
not mistaken for a slow API.
"""

import json
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import supabase  # noqa: E402
from config import settings  # noqa: E402

LOCAL = "http://127.0.0.1:8001"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
UPLOADS = Path(__file__).resolve().parent / "uploads_audio"

made_users = []
made_patients = []


def get(url, token=None, timeout=20):
    """Status, elapsed time, and the parsed body."""
    headers = {"User-Agent": UA}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            try:
                body = json.loads(raw)
            except Exception:
                body = {}
            return resp.status, time.time() - t0, body
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except Exception:
            body = {}
        return e.code, time.time() - t0, body
    except Exception:
        return 0, time.time() - t0, {}


def make_account(role):
    email = f"perf{int(time.time())}@example.com"
    password = "PerfTest!pass123"
    for _ in range(4):
        try:
            r = supabase.auth.admin.create_user(
                {"email": email, "password": password, "email_confirm": True})
            break
        except Exception:
            time.sleep(3)
    else:
        raise RuntimeError("could not create the test account")
    uid = r.user.id
    made_users.append(uid)
    clinic = supabase.table("clinics").select("id").limit(1).execute().data[0]["id"]
    supabase.table("profiles").upsert({
        "id": uid, "email": email, "full_name": "Perf Clinician", "role": role,
        "status": "approved", "clinic_id": clinic,
    }).execute()
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        data=body,
        headers={"Content-Type": "application/json",
                 "apikey": settings.supabase_anon_key})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["access_token"]


def write_wav(path, seconds=6.0, rate=16000):
    import math, random, struct, wave
    random.seed(11)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        fr = bytearray()
        for i in range(int(rate * seconds)):
            t = i / rate
            v = 0.22 * math.sin(2 * math.pi * 120 * t) * (
                1 + 0.4 * math.sin(2 * math.pi * 3 * t)) + 0.04 * random.uniform(-1, 1)
            fr += struct.pack("<h", int(max(-1, min(1, v)) * 32767))
        w.writeframes(bytes(fr))


def main():
    token = make_account("clinician")
    clinic = supabase.table("clinics").select("id").limit(1).execute().data[0]["id"]
    uid = made_users[0]
    pid = str(uuid.uuid4())
    made_patients.append(pid)
    supabase.table("patients").insert({
        "id": pid, "full_name": "Perf Probe", "date_of_birth": "1990-01-01",
        "gender": "male", "clinic_id": clinic, "clinician_id": uid,
    }).execute()

    # Five takes, the maximum, so the inference is as long as it ever gets.
    names = []
    for i in range(5):
        n = f"perf_probe_{uuid.uuid4()}.wav"
        write_wav(UPLOADS / n)
        names.append(f"uploads_audio\\{n}")

    # A sampler that measures the API's response time continuously.
    samples = []
    stop = threading.Event()

    def sampler():
        while not stop.is_set():
            code, dt, _ = get(f"{LOCAL}/api/health")
            samples.append((round(dt, 2), code))
            time.sleep(1.0)

    t = threading.Thread(target=sampler, daemon=True)
    t.start()

    body = json.dumps({
        "patient_id": pid,
        "audio_file_paths": names,
        "audio_duration_sec": 60.0,
    }).encode()
    req = urllib.request.Request(
        f"{LOCAL}/api/screenings", data=body, method="POST",
        headers={"Content-Type": "application/json", "User-Agent": UA,
                 "Authorization": f"Bearer {token}"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as resp:
        screening = json.loads(resp.read())
    post_time = time.time() - t0
    print(f"  POST /api/screenings returned in {post_time:.2f}s  (status {screening.get('status')})")

    # Wait for the analysis to land.
    analysis_start = time.time()
    for _ in range(180):
        code, _dt, row = get(f"{LOCAL}/api/screenings/{screening['id']}", token=token)
        if row.get("status") != "analysing":
            break
        time.sleep(1.0)
    analysis_time = time.time() - analysis_start
    stop.set()
    t.join(timeout=5)

    print(f"  the analysis took {analysis_time:.1f}s")
    print(f"  final status: {row.get('status')}   result: {row.get('respiratory_result')}")
    if row.get("status") == "error":
        err = supabase.table("audit_logs").select("details").eq(
            "action", "screening_error").order("created_at", desc=True).limit(1).execute().data
        if err:
            print(f"  the error was: {str(err[0].get('details'))[:300]}")
    print(f"  the API was sampled {len(samples)} time(s) during it")
    if samples:
        worst = max(samples, key=lambda s: s[0])
        times = [s[0] for s in samples]
        errors = [s for s in samples if s[1] != 200]
        print(f"    fastest {min(times):.2f}s   median {sorted(times)[len(times)//2]:.2f}s   slowest {worst[0]:.2f}s")
        print(f"    responses that were not 200: {len(errors)}")
        for dt, code in errors[:5]:
            print(f"      {code} after {dt}s")
    else:
        print("    no samples were taken")
    # Ten seconds is the point at which a clinician would call the app hung.
    if samples and max(times) > 10:
        print("\n  FINDING: the API stalled while the analysis ran")
    else:
        print("\n  FINDING: the API stayed responsive throughout the analysis")


try:
    main()
finally:
    for pid in made_patients:
        try:
            supabase.table("patients").delete().eq("id", pid).execute()
        except Exception:
            pass
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
    for f in UPLOADS.glob("perf_probe_*.wav"):
        try:
            f.unlink()
        except OSError:
            pass
    print("\n  probe data cleaned up")
