"""Start the inference service on an event loop that does not crash.

Windows' default event loop is the Proactor, which uses the Windows I/O
completion port. It has a long-standing bug: when a connection is closed in a
particular way, the accept call fails with

    OSError: [WinError 64] The specified network name is no longer available

and the accept loop dies with it. uvicorn only switches to the Selector loop
when it is going to use subprocesses, which on Windows it never is -- so the
Proactor is what this service was running on.

The effect was that the inference service died on its own, part-way through
handling a screening. The process stayed resident, so the port stayed open
and a health check still said the service was up -- but it answered nothing,
and every screening after that failed with "Analysis failed". Nothing
restarted it. The only way out was to run the start script by hand.

The log showed it plainly:

    INFO:inference_service:Fused 1 recordings -> COPD (0.530), override=None
    INFO:     127.0.0.1:60462 - "POST /api/inference HTTP/1.1" 200 OK
    ERROR:asyncio:Accept failed on a socket
    socket: <asyncio.TransportSocket fd=1344, ... laddr=('0.0.0.0', 8000)>
    OSError: [WinError 64] The specified network name is no longer available

The Selector loop does not have the bug. It cannot spawn subprocesses, which
this service does not need.

The app string is passed in rather than hard-coded, so the command line still
contains "inference_service:app". The deployment script finds orphaned
services by matching that string against the running processes, and changing
the command line without changing that would leave it unable to reap a
service that is holding the port.
"""

import argparse
import asyncio
import os
import sys


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the inference service.")
    parser.add_argument("app", help="the ASGI application, as module:attr")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--limit-concurrency", type=int, default=None)
    parser.add_argument("--log-level", default="info")
    args = parser.parse_args()

    # Before anything creates a loop. uvicorn makes the loop inside
    # asyncio.run(), which is after this point, so a policy set here is the
    # one the server actually uses.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    import uvicorn

    uvicorn.run(
        args.app,
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        limit_concurrency=args.limit_concurrency,
        # The same defaults uvicorn's own command line uses, so the logs
        # read the way they always have.
        access_log=True,
    )


if __name__ == "__main__":
    # The script's own directory has to be importable: the app is given as
    # "module:attr" and uvicorn imports it.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
