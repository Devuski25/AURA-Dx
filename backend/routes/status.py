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

    return ServiceStatus(**checks, last_seen=last_seen)


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