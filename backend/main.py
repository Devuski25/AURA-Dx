from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from collections import defaultdict
from time import time
import traceback
from routes.api import router as api_router
from routes.status import start_heartbeat, stop_heartbeat, warm_status_caches
from routes.status import router as status_router
from config import settings
from httpx_client import aclose_client, get_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting AURA-Dx FastAPI Backend...")
    # Build the pooled client now rather than on the first request. Constructing
    # one costs ~550 ms because it builds an SSL context, and whoever asks for
    # /api/status first after a restart would otherwise be the one who waits for
    # it. Doing it during startup moves that cost somewhere nobody is watching.
    get_client()
    # Spends the remaining first-probe cost -- Supabase's cold connection pool,
    # measured at ~1.2 s for a process's first probe against ~120 ms for every
    # one after it. See routes.status.warm_status_caches for why that cost
    # belongs to startup rather than to the clinician on the Login page.
    await warm_status_caches()
    # Publishes liveness to Supabase on an interval so the frontend can tell
    # "switched off" from "crashed" even while this process is gone.
    #
    # Started from HERE, inside the lifespan context. It used to be registered
    # with app.router.add_event_handler("startup", ...), and Starlette never ran
    # it -- Router.lifespan executes lifespan_context only, and on_startup
    # handlers belong to the deprecated path taken when an app is built without
    # a lifespan=. See routes.status.start_heartbeat.
    #
    # The task is held in this frame so it stays strongly referenced (asyncio
    # holds only a weak one, and a collected task stops without a trace) and can
    # be cancelled cleanly below.
    heartbeat = start_heartbeat()
    try:
        yield
    finally:
        await stop_heartbeat(heartbeat)
        # Releases the pooled httpx client. Not closing it would not break
        # anything -- the sockets die with the process -- but --reload cycles
        # this lifespan frequently, and closing is what keeps each cycle from
        # leaving a pool behind.
        await aclose_client()
        print("Shutting down AURA-Dx FastAPI Backend...")


app = FastAPI(
    title="AURA-Dx API",
    description="Cough Sound Analysis for Respiratory Disease Screening",
    version="1.0.0",
    lifespan=lifespan
)

# NOTE: CORSMiddleware is added LAST (see bottom of the middleware block).
# Starlette inserts each newly added middleware at the HEAD of the stack, so
# the last one added is the OUTERMOST and runs on both the request and the
# response path.  Adding CORS first (the old order) put the rate limiter
# outside it, which meant 429 responses — and every unhandled 500 — went out
# without an Access-Control-Allow-Origin header, which browsers report as:
#   "Response to preflight request doesn't pass access control check:
#    No 'Access-Control-Allow-Origin' header is present"

# --- Simple in-memory rate limiter ---
#
# The bucket is per client IP, and a whole clinic usually shares one public IP.
# At the original 60 requests a minute that was a ceiling on the CLINIC, not on
# a user: one page load is several calls, the users list polls every 10s and the
# records list every 15s, so ten people working normally would trip it and start
# collecting 429s. The limit is a denial-of-service backstop, not a per-user
# quota, so it sits well above what a room full of clinicians can generate.
_rate_limit_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 600    # requests per window, per IP
_RATE_LIMIT_CLEANUP_INTERVAL = 300  # clean stale IPs every 5 min
_last_cleanup: float = 0

# A screening upload is at most five 10MB recordings plus multipart framing.
# Anything past this is refused from its Content-Length header, before the body
# is read, so an oversized request costs a header read rather than 60MB of RAM.
MAX_REQUEST_BYTES = 64 * 1024 * 1024


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    global _last_cleanup
    # CORS preflights are answered by the outer middleware and never reach
    # here; skip them anyway so the intent is local to this function.
    if request.method == "OPTIONS":
        return await call_next(request)

    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_REQUEST_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": "Request too large. Upload at most 5 recordings of 10MB each."},
        )

    # Behind the Cloudflare Tunnel every request's client host is 127.0.0.1,
    # which would funnel ALL users into one shared rate-limit bucket.
    # Use the X-Forwarded-For header (set by cloudflared) when present.
    forwarded_for = request.headers.get("x-forwarded-for", "")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else (request.client.host if request.client else "unknown")
    now = time()

    # Periodic cleanup of stale IP entries to prevent memory leak
    if now - _last_cleanup > _RATE_LIMIT_CLEANUP_INTERVAL:
        window_start = now - RATE_LIMIT_WINDOW
        stale_ips = [ip for ip, ts in _rate_limit_store.items() if not ts or ts[-1] < window_start]
        for ip in stale_ips:
            del _rate_limit_store[ip]
        _last_cleanup = now

    _rate_limit_store[client_ip] = [t for t in _rate_limit_store[client_ip] if t > now - RATE_LIMIT_WINDOW]
    if len(_rate_limit_store[client_ip]) >= RATE_LIMIT_MAX:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Try again later."},
            headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
        )
    _rate_limit_store[client_ip].append(now)
    return await call_next(request)


@app.middleware("http")
async def exception_guard_middleware(request: Request, call_next):
    """Turn unhandled exceptions into a JSON 500 *inside* the CORS middleware.

    Starlette's ServerErrorMiddleware (which renders generic exceptions as a
    bare "Internal Server Error") sits OUTSIDE every user middleware, so a
    crashing endpoint used to produce a 500 with no CORS headers at all — the
    browser then only shows the misleading CORS preflight error.  Catching
    here keeps the response on the CORS path and logs the real traceback.
    """
    try:
        return await call_next(request)
    except Exception:
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )


# Added last => OUTERMOST: every response below (200/401/403/429/500) gets the
# CORS headers, and preflights are answered before the rate limiter counts them.
#
# `allow_origin_regex` admits origins on the local network so the dev site works
# from a phone or a second laptop without hand-editing CORS_ORIGINS every time
# the DHCP lease changes. Starlette checks the explicit list first, so the
# production origins still match by name; the regex is http-only and RFC1918-
# scoped, and the API is bearer-token authenticated rather than cookie-based.
# See Settings.cors_lan_origin_regex for the full scoping argument.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_lan_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")
# /api/status is public and unauthenticated: the Login page needs it before any
# session exists. It is mounted separately rather than folded into api_router
# so that the absence of a guard there is deliberate and visible in one place.
app.include_router(status_router, prefix="/api")


@app.get("/")
async def root():
    return {"message": "AURA-Dx API", "version": "1.0.0", "docs": "/docs"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.api_host, port=settings.api_port, reload=True)