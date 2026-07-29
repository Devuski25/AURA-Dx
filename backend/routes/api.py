from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from typing import List, Optional
from datetime import datetime
import httpx
import uuid
import os
import io
import json
import urllib.request
import urllib.error
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from fastapi.responses import StreamingResponse
from models import (
    UserLogin, UserRegister, UserCreate, UserResponse, UserUpdate, Token,
    PatientCreate, PatientResponse, PatientUpdate,
    ScreeningCreate, ScreeningResponse, ScreeningReview,
    InferenceRequest, InferenceResponse,
    ClinicCreate, ClinicResponse,
    AuditLogResponse, MetricsSummary,
    UserRole, UserStatus, ScreeningStatus,
    ErrorResponse, HealthResponse
)
from auth import get_current_user, get_current_user_id, require_role, create_access_token
from database import supabase, supabase_anon
from config import settings

router = APIRouter()

UPLOAD_DIR = "uploads_audio"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.get("/health", response_model=HealthResponse)
async def health_check():
    services = {
        "database": "unknown",
        "inference": "unknown",
        "auth": "unknown"
    }
    try:
        supabase.table("clinics").select("id").limit(1).execute()
        services["database"] = "healthy"
    except Exception:
        services["database"] = "unhealthy"

    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{settings.inference_service_url}/health", timeout=5)
            services["inference"] = "healthy" if r.status_code == 200 else "unhealthy"
    except Exception:
        services["inference"] = "unhealthy"

    services["auth"] = "healthy"

    return HealthResponse(
        status="healthy" if all(v == "healthy" for v in services.values()) else "degraded",
        timestamp=datetime.utcnow(),
        services=services
    )


@router.post("/audio/upload")
async def upload_audio(
    audio: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    """Upload audio file for screening. Returns file path for inference."""
    if not audio.filename.lower().endswith((".wav", ".mp3", ".flac", ".ogg", ".m4a")):
        raise HTTPException(status_code=400, detail="Unsupported audio format. Use wav, mp3, flac, ogg, m4a")
    
    contents = await audio.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio file too large. Maximum 5MB.")
    
    file_ext = os.path.splitext(audio.filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    
    with open(file_path, "wb") as f:
        f.write(contents)
    
    return {"file_path": file_path, "filename": unique_filename, "size": len(contents)}


@router.post("/auth/login", response_model=Token)
async def login(credentials: UserLogin):
    try:
        res = supabase_anon.auth.sign_in_with_password({
            "email": credentials.email,
            "password": credentials.password
        })
        if not res.user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        user_data = supabase.table("profiles").select("*").eq("id", res.user.id).single().execute()
        if not user_data.data:
            raise HTTPException(status_code=404, detail="User profile not found")

        profile = user_data.data
        if profile["status"] != "approved":
            raise HTTPException(status_code=403, detail="Account not approved")

        access_token = create_access_token({
            "sub": res.user.id,
            "email": res.user.email,
            "role": profile["role"],
            "clinic_id": profile.get("clinic_id")
        })

        supabase.table("profiles").update({"last_login_at": datetime.utcnow().isoformat()}).eq("id", res.user.id).execute()

        supabase.table("audit_logs").insert({
            "user_id": res.user.id,
            "clinic_id": profile.get("clinic_id"),
            "action": "login",
            "details": {"email": credentials.email}
        }).execute()

        return Token(access_token=access_token)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/auth/register", response_model=UserResponse)
async def register(user_data: UserRegister):
    try:
        res = supabase_anon.auth.sign_up({
            "email": user_data.email,
            "password": user_data.password,
            "options": {
                "data": {
                    "full_name": user_data.full_name,
                    "role": user_data.role.value
                }
            }
        })
        if not res.user:
            raise HTTPException(status_code=400, detail="Registration failed")

        profile = {
            "id": res.user.id,
            "email": user_data.email,
            "full_name": user_data.full_name,
            "role": user_data.role.value,
            "status": UserStatus.PENDING.value if user_data.role != UserRole.SUPER_ADMIN else UserStatus.APPROVED.value,
            "phone": user_data.phone,
            "specialization": user_data.specialization,
            "license_number": user_data.license_number,
            "clinic_id": user_data.clinic_id
        }
        supabase.table("profiles").insert(profile).execute()

        supabase.table("audit_logs").insert({
            "user_id": res.user.id,
            "clinic_id": user_data.clinic_id,
            "action": "user_register",
            "details": {"role": user_data.role.value, "email": user_data.email}
        }).execute()

        return UserResponse(**profile, created_at=datetime.utcnow(), updated_at=datetime.utcnow())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auth/me", response_model=UserResponse)
async def get_me(user: dict = Depends(get_current_user)):
    user_id = user.get("sub")
    res = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    return UserResponse(**res.data)


@router.post("/auth/logout")
async def logout(user: dict = Depends(get_current_user)):
    user_id = user.get("sub")
    profile = supabase.table("profiles").select("clinic_id").eq("id", user_id).single().execute()
    clinic_id = profile.data.get("clinic_id") if profile.data else None

    supabase.table("audit_logs").insert({
        "user_id": user_id,
        "clinic_id": clinic_id,
        "action": "logout"
    }).execute()

    return {"message": "Logged out successfully"}


@router.get("/users", response_model=List[UserResponse])
async def list_users(user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinic_id = user.get("clinic_id")
    query = supabase.table("profiles").select("*")
    if user.get("role") != "super_admin" and clinic_id:
        query = query.eq("clinic_id", clinic_id)
    res = query.order("created_at", desc=True).execute()
    return [UserResponse(**u) for u in res.data]


@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user(user_data: UserCreate, user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    try:
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
                "apikey": settings.supabase_service_key,
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
            "status": UserStatus.PENDING.value,
            "phone": user_data.phone,
            "specialization": user_data.specialization,
            "license_number": user_data.license_number,
        }
        supabase.table("profiles").upsert(profile).execute()

        supabase.table("audit_logs").insert({
            "user_id": user.get("sub"),
            "clinic_id": user.get("clinic_id"),
            "action": "user_create",
            "entity_type": "user",
            "entity_id": auth_user["id"],
            "details": {"email": user_data.email, "role": user_data.role.value}
        }).execute()

        result = supabase.table("profiles").select("*").eq("id", auth_user["id"]).single().execute()
        return UserResponse(**result.data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, update: UserUpdate, user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinic_id = user.get("clinic_id")
    target = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="User not found")

    if user.get("role") != "super_admin" and target.data.get("clinic_id") != clinic_id:
        raise HTTPException(status_code=403, detail="Cannot modify user from another clinic")

    update_data = update.model_dump(exclude_unset=True)
    password = update_data.pop("password", None) if update_data else None
    if update_data:
        supabase.table("profiles").update(update_data).eq("id", user_id).execute()
    if password:
        supabase.auth.admin.update_user_by_id(user_id, {"password": password})

    supabase.table("audit_logs").insert({
        "user_id": user.get("sub"),
        "clinic_id": clinic_id,
        "action": "user_update",
        "entity_type": "user",
        "entity_id": user_id,
        "details": update_data
    }).execute()

    res = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    return UserResponse(**res.data)


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    target = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="User not found")

    if user.get("role") == "admin" and target.data.get("role") != "clinician":
        raise HTTPException(
            status_code=403,
            detail="Admins can only delete clinician accounts"
        )

    supabase.auth.admin.delete_user(user_id)
    supabase.table("profiles").delete().eq("id", user_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": user.get("sub"),
        "action": "user_delete",
        "entity_type": "user",
        "entity_id": user_id,
        "details": {"deleted_user": target.data["email"]}
    }).execute()

    return {"message": "User deleted"}


@router.post("/clinics", response_model=ClinicResponse)
async def create_clinic(clinic: ClinicCreate, user: dict = Depends(require_role(UserRole.SUPER_ADMIN))):
    res = supabase.table("clinics").insert(clinic.model_dump()).execute()
    return ClinicResponse(**res.data[0])


@router.get("/clinics", response_model=List[ClinicResponse])
async def list_clinics(user: dict = Depends(get_current_user)):
    if user.get("role") == "super_admin":
        res = supabase.table("clinics").select("*").order("created_at", desc=True).execute()
    else:
        clinic_id = user.get("clinic_id")
        res = supabase.table("clinics").select("*").eq("id", clinic_id).execute()
    return [ClinicResponse(**c) for c in res.data]


@router.get("/patients", response_model=List[PatientResponse])
async def list_patients(
    search: Optional[str] = None,
    clinic_id: Optional[str] = None,
    user: dict = Depends(get_current_user)
):
    query = supabase.table("patient_list_view").select("*")
    role = user.get("role")
    user_clinic_id = user.get("clinic_id")

    if role == "admin":
        query = query.eq("clinic_id", clinic_id or user_clinic_id)
    elif role != "super_admin" and clinic_id:
        query = query.eq("clinic_id", clinic_id)

    if search:
        query = query.ilike("full_name", f"%{search}%")

    res = query.order("created_at", desc=True).execute()
    return [PatientResponse(**p) for p in res.data]


@router.post("/patients", response_model=PatientResponse, status_code=201)
async def create_patient(patient: PatientCreate, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinician_id = user.get("sub") if user.get("role") == "clinician" else patient.clinician_id
    clinic_id = user.get("clinic_id")

    data = patient.model_dump()
    data["clinician_id"] = clinician_id
    data["clinic_id"] = clinic_id

    res = supabase.table("patients").insert(data).execute()
    created = res.data[0]

    supabase.table("audit_logs").insert({
        "user_id": user.get("sub"),
        "clinic_id": clinic_id,
        "action": "patient_create",
        "entity_type": "patient",
        "entity_id": created["id"],
        "details": {"patient_name": patient.full_name}
    }).execute()

    return PatientResponse(**created, clinic_name=None, clinician_name=None, age_bracket=None)


@router.get("/patients/{patient_id}", response_model=PatientResponse)
async def get_patient(patient_id: str, user: dict = Depends(get_current_user)):
    role = user.get("role")
    clinic_id = user.get("clinic_id")

    query = supabase.table("patient_list_view").select("*").eq("id", patient_id)
    if role == "admin":
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

    if role == "admin" and target.data["clinic_id"] != clinic_id:
        raise HTTPException(status_code=403, detail="Not your clinic patient")

    update_data = update.model_dump(exclude_unset=True)
    if update_data:
        supabase.table("patients").update(update_data).eq("id", patient_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": user_id,
        "clinic_id": clinic_id,
        "action": "patient_update",
        "entity_type": "patient",
        "entity_id": patient_id,
        "details": update_data
    }).execute()

    res = supabase.table("patient_list_view").select("*").eq("id", patient_id).single().execute()
    return PatientResponse(**res.data)


@router.delete("/patients/{patient_id}")
async def delete_patient(patient_id: str, user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinic_id = user.get("clinic_id")
    target = supabase.table("patients").select("*").eq("id", patient_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="Patient not found")
    if user.get("role") != "super_admin" and target.data["clinic_id"] != clinic_id:
        raise HTTPException(status_code=403, detail="Not your clinic patient")

    supabase.table("patients").delete().eq("id", patient_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": user.get("sub"),
        "clinic_id": clinic_id,
        "action": "patient_delete",
        "entity_type": "patient",
        "entity_id": patient_id,
        "details": {"patient_name": target.data["full_name"]}
    }).execute()

    return {"message": "Patient deleted"}


@router.post("/screenings", response_model=ScreeningResponse)
async def create_screening(screening: ScreeningCreate, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinician_id = user.get("sub")
    clinic_id = user.get("clinic_id")

    patient = supabase.table("patients").select("*").eq("id", screening.patient_id).single().execute()
    if not patient.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    if not screening.audio_file_path:
        raise HTTPException(status_code=400, detail="Audio file required. Upload via /api/audio/upload first.")

    inference_res = await run_inference(screening.audio_file_path, screening.audio_duration_sec)

    data = {
        "patient_id": screening.patient_id,
        "clinic_id": clinic_id,
        "clinician_id": clinician_id,
        "audio_file_path": screening.audio_file_path,
        "audio_duration_sec": screening.audio_duration_sec,
        "tb_result": inference_res["tb_result"]["label"],
        "tb_confidence": inference_res["tb_result"]["confidence"],
        "tb_probabilities": inference_res["tb_result"]["probabilities"],
        "respiratory_result": inference_res["respiratory_result"]["label"] if inference_res["respiratory_result"] else None,
        "respiratory_confidence": inference_res["respiratory_result"]["confidence"] if inference_res["respiratory_result"] else None,
        "respiratory_probabilities": inference_res["respiratory_result"]["probabilities"] if inference_res["respiratory_result"] else None,
        "cascade_path": inference_res["cascade"],
        "model_version": inference_res["model_version"],
        "status": "completed"
    }

    res = supabase.table("screenings").insert(data).execute()
    created = res.data[0]

    supabase.table("audit_logs").insert({
        "user_id": clinician_id,
        "clinic_id": clinic_id,
        "action": "screening_create",
        "entity_type": "screening",
        "entity_id": created["id"],
        "details": {
            "patient_id": screening.patient_id,
            "tb_result": data["tb_result"],
            "respiratory_result": data["respiratory_result"]
        }
    }).execute()

    return ScreeningResponse(**created, patient_name=patient.data["full_name"], clinic_name=None, clinician_name=None, reviewed_by_name=None)


async def run_inference(audio_file_path: str, audio_duration_sec: Optional[float]) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        with open(audio_file_path, "rb") as f:
            files = {"audio": (os.path.basename(audio_file_path), f, "audio/wav")}
            r = await client.post(f"{settings.inference_service_url}/api/inference", files=files)
        r.raise_for_status()
        return r.json()


@router.get("/screenings", response_model=List[ScreeningResponse])
async def list_screenings(
    patient_id: Optional[str] = None,
    tb_result: Optional[str] = None,
    respiratory_result: Optional[str] = None,
    user: dict = Depends(get_current_user)
):
    role = user.get("role")
    clinic_id = user.get("clinic_id")

    query = supabase.table("screening_history_view").select("*")

    if role == "admin":
        query = query.eq("clinic_id", clinic_id)

    if patient_id:
        query = query.eq("patient_id", patient_id)
    if tb_result:
        query = query.eq("tb_result", tb_result)
    if respiratory_result:
        query = query.eq("respiratory_result", respiratory_result)

    res = query.order("created_at", desc=True).execute()
    return [ScreeningResponse(**s) for s in res.data]


@router.get("/screenings/{screening_id}", response_model=ScreeningResponse)
async def get_screening(screening_id: str, user: dict = Depends(get_current_user)):
    role = user.get("role")
    clinic_id = user.get("clinic_id")

    query = supabase.table("screening_history_view").select("*").eq("id", screening_id)
    if role == "admin":
        query = query.eq("clinic_id", clinic_id)

    res = query.single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Screening not found")
    return ScreeningResponse(**res.data)


@router.patch("/screenings/{screening_id}/review", response_model=ScreeningResponse)
async def review_screening(screening_id: str, review: ScreeningReview, user: dict = Depends(require_role(UserRole.CLINICIAN, UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    role = user.get("role")
    user_id = user.get("sub")
    clinic_id = user.get("clinic_id")

    target = supabase.table("screenings").select("*").eq("id", screening_id).single().execute()
    if not target.data:
        raise HTTPException(status_code=404, detail="Screening not found")

    if role == "admin" and target.data["clinic_id"] != clinic_id:
        raise HTTPException(status_code=403, detail="Not your clinic screening")

    update_data = {
        "reviewed_by": user_id,
        "reviewed_at": datetime.utcnow().isoformat(),
        "status": "completed"
    }
    if review.review_notes:
        update_data["review_notes"] = review.review_notes

    supabase.table("screenings").update(update_data).eq("id", screening_id).execute()

    supabase.table("audit_logs").insert({
        "user_id": user_id,
        "clinic_id": clinic_id,
        "action": "screening_review",
        "entity_type": "screening",
        "entity_id": screening_id,
        "details": {"review_notes": review.review_notes}
    }).execute()

    res = supabase.table("screening_history_view").select("*").eq("id", screening_id).single().execute()
    return ScreeningResponse(**res.data)


@router.get("/audit-logs", response_model=List[AuditLogResponse])
async def list_audit_logs(
    user_id: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = 100,
    user: dict = Depends(get_current_user)
):
    role = user.get("role")
    user_id = user.get("sub")
    clinic_id = user.get("clinic_id")

    query = supabase.table("audit_logs").select("*")

    if role == "clinician":
        query = query.eq("user_id", user_id)
    elif role == "admin":
        query = query.eq("clinic_id", clinic_id)

    if user_id and role in ["admin", "super_admin"]:
        query = query.eq("user_id", user_id)
    if action:
        query = query.eq("action", action)

    res = query.order("created_at", desc=True).limit(limit).execute()
    return [AuditLogResponse(**a) for a in res.data]


@router.get("/metrics/summary", response_model=MetricsSummary)
async def metrics_summary(user: dict = Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))):
    clinic_id = user.get("clinic_id")
    query = supabase.table("audit_logs").select("action").eq("action", "inference_request")
    if user.get("role") != "super_admin" and clinic_id:
        query = query.eq("clinic_id", clinic_id)
    res = query.execute()
    total = len(res.data)
    return MetricsSummary(total_requests=total, avg_ms=None, error_rate=0.0)


@router.get("/screenings/{screening_id}/pdf")
async def download_screening_pdf(
    screening_id: str,
    user: dict = Depends(get_current_user)
):
    """Generate and download PDF report for a screening."""
    screening = supabase.table("screening_history_view").select("*").eq("id", screening_id).single().execute()
    if not screening.data:
        raise HTTPException(status_code=404, detail="Screening not found")
    
    data = screening.data
    
    role = user.get("role")
    user_clinic_id = user.get("clinic_id")
    if role == "admin" and data.get("clinic_id") != user_clinic_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=50, leftMargin=50, topMargin=50, bottomMargin=50)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('CustomTitle', parent=styles['Title'], fontSize=18, spaceAfter=6, alignment=TA_CENTER)
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'], fontSize=11, textColor=colors.grey, alignment=TA_CENTER, spaceAfter=20)
    heading_style = ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=13, spaceAfter=6, spaceBefore=12, textColor=colors.HexColor('#1f2937'))
    subheading_style = ParagraphStyle('Subheading', parent=styles['Heading3'], fontSize=11, spaceAfter=4, textColor=colors.HexColor('#374151'))
    normal_style = ParagraphStyle('Normal', parent=styles['Normal'], fontSize=10, spaceAfter=2)
    bold_style = ParagraphStyle('Bold', parent=normal_style, fontName='Helvetica-Bold')
    small_style = ParagraphStyle('Small', parent=normal_style, fontSize=8, textColor=colors.grey)
    
    story = []
    
    story.append(Paragraph("COUGHPH - AI-Assisted Respiratory Screening Report", title_style))
    story.append(Paragraph(f"Screening ID: {screening_id}", subtitle_style))
    story.append(Spacer(1, 10))
    
    patient_data = [
        ["Patient Name", data.get("patient_name", "N/A"), "Age / Gender", f"{data.get('age_bracket', 'N/A')} / {data.get('patient_gender', 'N/A').capitalize()}"],
        ["Date of Birth", data.get("patient_dob", "N/A"), "Clinic", data.get("clinic_name", "N/A")],
        ["Clinician", data.get("clinician_name", "N/A"), "Screening Date", data.get("created_at", "N/A")[:19].replace("T", " ")],
    ]
    patient_table = Table(patient_data, colWidths=[1.2*inch, 2.3*inch, 1.2*inch, 2.3*inch])
    patient_table.setStyle(TableStyle([
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
    ]))
    story.append(Paragraph("Patient Information", heading_style))
    story.append(patient_table)
    story.append(Spacer(1, 12))
    
    meta_data = [
        ["Model Version", data.get("model_version", "N/A"), "Cascade Path", data.get("cascade_path", "N/A")],
        ["Audio Duration", f"{data.get('audio_duration_sec', 'N/A')}s" if data.get('audio_duration_sec') else "N/A", "Status", data.get("status", "N/A")],
    ]
    meta_table = Table(meta_data, colWidths=[1.2*inch, 2.3*inch, 1.2*inch, 2.3*inch])
    meta_table.setStyle(TableStyle([
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
    ]))
    story.append(Paragraph("Screening Details", heading_style))
    story.append(meta_table)
    story.append(Spacer(1, 12))
    
    tb_result = data.get("tb_result", "N/A")
    tb_conf = data.get("tb_confidence")
    tb_probs = data.get("tb_probabilities", {})
    cascade = data.get("cascade_path", "")
    
    tb_color = colors.HexColor('#dc2626') if tb_result == "TB" else colors.HexColor('#16a34a')
    tb_badge = "⚠ HIGH PRIORITY" if tb_result == "TB" else "✓ NON-TB"
    
    story.append(Paragraph("Tier 1: TB Gatekeeper", heading_style))
    tb_data = [
        ["Result", tb_result, "Confidence", f"{tb_conf * 100:.1f}%" if tb_conf else "N/A", "Priority", tb_badge],
    ]
    tb_table = Table(tb_data, colWidths=[1*inch, 1.5*inch, 1*inch, 1.5*inch, 1*inch, 2*inch])
    tb_table.setStyle(TableStyle([
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
        ('FONTNAME', (4, 0), (4, -1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (1, 0), (1, -1), tb_color),
        ('TEXTCOLOR', (5, 0), (5, -1), tb_color),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
        ('FONTNAME', (5, 0), (5, -1), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
        ('BACKGROUND', (0, 0), (-1, -1), colors.white),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(tb_table)
    story.append(Spacer(1, 6))
    
    if tb_probs:
        prob_data = [["Class", "Probability"]]
        for cls, prob in tb_probs.items():
            prob_data.append([cls, f"{prob * 100:.1f}%"])
        prob_table = Table(prob_data, colWidths=[3*inch, 3*inch])
        prob_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1f2937')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        story.append(Paragraph("Probability Distribution", subheading_style))
        story.append(prob_table)
        story.append(Spacer(1, 8))
    
    if tb_result == "TB":
        story.append(Paragraph(
            "<b>⚠ CLINICAL RECOMMENDATION:</b> Immediate referral for confirmatory TB testing recommended. "
            "Follow local TB protocols and initiate contact tracing as per guidelines.",
            ParagraphStyle('Rec', parent=normal_style, textColor=colors.HexColor('#dc2626'), backColor=colors.HexColor('#fef2f2'), borderPadding=8)
        ))
        story.append(Spacer(1, 8))
    
    resp_result = data.get("respiratory_result")
    resp_conf = data.get("respiratory_confidence")
    resp_probs = data.get("respiratory_probabilities", {})
    
    if resp_result:
        story.append(Paragraph("Tier 2: Respiratory Classifier", heading_style))
        
        resp_colors = {"Healthy": colors.HexColor('#16a34a'), "Pneumonia": colors.HexColor('#dc2626'), "COPD": colors.HexColor('#ca8a04')}
        resp_recs = {
            "Healthy": "No urgent action required. Routine follow-up as clinically indicated.",
            "Pneumonia": "Urgent clinical evaluation recommended. Consider chest imaging and antibiotics per guidelines.",
            "COPD": "Clinical evaluation recommended. Consider spirometry and pulmonology referral.",
        }
        resp_color = resp_colors.get(resp_result, colors.HexColor('#6b7280'))
        resp_rec = resp_recs.get(resp_result, "")
        
        resp_data = [
            ["Result", resp_result, "Confidence", f"{resp_conf * 100:.1f}%" if resp_conf else "N/A"],
        ]
        resp_table = Table(resp_data, colWidths=[1*inch, 2*inch, 1*inch, 2*inch])
        resp_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTNAME', (2, 0), (2, -1), 'Helvetica-Bold'),
            ('TEXTCOLOR', (1, 0), (1, -1), resp_color),
            ('FONTNAME', (1, 0), (1, -1), 'Helvetica-Bold'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
            ('BACKGROUND', (0, 0), (-1, -1), colors.white),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(resp_table)
        story.append(Spacer(1, 6))
        
        if resp_probs:
            prob_data = [["Class", "Probability"]]
            for cls, prob in resp_probs.items():
                prob_data.append([cls, f"{prob * 100:.1f}%"])
            prob_table = Table(prob_data, colWidths=[3*inch, 3*inch])
            prob_table.setStyle(TableStyle([
                ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f3f4f6')),
                ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1f2937')),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('TOPPADDING', (0, 0), (-1, -1), 3),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ]))
            story.append(Paragraph("Probability Distribution", subheading_style))
            story.append(prob_table)
            story.append(Spacer(1, 8))
        
        if resp_rec:
            story.append(Paragraph(
                f"<b>CLINICAL RECOMMENDATION:</b> {resp_rec}",
                ParagraphStyle('Rec2', parent=normal_style, textColor=resp_color, backColor=colors.HexColor('#fefce8') if resp_result == "COPD" else (colors.HexColor('#fef2f2') if resp_result == "Pneumonia" else colors.HexColor('#f0fdf4')), borderPadding=8)
            ))
            story.append(Spacer(1, 8))
    
    reviewed_by = data.get("reviewed_by_name")
    reviewed_at = data.get("reviewed_at")
    review_notes = data.get("review_notes")
    
    if reviewed_by or review_notes:
        story.append(Paragraph("Clinical Review", heading_style))
        review_data = [
            ["Status", "Reviewed" if reviewed_by else "Pending Review"],
            ["Reviewed By", reviewed_by or "—"],
            ["Review Date", reviewed_at[:19].replace("T", " ") if reviewed_at else "—"],
        ]
        if review_notes:
            review_data.append(["Notes", review_notes])
        review_table = Table(review_data, colWidths=[1.5*inch, 4.5*inch])
        review_table.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#1f2937')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e5e7eb')),
            ('BACKGROUND', (0, 0), (-1, -1), colors.white),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(review_table)
        story.append(Spacer(1, 20))
    
    story.append(Spacer(1, 20))
    story.append(Paragraph(
        "<i>Disclaimer: This is an AI-assisted screening tool and does not replace clinical judgment. "
        "All results should be interpreted by a qualified healthcare professional.</i>",
        ParagraphStyle('Disclaimer', parent=small_style, alignment=TA_CENTER, spaceBefore=10)
    ))
    story.append(Paragraph(
        f"<i>Report generated on {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC | COUGHPH v1.0</i>",
        ParagraphStyle('Footer', parent=small_style, alignment=TA_CENTER)
    ))
    
    doc.build(story)
    buffer.seek(0)
    
    filename = f"coughph-screening-{screening_id[:8]}.pdf"
    return StreamingResponse(
        io.BytesIO(buffer.read()),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )