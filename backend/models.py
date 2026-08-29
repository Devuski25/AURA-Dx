from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, EmailStr
from enum import Enum


class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    CLINICIAN = "clinician"


class UserStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    DELETED = "deleted"


class TBCheckResult(str, Enum):
    TB = "TB"
    NON_TB = "Non-TB"


class RespiratoryResult(str, Enum):
    HEALTHY = "Healthy"
    PNEUMONIA = "Pneumonia"
    COPD = "COPD"


class ScreeningStatus(str, Enum):
    COMPLETED = "completed"
    ERROR = "error"
    PENDING_REVIEW = "pending_review"


class AuditAction(str, Enum):
    LOGIN = "login"
    LOGOUT = "logout"
    SCREENING_CREATE = "screening_create"
    SCREENING_REVIEW = "screening_review"
    PATIENT_CREATE = "patient_create"
    PATIENT_UPDATE = "patient_update"
    USER_APPROVE = "user_approve"
    USER_REJECT = "user_reject"
    USER_DELETE = "user_delete"


# Request/Response Models
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class SendOtp(BaseModel):
    email: EmailStr


class VerifyOtp(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=4, max_length=12)


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: UserRole
    status: UserStatus
    clinic_id: Optional[str]
    phone: Optional[str]
    specialization: Optional[str]
    license_number: Optional[str]
    last_login_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: UserRole = UserRole.CLINICIAN
    status: Optional[UserStatus] = None
    phone: Optional[str] = None
    specialization: Optional[str] = None
    license_number: Optional[str] = None


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    specialization: Optional[str] = None
    license_number: Optional[str] = None
    status: Optional[UserStatus] = None
    role: Optional[UserRole] = None
    password: Optional[str] = None


class ClinicCreate(BaseModel):
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None


class ClinicResponse(BaseModel):
    id: str
    name: str
    address: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PatientCreate(BaseModel):
    full_name: str
    date_of_birth: str
    gender: str
    smoking_history: bool = False
    pack_years: Optional[float] = None
    past_respiratory_diseases: List[str] = []
    symptoms: List[str] = []
    clinician_id: Optional[str] = None
    clinic_id: Optional[str] = None


class PatientResponse(BaseModel):
    id: str
    clinic_id: str
    clinician_id: str
    full_name: str
    date_of_birth: str
    gender: str
    smoking_history: bool
    pack_years: Optional[float]
    past_respiratory_diseases: List[str]
    symptoms: List[str]
    created_at: datetime
    updated_at: datetime
    clinic_name: Optional[str] = None
    clinician_name: Optional[str] = None
    age_bracket: Optional[str] = None


class PatientUpdate(BaseModel):
    full_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    smoking_history: Optional[bool] = None
    pack_years: Optional[float] = None
    past_respiratory_diseases: Optional[List[str]] = None
    symptoms: Optional[List[str]] = None


class ScreeningCreate(BaseModel):
    patient_id: str
    audio_file_path: Optional[str] = None
    audio_duration_sec: Optional[float] = None
    camera_data: Optional[Dict[str, Any]] = None


class ScreeningResponse(BaseModel):
    id: str
    patient_id: str
    clinic_id: str
    clinician_id: str
    audio_file_path: Optional[str]
    audio_duration_sec: Optional[float]
    tb_result: TBCheckResult
    tb_confidence: Optional[float]
    tb_probabilities: Optional[Dict[str, float]]
    respiratory_result: Optional[RespiratoryResult]
    respiratory_confidence: Optional[float]
    respiratory_probabilities: Optional[Dict[str, float]]
    camera_data: Optional[Dict[str, Any]] = None
    cascade_path: str
    model_version: str
    status: ScreeningStatus
    reviewed_by: Optional[str]
    reviewed_at: Optional[datetime]
    review_notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    patient_name: Optional[str] = None
    patient_dob: Optional[str] = None
    age_bracket: Optional[str] = None
    patient_gender: Optional[str] = None
    clinic_name: Optional[str] = None
    clinician_name: Optional[str] = None
    reviewed_by_name: Optional[str] = None


class ScreeningReview(BaseModel):
    review_notes: Optional[str] = None


class InferenceRequest(BaseModel):
    patient_id: str
    audio_duration_sec: Optional[float] = None


class InferenceResponse(BaseModel):
    model_version: str
    tb_result: Dict[str, Any]
    respiratory_result: Optional[Dict[str, Any]]
    cascade: str


class AuditLogResponse(BaseModel):
    id: str
    user_id: Optional[str]
    clinic_id: Optional[str]
    action: str
    entity_type: Optional[str]
    entity_id: Optional[str]
    details: Optional[Dict[str, Any]]
    ip_address: Optional[str]
    user_agent: Optional[str]
    created_at: datetime


class MetricsSummary(BaseModel):
    total_requests: int
    avg_ms: Optional[float]
    error_rate: float


class ErrorResponse(BaseModel):
    detail: str
    code: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    timestamp: datetime
    services: Dict[str, str]