"""Host systemd / Docker daemon controls via nsenter into PID 1.

Requires pid: host and CAP_SYS_ADMIN (or privileged) so the dashboard container
can run systemctl on the host. Restarting Docker will briefly disconnect this API.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from typing import Any

from fastapi import HTTPException

log = logging.getLogger("dm.host_ctl")

ALLOWED = frozenset({"daemon-reload", "restart-docker"})


def _run(argv: list[str], timeout: float = 90.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)


def _host_systemctl(*args: str, timeout: float = 90.0) -> dict[str, Any]:
    nsenter = shutil.which("nsenter")
    systemctl = shutil.which("systemctl")
    attempts: list[list[str]] = []
    if nsenter:
        attempts.append([nsenter, "-t", "1", "-m", "-u", "-i", "-n", "--", "systemctl", *args])
    if systemctl:
        attempts.append([systemctl, *args])

    if not attempts:
        raise HTTPException(503, "systemctl / nsenter not available in this container")

    last_err = ""
    for argv in attempts:
        try:
            r = _run(argv, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise HTTPException(504, f"Timed out running: {' '.join(argv)}")
        except OSError as exc:
            last_err = str(exc)
            continue
        out = (r.stdout or "").strip()
        err = (r.stderr or "").strip()
        if r.returncode == 0:
            log.info("host ctl ok: %s", " ".join(args))
            return {"ok": True, "action": " ".join(args), "output": out or err or "ok", "via": argv[0]}
        last_err = err or out or f"exit {r.returncode}"
        log.warning("host ctl failed (%s): %s", " ".join(argv[:4]), last_err)

    raise HTTPException(
        502,
        f"Could not run systemctl {' '.join(args)} on the host. "
        f"Ensure the app has pid: host, CAP_SYS_ADMIN (or privileged), and systemd is available. "
        f"Detail: {last_err}",
    )


def docker_control(action: str) -> dict[str, Any]:
    if action not in ALLOWED:
        raise HTTPException(400, f"Unknown action; valid: {', '.join(sorted(ALLOWED))}")
    if action == "daemon-reload":
        return _host_systemctl("daemon-reload", timeout=60)
    # restart docker — API will briefly disconnect; client should expect that
    return _host_systemctl("restart", "docker", timeout=120)
