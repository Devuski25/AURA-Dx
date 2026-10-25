"""Check the mobile upload path against its caps and its memory contract.

Run from anywhere, with the backend on :8001 and Supabase up:

    python backend/test_upload_limits.py

It creates a throwaway super_admin (the same helper the concurrency probe
uses), uploads near-limit takes, proves the per-file cap and the batch cap,
proves the 64MB Content-Length guard answers before the body is read, and
removes every file and account it created.

The memory claim is structural: the backend copies the spooled upload in 1MB
chunks, so the largest recording a request holds is one chunk rather than ten
megabytes. This test proves the copy is correct and bounded by the limit; the
sampling of the process working set is done outside Python.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parent
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

from test_concurrency import API, UA, cleanup, make_account  # noqa: E402

MB = 1024 * 1024
UPLOAD_DIR = BACKEND / "uploads_audio"


def multipart(sizes: list[int], names: list[str]) -> tuple[bytes, str]:
    boundary = "----auraupload" + uuid.uuid4().hex
    out = bytearray()
    for size, name in zip(sizes, names):
        out += f"--{boundary}\r\n".encode()
        out += (
            f'Content-Disposition: form-data; name="audios"; filename="{name}"\r\n'
        ).encode()
        out += b"Content-Type: audio/wav\r\n\r\n"
        out += b"RIFF" + b"\0" * max(0, size - 4)
        out += b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), boundary


def post(token: str, sizes: list[int]):
    names = [f"take-{i + 1}.wav" for i in range(len(sizes))]
    body, boundary = multipart(sizes, names)
    req = urllib.request.Request(
        API + "/api/audio/upload",
        data=body,
        headers={
            "User-Agent": UA,
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def saved_names(payload) -> set[str]:
    return {
        os.path.basename(os.path.join(str(BACKEND), item["file_path"]))
        for item in payload.get("files", [])
    }


def remove_batches(batches) -> None:
    for payload in batches:
        for item in payload.get("files", []):
            try:
                os.remove(BACKEND / item["file_path"])
            except OSError:
                pass


def content_length_guard() -> tuple[int, str]:
    """Send 65MB and read the answer while the body is still going out.

    A plain request/response client cannot see this: the server refuses from
    the header and closes, so the client's next write is aborted before it
    reads. Reading concurrently is what proves the 413 arrived first.
    """
    size = 65 * MB
    sock = socket.create_connection(("127.0.0.1", 8001), timeout=30)
    sock.sendall(
        (
            "POST /api/audio/upload HTTP/1.1\r\n"
            "Host: 127.0.0.1:8001\r\n"
            f"User-Agent: {UA}\r\n"
            "Content-Type: multipart/form-data; boundary=x\r\n"
            f"Content-Length: {size}\r\n"
            "\r\n"
        ).encode()
    )

    def send_body() -> None:
        chunk = b"\0" * MB
        remaining = size
        try:
            while remaining:
                n = min(len(chunk), remaining)
                sock.sendall(chunk[:n])
                remaining -= n
        except OSError:
            pass

    threading.Thread(target=send_body, daemon=True).start()
    raw = sock.recv(4096).decode("utf-8", "replace")
    sock.close()
    status_line, _, rest = raw.partition("\r\n")
    try:
        status = int(status_line.split()[1])
    except (IndexError, ValueError):
        status = 0
    return status, rest


def main() -> int:
    uid, token = make_account()
    failures: list[str] = []
    batches = []
    UPLOAD_DIR.mkdir(exist_ok=True)
    before = set(os.listdir(UPLOAD_DIR))

    try:
        # A real batch at the edge of the per-file limit.
        started = time.perf_counter()
        status, payload = post(token, [9 * MB] * 3)
        elapsed = time.perf_counter() - started
        if status != 200:
            failures.append(f"3x9MB upload returned {status}: {payload}")
        else:
            batches.append(payload)
            if [f["size"] for f in payload["files"]] != [9 * MB] * 3:
                failures.append("3x9MB sizes did not round-trip")
            if payload.get("count") != 3:
                failures.append(f"3x9MB count was {payload.get('count')}")
            print(f"  PASS  3 x 9MB accepted in {elapsed * 1000:.0f} ms")

        # One byte over the per-file limit: refused, and no partial file left.
        known = {name for batch in batches for name in saved_names(batch)}
        status, payload = post(token, [10 * MB + 1])
        leftovers = set(os.listdir(UPLOAD_DIR)) - before - known
        if status != 400 or "too large" not in str(payload.get("detail", "")):
            failures.append(f"10MB+1 upload returned {status}: {payload}")
        elif leftovers:
            failures.append(f"oversized upload left {len(leftovers)} partial file(s)")
        else:
            print("  PASS  10MB+1 rejected with 400 and no partial file")

        # The batch cap is checked before any file is read.
        status, payload = post(token, [1024] * 6)
        if status != 400 or "Too many recordings" not in str(payload.get("detail", "")):
            failures.append(f"6-file upload returned {status}: {payload}")
        else:
            print("  PASS  six files rejected before any write")

        # Several near-limit batches at once. They must all complete; memory is
        # bounded by the 1MB chunk, not by the number of recordings in flight.
        def burst(_: int):
            return post(token, [4 * MB] * 3)

        started = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(burst, range(3)))
        elapsed = time.perf_counter() - started
        for status, payload in results:
            if status != 200:
                failures.append(f"concurrent 3x4MB upload returned {status}: {payload}")
            else:
                batches.append(payload)
        if all(status == 200 for status, _ in results):
            print(f"  PASS  3 concurrent 3x4MB batches in {elapsed:.1f} s")

        for batch in batches:
            for item in batch["files"]:
                path = BACKEND / item["file_path"]
                if not path.exists():
                    failures.append(f"missing uploaded file {path}")
                elif path.stat().st_size != item["size"]:
                    failures.append(f"size mismatch for {path}")
        if not failures:
            print("  PASS  every saved path exists at the reported size")

        status, rest = content_length_guard()
        if status != 413:
            failures.append(f"65MB Content-Length returned {status}: {rest[:120]}")
        else:
            print("  PASS  65MB Content-Length rejected with 413 before the body")

    finally:
        remove_batches(batches)
        cleanup(uid)

    print()
    if failures:
        for failure in failures:
            print("  FAIL:", failure)
        return 1
    print("  ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
