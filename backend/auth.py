from datetime import datetime, timedelta
from typing import Optional
import time
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

# How long a profile's role and status are trusted before being read from the
# database again.
#
# Short on purpose. This is a backstop for a change made outside the API --
# in the Supabase dashboard, say -- where nothing calls the invalidation. A
# change made through the API takes effect at once, because approving,
# rejecting, changing a role and deleting an account all invalidate the
# entry. So this only decides how long a change made by hand is ignored.
PROFILE_CACHE_TTL_SECONDS = 20

# user id -> (profile row, the monotonic time it was read)
_profile_cache: dict = {}


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.utcnow()
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=60)
    to_encode.update({"iat": now, "exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _b64url_decode(segment: str) -> bytes:
    """Decode a base64url segment, padding it properly first.

    The previous code appended a fixed "==" which is wrong whenever the input
    length is already a multiple of 4, and silently truncates when it is not.
    """
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _p1363_to_der(sig: bytes) -> bytes:
    """Convert a raw JWS P-256 signature (r||s) to DER.

    A JWS ES256 signature is the two 32-byte integers r and s concatenated.
    `cryptography`'s `verify()` expects the ASN.1 DER encoding of that pair,
    and raises when handed raw bytes.

    This is why ES256 verification never worked here. Supabase signs ES256, so
    the local check could only ever fail, and every single authenticated request
    fell through to the network probe against Supabase -- a round trip on the
    hot path with a 5 second timeout. When that call was slow or flaky, the
    request came back 401 and the user was told to sign in again.
    """
    if len(sig) != 64:
        return sig

    def _enc(value: int) -> bytes:
        b = value.to_bytes(max(1, (value.bit_length() + 7) // 8), "big")
        # DER integers are signed: a leading bit of 1 would read as negative.
        if b[0] & 0x80:
            b = b"\x00" + b
        return b

    r = _enc(int.from_bytes(sig[:32], "big"))
    s = _enc(int.from_bytes(sig[32:], "big"))
    body = b"\x02" + bytes([len(r)]) + r + b"\x02" + bytes([len(s)]) + s
    return b"\x30" + bytes([len(body)]) + body


def _decode_es256(token: str, jwk_data: dict) -> Optional[dict]:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        header_payload = f"{parts[0]}.{parts[1]}".encode()
        sig = _p1363_to_der(_b64url_decode(parts[2]))
        x = int.from_bytes(_b64url_decode(jwk_data["x"]), "big")
        y = int.from_bytes(_b64url_decode(jwk_data["y"]), "big")
        public_key = ec.EllipticCurvePublicNumbers(
            x, y, ec.SECP256R1()
        ).public_key(default_backend())
        public_key.verify(sig, header_payload, ec.ECDSA(hashes.SHA256()))
        payload = json.loads(_b64url_decode(parts[1]))
        # An expired token is not a valid credential even with a good signature.
        # jose would reject it here, but this path decodes by hand.
        exp = payload.get("exp")
        if exp is not None and exp < datetime.utcnow().timestamp():
            return None
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
    # `.total_seconds()`, not `.seconds`. `timedelta.seconds` is the seconds
    # COMPONENT, so it wraps to 0 at every whole minute: at 60s it reads 0,
    # at 120s it reads 0, and at a full hour it reads 0 again. The cache then
    # never expires for a long-running process, and a rotated signing key is
    # never picked up.
    if (
        _jwks_cache is not None
        and _jwks_cache_time
        and _jwks_cache_key == cache_key
        and (datetime.utcnow() - _jwks_cache_time).total_seconds() < 300
    ):
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

    # Fallback 1: ES256 verification against the issuer's JWKS, kid-matched.
    #
    # This runs BEFORE the network probe on purpose. Supabase signs ES256, so
    # for every real session the HS256 branch above fails and this is the check
    # that actually decides. It is local and the key set is cached for five
    # minutes, so it costs nothing.
    #
    # The network probe below used to sit in front of it, which meant every
    # authenticated request made a round trip to Supabase -- and if that call
    # was slow or failed, a perfectly good token was rejected with a 401 and
    # the user was told to sign in again.
    jwks = _get_jwks_sync(issuer)
    if jwks:
        payload = _decode_es256_with_keys(token, jwks)
        if payload:
            return payload

    # Fallback 2: ask Supabase directly. Last resort, because it is a network
    # call on the hot path. Kept for tokens signed with a key the JWKS does not
    # publish, which happens when a project rotates signing keys.
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

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )


def invalidate_profile(user_id: str) -> None:
    """Forget a cached profile.

    Called whenever something changes a person's role or status, so that the
    change takes effect on the very next request rather than whenever the
    cache happens to expire. Without this the cache would quietly weaken the
    rule that a rejected account stops working immediately.
    """
    _profile_cache.pop(user_id, None)


def _get_profile(user_id: str) -> Optional[dict]:
    """role, status and clinic_id for a user, from a short-lived cache.

    Returns None when the user does not exist. A user who does not exist is
    not cached: the first request after the account is deleted has to be
    refused, and caching a miss would keep refusing a user who has just been
    created.
    """
    now = time.monotonic()
    hit = _profile_cache.get(user_id)
    if hit is not None and (now - hit[1]) < PROFILE_CACHE_TTL_SECONDS:
        return hit[0]

    try:
        res = (
            supabase.table("profiles")
            .select("role, status, clinic_id")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception:
        return None

    rows = res.data or []
    if not rows:
        _profile_cache.pop(user_id, None)
        return None

    row = rows[0]
    _profile_cache[user_id] = (row, now)
    return row


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

    # Resolve role/status/clinic_id from the DB so account status
    # (pending/rejected/deleted) is enforced and role changes take effect
    # without waiting for token expiry.
    #
    # That lookup was done on EVERY authenticated request, and it is a
    # database round trip: about 130ms from this machine to the hosted
    # database, which is more than the query the endpoint itself runs. A page
    # that makes three calls paid it three times, and every page felt slow
    # for a reason that had nothing to do with the page.
    #
    # The result is cached in memory for a short window, and invalidated the
    # moment anything changes it -- approving, rejecting, changing a role or
    # deleting an account all call `invalidate_profile`. So the guarantee that
    # a rejected account stops working the moment it is rejected still holds;
    # the cache only covers the window between two requests from the same
    # signed-in person.
    profile_row = _get_profile(sub)
    if profile_row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Profile not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if profile_row.get("status") != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account not approved or inactive",
        )
    payload["role"] = profile_row["role"]
    payload["clinic_id"] = profile_row.get("clinic_id")
    payload["status"] = profile_row.get("status")
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