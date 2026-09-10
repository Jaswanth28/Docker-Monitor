"""Optional Kubernetes cluster read API (pods, nodes, namespaces + metrics-server)."""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

from fastapi import HTTPException

from .config import settings

log = logging.getLogger("dm.kube")

_lock = threading.Lock()
_api_client = None
_last_error: str | None = None
_cache: dict[str, Any] = {}
_CACHE_TTL = 4.0

_QUANTITY_RE = re.compile(r"^([0-9]*\.?[0-9]+)([a-zA-Z]*)$")


def enabled() -> bool:
    return settings.kubernetes_enabled


def _quantity_to_cores(s: str | None) -> float:
    if not s:
        return 0.0
    m = _QUANTITY_RE.match(str(s).strip())
    if not m:
        return 0.0
    n, unit = float(m.group(1)), m.group(2)
    if unit in {"", "cpu"}:
        return n
    if unit == "m":
        return n / 1000.0
    if unit == "n":
        return n / 1_000_000_000.0
    if unit == "u":
        return n / 1_000_000.0
    return n


def _quantity_to_bytes(s: str | None) -> int:
    if not s:
        return 0
    m = _QUANTITY_RE.match(str(s).strip())
    if not m:
        return 0
    n, unit = float(m.group(1)), m.group(2)
    mult = {
        "": 1,
        "Ki": 1024,
        "Mi": 1024**2,
        "Gi": 1024**3,
        "Ti": 1024**4,
        "K": 1000,
        "M": 1000**2,
        "G": 1000**3,
        "T": 1000**4,
        "k": 1000,
    }.get(unit, 1)
    return int(n * mult)


def _load_client():
    """Load kubernetes ApiClient once. Raises on failure."""
    global _api_client, _last_error
    if _api_client is not None:
        return _api_client
    with _lock:
        if _api_client is not None:
            return _api_client
        try:
            from kubernetes import client, config

            if settings.kubernetes_in_cluster:
                config.load_incluster_config()
            else:
                kwargs: dict[str, Any] = {}
                if settings.kubeconfig:
                    kwargs["config_file"] = settings.kubeconfig
                if settings.kubernetes_context:
                    kwargs["context"] = settings.kubernetes_context
                config.load_kube_config(**kwargs)
            _api_client = client.ApiClient()
            _last_error = None
            log.info(
                "Kubernetes client ready (in_cluster=%s, kubeconfig=%s)",
                settings.kubernetes_in_cluster,
                settings.kubeconfig or "(default)",
            )
            return _api_client
        except Exception as exc:  # noqa: BLE001
            _last_error = str(exc)[:400]
            log.warning("Kubernetes client failed: %s", _last_error)
            raise


def _require() -> Any:
    if not enabled():
        raise HTTPException(404, "Kubernetes monitoring is disabled (set KUBERNETES_ENABLED=true)")
    try:
        return _load_client()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Kubernetes unavailable: {_last_error or str(exc)}") from exc


def _cached(key: str, fn):
    now = time.monotonic()
    entry = _cache.get(key)
    if entry and now - entry["t"] < _CACHE_TTL:
        return entry["v"]
    v = fn()
    _cache[key] = {"t": now, "v": v}
    return v


def status() -> dict[str, Any]:
    if not enabled():
        return {
            "enabled": False,
            "connected": False,
            "metrics_available": False,
            "error": None,
            "in_cluster": settings.kubernetes_in_cluster,
            "kubeconfig": settings.kubeconfig or None,
            "context": settings.kubernetes_context or None,
        }
    try:
        api = _load_client()
        from kubernetes import client

        v1 = client.CoreV1Api(api)
        version = client.VersionApi(api).get_code()
        v1.list_namespace(limit=1)
        metrics_ok = False
        try:
            _fetch_pod_metrics_raw(api)
            metrics_ok = True
        except Exception:  # noqa: BLE001
            metrics_ok = False
        return {
            "enabled": True,
            "connected": True,
            "metrics_available": metrics_ok,
            "error": None,
            "version": getattr(version, "git_version", None),
            "platform": getattr(version, "platform", None),
            "in_cluster": settings.kubernetes_in_cluster,
            "kubeconfig": settings.kubeconfig or None,
            "context": settings.kubernetes_context or None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "enabled": True,
            "connected": False,
            "metrics_available": False,
            "error": _last_error or str(exc)[:400],
            "in_cluster": settings.kubernetes_in_cluster,
            "kubeconfig": settings.kubeconfig or None,
            "context": settings.kubernetes_context or None,
        }


def list_namespaces() -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client

        items = client.CoreV1Api(api).list_namespace().items or []
        out = []
        for ns in items:
            out.append({
                "name": ns.metadata.name,
                "status": (ns.status.phase if ns.status else None) or "Active",
                "labels": dict(ns.metadata.labels or {}),
            })
        return sorted(out, key=lambda x: x["name"])

    return _cached("namespaces", load)


def list_nodes() -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client

        items = client.CoreV1Api(api).list_node().items or []
        metrics = _node_metrics_map(api)
        out = []
        for n in items:
            ready = False
            for c in n.status.conditions or []:
                if c.type == "Ready" and c.status == "True":
                    ready = True
                    break
            labels = dict(n.metadata.labels or {})
            roles = sorted(
                k.replace("node-role.kubernetes.io/", "")
                for k in labels
                if k.startswith("node-role.kubernetes.io/")
            )
            if not roles and "node-role.kubernetes.io/master" in labels:
                roles = ["master"]
            capacity = n.status.capacity or {}
            allocatable = n.status.allocatable or {}
            key = n.metadata.name
            m = metrics.get(key) or {}
            out.append({
                "name": key,
                "ready": ready,
                "roles": roles,
                "cpu_capacity": _quantity_to_cores(capacity.get("cpu")),
                "mem_capacity": _quantity_to_bytes(capacity.get("memory")),
                "cpu_allocatable": _quantity_to_cores(allocatable.get("cpu")),
                "mem_allocatable": _quantity_to_bytes(allocatable.get("memory")),
                "cpu_usage": m.get("cpu"),
                "mem_usage": m.get("memory"),
                "kubelet_version": (n.status.node_info.kubelet_version if n.status.node_info else None),
                "os_image": (n.status.node_info.os_image if n.status.node_info else None),
                "architecture": (n.status.node_info.architecture if n.status.node_info else None),
            })
        return sorted(out, key=lambda x: x["name"])

    return _cached("nodes", load)


def list_pods(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()
    ns_key = namespace or "_all"

    def load():
        from kubernetes import client

        core = client.CoreV1Api(api)
        if namespace:
            items = core.list_namespaced_pod(namespace).items or []
        else:
            items = core.list_pod_for_all_namespaces().items or []
        metrics = _pod_metrics_map(api)
        out = []
        for p in items:
            name = p.metadata.name
            ns = p.metadata.namespace
            restarts = 0
            ready_c = total_c = 0
            images: list[str] = []
            for cs in p.status.container_statuses or []:
                restarts += cs.restart_count or 0
                total_c += 1
                if cs.ready:
                    ready_c += 1
                if cs.image:
                    images.append(cs.image)
            for c in p.spec.containers or []:
                if c.image and c.image not in images:
                    images.append(c.image)
            m = metrics.get(f"{ns}/{name}") or {}
            out.append({
                "name": name,
                "namespace": ns,
                "uid": p.metadata.uid,
                "phase": (p.status.phase if p.status else None) or "Unknown",
                "node": p.spec.node_name,
                "ready": f"{ready_c}/{total_c}" if total_c else "0/0",
                "restarts": restarts,
                "images": images[:4],
                "cpu_cores": m.get("cpu"),
                "mem_bytes": m.get("memory"),
                "qos": (p.status.qos_class if p.status else None),
                "created": p.metadata.creation_timestamp.isoformat() if p.metadata.creation_timestamp else None,
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"pods:{ns_key}", load)


def overview() -> dict[str, Any]:
    """Cluster snapshot for the Kubernetes page header."""
    st = status()
    if not st.get("connected"):
        return {"status": st, "namespaces": 0, "nodes": [], "pods": [], "counts": {}}
    namespaces = list_namespaces()
    nodes = list_nodes()
    pods = list_pods()
    running = sum(1 for p in pods if p["phase"] == "Running")
    pending = sum(1 for p in pods if p["phase"] == "Pending")
    failed = sum(1 for p in pods if p["phase"] in {"Failed", "Unknown"})
    return {
        "status": st,
        "namespaces": len(namespaces),
        "nodes": nodes,
        "pods": pods,
        "counts": {
            "pods": len(pods),
            "running": running,
            "pending": pending,
            "failed": failed,
            "nodes": len(nodes),
            "nodes_ready": sum(1 for n in nodes if n["ready"]),
        },
    }


def _fetch_pod_metrics_raw(api) -> list[dict]:
    from kubernetes import client

    cust = client.CustomObjectsApi(api)
    data = cust.list_cluster_custom_object("metrics.k8s.io", "v1beta1", "pods")
    return (data or {}).get("items") or []


def _fetch_node_metrics_raw(api) -> list[dict]:
    from kubernetes import client

    cust = client.CustomObjectsApi(api)
    data = cust.list_cluster_custom_object("metrics.k8s.io", "v1beta1", "nodes")
    return (data or {}).get("items") or []


def _pod_metrics_map(api) -> dict[str, dict[str, float | int]]:
    try:
        items = _fetch_pod_metrics_raw(api)
    except Exception as exc:  # noqa: BLE001
        log.debug("pod metrics unavailable: %s", exc)
        return {}
    out: dict[str, dict[str, float | int]] = {}
    for it in items:
        meta = it.get("metadata") or {}
        key = f"{meta.get('namespace')}/{meta.get('name')}"
        cpu = 0.0
        mem = 0
        for c in it.get("containers") or []:
            u = c.get("usage") or {}
            cpu += _quantity_to_cores(u.get("cpu"))
            mem += _quantity_to_bytes(u.get("memory"))
        out[key] = {"cpu": round(cpu, 4), "memory": int(mem)}
    return out


def _node_metrics_map(api) -> dict[str, dict[str, float | int]]:
    try:
        items = _fetch_node_metrics_raw(api)
    except Exception as exc:  # noqa: BLE001
        log.debug("node metrics unavailable: %s", exc)
        return {}
    out: dict[str, dict[str, float | int]] = {}
    for it in items:
        name = (it.get("metadata") or {}).get("name")
        if not name:
            continue
        u = it.get("usage") or {}
        out[name] = {
            "cpu": round(_quantity_to_cores(u.get("cpu")), 4),
            "memory": _quantity_to_bytes(u.get("memory")),
        }
    return out
