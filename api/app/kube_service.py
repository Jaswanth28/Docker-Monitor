"""Optional Kubernetes API: inventory, metrics, detail, logs, and admin actions."""
from __future__ import annotations

import logging
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Iterator

from fastapi import HTTPException

from .config import settings

log = logging.getLogger("dm.kube")

_lock = threading.Lock()
_api_client = None
_last_error: str | None = None
_cache: dict[str, Any] = {}
_CACHE_TTL = 4.0

_QUANTITY_RE = re.compile(r"^([0-9]*\.?[0-9]+)([a-zA-Z]*)$")
_GPU_KEYS = ("nvidia.com/gpu", "amd.com/gpu", "gpu.intel.com/i915")


def enabled() -> bool:
    return settings.kubernetes_enabled


def invalidate_cache() -> None:
    _cache.clear()


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
        "": 1, "Ki": 1024, "Mi": 1024**2, "Gi": 1024**3, "Ti": 1024**4,
        "K": 1000, "M": 1000**2, "G": 1000**3, "T": 1000**4, "k": 1000,
    }.get(unit, 1)
    return int(n * mult)


def _quantity_to_int(s: str | None) -> int:
    if not s:
        return 0
    m = _QUANTITY_RE.match(str(s).strip())
    if not m:
        return 0
    return int(float(m.group(1)))


def _ts(dt: Any) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()
    return str(dt)


def _gpu_from_resource(res: dict | None) -> int:
    if not res:
        return 0
    total = 0
    for k in _GPU_KEYS:
        if k in res:
            total += _quantity_to_int(str(res.get(k)))
    return total


def _container_resources(containers: list) -> dict[str, Any]:
    cpu_req = cpu_lim = 0.0
    mem_req = mem_lim = gpu = 0
    for c in containers or []:
        req = (c.resources.requests if c.resources else None) or {}
        lim = (c.resources.limits if c.resources else None) or {}
        cpu_req += _quantity_to_cores(req.get("cpu"))
        cpu_lim += _quantity_to_cores(lim.get("cpu"))
        mem_req += _quantity_to_bytes(req.get("memory"))
        mem_lim += _quantity_to_bytes(lim.get("memory"))
        gpu += max(_gpu_from_resource(req), _gpu_from_resource(lim))
    return {
        "cpu_request": round(cpu_req, 4),
        "cpu_limit": round(cpu_lim, 4),
        "mem_request": mem_req,
        "mem_limit": mem_lim,
        "gpu": gpu,
    }


def _load_client():
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


def _k8s_error(exc: Exception) -> HTTPException:
    from kubernetes.client.rest import ApiException

    if isinstance(exc, ApiException):
        body = (exc.body or "")[:300]
        return HTTPException(exc.status or 502, body or exc.reason or str(exc))
    return HTTPException(502, str(exc)[:400])


def _cached(key: str, fn):
    now = time.monotonic()
    entry = _cache.get(key)
    if entry and now - entry["t"] < _CACHE_TTL:
        return entry["v"]
    v = fn()
    _cache[key] = {"t": now, "v": v}
    return v


# ── status / overview ───────────────────────────────────────────────

def status() -> dict[str, Any]:
    if not enabled():
        return {
            "enabled": False, "connected": False, "metrics_available": False, "error": None,
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
            "enabled": True, "connected": True, "metrics_available": metrics_ok, "error": None,
            "version": getattr(version, "git_version", None),
            "platform": getattr(version, "platform", None),
            "in_cluster": settings.kubernetes_in_cluster,
            "kubeconfig": settings.kubeconfig or None,
            "context": settings.kubernetes_context or None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "enabled": True, "connected": False, "metrics_available": False,
            "error": _last_error or str(exc)[:400],
            "in_cluster": settings.kubernetes_in_cluster,
            "kubeconfig": settings.kubeconfig or None,
            "context": settings.kubernetes_context or None,
        }


def overview() -> dict[str, Any]:
    st = status()
    if not st.get("connected"):
        return {"status": st, "namespaces": 0, "nodes": [], "pods": [], "counts": {}, "workloads": {}}
    namespaces = list_namespaces()
    nodes = list_nodes()
    pods = list_pods()
    wl = workload_counts()
    running = sum(1 for p in pods if p["phase"] == "Running")
    pending = sum(1 for p in pods if p["phase"] == "Pending")
    failed = sum(1 for p in pods if p["phase"] in {"Failed", "Unknown"})
    gpu_pods = sum(1 for p in pods if (p.get("gpu") or 0) > 0)
    return {
        "status": st,
        "namespaces": len(namespaces),
        "nodes": nodes,
        "pods": pods,
        "counts": {
            "pods": len(pods), "running": running, "pending": pending, "failed": failed,
            "nodes": len(nodes), "nodes_ready": sum(1 for n in nodes if n["ready"]),
            "gpu_pods": gpu_pods,
            "gpu_node_capacity": sum(n.get("gpu_capacity") or 0 for n in nodes),
        },
        "workloads": wl,
    }


# ── core lists ──────────────────────────────────────────────────────

def list_namespaces() -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        items = client.CoreV1Api(api).list_namespace().items or []
        out = [{
            "name": ns.metadata.name,
            "status": (ns.status.phase if ns.status else None) or "Active",
            "labels": dict(ns.metadata.labels or {}),
            "created": _ts(ns.metadata.creation_timestamp),
        } for ns in items]
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
            ready = any(c.type == "Ready" and c.status == "True" for c in (n.status.conditions or []))
            labels = dict(n.metadata.labels or {})
            roles = sorted(k.replace("node-role.kubernetes.io/", "") for k in labels if k.startswith("node-role.kubernetes.io/"))
            if not roles and "node-role.kubernetes.io/master" in labels:
                roles = ["master"]
            capacity = n.status.capacity or {}
            allocatable = n.status.allocatable or {}
            key = n.metadata.name
            m = metrics.get(key) or {}
            out.append({
                "name": key, "ready": ready, "roles": roles,
                "cpu_capacity": _quantity_to_cores(capacity.get("cpu")),
                "mem_capacity": _quantity_to_bytes(capacity.get("memory")),
                "cpu_allocatable": _quantity_to_cores(allocatable.get("cpu")),
                "mem_allocatable": _quantity_to_bytes(allocatable.get("memory")),
                "gpu_capacity": _gpu_from_resource(capacity),
                "gpu_allocatable": _gpu_from_resource(allocatable),
                "cpu_usage": m.get("cpu"), "mem_usage": m.get("memory"),
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
        items = (
            core.list_namespaced_pod(namespace).items if namespace
            else core.list_pod_for_all_namespaces().items
        ) or []
        metrics = _pod_metrics_map(api)
        out = []
        for p in items:
            name, ns = p.metadata.name, p.metadata.namespace
            restarts = ready_c = total_c = 0
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
            res = _container_resources(p.spec.containers or [])
            m = metrics.get(f"{ns}/{name}") or {}
            owners = [
                {"kind": o.kind, "name": o.name, "controller": bool(o.controller)}
                for o in (p.metadata.owner_references or [])
            ]
            out.append({
                "name": name, "namespace": ns, "uid": p.metadata.uid,
                "phase": (p.status.phase if p.status else None) or "Unknown",
                "node": p.spec.node_name, "ready": f"{ready_c}/{total_c}" if total_c else "0/0",
                "restarts": restarts, "images": images[:4],
                "cpu_cores": m.get("cpu"), "mem_bytes": m.get("memory"),
                "gpu": res["gpu"],
                "qos": (p.status.qos_class if p.status else None),
                "created": _ts(p.metadata.creation_timestamp),
                "owners": owners,
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"pods:{ns_key}", load)


def get_pod(namespace: str, name: str) -> dict[str, Any]:
    api = _require()
    from kubernetes import client
    from kubernetes.client.rest import ApiException

    core = client.CoreV1Api(api)
    try:
        p = core.read_namespaced_pod(name, namespace)
    except ApiException as exc:
        raise _k8s_error(exc) from exc

    metrics = _pod_metrics_map(api).get(f"{namespace}/{name}") or {}
    containers = []
    status_by = {cs.name: cs for cs in (p.status.container_statuses or [])}
    for c in p.spec.containers or []:
        cs = status_by.get(c.name)
        state = "unknown"
        state_detail = None
        if cs and cs.state:
            if cs.state.running:
                state = "running"
                state_detail = _ts(cs.state.running.started_at)
            elif cs.state.waiting:
                state = "waiting"
                state_detail = cs.state.waiting.reason
            elif cs.state.terminated:
                state = "terminated"
                state_detail = cs.state.terminated.reason
        req = (c.resources.requests if c.resources else None) or {}
        lim = (c.resources.limits if c.resources else None) or {}
        containers.append({
            "name": c.name, "image": c.image, "state": state, "state_detail": state_detail,
            "ready": bool(cs.ready) if cs else False,
            "restarts": cs.restart_count if cs else 0,
            "cpu_request": _quantity_to_cores(req.get("cpu")),
            "cpu_limit": _quantity_to_cores(lim.get("cpu")),
            "mem_request": _quantity_to_bytes(req.get("memory")),
            "mem_limit": _quantity_to_bytes(lim.get("memory")),
            "gpu": max(_gpu_from_resource(req), _gpu_from_resource(lim)),
        })

    volumes = []
    for v in p.spec.volumes or []:
        kind = "other"
        detail = None
        if v.persistent_volume_claim:
            kind, detail = "pvc", v.persistent_volume_claim.claim_name
        elif v.config_map:
            kind, detail = "configMap", v.config_map.name
        elif v.secret:
            kind, detail = "secret", v.secret.secret_name
        elif v.empty_dir:
            kind = "emptyDir"
        elif v.host_path:
            kind, detail = "hostPath", v.host_path.path
        volumes.append({"name": v.name, "kind": kind, "detail": detail})

    conditions = [
        {"type": c.type, "status": c.status, "reason": c.reason, "message": c.message, "last_transition": _ts(c.last_transition_time)}
        for c in (p.status.conditions or [])
    ]
    res = _container_resources(p.spec.containers or [])
    return {
        "name": p.metadata.name, "namespace": p.metadata.namespace, "uid": p.metadata.uid,
        "phase": (p.status.phase if p.status else None) or "Unknown",
        "node": p.spec.node_name, "qos": p.status.qos_class if p.status else None,
        "labels": dict(p.metadata.labels or {}), "annotations": dict(p.metadata.annotations or {}),
        "owners": [{"kind": o.kind, "name": o.name} for o in (p.metadata.owner_references or [])],
        "created": _ts(p.metadata.creation_timestamp),
        "containers": containers, "volumes": volumes, "conditions": conditions,
        "cpu_cores": metrics.get("cpu"), "mem_bytes": metrics.get("memory"),
        "resources": res, "gpu": res["gpu"],
        "pod_ip": p.status.pod_ip if p.status else None,
        "host_ip": p.status.host_ip if p.status else None,
        "service_account": p.spec.service_account_name,
        "restart_policy": p.spec.restart_policy,
    }


def list_events(namespace: str | None = None, involved_kind: str | None = None, involved_name: str | None = None) -> list[dict[str, Any]]:
    api = _require()
    from kubernetes import client

    core = client.CoreV1Api(api)
    try:
        if namespace:
            items = core.list_namespaced_event(namespace).items or []
        else:
            items = core.list_event_for_all_namespaces().items or []
    except Exception as exc:  # noqa: BLE001
        raise _k8s_error(exc) from exc

    out = []
    for e in items:
        ref = e.involved_object
        if involved_kind and (not ref or ref.kind != involved_kind):
            continue
        if involved_name and (not ref or ref.name != involved_name):
            continue
        out.append({
            "type": e.type, "reason": e.reason, "message": e.message,
            "count": e.count or 1,
            "first_timestamp": _ts(e.first_timestamp or e.event_time),
            "last_timestamp": _ts(e.last_timestamp or e.event_time),
            "involved_kind": ref.kind if ref else None,
            "involved_name": ref.name if ref else None,
            "involved_namespace": ref.namespace if ref else namespace,
            "source": (e.source.component if e.source else None),
        })
    out.sort(key=lambda x: x.get("last_timestamp") or "", reverse=True)
    return out[:200]


def pod_logs(namespace: str, name: str, container: str | None = None, tail: int = 300, previous: bool = False) -> str:
    api = _require()
    from kubernetes import client
    from kubernetes.client.rest import ApiException

    try:
        return client.CoreV1Api(api).read_namespaced_pod_log(
            name=name, namespace=namespace, container=container,
            tail_lines=tail, timestamps=True, previous=previous,
        ) or ""
    except ApiException as exc:
        raise _k8s_error(exc) from exc


def iter_pod_logs(namespace: str, name: str, container: str | None = None, tail: int = 200) -> Iterator[str]:
    """Blocking generator of log lines (follow). Caller must close stream."""
    api = _require()
    from kubernetes import client

    stream = client.CoreV1Api(api).read_namespaced_pod_log(
        name=name, namespace=namespace, container=container,
        follow=True, timestamps=True, tail_lines=tail, _preload_content=False,
    )
    try:
        for line in stream.stream():
            if isinstance(line, bytes):
                yield line.decode(errors="replace")
            else:
                yield str(line)
    finally:
        try:
            stream.close()
        except Exception:  # noqa: BLE001
            pass


# ── workloads ───────────────────────────────────────────────────────

def _owner_ready(status) -> str:
    if not status:
        return "—"
    ready = getattr(status, "ready_replicas", None)
    desired = getattr(status, "replicas", None)
    if ready is None and desired is None:
        return "—"
    return f"{ready or 0}/{desired or 0}"


def list_deployments(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        apps = client.AppsV1Api(api)
        items = (
            apps.list_namespaced_deployment(namespace).items if namespace
            else apps.list_deployment_for_all_namespaces().items
        ) or []
        out = []
        for d in items:
            s = d.status
            out.append({
                "kind": "Deployment", "name": d.metadata.name, "namespace": d.metadata.namespace,
                "ready": _owner_ready(s),
                "replicas": s.replicas if s else 0,
                "ready_replicas": s.ready_replicas if s else 0,
                "available_replicas": s.available_replicas if s else 0,
                "updated_replicas": s.updated_replicas if s else 0,
                "strategy": (d.spec.strategy.type if d.spec and d.spec.strategy else None),
                "created": _ts(d.metadata.creation_timestamp),
                "images": [c.image for c in ((d.spec.template.spec.containers if d.spec and d.spec.template and d.spec.template.spec else None) or [])],
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"deploy:{namespace or '_all'}", load)


def list_statefulsets(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        apps = client.AppsV1Api(api)
        items = (
            apps.list_namespaced_stateful_set(namespace).items if namespace
            else apps.list_stateful_set_for_all_namespaces().items
        ) or []
        out = []
        for d in items:
            s = d.status
            out.append({
                "kind": "StatefulSet", "name": d.metadata.name, "namespace": d.metadata.namespace,
                "ready": _owner_ready(s), "replicas": s.replicas if s else 0,
                "ready_replicas": s.ready_replicas if s else 0,
                "created": _ts(d.metadata.creation_timestamp),
                "images": [c.image for c in ((d.spec.template.spec.containers if d.spec and d.spec.template and d.spec.template.spec else None) or [])],
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"sts:{namespace or '_all'}", load)


def list_daemonsets(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        apps = client.AppsV1Api(api)
        items = (
            apps.list_namespaced_daemon_set(namespace).items if namespace
            else apps.list_daemon_set_for_all_namespaces().items
        ) or []
        out = []
        for d in items:
            s = d.status
            desired = s.desired_number_scheduled if s else 0
            ready = s.number_ready if s else 0
            out.append({
                "kind": "DaemonSet", "name": d.metadata.name, "namespace": d.metadata.namespace,
                "ready": f"{ready}/{desired}", "desired": desired, "ready_replicas": ready,
                "created": _ts(d.metadata.creation_timestamp),
                "images": [c.image for c in ((d.spec.template.spec.containers if d.spec and d.spec.template and d.spec.template.spec else None) or [])],
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"ds:{namespace or '_all'}", load)


def list_jobs(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        batch = client.BatchV1Api(api)
        items = (
            batch.list_namespaced_job(namespace).items if namespace
            else batch.list_job_for_all_namespaces().items
        ) or []
        out = []
        for j in items:
            s = j.status
            out.append({
                "kind": "Job", "name": j.metadata.name, "namespace": j.metadata.namespace,
                "completions": (j.spec.completions if j.spec else None),
                "succeeded": s.succeeded if s else 0,
                "failed": s.failed if s else 0,
                "active": s.active if s else 0,
                "created": _ts(j.metadata.creation_timestamp),
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"job:{namespace or '_all'}", load)


def list_cronjobs(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        batch = client.BatchV1Api(api)
        items = (
            batch.list_namespaced_cron_job(namespace).items if namespace
            else batch.list_cron_job_for_all_namespaces().items
        ) or []
        out = []
        for j in items:
            s = j.status
            out.append({
                "kind": "CronJob", "name": j.metadata.name, "namespace": j.metadata.namespace,
                "schedule": j.spec.schedule if j.spec else None,
                "suspend": bool(j.spec.suspend) if j.spec else False,
                "last_schedule": _ts(s.last_schedule_time if s else None),
                "active": len(s.active or []) if s else 0,
                "created": _ts(j.metadata.creation_timestamp),
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"cj:{namespace or '_all'}", load)


def workload_counts(namespace: str | None = None) -> dict[str, int]:
    return {
        "deployments": len(list_deployments(namespace)),
        "statefulsets": len(list_statefulsets(namespace)),
        "daemonsets": len(list_daemonsets(namespace)),
        "jobs": len(list_jobs(namespace)),
        "cronjobs": len(list_cronjobs(namespace)),
    }


# ── network / storage / config ──────────────────────────────────────

def list_services(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        core = client.CoreV1Api(api)
        items = (
            core.list_namespaced_service(namespace).items if namespace
            else core.list_service_for_all_namespaces().items
        ) or []
        out = []
        for s in items:
            ports = [
                {"port": p.port, "target_port": str(p.target_port), "protocol": p.protocol, "node_port": p.node_port, "name": p.name}
                for p in (s.spec.ports or [])
            ]
            out.append({
                "name": s.metadata.name, "namespace": s.metadata.namespace,
                "type": s.spec.type if s.spec else None,
                "cluster_ip": s.spec.cluster_ip if s.spec else None,
                "external_ips": list(getattr(s.spec, "external_i_ps", None) or getattr(s.spec, "external_ips", None) or []) if s.spec else [],
                "ports": ports,
                "selector": dict(s.spec.selector or {}) if s.spec else {},
                "created": _ts(s.metadata.creation_timestamp),
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"svc:{namespace or '_all'}", load)


def list_ingresses(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        net = client.NetworkingV1Api(api)
        try:
            items = (
                net.list_namespaced_ingress(namespace).items if namespace
                else net.list_ingress_for_all_namespaces().items
            ) or []
        except Exception as exc:  # noqa: BLE001
            log.debug("ingress list failed: %s", exc)
            return []
        out = []
        for ing in items:
            hosts: list[str] = []
            for r in (ing.spec.rules or []) if ing.spec else []:
                if r.host:
                    hosts.append(r.host)
            out.append({
                "name": ing.metadata.name, "namespace": ing.metadata.namespace,
                "hosts": hosts,
                "class_name": ing.spec.ingress_class_name if ing.spec else None,
                "created": _ts(ing.metadata.creation_timestamp),
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"ing:{namespace or '_all'}", load)


def list_pvcs(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        core = client.CoreV1Api(api)
        items = (
            core.list_namespaced_persistent_volume_claim(namespace).items if namespace
            else core.list_persistent_volume_claim_for_all_namespaces().items
        ) or []
        out = []
        for c in items:
            req = {}
            if c.spec and c.spec.resources and c.spec.resources.requests:
                req = c.spec.resources.requests
            out.append({
                "name": c.metadata.name, "namespace": c.metadata.namespace,
                "status": c.status.phase if c.status else None,
                "volume": c.spec.volume_name if c.spec else None,
                "storage_class": c.spec.storage_class_name if c.spec else None,
                "capacity": _quantity_to_bytes((c.status.capacity or {}).get("storage") if c.status else None) or _quantity_to_bytes(req.get("storage")),
                "access_modes": list(c.spec.access_modes or []) if c.spec else [],
                "created": _ts(c.metadata.creation_timestamp),
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"pvc:{namespace or '_all'}", load)


def list_pvs() -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        items = client.CoreV1Api(api).list_persistent_volume().items or []
        out = []
        for v in items:
            cap = (v.spec.capacity or {}).get("storage") if v.spec else None
            claim = None
            if v.spec and v.spec.claim_ref:
                claim = f"{v.spec.claim_ref.namespace}/{v.spec.claim_ref.name}"
            out.append({
                "name": v.metadata.name,
                "status": v.status.phase if v.status else None,
                "capacity": _quantity_to_bytes(cap),
                "storage_class": v.spec.storage_class_name if v.spec else None,
                "reclaim_policy": v.spec.persistent_volume_reclaim_policy if v.spec else None,
                "claim": claim,
                "access_modes": list(v.spec.access_modes or []) if v.spec else [],
                "created": _ts(v.metadata.creation_timestamp),
            })
        return sorted(out, key=lambda x: x["name"])

    return _cached("pvs", load)


def list_configmaps(namespace: str | None = None) -> list[dict[str, Any]]:
    api = _require()

    def load():
        from kubernetes import client
        core = client.CoreV1Api(api)
        items = (
            core.list_namespaced_config_map(namespace).items if namespace
            else core.list_config_map_for_all_namespaces().items
        ) or []
        out = []
        for cm in items:
            data = cm.data or {}
            out.append({
                "name": cm.metadata.name, "namespace": cm.metadata.namespace,
                "keys": sorted(data.keys()),
                "key_count": len(data),
                "created": _ts(cm.metadata.creation_timestamp),
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"cm:{namespace or '_all'}", load)


def list_secrets(namespace: str | None = None) -> list[dict[str, Any]]:
    """Metadata only — never returns secret data values."""
    api = _require()

    def load():
        from kubernetes import client
        core = client.CoreV1Api(api)
        items = (
            core.list_namespaced_secret(namespace).items if namespace
            else core.list_secret_for_all_namespaces().items
        ) or []
        out = []
        for s in items:
            data = s.data or {}
            out.append({
                "name": s.metadata.name, "namespace": s.metadata.namespace,
                "type": s.type,
                "keys": sorted(data.keys()),
                "key_count": len(data),
                "created": _ts(s.metadata.creation_timestamp),
            })
        return sorted(out, key=lambda x: (x["namespace"], x["name"]))

    return _cached(f"sec:{namespace or '_all'}", load)


# ── admin actions ───────────────────────────────────────────────────

def delete_pod(namespace: str, name: str) -> dict[str, Any]:
    api = _require()
    from kubernetes import client
    from kubernetes.client.rest import ApiException

    try:
        client.CoreV1Api(api).delete_namespaced_pod(name, namespace)
    except ApiException as exc:
        raise _k8s_error(exc) from exc
    invalidate_cache()
    return {"ok": True, "action": "delete", "namespace": namespace, "name": name}


def scale_deployment(namespace: str, name: str, replicas: int) -> dict[str, Any]:
    if replicas < 0 or replicas > 500:
        raise HTTPException(400, "replicas must be 0–500")
    api = _require()
    from kubernetes import client
    from kubernetes.client.rest import ApiException

    apps = client.AppsV1Api(api)
    try:
        body = {"spec": {"replicas": replicas}}
        apps.patch_namespaced_deployment_scale(name, namespace, body)
    except ApiException as exc:
        raise _k8s_error(exc) from exc
    invalidate_cache()
    return {"ok": True, "action": "scale", "namespace": namespace, "name": name, "replicas": replicas}


def restart_deployment(namespace: str, name: str) -> dict[str, Any]:
    """Rollout restart via annotation bump."""
    api = _require()
    from kubernetes import client
    from kubernetes.client.rest import ApiException

    apps = client.AppsV1Api(api)
    try:
        now = datetime.now(timezone.utc).isoformat()
        body = {
            "spec": {
                "template": {
                    "metadata": {
                        "annotations": {"kubectl.kubernetes.io/restartedAt": now}
                    }
                }
            }
        }
        apps.patch_namespaced_deployment(name, namespace, body)
    except ApiException as exc:
        raise _k8s_error(exc) from exc
    invalidate_cache()
    return {"ok": True, "action": "restart", "namespace": namespace, "name": name}


# ── metrics helpers ─────────────────────────────────────────────────

def _fetch_pod_metrics_raw(api) -> list[dict]:
    from kubernetes import client
    data = client.CustomObjectsApi(api).list_cluster_custom_object("metrics.k8s.io", "v1beta1", "pods")
    return (data or {}).get("items") or []


def _fetch_node_metrics_raw(api) -> list[dict]:
    from kubernetes import client
    data = client.CustomObjectsApi(api).list_cluster_custom_object("metrics.k8s.io", "v1beta1", "nodes")
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
