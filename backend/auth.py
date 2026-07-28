from datetime import datetime, timedelta
from typing import Optional
from jose import jwt, JWTError
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
import base64
import json
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from config import settings
from database import supabase

security = HTTPBearer(auto_error=False)

ALGORITHM = settings.jwt_algorithm
SECRET_KEY = settings.jwt_secret

_jwks_cache = None
_jwks_cache_time = None


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=60)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _decode_es256(token: str, jwk_data: dict) -> Optional[dict]:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        header_payload = f"{parts[0]}.{parts[1]}".encode()
        sig = base64.urlsafe_b64decode(parts[2] + "==")
        x = int.from_bytes(base64.urlsafe_b64decode(jwk_data["x"] + "=="), "big")
        y = int.from_bytes(base64.urlsafe_b64decode(jwk_data["y"] + "=="), "big")
        public_key = ec.EllipticCurvePublicNumbers(
            x, y, ec.SECP256R1()
        ).public_key(default_backend())
        public_key.verify(sig, header_payload, ec.ECDSA(hashes.SHA256()))
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=="))
        return payload
    except Exception:
        return None


def _get_jwks_sync() -> Optional[dict]:
    global _jwks_cache, _jwks_cache_time
    now = datetime.utcnow()
    if _jwks_cache is not None and _jwks_cache_time and (now - _jwks_cache_time).seconds < 300:
        return _jwks_cache
    try:
        import urllib.request
        url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
            keys = data.get("keys", [])
            if keys:
                _jwks_cache = keys[0]
                _jwks_cache_time = now
                return _jwks_cache
    except Exception:
        pass
    return None


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        pass

    try:
        import urllib.request
        url = f"{settings.supabase_url}/auth/v1/user"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "apikey": settings.supabase_anon_key,
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            user_data = json.loads(resp.read())
            return {
                "sub": user_data["id"],
                "email": user_data.get("email", ""),
                "role": None,
            }
    except Exception:
        pass

    jwk_data = _get_jwks_sync()
    if jwk_data:
        payload = _decode_es256(token, jwk_data)
        if payload:
            return payload

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    # If the token carries a Supabase-level role (anon/authenticated) instead of
    # an application role (admin/clinician), look up the real role from the DB.
    app_roles = {"admin", "clinician", "super_admin"}
    if payload.get("role") not in app_roles:
        try:
            profile = supabase.table("profiles").select("role, clinic_id").eq("id", payload.get("sub")).single().execute()
            if profile.data:
                payload["role"] = profile.data["role"]
                payload["clinic_id"] = profile.data.get("clinic_id")
        except Exception:
            pass
    return payload


async def get_current_user_id(user: dict = Depends(get_current_user)) -> str:
    return user.get("sub")


def require_role(*allowed_roles: str):
    async def role_checker(user: dict = Depends(get_current_user)) -> dict:
        user_role = user.get("role", "")
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user_role}' not authorized for this action"
            )
        return user
    return role_checker