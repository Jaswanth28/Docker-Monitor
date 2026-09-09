"""Background metrics collector.

Samples every running container (in parallel) plus host CPU / memory / disk every
INTERVAL seconds and keeps a short in-memory history, so the UI can show current
numbers and sparklines instantly instead of blocking ~1s per container on each
request. Also caches `docker system df` (slow) for storage figures.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .docker_service import _calc_cpu, client

log = logging.getLogger("dm.metrics")

INTERVAL = float(os.environ.get("METRICS_INTERVAL", "5"))
HISTORY = int(os.environ.get("METRICS_HISTORY", "180"))  # samples kept (180 × 5s = 15 min)
DF_TTL = 30.0
HOST_FS = os.environ.get("HOST_FS", "/hostfs")


def _read_cpu_ticks() -> tuple[int, int]:
    with open("/proc/stat") as f:
        parts = f.readline().split()
    vals = [int(x) for x in parts[1:]]
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    return sum(vals), idle


def _read_mem() -> dict[str, int]:
    out: dict[str, int] = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, v = line.split(":", 1)
            out[k] = int(v.strip().split()[0]) * 1024
    return out


def _disk(path: str) -> dict[str, Any] | None:
    try:
        st = os.statvfs(path)
    except OSError:
        return None
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    return {"path": path, "total": total, "used": total - free, "free": free, "percent": round((total - free) / total * 100, 1) if total else 0}


class Collector:
    def __init__(self) -> None:
        self.container_history: dict[str, deque[dict]] = {}
        self.container_meta: dict[str, dict] = {}
        self.host_history: deque[dict] = deque(maxlen=HISTORY)
        self._prev_ticks: tuple[int, int] | None = None
        self._prev_net: dict[str, tuple[float, int, int]] = {}
        self._df: dict | None = None
        self._df_at = 0.0
        self._task: asyncio.Task | None = None
        self._pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="stats")
        self.last_error: str | None = None
        self.started_at = time.time()

    # ── lifecycle ────────────────────────────────────────────────
    def start(self) -> None:
        if not self._task:
            self._task = asyncio.get_event_loop().create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        self._pool.shutdown(wait=False)

    async def _loop(self) -> None:
        loop = asyncio.get_event_loop()
        while True:
            t0 = time.time()
            try:
                await loop.run_in_executor(None, self._sample)
                self.last_error = None
            except Exception as exc:  # noqa: BLE001
                self.last_error = f"{type(exc).__name__}: {exc}"
                log.warning("metrics sample failed: %s", self.last_error)
            await asyncio.sleep(max(1.0, INTERVAL - (time.time() - t0)))

    # ── sampling ─────────────────────────────────────────────────
    def _sample_container(self, c) -> dict | None:
        try:
            s = c.stats(stream=False)
        except Exception:  # noqa: BLE001
            return None
        now = time.time()
        mem = s.get("memory_stats", {})
        usage = mem.get("usage", 0) - (mem.get("stats", {}).get("inactive_file", 0) or 0)
        limit = mem.get("limit", 0) or 1
        nets = s.get("networks") or {}
        rx = sum(n.get("rx_bytes", 0) for n in nets.values())
        tx = sum(n.get("tx_bytes", 0) for n in nets.values())
        blk_r = blk_w = 0
        for e in (s.get("blkio_stats") or {}).get("io_service_bytes_recursive") or []:
            if e.get("op", "").lower() == "read":
                blk_r += e.get("value", 0)
            elif e.get("op", "").lower() == "write":
                blk_w += e.get("value", 0)
        prev = self._prev_net.get(c.id)
        rx_rate = tx_rate = 0.0
        if prev and now > prev[0]:
            dt = now - prev[0]
            rx_rate = max(0.0, (rx - prev[1]) / dt)
            tx_rate = max(0.0, (tx - prev[2]) / dt)
        self._prev_net[c.id] = (now, rx, tx)
        return {
            "t": now,
            "cpu_percent": _calc_cpu(s),
            "mem_usage": max(0, usage),
            "mem_limit": limit,
            "mem_percent": round(max(0, usage) / limit * 100, 2),
            "net_rx": rx,
            "net_tx": tx,
            "net_rx_rate": rx_rate,
            "net_tx_rate": tx_rate,
            "blk_read": blk_r,
            "blk_write": blk_w,
            "pids": (s.get("pids_stats") or {}).get("current", 0),
        }

    def _sample(self) -> None:
        containers = client().containers.list()
        running_ids = {c.id for c in containers}
        for c in containers:
            self.container_meta[c.id] = {
                "name": c.name,
                "project": (c.labels or {}).get("com.docker.compose.project"),
                "service": (c.labels or {}).get("com.docker.compose.service"),
                "image": c.attrs.get("Config", {}).get("Image"),
            }
        results = list(self._pool.map(self._sample_container, containers))
        for c, r in zip(containers, results):
            if r:
                self.container_history.setdefault(c.id, deque(maxlen=HISTORY)).append(r)
        # drop history for containers that are gone (keep stopped ones a while)
        for cid in list(self.container_history):
            if cid not in running_ids:
                hist = self.container_history[cid]
                if hist and time.time() - hist[-1]["t"] > 600:
                    del self.container_history[cid]
                    self.container_meta.pop(cid, None)
                    self._prev_net.pop(cid, None)
        self.host_history.append(self._sample_host())

    def _sample_host(self) -> dict:
        total, idle = _read_cpu_ticks()
        cpu = 0.0
        if self._prev_ticks:
            dt = total - self._prev_ticks[0]
            di = idle - self._prev_ticks[1]
            cpu = round((1 - di / dt) * 100, 1) if dt > 0 else 0.0
        self._prev_ticks = (total, idle)
        mem = _read_mem()
        mtotal = mem.get("MemTotal", 0)
        mavail = mem.get("MemAvailable", mem.get("MemFree", 0))
        try:
            load1, load5, load15 = os.getloadavg()
        except OSError:
            load1 = load5 = load15 = 0.0
        return {
            "t": time.time(),
            "cpu_percent": cpu,
            "mem_total": mtotal,
            "mem_used": mtotal - mavail,
            "mem_percent": round((mtotal - mavail) / mtotal * 100, 1) if mtotal else 0,
            "load": [load1, load5, load15],
        }

    # ── docker system df (cached) ───────────────────────────────
    def df(self, force: bool = False) -> dict:
        if force or not self._df or time.time() - self._df_at > DF_TTL:
            raw = client().df()
            images = raw.get("Images") or []
            conts = raw.get("Containers") or []
            vols = raw.get("Volumes") or []
            cache = raw.get("BuildCache") or []
            img_total = sum(i.get("Size", 0) for i in images)
            # docker de-duplicates shared layers when reporting reclaimable; keep it simple
            self._df = {
                "images": {"count": len(images), "size": img_total, "unused": sum(i.get("Size", 0) for i in images if not i.get("Containers"))},
                "containers": {"count": len(conts), "size": sum(c.get("SizeRw", 0) or 0 for c in conts), "rootfs": sum(c.get("SizeRootFs", 0) or 0 for c in conts)},
                "volumes": {"count": len(vols), "size": sum(((v.get("UsageData") or {}).get("Size") or 0) for v in vols),
                            "unused": sum(((v.get("UsageData") or {}).get("Size") or 0) for v in vols if ((v.get("UsageData") or {}).get("RefCount") or 0) == 0)},
                "build_cache": {"count": len(cache), "size": sum(b.get("Size", 0) or 0 for b in cache)},
                "per_container": {c["Id"]: {"size_rw": c.get("SizeRw", 0) or 0, "size_rootfs": c.get("SizeRootFs", 0) or 0} for c in conts},
                "per_volume": {v["Name"]: {"size": (v.get("UsageData") or {}).get("Size") or 0, "refs": (v.get("UsageData") or {}).get("RefCount") or 0} for v in vols},
                "at": time.time(),
            }
            self._df_at = time.time()
        return self._df

    # ── views ────────────────────────────────────────────────────
    def latest(self) -> list[dict]:
        out = []
        for cid, hist in self.container_history.items():
            if hist:
                out.append({"id": cid, **hist[-1]})
        return out

    def container(self, cid: str) -> dict:
        hist = list(self.container_history.get(cid, []))
        return {"id": cid, "current": hist[-1] if hist else None, "history": hist, "meta": self.container_meta.get(cid)}

    def stack(self, container_ids: list[str]) -> dict:
        """Aggregate history across a set of containers (a compose project), plus each one's own series."""
        per_container = {cid: self.container(cid) for cid in container_ids}
        histories = [pc["history"] for pc in per_container.values() if pc["history"]]
        history: list[dict] = []
        if histories:
            n = min(len(h) for h in histories)
            for i in range(-n, 0):
                samples = [h[i] for h in histories]
                history.append({
                    "t": samples[0]["t"],
                    "cpu_percent": round(sum(s["cpu_percent"] for s in samples), 2),
                    "mem_usage": sum(s["mem_usage"] for s in samples),
                    "net_rx_rate": sum(s["net_rx_rate"] for s in samples),
                    "net_tx_rate": sum(s["net_tx_rate"] for s in samples),
                    "blk_read": sum(s["blk_read"] for s in samples),
                    "blk_write": sum(s["blk_write"] for s in samples),
                })
        return {
            "current": history[-1] if history else None,
            "history": history,
            "per_container": per_container,
            "containers_sampled": len(histories),
        }

    def overview(self, top: int = 8) -> dict:
        host = list(self.host_history)
        latest = self.latest()
        for e in latest:
            e.update(self.container_meta.get(e["id"], {}))
        by_cpu = sorted(latest, key=lambda e: e["cpu_percent"], reverse=True)[:top]
        by_mem = sorted(latest, key=lambda e: e["mem_usage"], reverse=True)[:top]
        stacks: dict[str, dict] = {}
        for e in latest:
            key = e.get("project") or "(no stack)"
            s = stacks.setdefault(key, {"name": key, "cpu_percent": 0.0, "mem_usage": 0, "containers": 0, "net_rx_rate": 0.0, "net_tx_rate": 0.0})
            s["cpu_percent"] = round(s["cpu_percent"] + e["cpu_percent"], 2)
            s["mem_usage"] += e["mem_usage"]
            s["containers"] += 1
            s["net_rx_rate"] += e["net_rx_rate"]
            s["net_tx_rate"] += e["net_tx_rate"]
        try:
            df = self.df()
        except Exception as exc:  # noqa: BLE001
            df = {"error": str(exc)}
        return {
            "host": host[-1] if host else None,
            "host_history": host,
            "disk": _disk(HOST_FS) or _disk("/"),
            "disk_is_host": os.path.isdir(HOST_FS),
            "docker_df": df,
            "top_cpu": by_cpu,
            "top_mem": by_mem,
            "containers": sorted(latest, key=lambda e: e["mem_usage"], reverse=True),
            "stacks": sorted(stacks.values(), key=lambda s: s["mem_usage"], reverse=True),
            "totals": {
                "containers_sampled": len(latest),
                "cpu_percent": round(sum(e["cpu_percent"] for e in latest), 2),
                "mem_usage": sum(e["mem_usage"] for e in latest),
            },
            "collector": {"interval": INTERVAL, "history": HISTORY, "error": self.last_error, "uptime": time.time() - self.started_at},
        }


collector = Collector()
