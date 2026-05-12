from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, EmailStr

from app.db.connection import get_connection

router = APIRouter(prefix="/users", tags=["users"])

_bearer = HTTPBearer(auto_error=False)
_ALLOWED_ROLES = {"admin", "annotator", "viewer"}
_TOKEN_TTL_SECONDS = 24 * 60 * 60
_ROLE_RANK = {"viewer": 1, "annotator": 2, "admin": 3}


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    email: EmailStr | None = Field(default=None, max_length=128) 
    role: str = Field(default="viewer")


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)


class RoleUpdateRequest(BaseModel):
    role: str = Field(pattern="^(admin|annotator|viewer)$")


def _api_success(data: dict[str, object]) -> dict[str, object]:
    return {"code": 0, "message": "success", "data": data}


def _api_error(code: int, message: str, status_code: int) -> None:
    raise HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "data": {}},
    )


def _ensure_non_empty_text(value: str, field_name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        _api_error(1001, f"{field_name} is required.", status.HTTP_400_BAD_REQUEST)
    return cleaned


def _auth_secret() -> str:
    return os.getenv("APP_AUTH_SECRET", "dev-only-secret")


def _to_base64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")


def _from_base64url(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode(raw + padding)


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 200_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return (
        f"pbkdf2_sha256${iterations}$"
        f"{_to_base64url(salt)}${_to_base64url(digest)}"
    )


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, iterations_text, salt_b64, digest_b64 = password_hash.split("$", 3)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    iterations = int(iterations_text)
    salt = _from_base64url(salt_b64)
    expected = _from_base64url(digest_b64)
    calculated = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations
    )
    return hmac.compare_digest(calculated, expected)


def _issue_token(user_id: int, role: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "uid": user_id,
        "role": role,
        "exp": int(time.time()) + _TOKEN_TTL_SECONDS,
    }
    header_b64 = _to_base64url(
        json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    payload_raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )
    payload_b64 = _to_base64url(payload_raw)
    signing_input = f"{header_b64}.{payload_b64}"
    signature = hmac.new(
        _auth_secret().encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{header_b64}.{payload_b64}.{_to_base64url(signature)}"


def _decode_token(token: str) -> dict[str, int | str]:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".", 2)
    except ValueError as exc:
        _api_error(1002, "token format is invalid.", status.HTTP_401_UNAUTHORIZED)
        raise exc
    try:
        header = json.loads(_from_base64url(header_b64))
    except Exception as exc:
        _api_error(1002, "token header is invalid.", status.HTTP_401_UNAUTHORIZED)
        raise exc
    if header.get("alg") != "HS256":
        _api_error(1002, "token algorithm is invalid.", status.HTTP_401_UNAUTHORIZED)
    signing_input = f"{header_b64}.{payload_b64}"
    expected_sig = hmac.new(
        _auth_secret().encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    try:
        provided_sig = _from_base64url(signature_b64)
    except Exception as exc:
        _api_error(1002, "token signature is invalid.", status.HTTP_401_UNAUTHORIZED)
        raise exc
    if not hmac.compare_digest(expected_sig, provided_sig):
        _api_error(1002, "token signature mismatch.", status.HTTP_401_UNAUTHORIZED)
    try:
        payload_raw = _from_base64url(payload_b64)
        payload = json.loads(payload_raw)
    except Exception as exc:
        _api_error(1002, "token payload is invalid.", status.HTTP_401_UNAUTHORIZED)
        raise exc
    if int(payload.get("exp", 0)) < int(time.time()):
        _api_error(1002, "token expired.", status.HTTP_401_UNAUTHORIZED)
    return payload


def _public_user(user: sqlite3.Row) -> dict[str, int | str | None]:
    return {
        "user_id": int(user["user_id"]),
        "username": str(user["username"]),
        "email": user["email"],
        "role": str(user["role"]) if user["role"] else "viewer",
    }


def _get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict[str, int | str | None]:
    if credentials is None:
        _api_error(1002, "missing bearer token.", status.HTTP_401_UNAUTHORIZED)
    payload = _decode_token(credentials.credentials)
    user_id = int(payload["uid"])
    with get_connection() as conn:
        user = conn.execute(
            "SELECT user_id, username, email, role FROM LNG_USERS WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if user is None:
        _api_error(1002, "user does not exist.", status.HTTP_401_UNAUTHORIZED)
    return _public_user(user)


def get_current_user(
    user: Annotated[dict[str, int | str | None], Depends(_get_current_user)],
) -> dict[str, int | str | None]:
    return user


def require_roles(*roles: str):
    def _dependency(
        user: Annotated[dict[str, int | str | None], Depends(_get_current_user)],
    ) -> dict[str, int | str | None]:
        current_role = str(user["role"])
        if current_role not in roles:
            _api_error(
                1002,
                f"role not allowed, required: {', '.join(roles)}.",
                status.HTTP_403_FORBIDDEN,
            )
        return user
    return _dependency


def require_annotation_permission(
    user: Annotated[dict[str, int | str | None], Depends(_get_current_user)],
) -> dict[str, int | str | None]:
    current_role = str(user["role"])
    if _ROLE_RANK[current_role] < _ROLE_RANK["annotator"]:
        _api_error(
            1002,
            "annotation write permission denied.",
            status.HTTP_403_FORBIDDEN,
        )
    return user


@router.post("/register")
def register_user(payload: RegisterRequest) -> dict[str, object]:
    # 禁止普通注册时设置 admin 角色（安全加固）
    role = payload.role.strip().lower()
    if role not in _ALLOWED_ROLES:
        _api_error(
            1001,
            f"role must be one of: {', '.join(sorted(_ALLOWED_ROLES))}.",
            status.HTTP_400_BAD_REQUEST,
        )
    if role == "admin":
        _api_error(1001, "admin role cannot be assigned during registration.", status.HTTP_400_BAD_REQUEST)

    username = _ensure_non_empty_text(payload.username, "username")
    password_hash = _hash_password(payload.password)

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO LNG_USERS (username, password_hash, role, email)
                VALUES (?, ?, ?, ?)
                """,
                (username, password_hash, role, payload.email),
            )
            user_id = int(cursor.lastrowid)
            user = conn.execute(
                "SELECT user_id, username, email, role FROM LNG_USERS WHERE user_id = ?",
                (user_id,),
            ).fetchone()
    except sqlite3.IntegrityError as exc:
        _api_error(2002, "username already exists.", status.HTTP_409_CONFLICT)
        raise exc
    if user is None:
        _api_error(3001, "failed to create user.", status.HTTP_500_INTERNAL_SERVER_ERROR)
    return _api_success(_public_user(user))


@router.post("/login")
def login_user(payload: LoginRequest) -> dict[str, object]:
    username = _ensure_non_empty_text(payload.username, "username")
    with get_connection() as conn:
        user = conn.execute(
            """
            SELECT user_id, username, password_hash, role, email
            FROM LNG_USERS
            WHERE username = ?
            """,
            (username,),
        ).fetchone()
    if user is None or not _verify_password(payload.password, str(user["password_hash"])):
        _api_error(1002, "username or password is invalid.", status.HTTP_401_UNAUTHORIZED)
    role = str(user["role"]) if user["role"] else "viewer"
    token = _issue_token(int(user["user_id"]), role)
    return _api_success(
        {"token": token, "token_type": "bearer", "user_info": _public_user(user)}
    )


@router.get("/me")
def who_am_i(
    user: Annotated[dict[str, int | str | None], Depends(_get_current_user)],
) -> dict[str, object]:
    return _api_success(user)


@router.get("/permissions/check/{required_role}")
def check_role_permission(
    required_role: str,
    user: Annotated[dict[str, int | str | None], Depends(_get_current_user)],
) -> dict[str, object]:
    role = required_role.strip().lower()
    if role not in _ALLOWED_ROLES:
        _api_error(
            1001,
            f"required_role must be one of: {', '.join(sorted(_ALLOWED_ROLES))}.",
            status.HTTP_400_BAD_REQUEST,
        )
    current_role = str(user["role"])
    allowed = _ROLE_RANK[current_role] >= _ROLE_RANK[role]
    return _api_success(
        {
            "allowed": allowed,
            "required_role": role,
            "current_role": current_role,
        }
    )


@router.patch("/{user_id}/role")
def update_user_role(
    user_id: int,
    payload: RoleUpdateRequest,
    _: Annotated[dict[str, int | str | None], Depends(require_roles("admin"))],
) -> dict[str, object]:
    new_role = payload.role.strip().lower()
    if new_role not in _ALLOWED_ROLES:
        _api_error(
            1001,
            f"role must be one of: {', '.join(sorted(_ALLOWED_ROLES))}.",
            status.HTTP_400_BAD_REQUEST,
        )
    with get_connection() as conn:
        updated = conn.execute(
            "UPDATE LNG_USERS SET role = ? WHERE user_id = ?",
            (new_role, user_id),
        )
        if updated.rowcount == 0:
            _api_error(2001, "user not found.", status.HTTP_404_NOT_FOUND)
        user = conn.execute(
            "SELECT user_id, username, email, role FROM LNG_USERS WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    if user is None:
        _api_error(2001, "user not found.", status.HTTP_404_NOT_FOUND)
    return _api_success(_public_user(user))


@router.get("/permissions/rules")
def permission_rules() -> dict[str, object]:
    return _api_success(
        {
            "rules": [
                "annotations write endpoints require role >= annotator",
                "user role assignment and maintenance endpoints require role = admin",
                "token validation is executed by API dependency middleware (bearer token)",
            ]
        }
    )