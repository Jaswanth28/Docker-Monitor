"""Multi-vendor GPU sampling: NVIDIA (nvidia-smi), AMD (amdgpu sysfs / rocm-smi), Intel (i915/Xe).

Maps NVIDIA compute PIDs to Docker containers via /proc cgroups. AMD/Intel currently
expose device-level util/memory (per-container attribution is NVIDIA-first).
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

from .platform_info import detect_platform

log = logging.getLogger("dm.gpu")

_CGROUP_RE = re.compile(
    r"(?:docker[-/]|cri-containerd-)([0-9a-f]{12,64})",
    re.IGNORECASE,
)

PCI_VENDOR = {
    "0x10de": "nvidia",
    "10de": "nvidia",
    "0x1002": "amd",
    "1002": "amd",
    "0x8086": "intel",
    "8086": "intel",
}

_last_tool_error: str | None = None

# WSL2's GPU shim (nvidia-smi + libnvidia-ml/libcuda) is injected by the Windows
# host into /usr/lib/wsl/lib on the WSL distro itself. It is never on a plain
# container's $PATH — and critically, entering the host's mount namespace with
# nsenter does NOT give the child process the host's $PATH (nsenter -m only
# swaps the filesystem view; the exec's PATH lookup still uses this process's
# own environment). So a bare `nsenter -t 1 -m -- nvidia-smi` fails to find the
# binary even though it's reachable in that mount namespace. We resolve the
# absolute path once (checking WSL's location first, then normal Linux
# locations) and always exec by full path afterwards.
_CANDIDATE_NVIDIA_SMI_PATHS = [
    "/usr/lib/wsl/lib/nvidia-smi",  # WSL2 GPU passthrough (Windows host + WSLg)
    "/usr/bin/nvidia-smi",
    "/usr/local/bin/nvidia-smi",
    "/opt/nvidia/bin/nvidia-smi",
    "/run/nvidia/bin/nvidia-smi",
]
_nvidia_smi_path: str | None = None
_nvidia_smi_searched = False


def _run(argv: list[str], timeout: float = 8.0) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        log.debug("gpu cmd failed %s: %s", argv[:3], exc)
        return None


def _host_run(*args: str, timeout: float = 8.0) -> str | None:
    """Run on host via nsenter when possible, else in-container."""
    global _last_tool_error
    attempts: list[list[str]] = []
    nsenter = shutil.which("nsenter")
    if nsenter:
        attempts.append([nsenter, "-t", "1", "-m", "-u", "-i", "-n", "--", *args])
    attempts.append(list(args))
    last_err = None
    for argv in attempts:
        r = _run(argv, timeout=timeout)
        if not r:
            continue
        if r.returncode == 0 and (r.stdout or "").strip():
            _last_tool_error = None
            return r.stdout
        err = (r.stderr or r.stdout or "").strip()
        if err:
            last_err = err.splitlines()[-1][:240]
    _last_tool_error = last_err
    return None


def _locate_nvidia_smi() -> str | None:
    """Find the real nvidia-smi binary, checking the host mount namespace by
    absolute path so the WSL2 (/usr/lib/wsl/lib) location is found even though
    it's never on any process's $PATH."""
    global _nvidia_smi_path, _nvidia_smi_searched
    if _nvidia_smi_searched:
        return _nvidia_smi_path
    _nvidia_smi_searched = True

    found = shutil.which("nvidia-smi")
    if found:
        _nvidia_smi_path = found
        return found

    nsenter = shutil.which("nsenter")
    if nsenter:
        for candidate in _CANDIDATE_NVIDIA_SMI_PATHS:
            r = _run([nsenter, "-t", "1", "-m", "--", "test", "-x", candidate], timeout=4.0)
            if r and r.returncode == 0:
                _nvidia_smi_path = candidate
                return candidate
        # Fall back to a live search in case the driver lives somewhere else.
        probe = _run(
            [nsenter, "-t", "1", "-m", "--", "sh", "-c",
             "command -v nvidia-smi 2>/dev/null || "
             "find /usr /opt /run -maxdepth 4 -name nvidia-smi -type f 2>/dev/null | head -1"],
            timeout=6.0,
        )
        if probe and probe.returncode == 0:
            lines = [l.strip() for l in (probe.stdout or "").splitlines() if l.strip()]
            if lines:
                _nvidia_smi_path = lines[0]
                return lines[0]

    return None


def _read_sys(path: str) -> str | None:
    """Read a sysfs/proc file from the container view or host mount namespace."""
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        pass
    out = _host_run("cat", path)
    return out.strip() if out else None


def _parse_num(s: str | None) -> float | None:
    if s is None:
        return None
    s = s.strip()
    if not s or s.upper() in {"[N/A]", "N/A", "NA", "-"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def container_id_for_pid(pid: int) -> str | None:
    try:
        with open(f"/proc/{pid}/cgroup", encoding="utf-8") as f:
            text = f.read()
    except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
        return None
    m = _CGROUP_RE.search(text)
    return m.group(1) if m else None


def _match_cid(raw: str | None, known: dict[str, str]) -> str | None:
    if not raw:
        return None
    if raw in known:
        return known[raw]
    for cid in known.values():
        if cid.startswith(raw) or raw.startswith(cid[:12]):
            return cid
    return None


def _host_mem_bytes() -> tuple[int, int]:
    total = avail = 0
    try:
        with open("/proc/meminfo", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    avail = int(line.split()[1]) * 1024
    except OSError:
        return 0, 0
    return total, max(0, total - avail)


def _nvidia_smi(*args: str) -> str | None:
    global _last_tool_error
    path = _locate_nvidia_smi()
    if not path:
        _last_tool_error = (
            "nvidia-smi binary not found in the container or the host mount "
            "namespace (checked WSL's /usr/lib/wsl/lib and standard Linux paths)"
        )
        return None
    return _host_run(path, *args)


def _discover_drm_cards() -> list[dict[str, Any]]:
    """List render GPUs from /sys/class/drm/cardN (skip cardN-DP-* connectors)."""
    cards: list[dict[str, Any]] = []
    drm = Path("/sys/class/drm")
    if not drm.is_dir():
        # try listing via host
        listing = _host_run("sh", "-c", "ls -1 /sys/class/drm 2>/dev/null")
        names = (listing or "").split()
    else:
        names = [p.name for p in drm.iterdir()]

    for name in sorted(names):
        if not re.fullmatch(r"card\d+", name):
            continue
        base = f"/sys/class/drm/{name}/device"
        vendor_raw = (_read_sys(f"{base}/vendor") or "").lower()
        device_raw = (_read_sys(f"{base}/device") or "").lower()
        vendor = PCI_VENDOR.get(vendor_raw) or PCI_VENDOR.get(vendor_raw.replace("0x", ""))
        if not vendor:
            # Some virtio / unknown — skip
            continue
        driver = _read_sys(f"{base}/uevent") or ""
        drv = ""
        for line in driver.splitlines():
            if line.startswith("DRIVER="):
                drv = line.split("=", 1)[1].strip()
        # Prefer product name from drm / pci
        prod = _read_sys(f"{base}/label") or _read_sys(f"/sys/class/drm/{name}/device/marketing_name")
        if not prod:
            # pci.ids style short: vendor device
            prod = f"{vendor.upper()} {device_raw}" if device_raw else vendor.upper()
        cards.append({
            "card": name,
            "path": base,
            "vendor": vendor,
            "pci_vendor": vendor_raw,
            "pci_device": device_raw,
            "driver": drv,
            "name": prod,
        })
    return cards


def _sample_amd_sysfs(card: dict[str, Any], index: int) -> dict[str, Any]:
    base = card["path"]
    util = _parse_num(_read_sys(f"{base}/gpu_busy_percent")) or 0.0
    vram_t = _parse_num(_read_sys(f"{base}/mem_info_vram_total"))
    vram_u = _parse_num(_read_sys(f"{base}/mem_info_vram_used"))
    # values are bytes already on amdgpu
    mem_total = int(vram_t or 0)
    mem_used = int(vram_u or 0)
    # temperature: hwmon
    temp = None
    for hw in Path(base).glob("hwmon/hwmon*/temp1_input") if Path(base).exists() else []:
        try:
            temp = int(hw.read_text().strip()) / 1000.0
            break
        except OSError:
            continue
    if temp is None:
        t_raw = _host_run("sh", "-c", f"cat {base}/hwmon/hwmon*/temp1_input 2>/dev/null | head -1")
        if t_raw and t_raw.strip().isdigit():
            temp = int(t_raw.strip()) / 1000.0
    unified = mem_total == 0  # APU shared memory sometimes reports 0 discrete VRAM
    host_total, _ = _host_mem_bytes()
    if unified and host_total:
        mem_total = host_total
    return {
        "index": index,
        "uuid": f"amd-{card['card']}-{card.get('pci_device') or 'gpu'}",
        "name": card["name"] if not card["name"].startswith("AMD ") else card["name"],
        "vendor": "amd",
        "util_percent": round(util, 1),
        "mem_used": mem_used,
        "mem_total": mem_total,
        "mem_percent": round(mem_used / mem_total * 100, 1) if mem_total else 0.0,
        "temperature_c": temp,
        "power_w": None,
        "unified_memory": unified,
        "driver": card.get("driver") or "amdgpu",
    }


def _sample_intel_sysfs(card: dict[str, Any], index: int) -> dict[str, Any]:
    """Intel iGPU / Arc — util via intel_gpu_top when present; memory often UMA."""
    base = card["path"]
    util = 0.0
    # intel_gpu_top -J one sample (ms)
    jt = _host_run("intel_gpu_top", "-J", "-s", "200", timeout=4.0)
    if jt:
        # Rough parse: look for "busy" percentages in engines / overall
        busy = re.findall(r'"busy"\s*:\s*([0-9.]+)', jt)
        if busy:
            try:
                util = max(float(x) for x in busy)
            except ValueError:
                util = 0.0
    # Arc discrete may expose similar mem nodes; iGPU usually shared
    mem_total = int(_parse_num(_read_sys(f"{base}/mem_info_vram_total")) or 0)
    mem_used = int(_parse_num(_read_sys(f"{base}/mem_info_vram_used")) or 0)
    host_total, host_used = _host_mem_bytes()
    unified = mem_total == 0
    if unified:
        mem_total = host_total
        # Without process attribution, show host used as soft estimate for iGPU pool pressure
        mem_used = host_used
    name = card["name"]
    if name.lower().startswith("0x") or name.upper().startswith("INTEL 0X"):
        name = "Intel Graphics"
        if "i915" in (card.get("driver") or ""):
            name = "Intel UHD / Iris (iGPU)"
        if "xe" in (card.get("driver") or ""):
            name = "Intel Arc / Xe"
    return {
        "index": index,
        "uuid": f"intel-{card['card']}-{card.get('pci_device') or 'gpu'}",
        "name": name,
        "vendor": "intel",
        "util_percent": round(util, 1),
        "mem_used": mem_used,
        "mem_total": mem_total,
        "mem_percent": round(mem_used / mem_total * 100, 1) if mem_total else 0.0,
        "temperature_c": None,
        "power_w": None,
        "unified_memory": unified,
        "driver": card.get("driver") or "i915",
    }


def _sample_nvidia(known: dict[str, str]) -> tuple[list[dict], list[dict], dict[str, dict], bool]:
    """Returns gpus, processes, by_container, unified_fb."""
    gpu_out = _nvidia_smi(
        "--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
    )
    if not gpu_out:
        return [], [], {}, False

    gpus: list[dict[str, Any]] = []
    uuid_to_index: dict[str, int] = {}
    fb_na = False
    for line in gpu_out.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 6:
            continue
        idx = int(_parse_num(parts[0]) or 0)
        uuid = parts[1]
        used_mib = _parse_num(parts[4])
        total_mib = _parse_num(parts[5])
        if used_mib is None or total_mib is None:
            fb_na = True
        mem_used = int((used_mib or 0) * 1024 * 1024)
        mem_total = int((total_mib or 0) * 1024 * 1024)
        util = _parse_num(parts[3]) or 0.0
        temp = _parse_num(parts[6]) if len(parts) > 6 else None
        power = _parse_num(parts[7]) if len(parts) > 7 else None
        uuid_to_index[uuid] = idx
        gpus.append({
            "index": idx,
            "uuid": uuid,
            "name": parts[2],
            "vendor": "nvidia",
            "util_percent": round(util, 1),
            "mem_used": mem_used,
            "mem_total": mem_total,
            "mem_percent": round(mem_used / mem_total * 100, 1) if mem_total else 0.0,
            "temperature_c": temp,
            "power_w": power,
            "unified_memory": False,
            "driver": "nvidia",
        })

    # pmon SM%
    sm_by_pid: dict[int, float] = {}
    pmon = _nvidia_smi("pmon", "-c", "1")
    if pmon:
        for line in pmon.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 4:
                continue
            pid = int(_parse_num(parts[1]) or 0)
            if pid <= 0:
                continue
            sm = 0.0 if parts[3] in {"-", "—"} else (_parse_num(parts[3]) or 0.0)
            sm_by_pid[pid] = max(sm_by_pid.get(pid, 0.0), float(sm))

    processes: list[dict[str, Any]] = []
    by_container: dict[str, dict[str, Any]] = {}
    mem_by_uuid: dict[str, int] = {}
    proc_out = _nvidia_smi(
        "--query-compute-apps=gpu_uuid,pid,process_name,used_gpu_memory",
        "--format=csv,noheader,nounits",
    )
    if proc_out:
        for line in proc_out.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            uuid, pid_s, pname, mem_s = parts[0], parts[1], parts[2], parts[3]
            pid = int(_parse_num(pid_s) or 0)
            mem = int((_parse_num(mem_s) or 0) * 1024 * 1024)
            sm = sm_by_pid.get(pid, 0.0)
            mem_by_uuid[uuid] = mem_by_uuid.get(uuid, 0) + mem
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
                "util_percent": round(sm, 1),
                "vendor": "nvidia",
                "container_id": cid,
            }
            processes.append(entry)
            if cid:
                agg = by_container.setdefault(cid, {
                    "container_id": cid, "mem_used": 0, "util_percent": 0.0,
                    "processes": 0, "gpu_indexes": set(),
                })
                agg["mem_used"] += mem
                agg["util_percent"] = round(agg["util_percent"] + sm, 1)
                agg["processes"] += 1
                if entry["gpu_index"] is not None:
                    agg["gpu_indexes"].add(entry["gpu_index"])

    if fb_na or (gpus and all(g["mem_total"] == 0 for g in gpus)):
        host_total, _ = _host_mem_bytes()
        for g in gpus:
            attributed = mem_by_uuid.get(g["uuid"], 0)
            g["mem_used"] = attributed
            g["mem_total"] = host_total
            g["mem_percent"] = round(attributed / host_total * 100, 1) if host_total else 0.0
            g["unified_memory"] = True
        fb_na = True

    return gpus, processes, by_container, fb_na


def sample_gpus(container_ids: list[str] | None = None) -> dict[str, Any]:
    """Aggregate all detectable GPUs (NVIDIA + AMD + Intel), including hybrid laptops."""
    known: dict[str, str] = {}
    for cid in container_ids or []:
        known[cid] = cid
        known[cid[:12]] = cid

    plat = detect_platform()
    if plat.get("apple_silicon"):
        return {
            "available": False,
            "gpus": [],
            "processes": [],
            "by_container": {},
            "vendors": [],
            "totals": {"mem_used": 0, "mem_total": 0, "util_percent": 0.0, "mem_percent": 0.0, "count": 0},
            "unified_memory": False,
            "platform": plat,
            "error": plat.get("gpu_note"),
        }

    nv_gpus, processes, by_container, nv_unified = _sample_nvidia(known)
    drm = _discover_drm_cards()

    # Skip DRM nvidia cards if nvidia-smi already listed them (avoid duplicates)
    have_nvidia = bool(nv_gpus)
    extra: list[dict[str, Any]] = []
    next_idx = max((g["index"] for g in nv_gpus), default=-1) + 1

    for card in drm:
        vendor = card["vendor"]
        if vendor == "nvidia" and have_nvidia:
            continue
        if vendor == "nvidia" and not have_nvidia:
            # nvidia present in DRM but smi failed — still show placeholder from DRM
            extra.append({
                "index": next_idx,
                "uuid": f"nvidia-{card['card']}",
                "name": card["name"] if "nvidia" in card["name"].lower() else f"NVIDIA {card['name']}",
                "vendor": "nvidia",
                "util_percent": 0.0,
                "mem_used": 0,
                "mem_total": 0,
                "mem_percent": 0.0,
                "temperature_c": None,
                "power_w": None,
                "unified_memory": False,
                "driver": card.get("driver") or "nvidia",
            })
            next_idx += 1
            continue
        if vendor == "amd":
            try:
                extra.append(_sample_amd_sysfs(card, next_idx))
                next_idx += 1
            except Exception as exc:  # noqa: BLE001
                log.debug("amd sample failed: %s", exc)
        elif vendor == "intel":
            try:
                extra.append(_sample_intel_sysfs(card, next_idx))
                next_idx += 1
            except Exception as exc:  # noqa: BLE001
                log.debug("intel sample failed: %s", exc)

    gpus = [*nv_gpus, *extra]
    # Re-index sequentially for UI
    for i, g in enumerate(gpus):
        g["index"] = i

    by_container_out: dict[str, dict[str, Any]] = {}
    for cid, agg in by_container.items():
        by_container_out[cid] = {
            "container_id": cid,
            "mem_used": agg["mem_used"],
            "util_percent": round(float(agg["util_percent"]), 1),
            "processes": agg["processes"],
            "gpu_indexes": sorted(agg["gpu_indexes"]),
        }

    if not gpus:
        hint = plat.get("gpu_note") or _last_tool_error or "No GPU detected (NVIDIA / AMD / Intel)"
        if _last_tool_error and "NVML" in (_last_tool_error or ""):
            hint = (
                f"{_last_tool_error} — grant GPU devices to the app container "
                "(toolkit / privileged) and recreate"
            )
        return {
            "available": False,
            "gpus": [],
            "processes": [],
            "by_container": {},
            "vendors": [],
            "totals": {"mem_used": 0, "mem_total": 0, "util_percent": 0.0, "mem_percent": 0.0, "count": 0},
            "unified_memory": False,
            "platform": plat,
            "error": hint,
        }

    vendors = sorted({g.get("vendor") or "unknown" for g in gpus})
    unified = nv_unified or any(g.get("unified_memory") for g in gpus)
    host_total, host_used = _host_mem_bytes()

    # Totals: sum discrete VRAM; for UMA devices don't double-count host RAM
    discrete = [g for g in gpus if not g.get("unified_memory")]
    uma = [g for g in gpus if g.get("unified_memory")]
    mem_used = sum(g["mem_used"] for g in discrete) + (sum(g["mem_used"] for g in uma) if not discrete else 0)
    mem_total = sum(g["mem_total"] for g in discrete)
    if uma and not discrete:
        mem_total = host_total or uma[0]["mem_total"]
        mem_used = sum(g.get("mem_used") or 0 for g in processes) or host_used
    elif uma and discrete:
        # hybrid: report discrete pool + note UMA separately in devices
        pass
    util_avg = round(sum(g["util_percent"] for g in gpus) / len(gpus), 1)

    return {
        "available": True,
        "gpus": gpus,
        "processes": processes,
        "by_container": by_container_out,
        "vendors": vendors,
        "unified_memory": unified,
        "host_mem_total": host_total if unified else None,
        "host_mem_used": host_used if unified else None,
        "platform": plat,
        "totals": {
            "mem_used": mem_used,
            "mem_total": mem_total or host_total,
            "mem_percent": round(mem_used / (mem_total or host_total or 1) * 100, 1),
            "util_percent": util_avg,
            "count": len(gpus),
        },
        "error": None,
    }
