"""Thin wrapper around the Docker SDK. All calls are blocking; routers run them in a threadpool."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import docker
from docker.errors import APIError, NotFound
from fastapi import HTTPException

_client: docker.DockerClient | None = None


def client() -> docker.DockerClient:
    global _client
    if _client is None:
        _client = docker.from_env()
    return _client


def _ports(attrs: dict) -> list[dict]:
    out = []
    for private, bindings in (attrs.get("NetworkSettings", {}).get("Ports") or {}).items():
        if bindings:
            for b in bindings:
                out.append({"private": private, "host_ip": b.get("HostIp"), "host_port": b.get("HostPort")})
        else:
            out.append({"private": private, "host_ip": None, "host_port": None})
    return out


def summarize(c) -> dict[str, Any]:
    a = c.attrs
    labels = c.labels or {}
    return {
        "id": c.id,
        "short_id": c.short_id,
        "name": c.name,
        "image": a.get("Config", {}).get("Image") or (c.image.tags[0] if c.image and c.image.tags else c.image.short_id if c.image else "?"),
        "state": c.status,
        "status": a.get("State", {}).get("Status"),
        "health": (a.get("State", {}).get("Health") or {}).get("Status"),
        "created": a.get("Created"),
        "started_at": a.get("State", {}).get("StartedAt"),
        "ports": _ports(a),
        "project": labels.get("com.docker.compose.project"),
        "service": labels.get("com.docker.compose.service"),
        "protected": labels.get("dm.protected") == "true",
        "restart_count": a.get("RestartCount", 0),
    }


def list_containers(all_: bool = True) -> list[dict]:
    return [summarize(c) for c in client().containers.list(all=all_)]


def container_ids_for_project(project: str) -> list[str]:
    return [c.id for c in client().containers.list(all=True) if (c.labels or {}).get("com.docker.compose.project") == project]


def get(cid: str):
    try:
        return client().containers.get(cid)
    except NotFound:
        raise HTTPException(404, f"Container {cid} not found")


def action(cid: str, act: str) -> dict:
    c = get(cid)
    if (c.labels or {}).get("dm.protected") == "true" and act in {"stop", "remove", "kill", "pause"}:
        raise HTTPException(400, "This container belongs to the dashboard stack and is protected")
    try:
        if act == "start":
            c.start()
        elif act == "stop":
            c.stop(timeout=15)
        elif act == "restart":
            c.restart(timeout=15)
        elif act == "kill":
            c.kill()
        elif act == "pause":
            c.pause()
        elif act == "unpause":
            c.unpause()
        elif act == "remove":
            c.remove(force=True)
            return {"ok": True, "state": "removed"}
        else:
            raise HTTPException(400, f"Unknown action {act}")
    except APIError as e:
        raise HTTPException(500, e.explanation or str(e))
    c.reload()
    return {"ok": True, "state": c.status}


def _calc_cpu(s: dict) -> float:
    try:
        cpu_delta = s["cpu_stats"]["cpu_usage"]["total_usage"] - s["precpu_stats"]["cpu_usage"]["total_usage"]
        sys_delta = s["cpu_stats"]["system_cpu_usage"] - s["precpu_stats"]["system_cpu_usage"]
        ncpu = s["cpu_stats"].get("online_cpus") or len(s["cpu_stats"]["cpu_usage"].get("percpu_usage") or [1])
        return round(cpu_delta / sys_delta * ncpu * 100, 2) if sys_delta > 0 and cpu_delta > 0 else 0.0
    except (KeyError, ZeroDivisionError, TypeError):
        return 0.0


def stats(cid: str) -> dict:
    c = get(cid)
    if c.status != "running":
        return {"id": c.id, "cpu_percent": 0, "mem_usage": 0, "mem_limit": 0, "mem_percent": 0, "net_rx": 0, "net_tx": 0}
    s = c.stats(stream=False)
    mem = s.get("memory_stats", {})
    usage = mem.get("usage", 0) - (mem.get("stats", {}).get("inactive_file", 0) or 0)
    limit = mem.get("limit", 0) or 1
    nets = s.get("networks") or {}
    return {
        "id": c.id,
        "cpu_percent": _calc_cpu(s),
        "mem_usage": usage,
        "mem_limit": limit,
        "mem_percent": round(usage / limit * 100, 2),
        "net_rx": sum(n.get("rx_bytes", 0) for n in nets.values()),
        "net_tx": sum(n.get("tx_bytes", 0) for n in nets.values()),
    }


def all_stats() -> list[dict]:
    out = []
    for c in client().containers.list():
        try:
            out.append(stats(c.id))
        except Exception:  # noqa: BLE001
            pass
    return out


def logs(cid: str, tail: int = 200) -> str:
    return get(cid).logs(tail=tail, timestamps=True).decode(errors="replace")


def inspect(cid: str) -> dict:
    return get(cid).attrs


def _all_containers():
    return client().containers.list(all=True)


def _used_image_ids() -> set[str]:
    ids: set[str] = set()
    for c in _all_containers():
        img_id = c.attrs.get("Image")
        if img_id:
            ids.add(img_id)
    return ids


def _used_volume_names() -> set[str]:
    names: set[str] = set()
    for c in _all_containers():
        for m in c.attrs.get("Mounts") or []:
            if m.get("Type") == "volume" and m.get("Name"):
                names.add(m["Name"])
    return names


def _used_network_names() -> set[str]:
    names: set[str] = set()
    for c in _all_containers():
        nets = (c.attrs.get("NetworkSettings") or {}).get("Networks") or {}
        names.update(nets.keys())
    return names


def list_images() -> list[dict]:
    used = _used_image_ids()
    out = []
    for i in client().images.list():
        out.append({
            "id": i.id,
            "short_id": i.short_id,
            "tags": i.tags,
            "size": i.attrs.get("Size", 0),
            "created": i.attrs.get("Created"),
            "in_use": i.id in used,
        })
    return out


def remove_image(image_id: str, force: bool = False) -> dict:
    try:
        client().images.remove(image_id, force=force)
    except NotFound:
        raise HTTPException(404, "Image not found")
    except APIError as e:
        raise HTTPException(409, e.explanation or str(e))
    return {"ok": True}


def list_volumes() -> list[dict]:
    used = _used_volume_names()
    return [
        {
            "name": v.name,
            "driver": v.attrs.get("Driver"),
            "mountpoint": v.attrs.get("Mountpoint"),
            "created": v.attrs.get("CreatedAt"),
            "in_use": v.name in used,
        }
        for v in client().volumes.list()
    ]


def remove_volume(name: str, force: bool = False) -> dict:
    try:
        client().volumes.get(name).remove(force=force)
    except NotFound:
        raise HTTPException(404, "Volume not found")
    except APIError as e:
        raise HTTPException(409, e.explanation or str(e))
    return {"ok": True}


DEFAULT_NETWORKS = {"bridge", "host", "none"}


def list_networks() -> list[dict]:
    used = _used_network_names()
    return [
        {
            "id": n.short_id,
            "name": n.name,
            "driver": n.attrs.get("Driver"),
            "scope": n.attrs.get("Scope"),
            "in_use": n.name in used,
            "protected": n.name in DEFAULT_NETWORKS,
        }
        for n in client().networks.list()
    ]


def remove_network(network_id: str) -> dict:
    try:
        net = client().networks.get(network_id)
        if net.name in DEFAULT_NETWORKS:
            raise HTTPException(400, f"'{net.name}' is a built-in Docker network and can't be removed")
        net.remove()
    except NotFound:
        raise HTTPException(404, "Network not found")
    except APIError as e:
        raise HTTPException(409, e.explanation or str(e))
    return {"ok": True}


def prune(what: str) -> dict:
    cl = client()
    if what == "containers":
        return cl.containers.prune()
    if what == "images":
        return cl.images.prune(filters={"dangling": True})
    if what == "volumes":
        return cl.volumes.prune()
    if what == "networks":
        return cl.networks.prune()
    raise HTTPException(400, "Unknown prune target")


def system_info() -> dict:
    # Lazy import: platform_info must not import this module at load time.
    from .platform_info import detect_platform

    info = client().info()
    ver = client().version()
    try:
        plat = detect_platform()
    except Exception:  # noqa: BLE001
        plat = None
    return {
        "server_version": ver.get("Version"),
        "api_version": ver.get("ApiVersion"),
        "os": info.get("OperatingSystem"),
        "kernel": info.get("KernelVersion"),
        "arch": info.get("Architecture"),
        "ncpu": info.get("NCPU"),
        "mem_total": info.get("MemTotal"),
        "containers": info.get("Containers"),
        "containers_running": info.get("ContainersRunning"),
        "containers_paused": info.get("ContainersPaused"),
        "containers_stopped": info.get("ContainersStopped"),
        "images": info.get("Images"),
        "docker_root": info.get("DockerRootDir"),
        "now": datetime.now(timezone.utc).isoformat(),
        "platform": plat,
    }
