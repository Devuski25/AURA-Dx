from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from collections import defaultdict
from time import time
from routes.api import router as api_router
from config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting AURA-Dx FastAPI Backend...")
    yield
    print("Shutting down AURA-Dx FastAPI Backend...")


app = FastAPI(
    title="AURA-Dx API",
    description="Cough Sound Analysis for Respiratory Disease Screening",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Simple in-memory rate limiter ---
_rate_limit_store: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 60     # requests per window
_RATE_LIMIT_CLEANUP_INTERVAL = 300  # clean stale IPs every 5 min
_last_cleanup: float = 0


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    global _last_cleanup
    client_ip = request.client.host if request.client else "unknown"
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
        return JSONResponse(status_code=429, content={"detail": "Too many requests. Try again later."})
    _rate_limit_store[client_ip].append(now)
    return await call_next(request)

app.include_router(api_router, prefix="/api")


@app.get("/")
async def root():
    return {"message": "AURA-Dx API", "version": "1.0.0", "docs": "/docs"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.api_host, port=settings.api_port, reload=True)