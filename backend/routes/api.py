from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Request, BackgroundTasks
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
    ErrorResponse, HealthResponse, SendOtp, VerifyOtp
)
from auth import get_current_user, get_current_user_id, require_role
from database import supabase, supabase_anon
from config import settings
from email_service import send_account_status_email, send_verification_email
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
    # Fetch auth users to check email_confirmed_at — parallel with profiles fetch
    try:
        auth_res = await get_client().get(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers={
                "Authorization": f"Bearer {settings.supabase_service_key}",
                "apikey": settings.supabase_anon_key,
            },
            timeout=10.0
        )
        auth_data = auth_res.json()
        auth_users = auth_data.get("users", [])
        confirmed_emails = {u["email"] for u in auth_users if u.get("email_confirmed_at")}
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

        result = supabase.table("profiles").select("*").eq("id", auth_user["id"]).single().execute()
        return UserResponse(**result.data)
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

    res = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    return UserResponse(**res.data)


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
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

    # patients/screenings reference profiles(clinician_id) with ON DELETE RESTRICT,
    # so delete the user's clinical rows first, otherwise the profile/auth delete fails.
    supabase.table("screenings").delete().eq("clinician_id", user_id).execute()
    supabase.table("patients").delete().eq("clinician_id", user_id).execute()

    supabase.auth.admin.delete_user(user_id)
    supabase.table("profiles").delete().eq("id", user_id).execute()

    _log_audit("user_delete", user.get("sub"), None, "user", user_id, {"deleted_user": target.data["email"]})

    return {"message": "User deleted"}


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
            res = _fetch_patients_with_view(search, clinic_id, role, user_clinic_id, offset, limit)
        except Exception as e:
            print(f"[list_patients] view query failed, using table fallback: {e!r}")
            res = _fetch_patients_from_tables(search, clinic_id, role, user_clinic_id, offset, limit)
        return [PatientResponse(**p) for p in (res.data or [])]
    except HTTPException:
        raise
    except Exception as e:
        print(f"[list_patients] failed: {e!r}")
        raise HTTPException(status_code=500, detail="Failed to load patients")


def _fetch_patients_with_view(search, clinic_id, role, user_clinic_id, offset: int, limit: int):
    query = supabase.table("patient_list_view").select("*")
    query = _scope_query(query, role, user_clinic_id, clinic_id)
    if search:
        query = query.ilike("full_name", f"%{search}%")
    return query.range(offset, offset + limit - 1).order("created_at", desc=True).execute()


def _fetch_patients_from_tables(search, clinic_id, role, user_clinic_id, offset: int, limit: int):
    """Fallback when patient_list_view doesn't exist — query base tables and join in Python."""
    query = supabase.table("patients").select("*")
    query = _scope_query(query, role, user_clinic_id, clinic_id)
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
    role = user.get("role")
    clinic_id = user.get("clinic_id")

    query = supabase.table("patient_list_view").select("*").eq("id", patient_id)
    if role != "super_admin":
        query = query.eq("clinic_id", clinic_id)

    res = query.single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Patient not found")
    return PatientResponse(**res.data)


@router.patch("/patients/{patient_id}", response_model=PatientResponse)
async def update_patient(patient_id: str, update: PatientUpdate, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    role = user.get("role")
    user_id = user.get("sub")
    clinic_id = user.get("clinic_id")

    target = supabase.table("patients").select("*").eq("id", patient_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Super admins are exempt, matching delete_patient below. Without this a
    # super admin -- whose profile carries no clinic_id -- compares the
    # patient's clinic against None and is refused every time. The row menu now
    # offers Edit to every clinician, admin and super admin alike, so the
    # exemption is on a path users actually reach rather than a latent gap.
    if user.get("role") != "super_admin" and target.data["clinic_id"] != clinic_id:
        raise HTTPException(status_code=403, detail="Not your clinic patient")

    update_data = update.model_dump(exclude_unset=True)
    if update_data:
        supabase.table("patients").update(update_data).eq("id", patient_id).execute()

    _log_audit("patient_update", user_id, clinic_id, "patient", patient_id, update_data)

    res = supabase.table("patient_list_view").select("*").eq("id", patient_id).single().execute()
    return PatientResponse(**res.data)


@router.delete("/patients/{patient_id}")
async def delete_patient(patient_id: str, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinic_id = user.get("clinic_id")
    target = supabase.table("patients").select("*").eq("id", patient_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="Patient not found")
    if user.get("role") != "super_admin" and target.data["clinic_id"] != clinic_id:
        raise HTTPException(status_code=403, detail="Not your clinic patient")

    supabase.table("patients").delete().eq("id", patient_id).execute()

    _log_audit("patient_delete", user.get("sub"), clinic_id, "patient", patient_id, {"patient_name": target.data["full_name"]})

    return {"message": "Patient deleted"}


@router.post("/screenings", response_model=ScreeningResponse)
async def create_screening(screening: ScreeningCreate, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinician_id = user.get("sub")
    clinic_id = _resolve_clinic_id(user.get("clinic_id"))
    if not clinic_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No clinic is configured; cannot create screening")

    patient = supabase.table("patients").select("*").eq("id", screening.patient_id).single().execute()
    if not patient.data:
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

    inference_res = await run_inference(screening.audio_file_paths, screening.audio_duration_sec)

    fused = inference_res.get("respiratory_result") or {}
    fusion = inference_res.get("fusion") or {}
    # Produced by inference_service.interpret_fusion. Every field is optional at
    # the storage layer so a screening recorded against an older model (or an
    # inference service that predates the interpretation layer) still saves.
    interp = fused.get("interpretation") or {}

    data = {
        "patient_id": screening.patient_id,
        "clinic_id": clinic_id,
        "clinician_id": clinician_id,
        # Canonical take for the row; the full batch lives in recording_paths.
        "audio_file_path": screening.audio_file_paths[0],
        "audio_duration_sec": screening.audio_duration_sec,
        "recording_paths": screening.audio_file_paths,
        # Per-take scores + fusion metadata, so the PDF and the detail view can
        # show how the headline verdict was reached rather than just the verdict.
        "recording_scores": {
            "per_clip": inference_res.get("per_clip", []),
            "fusion": fusion,
        },
        "respiratory_result": fused.get("label"),
        "respiratory_confidence": fused.get("confidence"),
        "respiratory_probabilities": fused.get("probabilities"),
        "cascade_path": fusion.get("method") or "mean_then_safety_override",
        # Interpretation. `recommendation_code` is a key into
        # shared/clinical_copy.json rather than prose, so rewording a
        # clinician-facing message never needs a migration.
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
        "model_version": inference_res["model_version"],
        "status": "completed"
    }

    res = supabase.table("screenings").insert(data).execute()
    created = res.data[0]

    _log_audit("screening_create", clinician_id, clinic_id, "screening", created["id"], {
        "patient_id": screening.patient_id,
        "recordings": len(screening.audio_file_paths),
        "respiratory_result": data["respiratory_result"],
        "override_applied": fusion.get("override_applied"),
    })

    return ScreeningResponse(**created, patient_name=patient.data["full_name"], clinic_name=None, clinician_name=None, reviewed_by_name=None)


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
                .select("id,full_name,date_of_birth,gender")
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
    return ScreeningResponse(**row)


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
        return [_enrich_screening(s) for s in (res.data or [])]
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

    try:
        query = supabase.table("screening_history_view").select("*").eq("id", screening_id)
        if role == "clinician":
            query = query.eq("clinician_id", user_id)
        elif role != "super_admin":
            query = query.eq("clinic_id", clinic_id)
        res = query.single().execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Screening not found")
        return _screening_row(res.data)
    except Exception:
        # Fallback: use base screenings table
        query = supabase.table("screenings").select("*").eq("id", screening_id)
        if role == "clinician":
            query = query.eq("clinician_id", user_id)
        elif role != "super_admin":
            query = query.eq("clinic_id", clinic_id)
        res = query.single().execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Screening not found")
        return ScreeningResponse(**_enrich_screening(res.data))


@router.patch("/screenings/{screening_id}/review", response_model=ScreeningResponse)
async def review_screening(screening_id: str, review: ScreeningReview, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    role = user.get("role")
    user_id = user.get("sub")
    clinic_id = user.get("clinic_id")

    target = supabase.table("screenings").select("*").eq("id", screening_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="Screening not found")

    if target.data["clinic_id"] != clinic_id:
        raise HTTPException(status_code=403, detail="Not your clinic screening")

    update_data = {
        "reviewed_by": user_id,
        "reviewed_at": datetime.utcnow().isoformat(),
        "status": "completed"
    }
    if review.review_notes:
        update_data["review_notes"] = review.review_notes

    supabase.table("screenings").update(update_data).eq("id", screening_id).execute()

    _log_audit("screening_review", user_id, clinic_id, "screening", screening_id, {"review_notes": review.review_notes})

    res = supabase.table("screening_history_view").select("*").eq("id", screening_id).single().execute()
    return ScreeningResponse(**res.data)


@router.get("/metrics/summary", response_model=MetricsSummary)
async def metrics_summary(user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinic_id = user.get("clinic_id")
    try:
        query = supabase.table("audit_logs").select("action").eq("action", "screening_create")
        if user.get("role") != "super_admin" and clinic_id:
            query = query.eq("clinic_id", clinic_id)
        res = query.execute()
        total = len(res.data)
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
    story.append(Paragraph(
        f"{name} &nbsp;&middot;&nbsp; Screening {screening_id[:8]} &nbsp;&middot;&nbsp; "
        f"Page {page_no} of {page_total}",
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
         str(data.get("status") or "N/A")],
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

    allowed = []
    for sid in ids:
        row = (
            supabase.table("screening_history_view")
            .select("id,clinic_id,clinician_id")
            .eq("id", sid)
            .limit(1)
            .execute()
            .data
        )
        if not row:
            continue
        if role != "super_admin" and row[0].get("clinic_id") != user_clinic_id:
            continue
        if role == "clinician" and row[0].get("clinician_id") != user_id:
            continue
        allowed.append(sid)

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
        data = dict(row)
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
    try:
        screening = supabase.table("screening_history_view").select("*").eq("id", screening_id).single().execute()
    except Exception:
        screening = supabase.table("screenings").select("*").eq("id", screening_id).single().execute()
    if not screening.data:
        raise HTTPException(status_code=404, detail="Screening not found")
    data = dict(screening.data)
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