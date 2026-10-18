"""One pooled httpx client for the whole process.

Why this module exists
----------------------
Every outbound HTTP call used to be written as:

    async with httpx.AsyncClient() as client:
        r = await client.get(...)

which looks cheap and is not. Constructing an ``AsyncClient`` builds a fresh
``ssl.SSLContext``, and building one loads and parses the CA bundle from disk.
Measured on the clinic Mini PC against the local inference service:

    fresh AsyncClient() per call ...... 587-910 ms
    one shared AsyncClient, reused ..... 2-7 ms

Roughly 300x, for a request whose actual work is returning a dict. The gap was
not server time and not the tunnel -- a plain ``urllib`` GET to the same URL
took 1 ms. It was client construction, paid on every single call.

That cost was previously being paid on:

  * ``/api/status`` and ``/api/health`` -- once per request, and the Login page
    and the in-session watchdog both poll those every 30 seconds
  * the heartbeat, every 60 seconds
  * ``run_inference`` -- on the critical path of a screening submission
  * ``/api/users`` -- on the admin page load

Sharing one client fixes all of them at once because the pool -- and with it
the TLS session and the CA bundle -- is built once per process instead of once
per request.

Usage
-----
    from httpx_client import get_client
    r = await get_client().get(url, timeout=5)

A per-request ``timeout=`` still overrides the client default, so the short
timeouts the health probes rely on are unaffected.

Closed by the FastAPI lifespan in ``main.py``. If it is never closed the process
still exits cleanly -- httpx registers no atexit hook and the sockets die with
the process -- but closing it releases the pool cleanly on reload.

Named ``httpx_client`` rather than ``http`` on purpose: ``backend/`` is on
``sys.path`` ahead of the standard library, so a module called ``http.py`` would
shadow the stdlib package of that name. Anything in the dependency tree doing
``import http.client`` would then resolve to this file and fail on a submodule
that does not exist under it.
"""

import httpx

# A screening fans 3-5 takes out to the inference service, which runs the
# two-stage cascade on the Mini PC's CPU. That is the slowest call in the system
# and it sets the floor here; individual probes override it downward.
DEFAULT_TIMEOUT_SEC = 150.0

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    """The process-wide client. Created on first use, then reused.

    Lazily created rather than at import: the module is imported by route
    modules, which are imported by ``main``, and constructing an async client
    outside a running loop is a footgun worth not having.

    Safe to call from several coroutines -- there is no ``await`` between the
    check and the assignment, so the guard cannot be interleaved.
    """
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=DEFAULT_TIMEOUT_SEC,
            limits=httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
                keepalive_expiry=60.0,
            ),
        )
    return _client


async def aclose_client() -> None:
    """Release the pool. Called from the FastAPI lifespan on shutdown."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None