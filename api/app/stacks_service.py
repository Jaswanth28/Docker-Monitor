"""Compose stack management: one folder per stack under STACKS_DIR, each holding docker-compose.yml."""
from __future__ import annotations

import asyncio
import re
import shutil
from pathlib import Path

import yaml
from fastapi import HTTPException

from .config import settings
from .docker_service import client

COMPOSE_NAMES = ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")


def _dir(name: str) -> Path:
    if not NAME_RE.match(name):
        raise HTTPException(400, "Stack name must be lowercase letters, digits, '-' or '_' and start with a letter/digit")
    p = (settings.stacks_dir / name).resolve()
    if settings.stacks_dir not in p.parents:
        raise HTTPException(400, "Invalid stack path")
    return p


def _compose_file(d: Path) -> Path | None:
    for n in COMPOSE_NAMES:
        if (d / n).exists():
            return d / n
    return None


def validate_yaml(text: str) -> dict:
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise HTTPException(422, f"Invalid YAML: {e}")
    if not isinstance(doc, dict) or "services" not in doc or not isinstance(doc["services"], dict):
        raise HTTPException(422, "Compose file must be a mapping with a 'services' key")
    return doc


def _project_status() -> dict[str, dict]:
    """Map compose project name -> {running, total}. Uses container labels so it needs no CLI call."""
    out: dict[str, dict] = {}
    for c in client().containers.list(all=True):
        proj = (c.labels or {}).get("com.docker.compose.project")
        if not proj:
            continue
        s = out.setdefault(proj, {"running": 0, "total": 0, "containers": []})
        s["total"] += 1
        if c.status == "running":
            s["running"] += 1
        s["containers"].append({"id": c.id, "name": c.name, "state": c.status, "service": c.labels.get("com.docker.compose.service")})
    return out


def list_stacks() -> list[dict]:
    settings.stacks_dir.mkdir(parents=True, exist_ok=True)
    status = _project_status()
    stacks = []
    for d in sorted(settings.stacks_dir.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        cf = _compose_file(d)
        services: list[str] = []
        if cf:
            try:
                doc = yaml.safe_load(cf.read_text()) or {}
                services = list((doc.get("services") or {}).keys())
            except yaml.YAMLError:
                pass
        st = status.get(d.name, {"running": 0, "total": 0, "containers": []})
        stacks.append({
            "name": d.name,
            "path": str(d),
            "compose_file": cf.name if cf else None,
            "services": services,
            "running": st["running"],
            "total": st["total"],
            "containers": st["containers"],
            "state": "running" if st["total"] and st["running"] == st["total"] else "partial" if st["running"] else "stopped" if st["total"] else "not created",
            "managed": True,
        })
    # compose projects running from elsewhere (e.g. the dashboard itself)
    for proj, st in status.items():
        if not any(s["name"] == proj for s in stacks):
            stacks.append({"name": proj, "path": None, "compose_file": None, "services": sorted({c["service"] for c in st["containers"] if c["service"]}),
                           "running": st["running"], "total": st["total"], "containers": st["containers"],
                           "state": "running" if st["running"] == st["total"] else "partial", "managed": False})
    return stacks


def read_stack(name: str) -> dict:
    d = _dir(name)
    cf = _compose_file(d)
    if not cf:
        raise HTTPException(404, "Stack not found")
    env = d / ".env"
    return {"name": name, "compose": cf.read_text(), "compose_file": cf.name, "env": env.read_text() if env.exists() else ""}


def write_stack(name: str, compose: str, env: str | None = None, create: bool = False) -> dict:
    validate_yaml(compose)
    d = _dir(name)
    if create and d.exists():
        raise HTTPException(409, f"Stack '{name}' already exists")
    if not create and not d.exists():
        raise HTTPException(404, "Stack not found")
    d.mkdir(parents=True, exist_ok=True)
    cf = _compose_file(d) or d / "docker-compose.yml"
    cf.write_text(compose)
    if env is not None:
        (d / ".env").write_text(env)
    return {"ok": True, "name": name, "path": str(d)}


def delete_stack(name: str) -> dict:
    d = _dir(name)
    if not d.exists():
        raise HTTPException(404, "Stack not found")
    shutil.rmtree(d)
    return {"ok": True}


async def compose(name: str, *args: str, timeout: int = 600) -> dict:
    d = _dir(name)
    cf = _compose_file(d)
    if not cf:
        raise HTTPException(404, "Stack not found")
    cmd = ["docker", "compose", "-p", name, "-f", str(cf), *args]
    proc = await asyncio.create_subprocess_exec(*cmd, cwd=str(d), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise HTTPException(504, "docker compose timed out")
    text = out.decode(errors="replace")
    if proc.returncode != 0:
        raise HTTPException(500, text[-4000:] or f"docker compose exited {proc.returncode}")
    return {"ok": True, "output": text[-8000:]}


ACTIONS = {
    "up": ["up", "-d", "--remove-orphans"],
    "start": ["up", "-d", "--remove-orphans"],
    "down": ["down"],
    "stop": ["stop"],
    "restart": ["restart"],
    "pull": ["pull"],
    "recreate": ["up", "-d", "--force-recreate", "--remove-orphans"],
    # Rebuild images from source (no cache) then recreate containers from them.
    "rebuild": ["build", "--pull", "--no-cache"],
}

# Actions requiring a second command after ACTIONS[...] completes.
CHAINED: dict[str, list[str]] = {
    "rebuild": ["up", "-d", "--force-recreate", "--remove-orphans"],
}
