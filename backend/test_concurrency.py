"""Does the stack hold up when a room full of people use it at once?

Every other test in this directory asks whether one request is correct. This
one asks what happens when ten or twenty arrive together, which is the only
question whose answer changes when the clinic grows past one clinician.

Three things are checked:

  1. No 429s. The rate limiter is per IP, and a clinic shares one public IP.
     At 60 requests a minute a single busy room throttled itself.
  2. Health stays answerable. The backend is one event loop; a synchronous
     Supabase call inside an `async def` used to freeze every other request
     for the length of that call. If /api/health slows down during a burst,
     something is blocking the loop again.
  3. The same audio still scores the same with several batches in flight
     (`--inference`, slower). That is the check that the concurrency control
     did not change the cascade.

Run against the local services, with the backend on :8001 and inference on
:8000. Creates a throwaway super_admin account and removes it afterwards.
"""

import argparse
import json
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import settings  # noqa: E402
from database import supabase  # noqa: E402

API = "http://127.0.0.1:8001"
INFERENCE = "http://127.0.0.1:8000"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AURA-Dx concurrency probe"

# What a clinician's browser actually asks for. The admin pages are included
# because they are the heaviest reads and the ones most likely to be open on a
# second screen while everybody else works.
PATHS = ["/api/health", "/api/patients", "/api/screenings", "/api/users"]


def make_account():
    email = f"load{int(time.time())}@example.com"
    password = "LoadTest!pass123"
    r = supabase.auth.admin.create_user(
        {"email": email, "password": password, "email_confirm": True}
    )
    uid = r.user.id
    clinic = supabase.table("clinics").select("id").limit(1).execute().data[0]["id"]
    supabase.table("profiles").upsert({
        "id": uid, "email": email, "full_name": "Load Probe", "role": "super_admin",
        "status": "approved", "clinic_id": clinic,
    }).execute()
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        f"{settings.supabase_url}/auth/v1/token?grant_type=password",
        data=body,
        headers={"Content-Type": "application/json",
                 "apikey": settings.supabase_anon_key},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return uid, json.loads(resp.read())["access_token"]


def cleanup(uid):
    try:
        supabase.table("profiles").delete().eq("id", uid).execute()
    except Exception:
        pass
    try:
        supabase.auth.admin.delete_user(uid)
    except Exception:
        pass


def timed(path, token, timeout=120):
    req = urllib.request.Request(
        API + path, headers={"User-Agent": UA, "Authorization": f"Bearer {token}"}
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
            return (time.perf_counter() - t0) * 1000, resp.status
    except urllib.error.HTTPError as exc:
        return (time.perf_counter() - t0) * 1000, exc.code


def burst(concurrent, token):
    """Fire `concurrent` page-load-shaped calls; sample health meanwhile."""
    latencies = []
    statuses = []
    health = []
    lock = threading.Lock()
    stop = threading.Event()

    def worker(i):
        ms, status = timed(PATHS[i % len(PATHS)], token)
        with lock:
            latencies.append(ms)
            statuses.append(status)

    def probe():
        while not stop.is_set():
            try:
                ms, _ = timed("/api/health", token, timeout=60)
                health.append(ms)
            except Exception:
                pass
            time.sleep(0.15)

    probe_thread = threading.Thread(target=probe, daemon=True)
    probe_thread.start()
    threads = [threading.Thread(target=worker, args=(i,)) for i in range(concurrent)]
    t0 = time.perf_counter()
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    wall = (time.perf_counter() - t0) * 1000
    stop.set()
    probe_thread.join(timeout=5)

    ordered = sorted(latencies)
    return {
        "wall": wall,
        "p50": statistics.median(ordered),
        "p95": ordered[max(0, int(len(ordered) * 0.95) - 1)],
        "worst": ordered[-1],
        "health_worst": max(health) if health else 0.0,
        "statuses": statuses,
    }


def inference_identity_check(token):
    """Score the same three takes twice at once and compare the verdicts."""
    recordings = sorted(
        Path(__file__).resolve().parent.joinpath("uploads_audio").glob("*.wav"),
        key=lambda p: p.stat().st_size,
        reverse=True,
    )[:3]
    if len(recordings) < 3:
        print("  skipped: fewer than three recordings on disk")
        return True

    headers = {"X-API-Key": settings.inference_api_key}

    def score():
        import httpx  # the backend venv has it, via supabase-py

        files = [
            ("audios", (p.name, p.read_bytes(), "audio/wav")) for p in recordings
        ]
        body = httpx.post(
            f"{INFERENCE}/api/inference", files=files, headers=headers, timeout=600
        )
        body.raise_for_status()
        return body.json()

    def summary(body):
        return (
            body["respiratory_result"]["label"],
            body["respiratory_result"]["confidence"],
            [(c["clip_label"], c["pneumonia_prob"]) for c in body["per_clip"]],
        )

    expected = summary(score())
    results = []
    lock = threading.Lock()

    def worker():
        try:
            value = summary(score())
        except Exception as exc:  # pragma: no cover - reported below
            print("  inference error:", exc)
            return
        with lock:
            results.append(value)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    identical = len(results) == 2 and all(r == expected for r in results)
    print(
        "  two batches in flight: %d answer(s), identical to a single run: %s"
        % (len(results), identical)
    )
    return identical


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--inference", action="store_true",
        help="also score the same audio twice at once (~1-2 minutes)",
    )
    args = parser.parse_args()

    uid, token = make_account()
    failures = []
    try:
        print(f"  {'users':>5}  {'p50':>7}  {'p95':>7}  {'worst':>7}  {'health':>7}")
        print("  " + "-" * 44)
        for concurrent in (5, 10, 20):
            r = burst(concurrent, token)
            print(
                "  %5d  %6.0fms %6.0fms %6.0fms %6.0fms"
                % (concurrent, r["p50"], r["p95"], r["worst"], r["health_worst"])
            )
            throttled = [s for s in r["statuses"] if s == 429]
            if throttled:
                failures.append(f"{len(throttled)} request(s) were rate-limited at {concurrent} users")
            errors = [s for s in r["statuses"] if s >= 400 and s != 429]
            if errors:
                failures.append(f"{len(errors)} request(s) returned {sorted(set(errors))}")
            # A blocked event loop shows up here, not in the request timings:
            # health is cheap, so it should never be waiting behind a page load.
            if r["health_worst"] > 3000:
                failures.append(
                    "health took %.0fms during the %d-user burst -- the event loop is blocked"
                    % (r["health_worst"], concurrent)
                )

        if args.inference:
            print("\n  cascade under load")
            if not inference_identity_check(token):
                failures.append("concurrent batches disagreed with a single run")
    finally:
        cleanup(uid)

    print()
    if failures:
        for failure in failures:
            print("  FAIL:", failure)
        return 1
    print("  PASS: concurrent users are served without throttling or a blocked loop")
    return 0


if __name__ == "__main__":
    sys.exit(main())
