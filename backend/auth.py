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
_jwks_cache_key = None


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.utcnow()
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=60)
    to_encode.update({"iat": now, "exp": expire})
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


def _decode_es256_with_keys(token: str, jwks: list) -> Optional[dict]:
    """Try decoding with each JWK in the set, matching by kid if present."""
    if not jwks:
        return None
    try:
        import base64 as _b64
        header_json = _b64.urlsafe_b64decode(token.split(".")[0] + "==")
        kid = json.loads(header_json).get("kid")
    except Exception:
        kid = None
    keys_to_try = jwks if not kid else [k for k in jwks if k.get("kid") == kid] or jwks
    for jwk in keys_to_try:
        payload = _decode_es256(token, jwk)
        if payload:
            return payload
    return None


def _get_jwks_sync(issuer: Optional[str] = None) -> Optional[list]:
    global _jwks_cache, _jwks_cache_time, _jwks_cache_key
    # Only allow known Supabase issuers to prevent SSRF via forged tokens.
    allowed = {settings.supabase_url}
    if issuer and issuer in allowed:
        base = issuer
    else:
        base = settings.supabase_url
    cache_key = base
    if _jwks_cache is not None and _jwks_cache_time and _jwks_cache_key == cache_key and (datetime.utcnow() - _jwks_cache_time).seconds < 300:
        return _jwks_cache
    try:
        import urllib.request
        url = f"{base}/auth/v1/.well-known/jwks.json"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
            keys = data.get("keys", [])
            if keys:
                _jwks_cache = keys
                _jwks_cache_key = cache_key
                _jwks_cache_time = datetime.utcnow()
                return _jwks_cache
    except Exception:
        pass
    return None


_ALLOWED_ISS_DOMAINS = {"supabase.co", "supabase.io"}

def _token_iss(token: str) -> Optional[str]:
    """Read iss claim without verifying signature, but only for known Supabase domains."""
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
        iss = unverified.get("iss")
        if not iss:
            return None
        # Only allow Supabase-issued issuers to prevent SSRF
        try:
            from urllib.parse import urlparse
            host = urlparse(iss).netloc
            if any(host.endswith(d) for d in _ALLOWED_ISS_DOMAINS):
                return iss
        except Exception:
            pass
        return None
    except Exception:
        return None


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        pass

    issuer = _token_iss(token)

    # Fallback 1: Supabase /auth/v1/user on the token's own issuer
    try:
        import urllib.request
        url = f"{issuer}/auth/v1/user" if issuer else f"{settings.supabase_url}/auth/v1/user"
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

    # Fallback 2: ES256 verification against the issuer's JWKS (kid-matched)
    jwks = _get_jwks_sync(issuer)
    if jwks:
        payload = _decode_es256_with_keys(token, jwks)
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
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Resolve role/status/clinic_id from the DB on every request so account
    # status (pending/rejected/deleted) is enforced immediately and role
    # changes take effect without waiting for token expiry.
    try:
        profile = supabase.table("profiles").select("role, status, clinic_id").eq("id", sub).single().execute()
    except Exception:
        profile = None
    if not profile or not profile.data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Profile not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if profile.data.get("status") != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not approved or inactive",
        )
    payload["role"] = profile.data["role"]
    payload["clinic_id"] = profile.data.get("clinic_id")
    payload["status"] = profile.data.get("status")
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