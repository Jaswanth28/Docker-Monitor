from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

import bcrypt
from fastapi import Depends, HTTPException, Query, WebSocket, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from .config import settings
from .secrets import store

Role = Literal["admin", "viewer"]
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


class User(BaseModel):
    username: str
    role: Role


def _check(username: str, password: str) -> User | None:
    candidates = [
        (store.get("ADMIN_USERNAME"), store.get("ADMIN_PASSWORD_HASH"), "admin"),
        (store.get("VIEWER_USERNAME"), store.get("VIEWER_PASSWORD_HASH"), "viewer"),
    ]
    for name, pw_hash, role in candidates:
        if name and pw_hash and username == name:
            try:
                if bcrypt.checkpw(password.encode(), pw_hash.encode()):
                    return User(username=name, role=role)  # type: ignore[arg-type]
            except ValueError:
                return None
            return None
    return None


def authenticate(username: str, password: str) -> str:
    user = _check(username, password)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_ttl_minutes)
    return jwt.encode({"sub": user.username, "role": user.role, "exp": exp}, store.get("JWT_SECRET"), settings.jwt_algorithm)


def decode(token: str | None) -> User:
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = jwt.decode(token, store.get("JWT_SECRET"), algorithms=[settings.jwt_algorithm])
        return User(username=payload["sub"], role=payload["role"])
    except (JWTError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")


def current_user(token: str | None = Depends(oauth2)) -> User:
    return decode(token)


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return user


async def ws_user(ws: WebSocket, token: str | None = Query(default=None)) -> User | None:
    """Websocket auth via ?token=... query param."""
    try:
        return decode(token)
    except HTTPException:
        await ws.close(code=4401)
        return None
