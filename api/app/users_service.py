"""Multi-user account store, backed by a JSON file on a persistent volume.

Replaces the old "exactly one admin + one viewer, both from secrets" model.
On first run, the store is seeded once from the legacy ADMIN_USERNAME /
ADMIN_PASSWORD_HASH / VIEWER_USERNAME / VIEWER_PASSWORD_HASH secrets so
existing deployments keep working without any manual migration step.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Literal, TypedDict

import bcrypt
from fastapi import HTTPException

from .secrets import store

Role = Literal["admin", "viewer"]

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
USERS_FILE = DATA_DIR / "users.json"

_lock = threading.Lock()


class UserRecord(TypedDict):
    username: str
    password_hash: str
    role: Role


def _read() -> list[UserRecord]:
    if not USERS_FILE.exists():
        return []
    try:
        data = json.loads(USERS_FILE.read_text())
        return data.get("users", [])
    except (json.JSONDecodeError, OSError):
        return []


def _write(users: list[UserRecord]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = USERS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"users": users}, indent=2))
    tmp.replace(USERS_FILE)


def _seed_if_empty() -> list[UserRecord]:
    users = _read()
    if users or USERS_FILE.exists():
        return users
    seeded: list[UserRecord] = []
    admin_name, admin_hash = store.get("ADMIN_USERNAME"), store.get("ADMIN_PASSWORD_HASH")
    if admin_name and admin_hash:
        seeded.append({"username": admin_name, "password_hash": admin_hash, "role": "admin"})
    viewer_name, viewer_hash = store.get("VIEWER_USERNAME"), store.get("VIEWER_PASSWORD_HASH")
    if viewer_name and viewer_hash:
        seeded.append({"username": viewer_name, "password_hash": viewer_hash, "role": "viewer"})
    if seeded:
        _write(seeded)
    return seeded


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def list_users() -> list[dict]:
    with _lock:
        users = _seed_if_empty()
    return [{"username": u["username"], "role": u["role"]} for u in users]


def authenticate(username: str, password: str) -> dict | None:
    with _lock:
        users = _seed_if_empty()
    for u in users:
        if u["username"] == username:
            try:
                if bcrypt.checkpw(password.encode(), u["password_hash"].encode()):
                    return {"username": u["username"], "role": u["role"]}
            except ValueError:
                return None
            return None
    return None


def _admin_count(users: list[UserRecord]) -> int:
    return sum(1 for u in users if u["role"] == "admin")


def create_user(username: str, password: str, role: Role) -> dict:
    username = username.strip()
    if not username or not password:
        raise HTTPException(400, "Username and password are required")
    with _lock:
        users = _seed_if_empty()
        if any(u["username"] == username for u in users):
            raise HTTPException(409, f"User '{username}' already exists")
        users.append({"username": username, "password_hash": _hash(password), "role": role})
        _write(users)
    return {"username": username, "role": role}


def update_user(username: str, password: str | None, role: Role | None) -> dict:
    with _lock:
        users = _seed_if_empty()
        for u in users:
            if u["username"] == username:
                if role and role != u["role"] and u["role"] == "admin" and _admin_count(users) <= 1:
                    raise HTTPException(409, "Can't demote the last admin account")
                if password:
                    u["password_hash"] = _hash(password)
                if role:
                    u["role"] = role
                _write(users)
                return {"username": u["username"], "role": u["role"]}
    raise HTTPException(404, f"User '{username}' not found")


def delete_user(username: str, requester: str) -> dict:
    if username == requester:
        raise HTTPException(409, "You can't delete your own account")
    with _lock:
        users = _seed_if_empty()
        target = next((u for u in users if u["username"] == username), None)
        if not target:
            raise HTTPException(404, f"User '{username}' not found")
        if target["role"] == "admin" and _admin_count(users) <= 1:
            raise HTTPException(409, "Can't delete the last admin account")
        users = [u for u in users if u["username"] != username]
        _write(users)
    return {"ok": True}
