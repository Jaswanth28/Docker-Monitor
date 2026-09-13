"""Docker Hub browsing for the Marketplace tab: search, a curated "popular" list, and tags.

Read-only against Docker Hub's public v2 API — no authentication needed for public
repositories. Results are cached briefly in memory to stay polite to Docker Hub and to
keep the UI snappy when flipping between tabs.
"""
from __future__ import annotations

import time
from typing import Any

import httpx
from fastapi import HTTPException

HUB = "https://hub.docker.com/v2"
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
_CACHE_TTL = 120.0

# Docker Hub's public API has no "trending" endpoint, so the Popular tab is a curated
# list of widely-used images, refreshed with live stats (stars/pulls/description) from
# Docker Hub on each request (subject to the cache above). Anything else is one search away.
POPULAR_REPOS = [
    "library/nginx", "library/redis", "library/postgres", "library/mysql",
    "library/mongo", "library/node", "library/python", "library/ubuntu",
    "library/alpine", "library/httpd", "library/mariadb", "library/rabbitmq",
    "library/wordpress", "library/traefik", "library/memcached",
    "library/elasticsearch", "library/busybox", "library/registry",
    "grafana/grafana", "prom/prometheus", "portainer/portainer-ce",
    "library/adminer", "library/caddy", "hashicorp/vault",
]

_cache: dict[str, tuple[float, Any]] = {}

# Docker Hub session: held in process memory only (never written to disk, never
# echoed back to the frontend) — cleared on container restart or explicit logout.
# The same username/password (or Personal Access Token) doubles as registry auth
# for pushing images, so one sign-in covers both browsing private repos and pushing.
_hub_session: dict[str, str] | None = None


def _cached(key: str) -> Any | None:
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL:
        return hit[1]
    return None


def _store(key: str, value: Any) -> Any:
    _cache[key] = (time.monotonic(), value)
    return value


def _split(repo_name: str) -> tuple[str, str]:
    if "/" in repo_name:
        ns, name = repo_name.split("/", 1)
        return ns, name
    return "library", repo_name


def _fmt_repo(namespace: str, name: str, data: dict) -> dict:
    return {
        "namespace": namespace,
        "name": name,
        "slug": name if namespace == "library" else f"{namespace}/{name}",
        "description": (data.get("short_description") or data.get("description") or "").strip(),
        "stars": data.get("star_count", 0) or 0,
        "pulls": data.get("pull_count", 0) or 0,
        "is_official": bool(data.get("is_official")) or namespace == "library",
        "is_automated": bool(data.get("is_automated")),
        "last_updated": data.get("last_updated"),
    }


async def _get(client: httpx.AsyncClient, url: str, params: dict | None = None) -> dict | None:
    try:
        r = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Docker Hub unreachable: {exc}") from exc
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        raise HTTPException(502, f"Docker Hub returned HTTP {r.status_code}")
    return r.json()


async def search(query: str, page: int = 1, page_size: int = 24) -> dict:
    query = (query or "").strip()
    if not query:
        return {"count": 0, "results": []}
    key = f"search:{query.lower()}:{page}:{page_size}"
    hit = _cached(key)
    if hit is not None:
        return hit
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        data = await _get(client, f"{HUB}/search/repositories/", {"query": query, "page": page, "page_size": page_size})
    raw = (data or {}).get("results", [])
    results = [_fmt_repo(*_split(r["repo_name"]), r) for r in raw]
    out = {"count": (data or {}).get("count", len(results)), "results": results}
    return _store(key, out)


async def popular() -> dict:
    hit = _cached("popular")
    if hit is not None:
        return hit
    results: list[dict] = []
    errors: list[str] = []
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for slug in POPULAR_REPOS:
            ns, name = _split(slug)
            try:
                data = await _get(client, f"{HUB}/repositories/{ns}/{name}/")
            except HTTPException as exc:
                errors.append(str(exc.detail))
                continue
            if data:
                results.append(_fmt_repo(ns, name, data))
    results.sort(key=lambda r: r["pulls"], reverse=True)
    out = {"results": results, "error": "; ".join(errors[:1]) if not results and errors else None}
    return _store("popular", out)


async def hub_login(username: str, password: str) -> dict:
    """Validate credentials (password or Personal Access Token) against Docker Hub
    and hold them in memory for subsequent pushes."""
    global _hub_session
    username = (username or "").strip()
    if not username or not password:
        raise HTTPException(400, "Username and password/token are required")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            r = await client.post(f"{HUB}/users/login/", json={"username": username, "password": password})
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Docker Hub unreachable: {exc}") from exc
    if r.status_code == 401:
        raise HTTPException(401, "Invalid Docker Hub username or password/token")
    if r.status_code >= 400:
        raise HTTPException(502, f"Docker Hub returned HTTP {r.status_code}")
    _hub_session = {"username": username, "password": password}
    return {"ok": True, "username": username}


def hub_logout() -> dict:
    global _hub_session
    _hub_session = None
    return {"ok": True}


def hub_status() -> dict:
    return {"signed_in": _hub_session is not None, "username": (_hub_session or {}).get("username")}


def hub_credentials() -> dict[str, str] | None:
    return _hub_session


async def repo_detail(namespace: str, name: str) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        data = await _get(client, f"{HUB}/repositories/{namespace}/{name}/")
    if not data:
        raise HTTPException(404, "Image not found on Docker Hub")
    return _fmt_repo(namespace, name, data)


async def tags(namespace: str, name: str, q: str | None = None, page: int = 1, page_size: int = 24) -> dict:
    key = f"tags:{namespace}/{name}:{(q or '').lower()}:{page}:{page_size}"
    hit = _cached(key)
    if hit is not None:
        return hit
    params: dict[str, Any] = {"page": page, "page_size": page_size, "ordering": "-last_updated"}
    if q:
        params["name"] = q
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        data = await _get(client, f"{HUB}/repositories/{namespace}/{name}/tags", params)
    if data is None:
        raise HTTPException(404, "Image not found on Docker Hub")
    results = []
    for t in data.get("results", []):
        imgs = t.get("images") or []
        archs = sorted({i.get("architecture") for i in imgs if i.get("architecture")})
        size = max((i.get("size") or 0) for i in imgs) if imgs else (t.get("full_size") or 0)
        results.append({
            "name": t.get("name"),
            "digest": t.get("digest"),
            "last_updated": t.get("last_updated"),
            "size": size,
            "architectures": archs,
        })
    out = {"count": data.get("count", len(results)), "results": results}
    return _store(key, out)
