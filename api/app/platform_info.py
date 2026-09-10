"""Runtime platform detection (Apple Silicon, NVIDIA/AMD/Intel, hybrid GPUs)."""
from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import docker

log = logging.getLogger("dm.platform")

PCI_VENDOR = {
    "0x10de": "nvidia", "10de": "nvidia",
    "0x1002": "amd", "1002": "amd",
    "0x8086": "intel", "8086": "intel",
}


def _host_which(bin_name: str) -> bool:
    if shutil.which(bin_name):
        return True
    nsenter = shutil.which("nsenter")
    if not nsenter:
        return False
    try:
        r = subprocess.run(
            [nsenter, "-t", "1", "-m", "-u", "-i", "-n", "--", "which", bin_name],
            capture_output=True, text=True, timeout=3, check=False,
        )
        return r.returncode == 0 and bool((r.stdout or "").strip())
    except Exception:  # noqa: BLE001
        return False


def _drm_vendors() -> set[str]:
    found: set[str] = set()
    drm = Path("/sys/class/drm")
    names: list[str] = []
    if drm.is_dir():
        names = [p.name for p in drm.iterdir()]
    else:
        try:
            r = subprocess.run(
                ["sh", "-c", "ls -1 /sys/class/drm 2>/dev/null"],
                capture_output=True, text=True, timeout=3, check=False,
            )
            names = (r.stdout or "").split()
        except Exception:  # noqa: BLE001
            return found
    for name in names:
        if not re.fullmatch(r"card\d+", name):
            continue
        try:
            vendor_raw = Path(f"/sys/class/drm/{name}/device/vendor").read_text().strip().lower()
        except OSError:
            continue
        v = PCI_VENDOR.get(vendor_raw) or PCI_VENDOR.get(vendor_raw.replace("0x", ""))
        if v:
            found.add(v)
    return found


_cached: dict[str, Any] | None = None
_cached_at = 0.0
_CACHE_TTL = 30.0


def detect_platform(*, force: bool = False) -> dict[str, Any]:
    """Classify host for UI copy and feature gates (cached briefly)."""
    global _cached, _cached_at
    now = time.monotonic()
    if not force and _cached is not None and (now - _cached_at) < _CACHE_TTL:
        return _cached

    machine = (platform.machine() or "").lower()
    arch = "arm64" if machine in {"aarch64", "arm64"} else ("amd64" if machine in {"x86_64", "amd64"} else machine or "unknown")

    # Use the Docker SDK directly — do not import docker_service (avoids circular import).
    os_name = kernel = docker_os = ""
    try:
        info = docker.from_env().info()
        os_name = str(info.get("OperatingSystem") or "")
        kernel = str(info.get("KernelVersion") or "")
        docker_os = str(info.get("OSType") or "")
    except Exception as exc:  # noqa: BLE001
        log.debug("docker info failed: %s", exc)

    blob = f"{os_name} {kernel} {docker_os}".lower()
    docker_desktop = "docker desktop" in blob or "dockerdesktop" in blob.replace(" ", "")
    linuxkit = "linuxkit" in kernel.lower()

    nvidia = _host_which("nvidia-smi")
    vendors = _drm_vendors()
    if nvidia:
        vendors.add("nvidia")
    # tools hint
    if _host_which("rocm-smi") or _host_which("amd-smi"):
        vendors.add("amd")

    apple_silicon = arch == "arm64" and not vendors and (docker_desktop or linuxkit)

    vendor_list = sorted(vendors)
    if apple_silicon:
        kind = "apple_silicon"
        label = "Apple Silicon (Docker Desktop)"
        gpu_note = (
            "Apple Metal GPU is not exposed to Linux containers on Docker Desktop. "
            "Container CPU/RAM/disk still work."
        )
    elif len(vendor_list) > 1:
        kind = "hybrid_gpu"
        label = f"Hybrid GPU ({' + '.join(v.upper() for v in vendor_list)})"
        gpu_note = None
    elif vendor_list == ["nvidia"]:
        kind = "nvidia_arm" if arch == "arm64" else "nvidia_x86"
        label = "ARM64 + NVIDIA" if arch == "arm64" else "NVIDIA GPU"
        gpu_note = None
    elif vendor_list == ["amd"]:
        kind = "amd_gpu"
        label = "AMD GPU"
        gpu_note = None
    elif vendor_list == ["intel"]:
        kind = "intel_gpu"
        label = "Intel GPU (integrated / Arc)"
        gpu_note = None
    elif arch == "arm64":
        kind = "arm64"
        label = "ARM64"
        gpu_note = "No GPU detected on this ARM host."
    else:
        kind = "generic"
        label = arch.upper() if arch else "Unknown"
        gpu_note = None if vendor_list else "No GPU detected (NVIDIA / AMD / Intel)."

    result = {
        "kind": kind,
        "label": label,
        "arch": arch,
        "machine": machine,
        "docker_desktop": docker_desktop,
        "apple_silicon": apple_silicon,
        "nvidia": "nvidia" in vendors,
        "amd": "amd" in vendors,
        "intel": "intel" in vendors,
        "gpu_vendors": vendor_list,
        "gpu_vendor": vendor_list[0] if len(vendor_list) == 1 else ("hybrid" if vendor_list else None),
        "gpu_note": gpu_note,
        "os": os_name or None,
        "kernel": kernel or None,
        "host_fs": os.environ.get("HOST_FS", "/hostfs"),
    }
    _cached = result
    _cached_at = now
    return result
