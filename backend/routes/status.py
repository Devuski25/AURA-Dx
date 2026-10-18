"""SERVICE_STATUS — liveness for the clinic.

Two separate questions, deliberately kept apart:

  1. "Is the backend answering right now?"  -> GET /api/status
     Authoritative, but only works while the backend is up. Its absence is itself
     the answer: unreachable means offline.

  2. "When did the Mini PC last check in?"  -> service_status row in Supabase
     Works regardless of backend state, because Supabase stays reachable. This is
     what distinguishes "nobody switched it on" from "it died mid-screening".

The Login page shows 1 and falls back to 2 for the "last seen" detail.
"""

import asyncio
import logging
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Response
from pydantic import BaseModel

from config import settings
from database import supabase
from httpx_client import get_client

log = logging.getLogger(__name__)
router = APIRouter()

HEARTBEAT_INTERVAL_SEC = int(os.environ.get("HEARTBEAT_INTERVAL_SEC", "60"))

# How long one probe result is reused before another is run.
#
# Set deliberately BELOW the 30s the frontend polls at. That ordering is the
# whole safety argument for the cache: a response can be at most
# PROBE_TTL_SEC old, whereas polling every 30s without a cache could hand back a
# result up to 30s old. Caching here therefore tightens the worst case rather
# than loosening it -- a cached "online" is always fresher than a re-probed one
# would have been.
#
# It also collapses duplicate work. The Login page, the in-session watchdog and
# the admin health panel each poll independently, and their intervals drift, so
# without this a minute of clinic traffic could trigger a dozen probes for one
# underlying answer.
PROBE_TTL_SEC = float(os.environ.get("PROBE_TTL_SEC", "15"))

# How often the Mini PC re-checks which kind of network link it has.
#
# Detecting the link shells out to `netsh`, which is far too slow to do per
# request. Five minutes is frequent enough that plugging in a pocket wifi shows
# up while someone is still looking at the screen, and rare enough to be
# invisible next to the probes.
LINK_REFRESH_SEC = int(os.environ.get("LINK_REFRESH_SEC", "300"))

_link_cache: dict = {"value": "unknown", "at": 0.0}


def _detect_link() -> str:
    """Best-effort: is this machine on Wi-Fi or on a cable?

    Deliberately reports only the *kind* of link. The SSID would be the network
    name -- putting a clinic's Wi-Fi name onto a screen that holds patient data
    buys nothing and leaks something.

    Unknown is a normal answer, not a failure. The Mini PC may be on a platform
    without `netsh`, and connectivity itself is proven by the Supabase probe, not
    by this.
    """
    if sys.platform != "win32":
        return "unknown"
    try:
        out = subprocess.run(
            ["netsh", "wlan", "show", "interfaces"],
            capture_output=True, timeout=4,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout.decode("utf-8", "replace")
    except Exception:
        return "unknown"

    # A Wi-Fi adapter that is present but not connected still reports a State
    # line, so presence of the text alone does not mean Wi-Fi is in use.
    #
    # Compared for equality, never by substring. "disconnected" contains
    # "connected", so a substring test reports Wi-Fi on a machine that is
    # plugged into a cable and merely has a wireless dongle attached -- which
    # is exactly this machine, and the first thing it got wrong.
    state = ""
    for line in out.splitlines():
        if line.strip().lower().startswith("state"):
            state = line.split(":", 1)[-1].strip().lower()
    if state == "connected":
        return "wifi"

    # No wireless adapter, or one that is disconnected. If the machine has a
    # non-loopback IPv4 address it is almost certainly on a cable.
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.settimeout(0.2)
        probe.connect(("10.255.255.255", 1))  # no packet sent
        ip = probe.getsockname()[0]
        probe.close()
        if not ip.startswith("127."):
            return "wired"
    except Exception:
        pass
    return "unknown"


def _current_link() -> str:
    now = time.monotonic()
    if now - _link_cache["at"] > LINK_REFRESH_SEC:
        _link_cache["value"] = _detect_link()
        _link_cache["at"] = now
    return _link_cache["value"]


class ServiceStatus(BaseModel):
    """What the Login page renders.

    Deliberately carries no version, no hostname, no URL and no key. Anyone can
    call this without a token, so it answers only "is it up".
    """

    backend: str      # up | down
    database: str     # up | down
    inference: str    # up | down
    # None when unknown: the heartbeat row is stale or missing, so "was up" is
    # not the same claim as "is up".
    last_seen: Optional[str] = None
    # wifi | wired | unknown. The kind of network link the Mini PC is on, not the
    # network name.
    #
    # This is deliberately separate from `database`. `database: up` already
    # proves the Mini PC can reach the internet, so the link kind is context,
    # not a second liveness signal -- the UI must not present it as one.
    minipc_link: str = "unknown"


def _overall(backend: str, database: str, inference: str) -> str:
    if backend == "down":
        return "offline"
    if "down" in (database, inference):
        return "degraded"
    return "online"


async def _probe_live() -> dict:
    """Component checks. Never raises; every failure degrades to a string.

    Expensive by design: three outbound calls, two of which cross the internet
    to Supabase. Callers go through `_probe()` / `_snapshot()`, not this.
    """
    async def check_db() -> str:
        try:
            await asyncio.to_thread(
                lambda: supabase.table("profiles").select("id").limit(1).execute()
            )
            return "up"
        except Exception:
            return "down"

    async def check_inference() -> tuple[str, Optional[str]]:
        """Reachability and model version from a single request.

        `model_version` used to cost a second round trip to the same URL a few
        lines later. The body is already in hand, so it is read from it.
        """
        try:
            r = await get_client().get(
                f"{settings.inference_service_url}/health", timeout=5
            )
            if r.status_code != 200:
                return "down", None
            try:
                return "up", r.json().get("model_version")
            except Exception:
                return "up", None
        except Exception:
            return "down", None

    db, (inference, version) = await asyncio.gather(check_db(), check_inference())
    return {
        "backend": "up",
        "database": db,
        "inference": inference,
        "inference_version": version,
    }


async def _read_last_seen() -> Optional[str]:
    """When the Mini PC last published to Supabase. None if unknown.

    Cached by the caller along with the probe, so a request that cannot reach
    Supabase does not pay for this query as well as the probe's.
    """
    try:
        row = await asyncio.to_thread(
            lambda: supabase.table("service_status")
            .select("checked_at")
            .eq("id", True)
            .single()
            .execute()
        )
        if row.data:
            return row.data["checked_at"]
    except Exception as exc:
        # Expected when the heartbeat migration has not been applied yet. The
        # UI renders "last seen" only in the offline state and copes with null,
        # so this must not escalate -- but it is worth a single line in the log
        # rather than a bare pass, because otherwise an unapplied migration is
        # invisible and `last_seen` stays permanently empty.
        log.debug("last_seen unavailable: %r", exc)
    return None


# Snapshot cache: one dict + the monotonic time it was taken, guarded by a lock
# so concurrent callers collapse onto a single probe rather than each starting
# their own.
_snapshot_cache: dict = {"value": None, "at": 0.0}
_snapshot_lock = asyncio.Lock()


async def _snapshot() -> dict:
    """The full status payload, cached for PROBE_TTL_SEC.

    Single-flight as well as cached. Three pollers landing in the same instant
    must not each open their own connections -- the second and third wait for
    the first and then find its result already fresh.

    Returns a copy. The cached dict is shared between callers, and the heartbeat
    stamps `last_seen` onto the row it writes; handing out the original would
    let one request mutate another's view.
    """
    fresh_enough = (
        _snapshot_cache["value"] is not None
        and (time.monotonic() - _snapshot_cache["at"]) < PROBE_TTL_SEC
    )
    if fresh_enough:
        return dict(_snapshot_cache["value"])

    async with _snapshot_lock:
        # Re-checked inside the lock. A caller that queued behind an in-flight
        # probe should receive that probe's result, not start a second one --
        # checking before acquiring the lock would let it miss the update that
        # happened while it was waiting.
        fresh_enough = (
            _snapshot_cache["value"] is not None
            and (time.monotonic() - _snapshot_cache["at"]) < PROBE_TTL_SEC
        )
        if fresh_enough:
            return dict(_snapshot_cache["value"])

        # Overlapped, not sequential. Both talk to Supabase, but they are
        # independent reads, and running them in series doubled the cold-probe
        # cost for no reason -- measured 230 ms serial against ~150 ms here.
        checks, last_seen = await asyncio.gather(_probe_live(), _read_last_seen())

        payload = {**checks, "last_seen": last_seen}
        _snapshot_cache["value"] = payload
        _snapshot_cache["at"] = time.monotonic()
        return dict(payload)


@router.get("/status", response_model=ServiceStatus)
async def service_status(response: Response):
    """Unauthenticated liveness probe.

    The Login page has no session yet, so this cannot be behind auth. It returns
    three words and a timestamp.

    No browser caching: a stale "online" held in a client's cache is worse than
    no answer, because it tells a clinician the system is ready when it is not.
    `no-store` keeps that decision with the server, where PROBE_TTL_SEC bounds
    it to 15 seconds -- see the note there on why that is tighter than the
    polling interval it replaces.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    payload = await _snapshot()

    return ServiceStatus(
        backend=payload["backend"],
        database=payload["database"],
        inference=payload["inference"],
        last_seen=payload["last_seen"],
        # Already cached for LINK_REFRESH_SEC by `_current_link`, so this is a
        # dict read on the hot path, not another `netsh` subprocess.
        minipc_link=_current_link(),
    )


async def _heartbeat_loop() -> None:
    """Publish liveness to Supabase every interval.

    Runs inside the backend, so a dead backend also stops publishing -- which is
    the signal. Nothing else writes this row.

    Uses `_probe_live()` rather than the cached `_snapshot()` deliberately: this
    row is the authoritative "last seen", so it must record a genuine
    observation. Reading its own row back through the snapshot would make the
    timestamp it publishes describe a moment before the write.
    """
    await asyncio.sleep(10)  # let startup finish before the first write
    while True:
        try:
            checks = await _probe_live()

            await asyncio.to_thread(
                lambda: supabase.table("service_status").upsert({
                    "id": True,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                    "backend": checks["backend"],
                    "database": checks["database"],
                    "inference": checks["inference"],
                    "inference_version": checks["inference_version"],
                }).execute()
            )
        except Exception as exc:
            # Never let a heartbeat failure take the API down. A missing row is
            # the signal in that case, which is the correct outcome anyway.
            log.debug("heartbeat failed: %r", exc)
        await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)


def register_heartbeat(app) -> None:
    app.router.add_event_handler("startup", lambda: asyncio.create_task(_heartbeat_loop()))


async def warm_status_caches() -> None:
    """Pay the first-probe cost at startup instead of on a request.

    The very first live probe in a fresh process measured ~1.2 s, against
    ~120 ms for every probe after it. The difference is one-time connection
    setup -- the pooled httpx client's TLS context, and Supabase's own pool,
    which postgrest-py leaves empty until its first query.

    That first probe is not a background cost. It is the answer to the first
    `/api/status` after a restart, which is exactly what a clinician waiting on
    the Login page is watching, on the most latency-sensitive page in the app.

    So it is spent here, during startup, where nobody is blocked on it.

    Never raises and never fails the boot: if Supabase or the inference service
    are not up yet, the snapshot simply holds a "down" reading, which is the
    truth, and the heartbeat corrects it within a minute.
    """
    try:
        get_client()
        # `_snapshot()` rather than its parts, so the cache is populated as well
        # as the connections warmed -- a request arriving in the first seconds
        # after boot then gets this reading instead of running its own.
        await _snapshot()
        log.info("status caches warmed")
    except Exception as exc:
        log.warning("status warm-up incomplete, continuing: %r", exc)