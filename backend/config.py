from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
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
    # NOTE: there is deliberately no default. See `is_production` below -- an
    # unset value must not be treated as development.
    app_env: str = ""
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

    @field_validator("inference_service_url")
    @classmethod
    def _pin_loopback_to_ipv4(cls, v: str) -> str:
        """Rewrite a `localhost` inference URL to `127.0.0.1`.

        On Windows `localhost` resolves to `::1` first and `127.0.0.1` second,
        but uvicorn is started with `--host 0.0.0.0`, which binds IPv4 only.
        Nothing is listening on `::1`, so every call to the inference service
        opened a connection to a dead address, waited for it to fail, and only
        then retried over IPv4. Measured cost of that detour: ~290 ms.

        Normalised here rather than at each call site, so `run_inference`, the
        health probes and the heartbeat all inherit the fix and a future call
        site cannot reintroduce it by writing `settings.inference_service_url`
        into a new file.

        Only the literal host `localhost` is rewritten. A real hostname -- which
        is how the service is reached if the inference server is ever moved off
        this machine -- is left exactly as configured.
        """
        v = v.strip()
        parts = urlsplit(v)
        if parts.hostname != "localhost":
            return v

        # Rebuilt from the split components rather than by string replacement,
        # so a `localhost` appearing in a path or query cannot be mangled.
        # An IPv6 literal would have to be bracketed to survive as a netloc;
        # that cannot arise here, but emitting a bare one would be invalid.
        host = "127.0.0.1"
        port = f":{parts.port}" if parts.port else ""
        return urlunsplit((parts.scheme, f"{host}{port}", parts.path, parts.query, parts.fragment))

    @property
    def is_production(self) -> bool:
        """True unless the environment is explicitly a development one.

        Written as an allowlist rather than `app_env == "production"` because
        that comparison fails open. APP_ENV was unset on the deployed machine,
        so the check `if settings.app_env == "production"` was False and two
        things followed from it:

          * `POST /api/auth/send-otp` returned the verification code in its JSON
            response (`dev_code`), so anyone could read the code for any address
            and skip email verification entirely.
          * Email send failures were swallowed rather than raised, so a broken
            sender looked like success.

        With an allowlist, every value that is not recognisably a development
        environment -- unset, blank, "prod", "Production", a typo, a stale name
        from another system -- resolves to production. To get development
        behaviour you must ask for it by name.
        """
        return self.app_env.strip().lower() not in {"development", "dev", "local"}

    @property
    def cors_origin_list(self) -> list[str]:
        # Normalise: strip whitespace, drop trailing slashes (browsers send
        # origins without one, so "https://auradx.xyz/" would never match).
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cors_lan_origin_regex(self) -> str:
        """Origins on the local network, for cross-device development.

        Opening the dev site on a phone or a second laptop means the browser
        sends `Origin: http://192.168.1.42:5174`. That origin is not in
        CORS_ORIGINS, the preflight fails, and every request dies before it
        reaches a route -- which surfaces in the UI as "inference down" even
        though both services are healthy. Adding every address by hand is not
        practical, because the DHCP lease changes.

        Scoped as tightly as the problem allows:

        * `http` only. Every production origin is `https`, so this can never
          widen the production surface.
        * RFC1918 ranges, loopback, and `.local` mDNS names only. A public
          address such as `https://evil.example.com` does not match.
        * Any port, because the Vite dev port is configurable.

        This is safe to leave enabled in production even though it is not
        needed there: reaching it requires already being on the clinic's LAN,
        and the API authenticates with a bearer token (backend/auth.py uses
        HTTPBearer) rather than a cookie, so a cross-origin page cannot ride an
        authenticated session.
        """
        return (
            r"^http://("
            r"localhost"
            r"|127\.0\.0\.1"
            r"|\[::1\]"
            r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
            r"|192\.168\.\d{1,3}\.\d{1,3}"
            r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
            r"|[\w-]+\.local"
            r")(:\d+)?$"
        )


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