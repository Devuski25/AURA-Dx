from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Request, BackgroundTasks
from fastapi.security import HTTPAuthorizationCredentials
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import asyncio
import uuid
import os
import io
import hashlib
import secrets
import json
import time
import urllib.request
import urllib.error
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, PageBreak
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from fastapi.responses import StreamingResponse
# The legacy JWT login flow (/auth/login, /auth/me, /auth/logout,
# /auth/exchange) and the /clinics and /audit-logs routes have been removed.
# Auth is Supabase's job end to end: the browser holds a Supabase session and
# sends its bearer token, and get_current_user validates it. The removed routes
# were a second, parallel credential system that nothing called -- a JWT minted
# and checked here, alongside the real one, which is attack surface with no user.
#
# UserLogin, Token, ClinicCreate, ClinicResponse and AuditLogResponse are the
# request/response shapes those routes used. They stay in models.py because that
# is the schema module's job, and they document the shape the API once had.
from models import (
    UserCreate, UserResponse, UserUpdate,
    PatientCreate, PatientResponse, PatientUpdate,
    ScreeningCreate, ScreeningResponse, ScreeningReview, ExportRequest,
    InferenceRequest, InferenceResponse,
    MetricsSummary,
    UserRole, UserStatus, ScreeningStatus,
    ErrorResponse, HealthResponse, SendOtp, VerifyOtp, ForgotPassword
)
from auth import (
    decode_token,
    get_current_user,
    get_current_user_id,
    require_role,
    invalidate_profile,
    security,
)
from database import supabase, supabase_anon
from config import settings
from email_service import (
    send_account_status_email,
    send_account_deleted_email,
    send_password_reset_email,
    send_verification_email,
)
from httpx_client import get_client
# Same wording source as the React result screen. See pdf_copy.py.
from pdf_copy import status_label, disclosure, confidence_label, class_recommendation

router = APIRouter()

UPLOAD_DIR = "uploads_audio"

# A screening is fused from 3-5 stethoscope takes. Mirrors the inference
# service's MAX_RECORDINGS so the backend rejects an oversized batch before
# any file is written to disk.
MAX_RECORDINGS = 5
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ─── Auth-specific rate limiting (per key) ─────────────────────────────────
_auth_rate_store: dict[str, list[float]] = {}
_AUTH_RATE_WINDOW = 60
_AUTH_RATE_MAX_KEYS = 10000


def _auth_rate_limit(key: str, max_calls: int, window: int = _AUTH_RATE_WINDOW) -> bool:
    """Return True if the request for this key is allowed, False if rate-limited."""
    now = time.time()
    if len(_auth_rate_store) > _AUTH_RATE_MAX_KEYS:
        cutoff = now - _AUTH_RATE_WINDOW
        stale = [k for k, ts in _auth_rate_store.items() if not ts or ts[-1] < cutoff]
        for k in stale:
            del _auth_rate_store[k]
    entries = _auth_rate_store.setdefault(key, [])
    entries[:] = [t for t in entries if t > now - window]
    if len(entries) >= max_calls:
        return False
    entries.append(now)
    return True


# ─── Email verification OTP (public, pre-registration gate) ────────────────
def _parse_ts(value) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        v = str(value)
        if v.endswith("Z"):
            v = v[:-1] + "+00:00"
        dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@router.post("/auth/send-otp")
async def send_otp(payload: SendOtp, request: Request):
    email = payload.email.lower().strip()

    # Rate limit: max 5 sends per email per 10 minutes
    if not _auth_rate_limit(f"otp_send:{email}", 5, 600):
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please wait a few minutes before requesting another code.",
        )

    # Invalidate any previous codes for this email
    try:
        supabase.table("email_verification_codes").delete().eq("email", email).execute()
    except Exception:
        pass

    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    expires_at = (datetime.utcnow() + timedelta(minutes=10)).isoformat()

    try:
        supabase.table("email_verification_codes").insert({
            "email": email,
            "code_hash": code_hash,
            "expires_at": expires_at,
            "verified": False,
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store verification code: {e}")

    email_sent = False
    try:
        send_verification_email(email, code)
        email_sent = True
    except Exception as e:
        print(f"[send-otp] email send failed: {e}")
        # Only a named development environment gets the code in the response.
        # Everywhere else the failure is reported, because a silently-swallowed
        # send failure means the user waits for an email that will never arrive.
        if settings.is_production:
            raise HTTPException(
                status_code=502,
                detail="Failed to send verification email. Please try again later.",
            )

    resp = {"success": True}
    # See Settings.is_production: this line hands out the verification code for
    # any address, so it must only ever be reachable in an explicit dev env.
    if not settings.is_production:
        resp["dev_code"] = code
    return resp


@router.post("/auth/verify-otp")
async def verify_otp(payload: VerifyOtp, request: Request):
    email = payload.email.lower().strip()

    # Rate limit: max 10 verify attempts per email per minute
    if not _auth_rate_limit(f"otp_verify:{email}", 10, 60):
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Please try again later.",
        )

    res = (
        supabase.table("email_verification_codes")
        .select("*")
        .eq("email", email)
        .eq("verified", False)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=400, detail="No active code found. Please request a new one.")

    row = res.data[0]
    try:
        if _parse_ts(row["expires_at"]) < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Code expired. Please request a new one.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid code record.")

    code_hash = hashlib.sha256(payload.code.strip().encode()).hexdigest()
    if code_hash != row["code_hash"]:
        raise HTTPException(status_code=400, detail="Invalid code.")

    supabase.table("email_verification_codes").update({"verified": True}).eq("id", row["id"]).execute()
    return {"verified": True, "email": email}


# ───────────────────────── Password reset (public) ─────────────────────────

def _public_base_url(request: Request) -> str:
    """Where the emailed reset link should send the reader back to.

    Taken from the Origin when that origin is one this API already trusts for
    CORS -- so the link works from the dev server (localhost:5174) as well as
    from auradx.xyz, without a new environment variable and without trusting
    an arbitrary header. Anything else falls back to the production site,
    because a link pointing somewhere unconfigured is a link that 404s.
    """
    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin and origin in settings.cors_origins:
        return origin
    return "https://auradx.xyz"


@router.post("/auth/forgot-password")
async def forgot_password(payload: ForgotPassword, request: Request):
    """Email a password reset link.

    Supabase normally sends this itself (auth.resetPasswordForEmail). It cannot
    on this project: its auth mailer answers every recovery send with HTTP 500
    "Error sending recovery email", so the Login page had nothing to report but
    that sentence. The link generation works fine through the service-role
    client, so the link is made here and delivered over Resend -- the transport
    the verification code and the approval notice already use.

    The link carries a token_hash, not the tokens themselves: the reset page
    exchanges it with supabase.auth.verifyOtp. That keeps the emailed URL on
    auradx.xyz instead of a raw *.supabase.co address, which reads like a
    phishing link in a mailbox.
    """
    email = payload.email.lower().strip()

    # Same shape of limit as the verification code: 5 per address per 10
    # minutes, so this endpoint cannot be used to flood a mailbox.
    if not _auth_rate_limit(f"pw_reset:{email}", 5, 600):
        raise HTTPException(
            status_code=429,
            detail="Too many reset requests. Please wait a few minutes before trying again.",
        )

    # One answer for every outcome, so this cannot be used to find out which
    # addresses have accounts. The wording matches what the page says.
    generic = {
        "success": True,
        "message": "If an account exists for that email, a reset link has been sent.",
    }

    try:
        found = (
            supabase.table("profiles")
            .select("email, full_name, status")
            .eq("email", email)
            .limit(1)
            .execute()
            .data
        )
    except Exception as exc:
        print(f"[forgot-password] profile lookup failed: {exc!r}")
        return generic

    # No such account: nothing to send, and the generic answer is the point.
    #
    # A pending account does get a link. It cannot sign in until an admin
    # approves it, but choosing a password before that is harmless, and the
    # alternative -- silence for an address that does exist -- makes the
    # message above a lie to exactly the person most likely to be waiting.
    if not found:
        return generic

    base = _public_base_url(request)
    try:
        link = supabase.auth.admin.generate_link({
            "type": "recovery",
            "email": email,
            "options": {"redirect_to": f"{base}/reset-password"},
        })
        token_hash = link.properties.hashed_token
    except Exception as exc:
        print(f"[forgot-password] generate_link failed: {exc!r}")
        raise HTTPException(
            status_code=502,
            detail="Could not create a reset link. Please try again, or email supportauradx@gmail.com.",
        )

    reset_url = f"{base}/reset-password?token_hash={token_hash}&type=recovery"

    try:
        # SMTP is blocking; off the event loop or it stalls every other request
        # for the second and a half the send takes.
        await asyncio.to_thread(
            send_password_reset_email, email, found[0].get("full_name") or "", reset_url
        )
    except Exception as exc:
        # This is the honest failure: the user is waiting for an email that was
        # never sent, so the page has to say so rather than show "check your
        # inbox". Logged with the reason for whoever reads the service log.
        print(f"[forgot-password] send failed: {exc!r}")
        raise HTTPException(
            status_code=502,
            detail="Failed to send the reset email. Please try again, or email supportauradx@gmail.com.",
        )

    return generic


@router.post("/auth/discard-oauth-signup")
async def discard_oauth_signup(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
):
    """Delete an account that a Google sign-in created by accident.

    Google is offered as a way IN, not a way to register: registration asks for
    a clinic name, and an OAuth round trip cannot collect one. But Supabase's
    OAuth flow, with sign-ups enabled, creates a complete auth user -- and the
    trigger a pending profile -- for any Google address it has not seen before.
    So a removed clinician, or anyone who simply taps the button, leaves a
    clinic-less pending account behind that an admin then has to clean up.

    The callback calls this once it has decided the identity is brand new. It
    is scoped to the caller's own token and refuses unless every one of these
    is true, so it can never touch a real account:

      * the profile is still `pending`,
      * it has no clinic name (registration cannot produce that),
      * the auth user was created by Google,
      * it was created within the last hour.

    Returns {"discarded": false} rather than an error for every refusal: the
    caller only wants to know whether it should clean up, and a failure here
    must never block the message the person is about to read.
    """
    if not credentials:
        return {"discarded": False}
    try:
        payload = decode_token(credentials.credentials)
    except HTTPException:
        return {"discarded": False}

    user_id = payload.get("sub")
    if not user_id:
        return {"discarded": False}

    try:
        rows = (
            supabase.table("profiles")
            .select("id,email,status,clinic_name")
            .eq("id", user_id)
            .limit(1)
            .execute()
            .data
        )
    except Exception as exc:
        print(f"[discard-oauth-signup] profile lookup failed: {exc!r}")
        return {"discarded": False}
    if not rows:
        return {"discarded": False}

    row = rows[0]
    if row.get("status") != "pending" or row.get("clinic_name"):
        return {"discarded": False}

    try:
        auth_user = supabase.auth.admin.get_user_by_id(user_id).user
    except Exception as exc:
        print(f"[discard-oauth-signup] auth lookup failed: {exc!r}")
        return {"discarded": False}

    if (auth_user.app_metadata or {}).get("provider") != "google":
        return {"discarded": False}

    created = auth_user.created_at
    if isinstance(created, str):
        try:
            created = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError:
            created = None
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    if not created or (datetime.now(timezone.utc) - created).total_seconds() > 3600:
        return {"discarded": False}

    try:
        supabase.auth.admin.delete_user(user_id)
        # Deleting the auth user cascades to the profile (ON DELETE CASCADE);
        # the explicit delete covers the case where the row outlives it.
        supabase.table("profiles").delete().eq("id", user_id).execute()
        invalidate_profile(user_id)
    except Exception as exc:
        print(f"[discard-oauth-signup] delete failed for {user_id}: {exc!r}")
        return {"discarded": False}

    _log_audit(
        "user_delete",
        None,
        None,
        "user",
        user_id,
        {"deleted_user": row.get("email"), "reason": "google sign-up (not a registration route)"},
    )
    return {"discarded": True}


def _scope_query(query, role: str, user_clinic_id: str, target_clinic_id=None):
    """Scope a query to the user's clinic unless they are super_admin."""
    if role == "super_admin":
        if target_clinic_id:
            return query.eq("clinic_id", target_clinic_id)
        return query
    if not user_clinic_id:
        # Admin without clinic assignment sees nothing (or could raise)
        return query.eq("clinic_id", "00000000-0000-0000-0000-000000000000")
    return query.eq("clinic_id", user_clinic_id)


def _scope_patients(query, role: str, user_id: str, user_clinic_id: str, target_clinic_id=None):
    """Scope a patient query to who may see the patient.

    The database already says this. The RLS policies on `patients` are:

        patients_own          clinicians see only their own patients
        patients_clinic_admin  an admin sees the clinic's patients
        patients_admin_all     an admin sees all of them

    But the backend queries with the service_role key, which bypasses RLS
    entirely, so those rules were never applied to the API. Every clinician
    was handed every patient in the clinic.

    This applies the rules the database already declares, so the two layers
    cannot disagree about who may see what.

    A patient belongs to the clinician who created it. An admin still sees
    everything in their clinic, and a super_admin sees everything.
    """
    if role == "super_admin":
        if target_clinic_id:
            return query.eq("clinic_id", target_clinic_id)
        return query
    if role == "admin":
        # Admins keep clinic-wide visibility.
        if not user_clinic_id:
            return query.eq("clinic_id", "00000000-0000-0000-0000-000000000000")
        return query.eq("clinic_id", user_clinic_id)
    # A clinician sees only the patients they created.
    return query.eq("clinician_id", user_id)


def _may_touch_patient(patient: dict, user: dict) -> bool:
    """Whether this user may read, edit or delete a given patient.

    Admins reach every patient in their clinic; a clinician reaches only the
    ones they created. Checked on the individual record as well as on the
    list, so a clinician cannot edit a colleague's patient by guessing its id.
    """
    role = user.get("role")
    if role == "super_admin":
        return True
    if role == "admin":
        return patient.get("clinic_id") == user.get("clinic_id")
    return patient.get("clinician_id") == user.get("sub")


def _row_by_id(table: str, row_id: str, columns: str = "*"):
    """One row by id, or None.

    `.single()` raises when the query matches no rows, and that turned every
    missing record into a 500 instead of the 404 it should be.

    It is done with limit(1) rather than `maybeSingle()`, because
    `maybeSingle` does not exist in this version of postgrest-py -- calling it
    raises an AttributeError, which is easy to mistake for "no such row".
    """
    try:
        res = (
            supabase.table(table)
            .select(columns)
            .eq("id", row_id)
            .limit(1)
            .execute()
        )
        return (res.data or [None])[0]
    except Exception:
        return None


def _first_row(query):
    """The first row of a query, or None.

    `.single()` raises when the query matches no rows, and a query that
    matches no rows is very often the right answer: a record that is not
    there, or one that belongs to somebody else and the ownership filter has
    excluded. The raise turned both of those into a 500.

    It is done with limit(1) rather than `maybeSingle()`, because
    `maybeSingle` does not exist in this version of postgrest-py -- calling it
    raises an AttributeError, which is easy to mistake for "no such row".

    A genuine database error is not swallowed here. It propagates, so it is
    still a 500 -- which is what it should be.
    """
    res = query.limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None


def _resolve_clinic_id(preferred):
    """Return the preferred clinic id, or the single configured clinic in the
    single-clinic model when none is supplied (so clinicians without an
    explicit assignment can still create records)."""
    if preferred:
        return preferred
    try:
        clin = supabase.table("clinics").select("id").limit(1).execute()
        if clin.data:
            return clin.data[0]["id"]
    except Exception:
        pass
    return None


def _calc_age_bracket(dob):
    """Calculate age bracket from date of birth (mirrors SQL age_bracket function)."""
    from datetime import date
    if not dob:
        return None
    try:
        if isinstance(dob, str):
            d = date.fromisoformat(dob.rstrip("Z").split("T")[0])
        else:
            d = dob
        years = date.today().year - d.year
        if years <= 12:
            return "0-12"
        if years <= 21:
            return "13-21"
        if years <= 35:
            return "22-35"
        return "35+"
    except Exception:
        return None


def _log_audit(action: str, user_id: str, clinic_id=None, entity_type=None, entity_id=None, details=None):
    """Insert an audit log entry. Silently skips if the table is missing or insert fails."""
    try:
        supabase.table("audit_logs").insert({
            "user_id": user_id,
            "clinic_id": clinic_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "details": details,
        }).execute()
    except Exception as e:
        print(f"[audit] Failed to log '{action}': {e}")


@router.get("/health", response_model=HealthResponse)
async def health_check():
    services = {
        "database": "unknown",
        "inference": "unknown",
        "auth": "unknown"
    }
    async def check_db() -> str:
        try:
            supabase.table("profiles").select("id").limit(1).execute()
            return "healthy"
        except Exception:
            return "unhealthy"

    async def check_inference() -> str:
        try:
            r = await get_client().get(f"{settings.inference_service_url}/health", timeout=5)
            return "healthy" if r.status_code == 200 else "unhealthy"
        except Exception:
            return "unhealthy"

    db_ok, inference_ok = await asyncio.gather(check_db(), check_inference())
    services["database"] = db_ok
    services["inference"] = inference_ok

    services["auth"] = "healthy"

    return HealthResponse(
        status="healthy" if all(v == "healthy" for v in services.values()) else "degraded",
        timestamp=datetime.utcnow(),
        services=services
    )


@router.post("/audio/upload")
async def upload_audio(
    audios: List[UploadFile] = File(...),
    user: dict = Depends(get_current_user)
):
    """Upload one batch of stethoscope takes and return their server paths.

    A screening is scored from 3-5 takes; they are uploaded together here and
    referenced by the subsequent POST /screenings call.
    """
    if not audios:
        raise HTTPException(status_code=400, detail="No audio files supplied")
    if len(audios) > MAX_RECORDINGS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many recordings: {len(audios)}. Maximum is {MAX_RECORDINGS}."
        )

    saved = []
    for idx, audio in enumerate(audios):
        if not audio.filename or not audio.filename.lower().endswith((".wav", ".mp3", ".flac", ".ogg", ".m4a")):
            raise HTTPException(
                status_code=400,
                detail=f"Recording {idx + 1} ({audio.filename}) has an unsupported format. Use wav, mp3, flac, ogg, m4a"
            )

        contents = await audio.read()
        if len(contents) > 10 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"Recording {idx + 1} is too large. Maximum 10MB per file."
            )

        file_ext = os.path.splitext(audio.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)
        with open(file_path, "wb") as f:
            f.write(contents)
        saved.append({"file_path": file_path, "filename": unique_filename, "size": len(contents)})

    return {
        "file_paths": [s["file_path"] for s in saved],
        "files": saved,
        "count": len(saved),
    }


# The emails whose addresses have been confirmed, and when they were read.
#
# Cached because the users list asked the auth service for every account in
# the project on every load, which is a network call the page waits for and
# a list that grows with the project rather than with the clinic.
_confirmed_emails_cache = None
_confirmed_emails_cache_time = 0.0
# Five minutes, not thirty seconds.
#
# This is the slowest part of the users list: it is a call to the auth service
# for every account in the project, measured at ~830 ms from a cold connection
# against ~0 ms once held. At 30 s it was almost always cold, because nobody
# opens the users page twice in half a minute -- so the cost landed on the one
# page load that matters.
#
# The set changes only when an account is created or confirmed, and accounts
# created through this app are confirmed as they are created (the project has
# mailer_autoconfirm on), so in practice it does not change at all between one
# load and the next. A hand-made confirmation in Supabase shows up within five
# minutes, and the list itself refreshes on every visit regardless.
CONFIRMED_EMAILS_TTL_SECONDS = 300


async def _confirmed_emails() -> set:
    """The emails that have been confirmed.

    Read from the auth service, and cached. An account created through this app
    is confirmed as it is created, so the set does not usually change; a
    confirmation made by hand shows up within the cache window.
    """
    global _confirmed_emails_cache, _confirmed_emails_cache_time
    now = time.monotonic()
    if (
        _confirmed_emails_cache is not None
        and (now - _confirmed_emails_cache_time) < CONFIRMED_EMAILS_TTL_SECONDS
    ):
        return _confirmed_emails_cache

    res = await get_client().get(
        f"{settings.supabase_url}/auth/v1/admin/users",
        headers={
            "Authorization": f"Bearer {settings.supabase_service_key}",
            "apikey": settings.supabase_anon_key,
        },
        timeout=10.0
    )
    data = res.json()
    emails = {
        u["email"] for u in (data.get("users") or []) if u.get("email_confirmed_at")
    }
    _confirmed_emails_cache = emails
    _confirmed_emails_cache_time = now
    return emails


@router.get("/users", response_model=List[UserResponse])
async def list_users(
    user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
    limit: int = 100,
    offset: int = 0
):
    clinic_id = user.get("clinic_id")

    # Scoping, with the same fallback the rest of the app uses.
    #
    # This used to be `if role != "super_admin" and clinic_id`, so an admin
    # carrying no clinic_id got NO filter and saw everyone. Filtering the other
    # way would be worse: `eq("clinic_id", None)` matches nothing, and an admin
    # would see an empty page rather than a wrong one.
    #
    # `_resolve_clinic_id` falls back to the single configured clinic, which is
    # the whole premise of the single-clinic model. So an admin whose own
    # clinic_id was never populated still resolves to the right clinic.
    if user.get("role") != "super_admin":
        resolved = _resolve_clinic_id(clinic_id)
        # No clinic row exists at all. Filtering on a value that cannot exist
        # would return an empty list, which reads as "no users" rather than
        # "misconfigured", so fall back to showing everything.
        query = (
            supabase.table("profiles").select("*").eq("clinic_id", resolved)
            if resolved
            else supabase.table("profiles").select("*")
        )
    else:
        query = supabase.table("profiles").select("*")
    query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
    try:
        profiles_res = query.execute()
        profiles = profiles_res.data or []
    except Exception as e:
        # Unhandled DB/Supabase errors escape as a bare 500 and lose the CORS
        # headers, which the browser reports only as a preflight CORS failure.
        print(f"[list_users] profiles query failed: {e!r}")
        raise HTTPException(status_code=500, detail="Failed to load users")

    # Filter out users with unconfirmed emails (fake emails)
    #
    # This used to fetch EVERY auth user in the project on every call to this
    # endpoint, to find out which emails were confirmed. That is a second
    # network call on top of the profiles query -- about 400ms -- and the
    # users list is the first thing an admin opens. It also grew with the
    # project rather than with the clinic.
    #
    # The set of confirmed emails only changes when somebody confirms an
    # email, so it is cached briefly. Thirty seconds is short enough that a
    # newly confirmed account shows up promptly, and the accounts this app
    # creates are confirmed at creation anyway, so in practice the list does
    # not change at all between one load and the next.
    try:
        confirmed_emails = await _confirmed_emails()
        profiles = [p for p in profiles if p["email"] in confirmed_emails]
    except Exception as e:
        print(f"[list_users] Failed to filter unconfirmed emails: {e}")
        # Fallback: return all profiles if auth check fails
        pass

    try:
        return [UserResponse(**u) for u in profiles]
    except Exception as e:
        print(f"[list_users] failed to serialise users: {e!r}")
        raise HTTPException(status_code=500, detail="Failed to load users")


@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user(user_data: UserCreate, user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    try:
        # Security: only super_admin can create admin or super_admin accounts
        if user_data.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN) and user.get("role") != "super_admin":
            raise HTTPException(status_code=403, detail="Only super_admin can create admin accounts")
        # Block super_admin creation even by super_admin via this endpoint
        if user_data.role == UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=403, detail="Cannot create super_admin via API")
        body = json.dumps({
            "email": user_data.email,
            "password": user_data.password,
            "email_confirm": True,
            "user_metadata": {
                "full_name": user_data.full_name,
                "role": user_data.role.value,
            }
        }).encode()
        req = urllib.request.Request(
            f"{settings.supabase_url}/auth/v1/admin/users",
            data=body,
            headers={
                "Authorization": f"Bearer {settings.supabase_service_key}",
                "apikey": settings.supabase_anon_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                auth_user = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            err_body = e.read().decode()
            raise HTTPException(
                status_code=e.code,
                detail=f"GoTrue error ({e.code}): {err_body[:200]}"
            )

        profile = {
            "id": auth_user["id"],
            "email": user_data.email,
            "full_name": user_data.full_name,
            "role": user_data.role.value,
            "status": user_data.status.value if user_data.status else UserStatus.PENDING.value,
            "phone": user_data.phone,
            "specialization": user_data.specialization,
            "license_number": user_data.license_number,
        }
        supabase.table("profiles").upsert(profile).execute()

        _log_audit("user_create", user.get("sub"), user.get("clinic_id"), "user", auth_user["id"], {"email": user_data.email, "role": user_data.role.value})

        result = supabase.table("profiles").select("*").eq("id", auth_user["id"]).limit(1).execute()
        if not result.data:
            raise HTTPException(
                status_code=500, detail="Account created but the profile is missing"
            )
        return UserResponse(**result.data[0])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    update: UserUpdate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
):
    clinic_id = user.get("clinic_id")
    try:
        target = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    except Exception:
        raise HTTPException(status_code=404, detail="User not found")
    if not target.data:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = update.model_dump(exclude_unset=True)

    # --- Authority: who may modify whom ---------------------------------
    # This is the whole permission model for editing an account, enforced here
    # rather than in the UI. The UI hides the affordance so nobody is offered
    # an action that will fail, but the UI is a client and this is the check
    # that counts.
    target_role = target.data.get("role")
    viewer_role = user.get("role")

    # 1. Super admins are not editable by anyone, including another super
    #    admin. Seeded via CLI, never through this route.
    if target_role == "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Cannot modify super admin account",
        )

    # 2. A rejected account is closed -- not editable, and not re-statusable
    #    through this route either.
    #
    #    This was a real hole: a rejected clinician could be edited, its role
    #    changed to admin, and it would then sit there as role=admin with
    #    status=rejected -- an account simultaneously refused entry and holding
    #    admin authority.
    if target.data.get("status") == "rejected":
        raise HTTPException(
            status_code=403,
            detail="Cannot modify a rejected account",
        )

    # 3. Admins manage clinicians. Editing a peer admin, or escalating one, is
    #    a super-admin action. Mirrors the existing rule on DELETE, which
    #    already scoped admins to clinicians -- edit simply never had it.
    if viewer_role == "admin" and target_role != "clinician":
        raise HTTPException(
            status_code=403,
            detail="Admins can only modify clinician accounts",
        )

    # --- Authority: what may be changed ---------------------------------
    # Prevent role escalation: only super_admin can change roles, and nobody
    # can grant super_admin (must be seeded via CLI).
    if "role" in update_data and update_data["role"] == "super_admin":
        raise HTTPException(status_code=403, detail="Cannot assign super_admin role via API")
    if "role" in update_data and viewer_role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super_admin can change user roles")

    if viewer_role != "super_admin" and target.data.get("clinic_id") != clinic_id:
        raise HTTPException(status_code=403, detail="Cannot modify user from another clinic")

    password = update_data.pop("password", None) if update_data else None
    previous_status = target.data.get("status")
    if update_data:
        supabase.table("profiles").update(update_data).eq("id", user_id).execute()
        # The role and status are cached for the length of a request, so a
        # change made here has to clear that entry. Otherwise a rejected
        # account would keep working until the cache happened to expire.
        invalidate_profile(user_id)
    if password:
        supabase.auth.admin.update_user_by_id(user_id, {"password": password})

    _log_audit("user_update", user.get("sub"), clinic_id, "user", user_id, update_data)

    # Notify on a TRANSITION into approved/rejected, not on any update that
    # happens to carry the same status. Without the guard, an admin editing
    # somebody's phone number while they are approved would send them a fresh
    # "your account has been approved" email.
    #
    # Fire and forget on purpose. The row is already updated and this is the
    # response the admin is waiting on; a Resend outage must not turn a
    # successful approval into a 500 that looks like it failed, and must not
    # leave the account stranded in a half-applied state. The failure is logged
    # and the admin can see the status flip in the table either way.
    new_status = (update_data or {}).get("status")
    if new_status in ("approved", "rejected") and new_status != previous_status:
        target_email = target.data.get("email")
        target_name = target.data.get("full_name") or ""
        if target_email:
            async def _notify():
                try:
                    await asyncio.to_thread(
                        send_account_status_email, target_email, target_name, new_status
                    )
                except Exception as exc:
                    # Swallowed deliberately, logged loudly. The approval stands.
                    print(
                        f"[user_update] approval email to {target_email} failed: {exc!r}"
                    )

            background_tasks.add_task(_notify)

    res = supabase.table("profiles").select("*").eq("id", user_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**res.data[0])


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN)),
):
    try:
        target = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    except Exception:
        raise HTTPException(status_code=404, detail="User not found")
    if not target.data:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent deleting super_admin
    if target.data.get("role") == "super_admin":
        raise HTTPException(
            status_code=403,
            detail="Cannot delete super admin account"
        )

    if user.get("role") == "admin" and target.data.get("role") != "clinician":
        raise HTTPException(
            status_code=403,
            detail="Admins can only delete clinician accounts"
        )

    target_email = target.data.get("email")
    target_name = target.data.get("full_name") or ""

    # patients/screenings reference profiles(clinician_id) with ON DELETE RESTRICT,
    # so delete the user's clinical rows first, otherwise the profile/auth delete fails.
    #
    # The recordings live on this host, not in the database, so they have to be
    # collected before the rows that point at them disappear -- the same reason
    # delete_patient does it. Without this, deleting an account left every take
    # it ever recorded on the disk with nothing referencing it.
    screenings = (
        supabase.table("screenings")
        .select("id,recording_paths,audio_file_path")
        .eq("clinician_id", user_id)
        .execute().data or []
    )
    audio_paths = []
    for s in screenings:
        audio_paths.extend(s.get("recording_paths") or [])
        if s.get("audio_file_path"):
            audio_paths.append(s["audio_file_path"])

    supabase.table("screenings").delete().eq("clinician_id", user_id).execute()
    supabase.table("patients").delete().eq("clinician_id", user_id).execute()

    supabase.auth.admin.delete_user(user_id)
    supabase.table("profiles").delete().eq("id", user_id).execute()
    # A deleted account must stop working on the next request, not whenever
    # the cached profile happens to expire.
    invalidate_profile(user_id)

    removed_files = _delete_audio_files(audio_paths)

    _log_audit("user_delete", user.get("sub"), None, "user", user_id, {
        "deleted_user": target_email,
        "screenings_removed": len(screenings),
        "audio_files_removed": removed_files,
    })

    # Sent after the delete, never before: "your account has been removed" must
    # not reach an inbox while the account still works. Fire and forget, so a
    # Resend outage cannot turn a successful delete into a 500 the admin would
    # read as "it did not work" -- the row is already gone either way. The
    # failure is logged, and the removed account cannot sign in regardless.
    if target_email:
        async def _notify_removed():
            try:
                await asyncio.to_thread(
                    send_account_deleted_email, target_email, target_name
                )
            except Exception as exc:
                print(f"[user_delete] removal email to {target_email} failed: {exc!r}")

        background_tasks.add_task(_notify_removed)

    return {
        "message": "User deleted",
        "audio_files_removed": removed_files,
    }


@router.get("/patients", response_model=List[PatientResponse])
async def list_patients(
    search: Optional[str] = None,
    clinic_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
    limit: int = 100,
    offset: int = 0
):
    role = user.get("role")
    user_clinic_id = user.get("clinic_id")
    # Both helpers apply pagination internally and return the executed response.
    # (Previously .range() was called on the already-executed view response,
    # which raised AttributeError and 500'd for roles that can read the view.)
    try:
        try:
            res = _fetch_patients_with_view(search, clinic_id, role, user.get("sub"), user_clinic_id, offset, limit)
        except Exception as e:
            print(f"[list_patients] view query failed, using table fallback: {e!r}")
            res = _fetch_patients_from_tables(search, clinic_id, role, user.get("sub"), user_clinic_id, offset, limit)
        return [PatientResponse(**p) for p in (res.data or [])]
    except HTTPException:
        raise
    except Exception as e:
        print(f"[list_patients] failed: {e!r}")
        raise HTTPException(status_code=500, detail="Failed to load patients")


def _fetch_patients_with_view(search, clinic_id, role, user_id, user_clinic_id, offset: int, limit: int):
    query = supabase.table("patient_list_view").select("*")
    query = _scope_patients(query, role, user_id, user_clinic_id, clinic_id)
    if search:
        query = query.ilike("full_name", f"%{search}%")
    return query.range(offset, offset + limit - 1).order("created_at", desc=True).execute()


def _fetch_patients_from_tables(search, clinic_id, role, user_id, user_clinic_id, offset: int, limit: int):
    """Fallback when patient_list_view doesn't exist — query base tables and join in Python."""
    query = supabase.table("patients").select("*")
    query = _scope_patients(query, role, user_id, user_clinic_id, clinic_id)
    if search:
        query = query.ilike("full_name", f"%{search}%")
    res = query.range(offset, offset + limit - 1).order("created_at", desc=True).execute()

    rows = res.data or []
    if not rows:
        return res

    # Fetch clinic and clinician names in batch
    clinic_ids = {r["clinic_id"] for r in rows if r.get("clinic_id")}
    clinician_ids = {r["clinician_id"] for r in rows if r.get("clinician_id")}

    clinics = {}
    patients_raw = {}
    if clinic_ids:
        try:
            c_res = supabase.table("clinics").select("id,name").in_("id", list(clinic_ids)).execute()
            clinics = {c["id"]: c["name"] for c in (c_res.data or [])}
        except Exception:
            pass

    if clinician_ids:
        try:
            p_res = supabase.table("profiles").select("id,full_name").in_("id", list(clinician_ids)).execute()
            patients_raw = {p["id"]: p for p in (p_res.data or [])}
        except Exception:
            pass

    enriched = []
    for r in rows:
        r["clinic_name"] = clinics.get(r.get("clinic_id"))
        r["clinician_name"] = patients_raw.get(r.get("clinician_id"), {}).get("full_name")
        r["age_bracket"] = _calc_age_bracket(r.get("date_of_birth"))
        enriched.append(r)
    res.data = enriched
    return res


@router.post("/patients", response_model=PatientResponse, status_code=201)
async def create_patient(patient: PatientCreate, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    role = user.get("role")
    # Clinicians act on their own behalf; admins/super-admins create on behalf of a
    # clinician when one is supplied in the body, otherwise fall back to themselves.
    if role == "clinician":
        clinician_id = user.get("sub")
    else:
        clinician_id = patient.clinician_id or user.get("sub")
    clinic_id = _resolve_clinic_id(patient.clinic_id or user.get("clinic_id"))
    if not clinic_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No clinic is configured; cannot create patient")

    data = patient.model_dump()
    data["clinician_id"] = clinician_id
    data["clinic_id"] = clinic_id

    try:
        res = supabase.table("patients").insert(data).execute()
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to create patient: {e}")
    if not res.data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create patient: no row returned")
    created = res.data[0]

    _log_audit("patient_create", user.get("sub"), clinic_id, "patient", created["id"], {"patient_name": patient.full_name})

    return PatientResponse(**created, clinic_name=None, clinician_name=None, age_bracket=None)


@router.get("/patients/{patient_id}", response_model=PatientResponse)
async def get_patient(patient_id: str, user: dict = Depends(get_current_user)):
    target = _row_by_id("patients", patient_id)
    if not target:
        raise HTTPException(status_code=404, detail="Patient not found")
    if not _may_touch_patient(target, user):
        # 404 rather than 403: the patient does not exist as far as this
        # clinician is concerned, and saying "forbidden" would confirm that
        # there is a patient with this id belonging to someone else.
        raise HTTPException(status_code=404, detail="Patient not found")

    res = supabase.table("patient_list_view").select("*").eq("id", patient_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Patient not found")
    # `.limit(1)` returns a LIST of rows, so the row is the first item. Using
    # `**res.data` spreads the list itself and raises "argument after ** must
    # be a mapping, not list", which is a 500 on the patient's record page.
    # `.single()` returns a dict and does not have this problem, which is
    # why the mistake is easy to miss -- two of the four places that read a
    # row this way use `.single()`, and the two that use `.limit(1)` were
    # broken.
    return PatientResponse(**res.data[0])


@router.patch("/patients/{patient_id}", response_model=PatientResponse)
async def update_patient(patient_id: str, update: PatientUpdate, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    role = user.get("role")
    user_id = user.get("sub")
    clinic_id = user.get("clinic_id")

    target = _row_by_id("patients", patient_id)
    if not target:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Super admins are exempt, matching delete_patient below. Without this a
    # super admin -- whose profile carries no clinic_id -- compares the
    # patient's clinic against None and is refused every time. The row menu now
    # offers Edit to every clinician, admin and super admin alike, so the
    # exemption is on a path users actually reach rather than a latent gap.
    #
    # A clinician may only edit a patient they created. An admin may edit any
    # patient in their clinic.
    if not _may_touch_patient(target, user):
        raise HTTPException(status_code=403, detail="You can only edit patients you created")

    update_data = update.model_dump(exclude_unset=True)
    if update_data:
        supabase.table("patients").update(update_data).eq("id", patient_id).execute()

    _log_audit("patient_update", user_id, clinic_id, "patient", patient_id, update_data)

    res = supabase.table("patient_list_view").select("*").eq("id", patient_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Patient not found")
    # The row is the first item -- `.limit(1)` returns a list. See the note
    # on `get_patient` above.
    return PatientResponse(**res.data[0])


def _delete_audio_files(paths) -> int:
    """Remove a screening's recordings from the backend host's disk.

    The audio files live on the Mini PC, not in the database, so deleting the
    row that points at them leaves the files behind. They are the largest
    thing the system stores -- a few megabytes per take -- so leaving them
    would grow the disk every time a screening is deleted.

    Returns how many files were removed.
    """
    removed = 0
    for p in paths or []:
        if not p:
            continue
        # Only ever touch a plain file name inside the upload directory.
        # The path comes from the database, but it is never trusted to point
        # anywhere else.
        name = os.path.basename(str(p))
        if not name or name in (".", ".."):
            continue
        full = os.path.join(UPLOAD_DIR, name)
        try:
            if os.path.isfile(full):
                os.remove(full)
                removed += 1
        except OSError:
            pass
    return removed


@router.delete("/patients/{patient_id}")
async def delete_patient(patient_id: str, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinic_id = user.get("clinic_id")
    target = _row_by_id("patients", patient_id)
    if not target:
        raise HTTPException(status_code=404, detail="Patient not found")
    if not _may_touch_patient(target, user):
        raise HTTPException(status_code=403, detail="You can only delete patients you created")

    # The recordings are collected before the delete, because the row that
    # points at them is about to go. Deleting the patient cascades to the
    # screenings in the database, but the audio files are on disk and need
    # clearing by hand.
    screenings = (
        supabase.table("screenings")
        .select("id,recording_paths,audio_file_path")
        .eq("patient_id", patient_id)
        .execute().data or []
    )
    audio_paths = []
    for s in screenings:
        audio_paths.extend(s.get("recording_paths") or [])
        if s.get("audio_file_path"):
            audio_paths.append(s["audio_file_path"])

    supabase.table("patients").delete().eq("id", patient_id).execute()

    removed_files = _delete_audio_files(audio_paths)

    _log_audit("patient_delete", user.get("sub"), clinic_id, "patient", patient_id, {
        "patient_name": target.get("full_name"),
        "screenings_removed": len(screenings),
        "audio_files_removed": removed_files,
    })

    return {"message": "Patient deleted"}


@router.delete("/screenings/{screening_id}")
async def delete_screening(screening_id: str, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    """Delete one screening, leaving the patient and their other screenings.

    A patient can be screened as many times as clinically needed, and
    sometimes one of those readings is not wanted -- the stethoscope slipped,
    the room was too noisy, the take was taken at the wrong site. Removing that
    one reading is different from removing the patient, and this is the
    difference: the patient stays, their other screenings stay, and the
    numbering of what remains closes up.
    """
    target = _row_by_id(
        "screenings", screening_id,
        "id,patient_id,clinic_id,clinician_id,recording_paths,audio_file_path,respiratory_result",
    )
    if not target:
        raise HTTPException(status_code=404, detail="Screening not found")

    role = user.get("role")
    if role == "super_admin":
        pass
    elif role == "admin":
        if target.get("clinic_id") != user.get("clinic_id"):
            raise HTTPException(status_code=403, detail="Not your clinic screening")
    else:
        # A clinician may delete their own screening. A colleague's is not
        # theirs to remove, even in the same clinic.
        if target.get("clinician_id") != user.get("sub"):
            raise HTTPException(status_code=403, detail="You can only delete your own screenings")

    audio_paths = list(target.get("recording_paths") or [])
    if target.get("audio_file_path"):
        audio_paths.append(target["audio_file_path"])

    supabase.table("screenings").delete().eq("id", screening_id).execute()
    removed_files = _delete_audio_files(audio_paths)

    _log_audit("screening_delete", user.get("sub"), user.get("clinic_id"), "screening", screening_id, {
        "patient_id": target.get("patient_id"),
        "respiratory_result": target.get("respiratory_result"),
        "audio_files_removed": removed_files,
    })

    return {
        "message": "Screening deleted",
        "audio_files_removed": removed_files,
    }


@router.post("/screenings", response_model=ScreeningResponse)
async def create_screening(
    screening: ScreeningCreate,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN)),
):
    clinician_id = user.get("sub")
    clinic_id = _resolve_clinic_id(user.get("clinic_id"))
    if not clinic_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No clinic is configured; cannot create screening")

    patient = _row_by_id("patients", screening.patient_id)
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    if not screening.audio_file_paths:
        raise HTTPException(
            status_code=400,
            detail="At least one recording is required. Upload via /api/audio/upload first.",
        )
    if len(screening.audio_file_paths) > MAX_RECORDINGS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many recordings: {len(screening.audio_file_paths)}. Maximum is {MAX_RECORDINGS}.",
        )

    # The row is written BEFORE the inference runs, with the status
    # 'analysing', so the client has something to poll and the screening is
    # visible in the list while it is still going.
    #
    # This is what lets a clinician leave the page. The inference used to hold
    # the POST open for the whole run -- up to two and a half minutes -- and
    # anyone who navigated away during it never saw the result, and could
    # easily re-record and create a second screening from the same takes.
    #
    # `model_version` is NOT NULL, so it needs a value before the inference has
    # reported one. The heartbeat row carries the version the inference service
    # last reported, which is the same figure within a minute; the background
    # task overwrites it with the exact value the run returned.
    model_version = "pending"
    try:
        # limit(1) rather than maybeSingle(), which does not exist in this
        # version of postgrest-py -- the AttributeError it raised was caught by
        # the except below, so the cached version was never actually read and
        # every screening was written as "pending".
        cached = (
            supabase.table("service_status")
            .select("inference_version")
            .eq("id", True)
            .limit(1)
            .execute()
            .data
        )
        if cached and cached[0] and cached[0].get("inference_version"):
            model_version = cached[0]["inference_version"]
    except Exception:
        pass

    row = {
        "patient_id": screening.patient_id,
        "clinic_id": clinic_id,
        "clinician_id": clinician_id,
        # Canonical take for the row; the full batch lives in recording_paths.
        "audio_file_path": screening.audio_file_paths[0],
        "audio_duration_sec": screening.audio_duration_sec,
        "recording_paths": screening.audio_file_paths,
        # The result columns stay NULL until the background task fills them.
        "respiratory_result": None,
        "respiratory_confidence": None,
        "respiratory_probabilities": None,
        "recording_scores": None,
        "cascade_path": "mean_then_safety_override",
        "model_version": model_version,
        "status": "analysing",
    }

    created = None
    try:
        res = supabase.table("screenings").insert(row).execute()
        created = res.data[0]
    except Exception as exc:
        # The 'analysing' status is not allowed by the column's CHECK
        # constraint until 20261021120000_add_analysing_status.sql has been
        # applied. The insert is refused atomically, so nothing is left behind.
        #
        # Rather than making the deployment order a hazard, fall back to
        # analysing BEFORE the insert. That is the old behaviour: correct, and
        # still blocking, but nothing breaks in the window between the backend
        # going out and the migration being run. The new behaviour switches
        # itself on the moment the migration lands, with no further deploy.
        if "23514" not in str(exc):
            raise
        created = None

    if created is None:
        return await _create_screening_blocking(row, screening, patient, clinician_id, clinic_id)

    screening_id = created["id"]

    # Runs after the response has been sent, on the same event loop. The
    # inference is an awaited HTTP call to the Mini PC, so the loop is free
    # while it waits and the client's poll is served normally.
    background_tasks.add_task(
        _analyse_screening,
        screening_id,
        screening.audio_file_paths,
        screening.audio_duration_sec,
    )

    _log_audit("screening_create", clinician_id, clinic_id, "screening", screening_id, {
        "patient_id": screening.patient_id,
        "recordings": len(screening.audio_file_paths),
        "status": "analysing",
    })

    return ScreeningResponse(**created, patient_name=patient.get("full_name"), clinic_name=None, clinician_name=None, reviewed_by_name=None)


async def _create_screening_blocking(row: dict, screening: ScreeningCreate, patient: dict, clinician_id: str, clinic_id: str):
    """Create a screening by analysing it before the row is written.

    The fallback for a database that does not yet allow the 'analysing' status.
    It behaves the way the system always did -- the POST stays open for the
    length of the analysis -- which is why it is only used when the background
    path is not available.
    """
    inference_res = await run_inference(screening.audio_file_paths, screening.audio_duration_sec)

    fused = inference_res.get("respiratory_result") or {}
    fusion = inference_res.get("fusion") or {}
    interp = fused.get("interpretation") or {}

    data = {
        **row,
        "recording_scores": {
            "per_clip": inference_res.get("per_clip", []),
            "fusion": fusion,
        },
        "respiratory_result": fused.get("label"),
        "respiratory_confidence": fused.get("confidence"),
        "respiratory_probabilities": fused.get("probabilities"),
        "cascade_path": fusion.get("method") or "mean_then_safety_override",
        "interpretation_status": interp.get("status"),
        "confidence_level": interp.get("confidence_level"),
        "recommendation_code": (
            f"{interp['status']}_{interp['confidence_level']}"
            if interp.get("status") and interp.get("confidence_level")
            else None
        ),
        "decision_rule": interp.get("decision_rule"),
        "decision_detail": interp.get("decision_detail"),
        "band_metric": interp.get("band_metric"),
        "band_position": interp.get("band_position"),
        "low_agreement": interp.get("low_agreement"),
        "recordings_total": interp.get("recordings_total"),
        "recordings_flagged": interp.get("recordings_flagged"),
        "model_version": inference_res.get("model_version") or "unknown",
        "status": "completed",
    }

    res = supabase.table("screenings").insert(data).execute()
    created = res.data[0]

    _log_audit("screening_create", clinician_id, clinic_id, "screening", created["id"], {
        "patient_id": screening.patient_id,
        "recordings": len(screening.audio_file_paths),
        "respiratory_result": data["respiratory_result"],
        "override_applied": fusion.get("override_applied"),
    })

    return ScreeningResponse(**created, patient_name=patient.get("full_name"), clinic_name=None, clinician_name=None, reviewed_by_name=None)


async def _analyse_screening(screening_id: str, audio_file_paths: List[str], audio_duration_sec: Optional[float]) -> None:
    """Run the inference for a screening and write the result onto its row.

    Runs as a background task, so it must never raise. An exception here would
    be swallowed by the task machinery and the row would sit in 'analysing' for
    ever, which reads to a clinician as "still working" when it is actually
    broken. Every failure is therefore caught and written to the row as the
    'error' status, with the reason kept in the audit log.
    """
    try:
        inference_res = await run_inference(audio_file_paths, audio_duration_sec)
    except Exception as exc:
        _log_audit("screening_error", None, None, "screening", screening_id, {
            "error": str(exc)[:500],
        })
        supabase.table("screenings").update({
            "status": "error",
        }).eq("id", screening_id).execute()
        return

    try:
        fused = inference_res.get("respiratory_result") or {}
        fusion = inference_res.get("fusion") or {}
        # Produced by inference_service.interpret_fusion. Every field is
        # optional at the storage layer so a screening recorded against an
        # older model (or an inference service that predates the
        # interpretation layer) still saves.
        interp = fused.get("interpretation") or {}

        update = {
            "recording_scores": {
                "per_clip": inference_res.get("per_clip", []),
                "fusion": fusion,
            },
            "respiratory_result": fused.get("label"),
            "respiratory_confidence": fused.get("confidence"),
            "respiratory_probabilities": fused.get("probabilities"),
            "cascade_path": fusion.get("method") or "mean_then_safety_override",
            # `recommendation_code` is a key into shared/clinical_copy.json
            # rather than prose, so rewording a clinician-facing message never
            # needs a migration.
            "interpretation_status": interp.get("status"),
            "confidence_level": interp.get("confidence_level"),
            "recommendation_code": (
                f"{interp['status']}_{interp['confidence_level']}"
                if interp.get("status") and interp.get("confidence_level")
                else None
            ),
            "decision_rule": interp.get("decision_rule"),
            "decision_detail": interp.get("decision_detail"),
            "band_metric": interp.get("band_metric"),
            "band_position": interp.get("band_position"),
            "low_agreement": interp.get("low_agreement"),
            "recordings_total": interp.get("recordings_total"),
            "recordings_flagged": interp.get("recordings_flagged"),
            "model_version": inference_res.get("model_version") or "unknown",
            "status": "completed",
        }
        supabase.table("screenings").update(update).eq("id", screening_id).execute()

        _log_audit("screening_analyse", None, None, "screening", screening_id, {
            "respiratory_result": update["respiratory_result"],
            "override_applied": fusion.get("override_applied"),
        })
    except Exception as exc:
        _log_audit("screening_error", None, None, "screening", screening_id, {
            "error": str(exc)[:500],
        })
        supabase.table("screenings").update({"status": "error"}).eq("id", screening_id).execute()


async def run_inference(audio_file_paths: List[str], audio_duration_sec: Optional[float]) -> dict:
    """Fan the batch of takes out to the inference service and return the fused verdict."""
    headers = {}
    if settings.inference_api_key:
        headers["X-API-Key"] = settings.inference_api_key
    # The shared client defaults to a 150s timeout, which covers the worst-case
    # 5-take batch on the Mini PC's CPU. This is the slowest call in the system
    # and it sits on the critical path of a screening submission, so it keeps a
    # warm connection to the inference service rather than rebuilding a client
    # (and its TLS context) per screening.
    client = get_client()
    opened = []
    try:
        files = []
        for path in audio_file_paths:
            handle = open(path, "rb")
            opened.append(handle)
            files.append(("audios", (os.path.basename(path), handle, "audio/wav")))
        r = await client.post(
            f"{settings.inference_service_url}/api/inference",
            files=files,
            headers=headers,
        )
    finally:
        for handle in opened:
            handle.close()
    if r.status_code >= 400:
        detail = None
        try:
            detail = r.json().get("detail")
        except Exception:
            pass
        raise HTTPException(
            status_code=502,
            detail=f"Inference service error ({r.status_code}): {detail or r.text[:200]}",
        )
    return r.json()


def _enrich_screening(s):
    """Add joined field names to a screening row (fallback when screening_history_view is missing)."""
    s = dict(s)
    s["patient_name"] = None
    s["patient_dob"] = None
    s["patient_gender"] = None
    s["age_bracket"] = None
    s["clinic_name"] = None
    s["clinician_name"] = None
    s["reviewed_by_name"] = None
    s["reviewed_by"] = s.get("reviewed_by")
    s["reviewed_at"] = s.get("reviewed_at")
    s["review_notes"] = s.get("review_notes")

    # best-effort enrichment
    sid = s.get("patient_id")
    cid = s.get("clinic_id")
    clin_id = s.get("clinician_id")
    rev_id = s.get("reviewed_by")

    # The patient lives in `patients`, NOT `profiles`.
    #
    # This looked up `profiles` by patient_id, and a patients row id is not a
    # profiles row id, so the lookup silently missed every time and the UI fell
    # back to "Anonymous Screening" for a patient whose name was sitting in the
    # table the whole time. The miss was invisible because the query succeeded --
    # it just returned no matching row, which is not an error to raise on.
    #
    # dob and gender come along for the ride, because the result page reads
    # patient_dob to compute the age and patient_gender to display it. Neither
    # was ever populated here, so the age rendered from an undefined date and
    # the gender rendered blank.
    if sid:
        try:
            p = (
                supabase.table("patients")
                .select(
                    "id,full_name,date_of_birth,gender,pack_years,"
                    "past_respiratory_diseases,symptoms"
                )
                .eq("id", sid)
                .single()
                .execute()
                .data
            )
            if p:
                s["patient_name"] = p.get("full_name")
                s["patient_dob"] = p.get("date_of_birth")
                s["patient_gender"] = p.get("gender")
                s["age_bracket"] = _calc_age_bracket(p.get("date_of_birth"))
                # The patient's own notes, for the result page.
                s["pack_years"] = p.get("pack_years")
                s["past_respiratory_diseases"] = p.get("past_respiratory_diseases") or []
                s["symptoms"] = p.get("symptoms") or []
        except Exception:
            pass

    prof_ids = [x for x in [clin_id, rev_id] if x]
    if prof_ids:
        try:
            profs = supabase.table("profiles").select("id,full_name").in_("id", prof_ids).execute()
            pmap = {p["id"]: p["full_name"] for p in (profs.data or [])}
            s["clinician_name"] = pmap.get(clin_id)
            s["reviewed_by_name"] = pmap.get(rev_id)
        except Exception:
            pass

    if cid:
        try:
            c = supabase.table("clinics").select("name").eq("id", cid).single().execute()
            if c.data:
                s["clinic_name"] = c.data.get("name")
        except Exception:
            pass
    return s


def _enrich_screenings(rows: list) -> list:
    """Add the joined names to many screenings at once.

    `_enrich_screening` does three queries for one row: the patient, the
    people, the clinic. Called in a loop that is three queries per screening,
    and every one of them is a round trip to the hosted database -- about
    130ms each from this machine. A list of fifty screenings spent fifteen
    seconds in lookups before it had anything to show.

    The same three lookups do not need repeating per row: the same patient
    appears in several screenings, the same clinician signs off on all of
    them, and there is one clinic. So the ids are collected and looked up
    once each.

    It is only used where the view is unavailable. The view already carries
    the joined names, and the normal path reads it directly.
    """
    rows = [dict(r) for r in (rows or [])]
    if not rows:
        return []

    for s in rows:
        s.setdefault("patient_name", None)
        s.setdefault("patient_dob", None)
        s.setdefault("patient_gender", None)
        s.setdefault("age_bracket", None)
        s.setdefault("clinic_name", None)
        s.setdefault("clinician_name", None)
        s.setdefault("reviewed_by_name", None)
        s.setdefault("reviewed_by", None)
        s.setdefault("reviewed_at", None)
        s.setdefault("review_notes", None)

    patient_ids = {r.get("patient_id") for r in rows if r.get("patient_id")}
    profile_ids = {
        x
        for r in rows
        for x in (r.get("clinician_id"), r.get("reviewed_by"))
        if x
    }
    clinic_ids = {r.get("clinic_id") for r in rows if r.get("clinic_id")}

    patients = {}
    if patient_ids:
        try:
            res = supabase.table("patients").select(
                "id,full_name,date_of_birth,gender"
            ).in_("id", list(patient_ids)).execute()
            patients = {p["id"]: p for p in (res.data or [])}
        except Exception:
            patients = {}

    people = {}
    if profile_ids:
        try:
            res = supabase.table("profiles").select("id,full_name").in_(
                "id", list(profile_ids)
            ).execute()
            people = {p["id"]: p.get("full_name") for p in (res.data or [])}
        except Exception:
            people = {}

    clinics = {}
    if clinic_ids:
        try:
            res = supabase.table("clinics").select("id,name").in_(
                "id", list(clinic_ids)
            ).execute()
            clinics = {c["id"]: c.get("name") for c in (res.data or [])}
        except Exception:
            clinics = {}

    for s in rows:
        p = patients.get(s.get("patient_id"))
        if p:
            s["patient_name"] = p.get("full_name")
            s["patient_dob"] = p.get("date_of_birth")
            s["patient_gender"] = p.get("gender")
            s["age_bracket"] = _calc_age_bracket(p.get("date_of_birth"))
        s["clinician_name"] = people.get(s.get("clinician_id"))
        s["reviewed_by_name"] = people.get(s.get("reviewed_by"))
        s["clinic_name"] = clinics.get(s.get("clinic_id"))
    return rows


def _attach_patient_history(row: dict) -> dict:
    """Add the patient's own clinical notes to a screening row.

    The screening history view carries the patient's name, age and sex, but
    not the history the clinician typed in: smoking, past respiratory
    diseases, current symptoms. Those live on the patient row.

    The result page shows them beside the result, because a verdict means
    something different depending on what the patient brought in with them.

    One extra query, for one screening. The result page is a single
    screening, so this is a single row.
    """
    row = dict(row)
    patient_id = row.get("patient_id")
    if not patient_id:
        return row
    try:
        found = (
            supabase.table("patients")
            .select("pack_years,past_respiratory_diseases,symptoms")
            .eq("id", patient_id)
            .limit(1)
            .execute()
        ).data or []
    except Exception as e:
        print(f"[patient history] lookup failed: {e!r}")
        return row
    if not found:
        return row
    p = found[0]
    row["pack_years"] = p.get("pack_years")
    row["past_respiratory_diseases"] = p.get("past_respiratory_diseases") or []
    row["symptoms"] = p.get("symptoms") or []
    return row


def _screening_row(row: dict) -> ScreeningResponse:
    """Build a ScreeningResponse from a screening_history_view row.

    The routes used to hand-maintain an explicit PostgREST column list, which
    had quietly drifted from ScreeningResponse: six required fields
    (clinic_id, clinician_id, audio_file_path, respiratory_probabilities,
    reviewed_by, updated_at) were never selected. Pydantic then rejected every
    row, the `except` fell through to the base-table fallback, and
    _enrich_screening looked the patient up in `profiles` using a `patients`
    table id -- a lookup that can never match. The result was that every
    screening in the product displayed as "Anonymous Screening" with no date of
    birth, from data that was present and correct the whole time.

    A required field being absent failed *silently* because the fallback was
    written to be quiet. Selecting the view wholesale removes the drift: the
    view is a superset of the model, so new fields arrive by default instead of
    needing a second commit that nobody remembers to make.

    The two renames are the remaining half of the same bug. The view exposes the
    patient's date of birth and sex as `date_of_birth` and `gender`, while the
    model and the UI both call them `patient_dob` and `patient_gender`. Since
    the model marks both Optional with a None default, pydantic cannot tell a
    renamed field from a missing one -- it silently accepted the row and the
    page rendered a blank gender and an age computed from an undefined date.
    Alias them here rather than in the query, because PostgREST cannot rename a
    column inside a `*` selection.
    """
    row = dict(row)
    if row.get("patient_dob") is None and row.get("date_of_birth") is not None:
        row["patient_dob"] = row["date_of_birth"]
    if row.get("patient_gender") is None and row.get("gender") is not None:
        row["patient_gender"] = row["gender"]
    return ScreeningResponse(**_normalise_classification(row))


def _normalise_classification(data: dict) -> dict:
    """Make the reported class agree with the reported probabilities.

    `respiratory_result` and `respiratory_confidence` are a cached copy of the
    answer that the probability vector already contains. Deriving them from
    that vector rather than trusting the cache means a screening can never
    report one class while showing another as the most likely -- which is
    exactly what happened: a screening with a healthy mean of 0.60 was
    reported as COPD while its own probability table read Healthy 60.0%, and
    the banner, the badge and the confidence meter each told a different story.

    The safety override is the exception and is respected. A single strongly
    positive recording wins regardless of the mean, so there the mean can
    legitimately point the other way. Re-deriving it here would hide the
    override, which is the one thing that must never be hidden.

    Doing this on read also repairs rows written before the fusion was fixed,
    without waiting for a migration and without a second copy of the rule.
    """
    data = dict(data)
    probs = data.get("respiratory_probabilities") or {}
    if not probs:
        return data
    fusion = (data.get("recording_scores") or {}).get("fusion") or {}
    if fusion.get("override_applied"):
        return data
    label, prob = max(probs.items(), key=lambda kv: kv[1])
    data["respiratory_result"] = label
    data["respiratory_confidence"] = prob
    return data


@router.get("/screenings", response_model=List[ScreeningResponse])
async def list_screenings(
    patient_id: Optional[str] = None,
    respiratory_result: Optional[str] = None,
    user: dict = Depends(get_current_user),
    limit: int = 100,
    offset: int = 0
):
    role = user.get("role")
    clinic_id = user.get("clinic_id")
    user_id = user.get("sub")

    try:
        query = supabase.table("screening_history_view").select("*")
        if role == "clinician":
            query = query.eq("clinician_id", user_id)
        elif role != "super_admin":
            query = query.eq("clinic_id", clinic_id)
        if patient_id:
            query = query.eq("patient_id", patient_id)
        if respiratory_result:
            query = query.eq("respiratory_result", respiratory_result)
        query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
        res = query.execute()
        return [_screening_row(s) for s in (res.data or [])]
    except Exception as e:
        # View missing/unreadable -> fall back to the base table.  This block is
        # NOT allowed to raise unhandled: a 500 here would leave the response
        # without CORS headers.
        print(f"[list_screenings] view query failed, using table fallback: {e!r}")
    try:
        query = supabase.table("screenings").select("*")
        if role == "clinician":
            query = query.eq("clinician_id", user_id)
        elif role != "super_admin":
            query = query.eq("clinic_id", clinic_id)
        if patient_id:
            query = query.eq("patient_id", patient_id)
        if respiratory_result:
            query = query.eq("respiratory_result", respiratory_result)
        query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
        res = query.execute()
        return [_screening_row(s) for s in _enrich_screenings(res.data or [])]
    except HTTPException:
        raise
    except Exception as e:
        print(f"[list_screenings] fallback failed: {e!r}")
        raise HTTPException(status_code=500, detail="Failed to load screenings")


@router.get("/screenings/{screening_id}", response_model=ScreeningResponse)
async def get_screening(screening_id: str, user: dict = Depends(get_current_user)):
    role = user.get("role")
    clinic_id = user.get("clinic_id")
    user_id = user.get("sub")

    def scoped(query):
        """The ownership rules, as a filter on the query.

        A clinician reaches their own screenings, an admin their clinic's, and
        the super admin all of them. Without this a clinician could read a
        colleague's screening by id, even though that colleague's patients
        are invisible to them.
        """
        if role == "clinician":
            return query.eq("clinician_id", user_id)
        if role != "super_admin":
            return query.eq("clinic_id", clinic_id)
        return query

    # `.single()` raises when the ownership filter excludes the row -- which
    # is what happens when a clinician asks for someone else's screening. The
    # raise was caught by the bare `except Exception` below, the fallback ran,
    # it raised the same way, and nothing caught that second one. So "not
    # yours" was a 500 rather than the 404 it should be.
    #
    # `limit(1)` returns a list, and an empty list is a missing record.
    try:
        row = _first_row(
            scoped(supabase.table("screening_history_view").select("*").eq("id", screening_id))
        )
        if row:
            # The patient's own notes, for the result page.
            return _screening_row(_attach_patient_history(row))
    except Exception as e:
        print(f"[get_screening] view query failed: {e!r}")

    # Fallback: use base screenings table
    row = _first_row(
        scoped(supabase.table("screenings").select("*").eq("id", screening_id))
    )
    if not row:
        raise HTTPException(status_code=404, detail="Screening not found")
    return ScreeningResponse(**_enrich_screening(row))


@router.patch("/screenings/{screening_id}/review", response_model=ScreeningResponse)
async def review_screening(screening_id: str, review: ScreeningReview, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    role = user.get("role")
    user_id = user.get("sub")
    clinic_id = user.get("clinic_id")

    # `.single()` raises when there is no such screening, which made a wrong
    # id a 500. A missing record is a 404.
    target_row = _first_row(supabase.table("screenings").select("*").eq("id", screening_id))
    if not target_row:
        raise HTTPException(status_code=404, detail="Screening not found")

    # Same rule as the patients: a clinician reaches their own screenings, an
    # admin reaches their clinic's, and the super admin reaches all. Without
    # this a clinician could review a colleague's screening by id, even
    # though that colleague's patients are invisible to them.
    if role == "super_admin":
        pass
    elif role == "admin":
        if target_row["clinic_id"] != clinic_id:
            raise HTTPException(status_code=403, detail="Not your clinic screening")
    else:
        if target_row["clinician_id"] != user_id:
            raise HTTPException(status_code=403, detail="You can only review your own screenings")

    update_data = {
        "reviewed_by": user_id,
        "reviewed_at": datetime.utcnow().isoformat(),
        "status": "completed"
    }
    if review.review_notes:
        update_data["review_notes"] = review.review_notes

    supabase.table("screenings").update(update_data).eq("id", screening_id).execute()

    _log_audit("screening_review", user_id, clinic_id, "screening", screening_id, {"review_notes": review.review_notes})

    res = supabase.table("screening_history_view").select("*").eq("id", screening_id).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Screening not found")
    return ScreeningResponse(**res.data[0])


@router.get("/metrics/summary", response_model=MetricsSummary)
async def metrics_summary(user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinic_id = user.get("clinic_id")
    try:
        # The screenings that are on record, not the ones that were ever made.
        #
        # This counted the audit log, and every screening leaves a
        # `screening_create` entry there that is never removed -- so the
        # number was every screening the clinic had ever created, including
        # the ones that had been deleted. A clinic with four screenings on
        # record showed "29", and the number climbed for as long as the
        # system was used.
        #
        # The card is labelled "Total Screenings" and sits next to "Registered
        # Users", so it has to mean the same thing as the list it counts: what
        # is there now.
        query = supabase.table("screenings").select("id", count="exact")
        if user.get("role") != "super_admin" and clinic_id:
            query = query.eq("clinic_id", clinic_id)
        res = query.execute()
        total = res.count if res.count is not None else len(res.data or [])
    except Exception:
        total = 0
    return MetricsSummary(total_requests=total, avg_ms=None, error_rate=0.0)


def _report_styles():
    """Paragraph styles for the report. Kept in one place so every page of a
    combined export is typeset identically to a single-screening PDF."""
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle('CustomTitle', parent=styles['Title'], fontSize=16,
                                spaceAfter=2, alignment=TA_CENTER),
        "subtitle": ParagraphStyle('Subtitle', parent=styles['Normal'], fontSize=10,
                                   textColor=colors.grey, alignment=TA_CENTER,
                                   spaceAfter=10),
        "heading": ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=12,
                                  spaceAfter=5, spaceBefore=10,
                                  textColor=colors.HexColor('#1f2937')),
        "subheading": ParagraphStyle('Subheading', parent=styles['Heading3'],
                                     fontSize=10.5, spaceAfter=3, spaceBefore=8,
                                     textColor=colors.HexColor('#374151')),
        "normal": ParagraphStyle('Normal', parent=styles['Normal'], fontSize=10,
                                 spaceAfter=2),
        "body": ParagraphStyle('Body', parent=styles['BodyText'], fontSize=10,
                               leading=15, spaceAfter=6),
        "bold": ParagraphStyle('Bold', parent=styles['Normal'], fontSize=10,
                               fontName='Helvetica-Bold'),
        "small": ParagraphStyle('Small', parent=styles['Normal'], fontSize=8,
                                textColor=colors.grey),
    }


# Shared cell styling for every two-column key/value table in the report.
_CELL = [
    ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
    ('FONTSIZE', (0, 0), (-1, -1), 9),
    ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
    ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
    ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1f2937')),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
    ('BACKGROUND', (0, 0), (-1, -1), colors.white),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 4),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
]

_RESULT_COLOR = {
    "HEALTHY": colors.HexColor('#16a34a'),
    "COPD": colors.HexColor('#ca8a04'),
    "PNEUMONIA": colors.HexColor('#dc2626'),
    "ATYPICAL_OOD": colors.HexColor('#4b5563'),
}


def _cell(text, bold: bool = False):
    """A table cell.

    Paragraph rather than a bare string. ReportLab only auto-converts cells to
    paragraphs in some paths; as soon as a table carries per-column styling or
    `&mdash;`-style entities it hands the value straight to wrapOn(), and a str
    has no wrapOn. Building every cell explicitly also lets the label columns
    be bold without a second table style.
    """
    return Paragraph(
        str(text),
        ParagraphStyle(
            f'cell{"B" if bold else ""}',
            fontName="Helvetica-Bold" if bold else "Helvetica",
            fontSize=9,
            leading=11,
            textColor=colors.HexColor('#1f2937'),
        ),
    )


def _kv_table(rows):
    """Two label/value pairs per row. Labels are the even-indexed columns."""
    cells = [
        [_cell(v, bold=(i % 2 == 0)) for i, v in enumerate(row)]
        for row in rows
    ]
    t = Table(cells, colWidths=[1.15 * inch, 2.35 * inch, 1.15 * inch, 2.35 * inch])
    t.setStyle(TableStyle(_CELL))
    return t


def _age_years(dob) -> str:
    """Age in whole years from a date of birth, or "N/A"."""
    if not dob:
        return "N/A"
    try:
        b = datetime.fromisoformat(str(dob).replace("Z", "+00:00"))
        today = datetime.utcnow()
        years = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
        return f"{years} years" if 0 <= years < 130 else "N/A"
    except Exception:
        return "N/A"


def _one_page_story(data: dict, screening_id: str, page_no: int, page_total: int, S: dict):
    """Everything about one screening, sized to sit on exactly one A4 page.

    The verbose single-screening report ran to two or three pages. That is fine
    for a PDF opened on its own but wrong for a combined export: the request was
    for each patient's details and result on one page, and a report that spills
    means half the pages start mid-table with no heading to attach to.

    So this drops the redundant sections rather than shrinking the type. The
    patient table folds screening details into itself, the probability
    distribution becomes a single row instead of its own table, and per-take
    scores are capped. Nothing is scaled below 8pt, which is the point -- a
    combined file that is unreadable defeats its own purpose.

    The scope disclaimer is last and is never conditional. It is the statement
    of what the model can and cannot rule out, and a report without it invites
    "not COPD and not pneumonia" being read as "nothing is wrong".
    """
    story = []

    # --- Header -------------------------------------------------------------
    name = data.get("patient_name") or "Unnamed patient"
    story.append(Paragraph("AURA-Dx &mdash; AI-Assisted Respiratory Screening Report", S["title"]))

    # Which screening this is, for the patient. A patient can be screened as
    # many times as clinically needed, so "Screening 2 of 3" says which
    # reading this is and how many there are -- which the raw id never did.
    screening_number = data.get("screening_number")
    screening_count = data.get("patient_screening_count")
    if screening_number and screening_count:
        which = f"Screening {screening_number} of {screening_count}"
    else:
        # Before the numbering migration, or for a row that predates it.
        which = f"Screening {screening_id[:8]}"
    screening_date = str(data.get("created_at") or "")[:10]
    story.append(Paragraph(
        f"{name} &nbsp;&middot;&nbsp; {which}"
        + (f" &nbsp;&middot;&nbsp; {screening_date}" if screening_date else "")
        + f" &nbsp;&middot;&nbsp; Page {page_no} of {page_total}",
        S["subtitle"]))

    # --- Result headline ----------------------------------------------------
    interp_status = data.get("interpretation_status")
    interp_level = data.get("confidence_level")
    resp_result = data.get("respiratory_result")
    resp_conf = data.get("respiratory_confidence")

    verdict = status_label(interp_status) if (interp_status and interp_level) else (resp_result or "Not classified")
    vcolor = _RESULT_COLOR.get(
        interp_status,
        {"Pneumonia": colors.HexColor('#dc2626'),
         "COPD": colors.HexColor('#ca8a04'),
         "Healthy": colors.HexColor('#16a34a')}.get(resp_result, colors.HexColor('#6b7280')),
    )
    confidence = confidence_label(interp_level) if (interp_status and interp_level) else "—"
    story.append(Paragraph(
        f"<b>{verdict}</b> &nbsp;&middot;&nbsp; {confidence}"
        + (f" &nbsp;&middot;&nbsp; {resp_conf * 100:.1f}% model confidence" if resp_conf else ""),
        # leading is set explicitly and must stay above the font size.
        #
        # ParagraphStyle inherits every attribute from its parent, and the
        # parent here is "small", which inherits leading 12 from ReportLab's
        # built-in Normal style. Overriding fontSize to 15 did not bring a
        # matching leading with it, so the verdict was drawn as 15pt glyphs in
        # a 12pt line box and the ascent was clipped off the top of the line.
        # The text was in the file and a text search found it, but nothing was
        # visible on the page -- which is why the result heading looked like
        # it had been left out.
        ParagraphStyle('RPVerdict', parent=S["small"], fontSize=15, leading=19,
                       textColor=vcolor, spaceAfter=2)))

    # --- Patient + screening details, one table -----------------------------
    #
    # The acquisition details sit in this table rather than in a section of
    # their own. The longer report had a separate "Acquisition" block with its
    # own heading, which cost more vertical space than the two facts in it
    # were worth and pushed the document onto a second page.
    cascade = data.get("cascade_path") or ""
    scores = data.get("recording_scores") or {}
    per_clip = scores.get("per_clip") or []
    recording_paths = data.get("recording_paths") or []
    take_count = len(recording_paths) or len(per_clip)
    fusion = scores.get("fusion") or {}
    # "mean_then_safety_override" means nothing to a clinician reading a
    # report, so it is spelled out.
    fusion_label = {
        "mean_then_safety_override": "Mean of takes, with single-take safety override",
    }.get(cascade, cascade or "not recorded")
    safety_override = (
        f"Applied (take {(fusion.get('override_triggered_by_clip') or 0) + 1})"
        if fusion.get("override_applied") else "Not applied"
    )

    story.append(_kv_table([
        ["Patient", name, "Age", _age_years(data.get("patient_dob"))],
        ["Date of Birth", str(data.get("patient_dob") or "N/A"), "Gender",
         str(data.get("patient_gender") or "N/A").capitalize()],
        ["Clinician", str(data.get("clinician_name") or "N/A"), "Date",
         str(data.get("created_at") or "N/A")[:19].replace("T", " ")],
        ["Model", str(data.get("model_version") or "N/A"), "Audio",
         f"{data['audio_duration_sec']}s" if data.get("audio_duration_sec") else "N/A"],
        ["Takes recorded", str(take_count) if take_count else "not recorded",
         "Fusion method", fusion_label],
        ["Safety override", safety_override, "Status",
         # The raw status is a lower-case code ("completed"), which reads as a
         # value that slipped through rather than as a status. The screen
         # upper-cases it for the same reason.
         str(data.get("status") or "N/A").upper()],
    ]))

    # --- Interpretation -----------------------------------------------------
    #
    # The narrative interpretation -- the headline, the explanation and the
    # suggested next step -- is not printed. It restates the result in prose
    # that the tables below already carry in numbers, and on a report that
    # goes to a referring clinician the numbers and the evidence behind them
    # are what is wanted.
    #
    # The scope disclaimer at the foot of the page is NOT part of that
    # narrative and is deliberately kept. It is the statement of what this
    # model can and cannot rule out, and a report that says "healthy" without
    # it invites a reader to treat the absence of COPD and pneumonia as
    # "nothing is wrong" -- the single most dangerous misreading this report
    # could produce. Do not fold it into the removed block.

    # --- Probability distribution, one row ---------------------------------
    probs = data.get("respiratory_probabilities") or {}
    if probs:
        items = list(probs.items())
        # A4 minus 42pt margins is ~7.1in. The label column takes a fixed slice
        # and the classes share what is left, so adding a class never pushes the
        # table off the page.
        avail = 7.1 - 1.15
        each = avail / max(len(items), 1)
        row = [_cell("Probabilities", bold=True)] + [
            _cell(f"{cls} {prob * 100:.1f}%") for cls, prob in items
        ]
        t = Table([row], colWidths=[1.15 * inch] + [each * inch] * len(items))
        t.setStyle(TableStyle([
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(Spacer(1, 8))
        story.append(t)

    # --- Clinical recommendation --------------------------------------------
    #
    # What to do given the CLASS: "No urgent action required..." for a healthy
    # result, and the equivalent for COPD and pneumonia.
    #
    # This is a different piece of advice from the confidence-qualified
    # "suggested next step" that is deliberately not printed above. That one
    # answered "what now, given how sure the model is"; this one answers "what
    # now, given what was found". A healthy result carries the same advice
    # whether the model was confident or not, and a pneumonia result carries
    # the same advice either way -- so the class-level advice is the one that
    # belongs on a report being sent to a referring clinician.
    #
    # The wording comes from shared/clinical_copy.json, the same file the
    # screen reads, so the report and the screen cannot drift apart.
    #
    # Keyed on the REPORTED verdict, not on the raw classifier column. The
    # heading above is the interpretation -- the fused result with its
    # confidence -- and the recommendation has to agree with it. Keying off
    # `respiratory_result` instead produced a page whose heading said "Healthy"
    # and whose advice said "consider spirometry and pulmonology referral",
    # because on that screening the classifier column read COPD while the
    # fused interpretation read HEALTHY. A report that contradicts itself
    # invites a referral nobody needed. `status_label` gives the same class
    # name the heading shows, so the two cannot disagree.
    rec_key = status_label(interp_status) if (interp_status and interp_level) else (resp_result or "")
    rec_text = class_recommendation(rec_key) if rec_key else ""
    if rec_text:
        rec_bg = {
            "COPD": colors.HexColor('#fefce8'),
            "Pneumonia": colors.HexColor('#fef2f2'),
        }.get(rec_key, colors.HexColor('#f0fdf4'))
        story.append(Spacer(1, 8))
        story.append(Paragraph(
            f"<b>CLINICAL RECOMMENDATION:</b> {rec_text}",
            ParagraphStyle('RPClinRec', parent=S["normal"], fontSize=10, leading=14,
                           textColor=vcolor, backColor=rec_bg, borderPadding=8)))
        story.append(Spacer(1, 4))

    # --- Per-take scores, capped so one page is enough ----------------------
    # `scores` and `per_clip` were read above for the acquisition rows.
    if per_clip:
        story.append(Paragraph("Per-take scores", S["subheading"]))
        clip_rows = [[_cell(h, bold=True) for h in
                      ("Take", "Length", "Stage 1 healthy", "Stage 2 pneumonia", "Result")]]
        for c in per_clip:
            s2 = c.get("stage2_pneumonia_prob")
            clip_rows.append([
                _cell((c.get("index", 0) or 0) + 1),
                _cell(f"{c.get('duration_sec', 0):.1f}s"),
                _cell(f"{c.get('stage1_healthy_prob', 0):.2f}"),
                _cell("&mdash;" if s2 is None else f"{s2:.2f}"),
                _cell(c.get("clip_label") or "&mdash;"),
            ])
        ct = Table(clip_rows, colWidths=[0.6 * inch, 0.9 * inch, 1.5 * inch, 1.7 * inch, 1.3 * inch])
        ct.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1f2937')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ('ALIGN', (2, 1), (3, -1), 'RIGHT'),
        ]))
        story.append(ct)

    # --- Clinical review ----------------------------------------------------
    reviewed_by = data.get("reviewed_by_name")
    review_notes = data.get("review_notes")
    if reviewed_by or review_notes:
        story.append(Paragraph("Clinical Review", S["subheading"]))
        story.append(Paragraph(
            f"{'Reviewed' if reviewed_by else 'Pending review'}"
            + (f" by {reviewed_by}" if reviewed_by else "")
            + (f"<br/>{review_notes}" if review_notes else ""),
            S["body"]))

    # --- Disclaimer ---------------------------------------------------------
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "<b>Scope:</b> " + disclosure('scope'),
        ParagraphStyle('RPDisclaimer', parent=S["small"], textColor=colors.HexColor('#6b7280'),
                       borderPadding=(4, 0, 4, 0), spaceBefore=4)))
    story.append(Paragraph(
        "This is an AI-assisted screening tool and does not replace clinical "
        "judgment. All results should be interpreted by a qualified healthcare "
        "professional.",
        ParagraphStyle('RPFooter', parent=S["small"], spaceBefore=4)))

    return story


@router.post("/screenings/export-pdf")
async def export_screenings_pdf(
    body: "ExportRequest",
    user: dict = Depends(get_current_user),
):
    """One PDF containing one page per selected screening.

    The export used to fire a separate download per record, paced 350ms apart to
    dodge the browser's pop-up blocker. That produced a dozen files for a dozen
    records -- unusable as a handover pack, and the pacing made it slow enough
    that people stopped using it. One document is what was actually wanted.

    Authorisation is applied per screening rather than to the batch, so a
    clinician cannot pull another clinician's records into an export by passing
    ids they guessed. Records the caller may not see are skipped silently and
    counted, rather than failing the whole export.
    """
    ids = [i for i in (body.screening_ids or []) if i]
    if not ids:
        raise HTTPException(status_code=400, detail="No screenings selected")
    if len(ids) > 200:
        raise HTTPException(status_code=400, detail="Too many screenings in one export (max 200)")

    role = user.get("role")
    user_clinic_id = user.get("clinic_id")
    user_id = user.get("sub")

    # One query for all of them, not one per id.
    #
    # This was a query per screening id, and an export can carry up to two
    # hundred. At about 130ms a round trip to the hosted database, exporting a
    # patient's history spent twenty seconds checking whether the caller was
    # allowed to see it -- before a single page was written. The rule is
    # simple enough to apply to a set of rows in memory.
    try:
        perm_rows = (
            supabase.table("screening_history_view")
            .select("id,clinic_id,clinician_id")
            .in_("id", ids)
            .execute()
            .data or []
        )
    except Exception as e:
        print(f"[export] permission query failed: {e!r}")
        perm_rows = []

    allowed = []
    for row in perm_rows:
        if role != "super_admin" and row.get("clinic_id") != user_clinic_id:
            continue
        if role == "clinician" and row.get("clinician_id") != user_id:
            continue
        allowed.append(row.get("id"))

    if not allowed:
        raise HTTPException(status_code=404, detail="None of the selected screenings are available to you")

    rows = (
        supabase.table("screening_history_view")
        .select("*")
        .in_("id", allowed)
        .execute()
        .data or []
    )
    # Preserve the caller's ordering -- the visible order is what they ticked.
    order = {sid: i for i, sid in enumerate(allowed)}
    rows.sort(key=lambda r: order.get(r.get("id"), 0))

    if not rows:
        raise HTTPException(status_code=404, detail="No screening data available")

    S = _report_styles()
    buffer = io.BytesIO()
    # Margins are tighter than the verbose report's so a full page of content
    # fits without anything dropping to 8pt.
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=42, leftMargin=42,
                            topMargin=38, bottomMargin=34)

    story = []
    total = len(rows)
    for i, row in enumerate(rows):
        data = _normalise_classification(dict(row))
        if data.get("patient_dob") is None and data.get("date_of_birth") is not None:
            data["patient_dob"] = data["date_of_birth"]
        if data.get("patient_gender") is None and data.get("gender") is not None:
            data["patient_gender"] = data["gender"]
        for _k in ("patient_name", "clinician_name", "model_version"):
            if data.get(_k) is None:
                data[_k] = "N/A"
        if i:
            story.append(PageBreak())
        story.extend(_one_page_story(data, data.get("id", ""), i + 1, total, S))

    doc.build(story)
    buffer.seek(0)

    return StreamingResponse(
        io.BytesIO(buffer.read()),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="aura-dx-export.pdf"'},
    )


@router.get("/screenings/{screening_id}/pdf")
async def download_screening_pdf(
    screening_id: str,
    user: dict = Depends(get_current_user)
):
    """Generate and download PDF report for a screening."""
    row = None
    try:
        row = _first_row(
            supabase.table("screening_history_view").select("*").eq("id", screening_id)
        )
    except Exception:
        row = None
    if row is None:
        try:
            row = _first_row(
                supabase.table("screenings").select("*").eq("id", screening_id)
            )
        except Exception as e:
            print(f"[pdf] fallback query failed: {e!r}")
            row = None
    if not row:
        raise HTTPException(status_code=404, detail="Screening not found")
    data = _normalise_classification(dict(row))
    # Enrich with join data if from base table (not the view)
    if "patient_name" not in data:
        data = _enrich_screening(data)

    # The view exposes the patient's date of birth and sex as `date_of_birth`
    # and `gender`; the report and the UI both call them patient_dob and
    # patient_gender. Same aliases as _screening_row.
    if data.get("patient_dob") is None and data.get("date_of_birth") is not None:
        data["patient_dob"] = data["date_of_birth"]
    if data.get("patient_gender") is None and data.get("gender") is not None:
        data["patient_gender"] = data["gender"]

    # Joined fields (patient_name, gender, age_bracket, ...) can legitimately be
    # None for orphaned records; .get(key, default) does NOT help because the key
    # exists — and calling e.g. .capitalize() on None crashed the whole report.
    for _k in ("patient_name", "age_bracket", "patient_gender", "gender", "patient_dob",
               "clinic_name", "clinician_name", "cascade_path", "model_version", "status"):
        if data.get(_k) is None:
            data[_k] = "N/A"

    role = user.get("role")
    user_clinic_id = user.get("clinic_id")
    if role != "super_admin" and data.get("clinic_id") != user_clinic_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    if role == "clinician" and data.get("clinician_id") != user.get("sub"):
        raise HTTPException(status_code=403, detail="Not authorized")
    
    # One page, using the same layout as the combined export.
    #
    # This used to build its own much longer report: a title, a Patient
    # Information section, a Screening Details section, an Acquisition
    # section, the per-take table, a classification block, a clinical review
    # and two footers, each with its own heading and its own vertical rhythm.
    # It ran to two pages for a single screening, which is a poor shape for a
    # document a clinician reads and prints -- and the second page carried
    # nothing but the tail of the report.
    #
    # The combined export already had a layout written for exactly this: one
    # screening on one A4 page, with nothing scaled below a readable size.
    # Using it here means the Download PDF and the Export PDF are the same
    # document rather than two documents describing the same screening
    # differently, and the two can no longer drift apart.
    S = _report_styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=42, leftMargin=42,
                            topMargin=38, bottomMargin=34)
    doc.build(_one_page_story(data, screening_id, 1, 1, S))
    buffer.seek(0)

    filename = f"aura-dx-screening-{screening_id[:8]}.pdf"
    return StreamingResponse(
        io.BytesIO(buffer.read()),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )