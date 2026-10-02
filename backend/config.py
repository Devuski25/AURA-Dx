from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional

# Resolve the env file relative to THIS file, not the process cwd.  If it were
# left as a bare ".env.local", starting uvicorn from anywhere except backend/
# (Windows service, task scheduler, `uvicorn backend.main:app`, ...) silently
# falls back to the defaults below -> CORS_ORIGINS becomes localhost-only and
# every request from https://auradx.xyz fails the preflight check.
BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env.local"


class Settings(BaseSettings):
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    inference_service_url: str = "http://localhost:8000"
    inference_api_key: str = ""
    api_host: str = "0.0.0.0"
    api_port: int = 8001
    app_env: str = "development"
    cors_origins: str = "http://localhost:5174,http://localhost:3000"
    # Transactional email via Resend SMTP (read from backend/.env.local)
    resend_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_from: str = ""
    jwt_secret: str = Field(
        default="",
        description="Set via JWT_SECRET env var. Must be >= 32 chars in production.",
    )
    jwt_algorithm: str = "HS256"

    class Config:
        # utf-8-sig strips the UTF-8 BOM that editors leave on the first line;
        # with plain utf-8 the first key would be parsed as "\ufeffSUPABASE_URL".
        env_file = ENV_FILE
        env_file_encoding = "utf-8-sig"
        case_sensitive = False
        extra = "ignore"

    @property
    def cors_origin_list(self) -> list[str]:
        # Normalise: strip whitespace, drop trailing slashes (browsers send
        # origins without one, so "https://auradx.xyz/" would never match).
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()

# Startup diagnostics (never prints secrets) — check these in backend.log when
# a deployment behaves differently from local dev.
import sys as _sys
print(
    f"[config] env_file={ENV_FILE} exists={ENV_FILE.exists()} "
    f"(cwd={Path.cwd()})",
    file=_sys.stderr,
)
print(
    f"[config] cors_origins={settings.cors_origin_list} "
    f"supabase_url={settings.supabase_url} "
    f"service_key_len={len(settings.supabase_service_key)} "
    f"anon_key_len={len(settings.supabase_anon_key)}",
    file=_sys.stderr,
)