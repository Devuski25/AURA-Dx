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

import httpx
from fastapi import APIRouter, Response
from pydantic import BaseModel

from config import settings
from database import supabase

log = logging.getLogger(__name__)
router = APIRouter()

HEARTBEAT_INTERVAL_SEC = int(os.environ.get("HEARTBEAT_INTERVAL_SEC", "60"))

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


async def _probe() -> dict:
    """Component checks. Never raises; every failure degrades to a string."""
    async def check_db() -> str:
        try:
            await asyncio.to_thread(
                lambda: supabase.table("profiles").select("id").limit(1).execute()
            )
            return "up"
        except Exception:
            return "down"

    async def check_inference() -> str:
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(
                    f"{settings.inference_service_url}/health", timeout=5
                )
                return "up" if r.status_code == 200 else "down"
        except Exception:
            return "down"

    db, inference = await asyncio.gather(check_db(), check_inference())
    return {"backend": "up", "database": db, "inference": inference}


@router.get("/status", response_model=ServiceStatus)
async def service_status(response: Response):
    """Unauthenticated liveness probe.

    The Login page has no session yet, so this cannot be behind auth. It returns
    three words and a timestamp. No cache: a stale "online" is worse than no
    answer, because it tells a clinician the system is ready when it is not.
    """
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    checks = await _probe()

    last_seen = None
    try:
        row = await asyncio.to_thread(
            lambda: supabase.table("service_status")
            .select("checked_at")
            .eq("id", True)
            .single()
            .execute()
        )
        if row.data:
            last_seen = row.data["checked_at"]
    except Exception:
        pass

    return ServiceStatus(**checks, last_seen=last_seen, minipc_link=_current_link())


async def _heartbeat_loop() -> None:
    """Publish liveness to Supabase every interval.

    Runs inside the backend, so a dead backend also stops publishing -- which is
    the signal. Nothing else writes this row.
    """
    await asyncio.sleep(10)  # let startup finish before the first write
    while True:
        try:
            checks = await _probe()
            version = None
            try:
                async with httpx.AsyncClient() as client:
                    r = await client.get(
                        f"{settings.inference_service_url}/health", timeout=5
                    )
                    if r.status_code == 200:
                        version = r.json().get("model_version")
            except Exception:
                pass

            await asyncio.to_thread(
                lambda: supabase.table("service_status").upsert({
                    "id": True,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                    "backend": checks["backend"],
                    "database": checks["database"],
                    "inference": checks["inference"],
                    "inference_version": version,
                }).execute()
            )
        except Exception as exc:
            # Never let a heartbeat failure take the API down. A missing row is
            # the signal in that case, which is the correct outcome anyway.
            log.debug("heartbeat failed: %r", exc)
        await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)


def register_heartbeat(app) -> None:
    app.router.add_event_handler("startup", lambda: asyncio.create_task(_heartbeat_loop()))