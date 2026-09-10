"""Host GPU sampling via nvidia-smi (direct or nsenter into PID 1).

Maps compute PIDs to Docker containers through /proc cgroups so the UI can
show which container holds how much VRAM.
"""
from __future__ import annotations

import logging
import re
import shutil
import subprocess
from typing import Any

log = logging.getLogger("dm.gpu")

# docker-<64hex>.scope  |  /docker/<id>  |  cri-containerd-<id>
_CGROUP_RE = re.compile(
    r"(?:docker[-/]|cri-containerd-)([0-9a-f]{12,64})",
    re.IGNORECASE,
)


def _run(argv: list[str], timeout: float = 8.0) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        log.debug("gpu cmd failed %s: %s", argv[:3], exc)
        return None


_last_nvidia_error: str | None = None


def _nvidia_smi(*args: str) -> str | None:
    """Run nvidia-smi on the host if possible (nsenter), else in-container.

    Needs host NVIDIA devices visible to this container (compose deploy.devices /
    device_cgroup_rules / NVIDIA Container Toolkit). Otherwise NVML returns
    "Unknown Error" even when the host binary is found via nsenter.
    """
    global _last_nvidia_error
    base = ["nvidia-smi", *args]
    attempts: list[list[str]] = []
    nsenter = shutil.which("nsenter")
    if nsenter:
        # Host mount + net so we use host driver libs and /dev; keep our pid NS.
        attempts.append([nsenter, "-t", "1", "-m", "-u", "-i", "-n", "--", *base])
    attempts.append(base)

    last_err = None
    for argv in attempts:
        r = _run(argv)
        if not r:
            continue
        if r.returncode == 0 and r.stdout.strip():
            _last_nvidia_error = None
            return r.stdout
        err = (r.stderr or r.stdout or "").strip()
        if err:
            last_err = err.splitlines()[-1][:240]
            log.debug("nvidia-smi failed (%s): %s", argv[0], last_err)
    _last_nvidia_error = last_err
    return None


def _parse_num(s: str) -> float | None:
    s = (s or "").strip()
    if not s or s.upper() in {"[N/A]", "N/A", "NA"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def container_id_for_pid(pid: int) -> str | None:
    """Resolve a host PID to a Docker container id (full or short) via cgroup."""
    try:
        with open(f"/proc/{pid}/cgroup", encoding="utf-8") as f:
            text = f.read()
    except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
        return None
    m = _CGROUP_RE.search(text)
    return m.group(1) if m else None


def _match_cid(raw: str | None, known: dict[str, str]) -> str | None:
    """Map a cgroup id fragment to a known full container id."""
    if not raw:
        return None
    if raw in known:
        return known[raw]
    for cid in known.values():
        if cid.startswith(raw) or raw.startswith(cid[:12]):
            return cid
    return None


def sample_gpus(container_ids: list[str] | None = None) -> dict[str, Any]:
    """Return current GPU snapshot, or {available: False, ...} when no NVIDIA GPU."""
    known: dict[str, str] = {}
    for cid in container_ids or []:
        known[cid] = cid
        known[cid[:12]] = cid

    gpu_out = _nvidia_smi(
        "--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
    )
    if not gpu_out:
        hint = _last_nvidia_error or "nvidia-smi not available (no GPU or missing host access)"
        if _last_nvidia_error and "NVML" in _last_nvidia_error:
            hint = (
                f"{_last_nvidia_error} — grant GPU devices to the app container "
                "(NVIDIA Container Toolkit / deploy.devices / device_cgroup_rules) and recreate"
            )
        return {
            "available": False,
            "gpus": [],
            "processes": [],
            "by_container": {},
            "totals": {"mem_used": 0, "mem_total": 0, "util_percent": 0.0, "mem_percent": 0.0, "count": 0},
            "error": hint,
        }

    gpus: list[dict[str, Any]] = []
    uuid_to_index: dict[str, int] = {}
    for line in gpu_out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue
        idx = int(_parse_num(parts[0]) or 0)
        uuid = parts[1]
        mem_used = int((_parse_num(parts[4]) or 0) * 1024 * 1024)  # MiB → bytes
        mem_total = int((_parse_num(parts[5]) or 0) * 1024 * 1024)
        util = _parse_num(parts[3]) or 0.0
        temp = _parse_num(parts[6]) if len(parts) > 6 else None
        power = _parse_num(parts[7]) if len(parts) > 7 else None
        uuid_to_index[uuid] = idx
        gpus.append({
            "index": idx,
            "uuid": uuid,
            "name": parts[2],
            "util_percent": round(util, 1),
            "mem_used": mem_used,
            "mem_total": mem_total,
            "mem_percent": round(mem_used / mem_total * 100, 1) if mem_total else 0.0,
            "temperature_c": temp,
            "power_w": power,
        })

    proc_out = _nvidia_smi(
        "--query-compute-apps=gpu_uuid,pid,process_name,used_gpu_memory",
        "--format=csv,noheader,nounits",
    )
    processes: list[dict[str, Any]] = []
    by_container: dict[str, dict[str, Any]] = {}

    if proc_out:
        for line in proc_out.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            uuid, pid_s, pname, mem_s = parts[0], parts[1], parts[2], parts[3]
            pid = int(_parse_num(pid_s) or 0)
            mem = int((_parse_num(mem_s) or 0) * 1024 * 1024)
            raw_cid = container_id_for_pid(pid) if pid else None
            cid = _match_cid(raw_cid, known) if known else raw_cid
            if not cid and raw_cid:
                cid = raw_cid
            entry = {
                "gpu_uuid": uuid,
                "gpu_index": uuid_to_index.get(uuid),
                "pid": pid,
                "process_name": pname,
                "mem_used": mem,
                "container_id": cid,
            }
            processes.append(entry)
            if cid:
                agg = by_container.setdefault(cid, {
                    "container_id": cid,
                    "mem_used": 0,
                    "processes": 0,
                    "gpu_indexes": set(),
                })
                agg["mem_used"] += mem
                agg["processes"] += 1
                if entry["gpu_index"] is not None:
                    agg["gpu_indexes"].add(entry["gpu_index"])

    by_container_out: dict[str, dict[str, Any]] = {}
    for cid, agg in by_container.items():
        by_container_out[cid] = {
            "container_id": cid,
            "mem_used": agg["mem_used"],
            "processes": agg["processes"],
            "gpu_indexes": sorted(agg["gpu_indexes"]),
        }

    mem_used = sum(g["mem_used"] for g in gpus)
    mem_total = sum(g["mem_total"] for g in gpus)
    util_avg = round(sum(g["util_percent"] for g in gpus) / len(gpus), 1) if gpus else 0.0

    return {
        "available": True,
        "gpus": gpus,
        "processes": processes,
        "by_container": by_container_out,
        "totals": {
            "mem_used": mem_used,
            "mem_total": mem_total,
            "mem_percent": round(mem_used / mem_total * 100, 1) if mem_total else 0.0,
            "util_percent": util_avg,
            "count": len(gpus),
        },
        "error": None,
    }
