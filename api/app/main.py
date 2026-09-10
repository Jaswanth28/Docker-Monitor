from __future__ import annotations

import asyncio
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import docker_service as dk
from . import kube_service as kube
from . import stacks_service as st
from .auth import User, authenticate, current_user, require_admin, ws_user
from .host_ctl import docker_control
from .metrics import collector
from .secrets import store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("dm")


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.load()
    log.info("Secrets loaded from %s (missing: %s)", store.source, store.missing or "none")
    collector.start()
    yield
    await collector.stop()


app = FastAPI(title="Docker Monitor API", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")


# ───────────────────────────── auth ─────────────────────────────
class LoginBody(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    if store.missing:
        raise HTTPException(503, f"Server not configured, missing secrets: {', '.join(store.missing)}")
    return {"access_token": authenticate(form.username, form.password), "token_type": "bearer"}


@app.get("/api/auth/me")
async def me(user: User = Depends(current_user)):
    return user


@app.get("/api/health")
async def health():
    return {"ok": True, "secrets": store.status()}


@app.post("/api/secrets/reload", dependencies=[Depends(require_admin)])
async def reload_secrets():
    await run_in_threadpool(store.load)
    return store.status()


# ───────────────────────────── containers ─────────────────────────────
@app.get("/api/containers", dependencies=[Depends(current_user)])
async def containers(all: bool = True):
    return await run_in_threadpool(dk.list_containers, all)


@app.get("/api/containers/stats", dependencies=[Depends(current_user)])
async def containers_stats():
    latest = collector.latest()
    if latest:
        return latest
    return await run_in_threadpool(dk.all_stats)  # collector hasn't sampled yet


@app.get("/api/containers/{cid}", dependencies=[Depends(current_user)])
async def container_inspect(cid: str):
    return await run_in_threadpool(dk.inspect, cid)


@app.get("/api/containers/{cid}/detail", dependencies=[Depends(current_user)])
async def container_detail(cid: str):
    """Everything the detail page needs in one call: summary, metrics history, storage, mounts, env, ports."""
    c = await run_in_threadpool(dk.get, cid)
    summary = dk.summarize(c)
    a = c.attrs
    metrics = collector.container(c.id)
    try:
        df = await run_in_threadpool(collector.df)
        storage = df["per_container"].get(c.id, {"size_rw": 0, "size_rootfs": 0})
        vol_sizes = df["per_volume"]
    except Exception as exc:  # noqa: BLE001
        storage = {"size_rw": 0, "size_rootfs": 0, "error": str(exc)}
        vol_sizes = {}
    mounts = []
    for m in a.get("Mounts") or []:
        mounts.append({
            "type": m.get("Type"), "source": m.get("Source") or m.get("Name"), "destination": m.get("Destination"),
            "rw": m.get("RW", True), "name": m.get("Name"),
            "size": vol_sizes.get(m.get("Name"), {}).get("size") if m.get("Type") == "volume" else None,
        })
    nets = (a.get("NetworkSettings") or {}).get("Networks") or {}
    networks = [{"name": n, "ip": v.get("IPAddress"), "gateway": v.get("Gateway"), "mac": v.get("MacAddress"), "aliases": v.get("Aliases") or []} for n, v in nets.items()]
    cfg = a.get("Config") or {}
    hc = a.get("HostConfig") or {}
    return {
        "summary": summary,
        "metrics": metrics,
        "storage": storage,
        "mounts": mounts,
        "networks": networks,
        "env": cfg.get("Env") or [],
        "cmd": cfg.get("Cmd"),
        "entrypoint": cfg.get("Entrypoint"),
        "working_dir": cfg.get("WorkingDir"),
        "user": cfg.get("User"),
        "labels": cfg.get("Labels") or {},
        "restart_policy": (hc.get("RestartPolicy") or {}).get("Name"),
        "limits": {"memory": hc.get("Memory") or 0, "nano_cpus": hc.get("NanoCpus") or 0, "cpu_shares": hc.get("CpuShares") or 0},
        "state": a.get("State") or {},
        "platform": a.get("Platform"),
        "image_id": a.get("Image"),
    }


@app.get("/api/containers/{cid}/metrics", dependencies=[Depends(current_user)])
async def container_metrics(cid: str):
    c = await run_in_threadpool(dk.get, cid)
    return collector.container(c.id)


@app.get("/api/containers/{cid}/logs", dependencies=[Depends(current_user)])
async def container_logs(cid: str, tail: int = 200):
    return {"logs": await run_in_threadpool(dk.logs, cid, tail)}


@app.post("/api/containers/{cid}/{action}", dependencies=[Depends(require_admin)])
async def container_action(cid: str, action: str):
    return await run_in_threadpool(dk.action, cid, action)


@app.websocket("/api/containers/{cid}/logs/ws")
async def container_logs_ws(ws: WebSocket, cid: str, tail: int = 100):
    user = await ws_user(ws, ws.query_params.get("token"))
    if not user:
        return
    await ws.accept()
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()
    try:
        c = await run_in_threadpool(dk.get, cid)
    except HTTPException as e:
        await ws.send_text(f"error: {e.detail}")
        await ws.close()
        return

    stream = c.logs(stream=True, follow=True, tail=tail, timestamps=True)

    def pump():
        try:
            for chunk in stream:
                loop.call_soon_threadsafe(queue.put_nowait, chunk)
        except Exception:  # noqa: BLE001
            pass
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    task = loop.run_in_executor(None, pump)
    try:
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            await ws.send_text(chunk.decode(errors="replace"))
    except WebSocketDisconnect:
        pass
    finally:
        try:
            stream.close()
        except Exception:  # noqa: BLE001
            pass
        task.cancel()


# ───────────────────────────── stacks ─────────────────────────────
class StackBody(BaseModel):
    compose: str
    env: str | None = None


@app.get("/api/stacks", dependencies=[Depends(current_user)])
async def stacks():
    return await run_in_threadpool(st.list_stacks)


@app.get("/api/stacks/{name}", dependencies=[Depends(current_user)])
async def stack_get(name: str):
    return await run_in_threadpool(st.read_stack, name)


@app.post("/api/stacks/{name}", dependencies=[Depends(require_admin)])
async def stack_create(name: str, body: StackBody):
    return await run_in_threadpool(st.write_stack, name, body.compose, body.env, True)


@app.put("/api/stacks/{name}", dependencies=[Depends(require_admin)])
async def stack_update(name: str, body: StackBody):
    return await run_in_threadpool(st.write_stack, name, body.compose, body.env, False)


@app.delete("/api/stacks/{name}", dependencies=[Depends(require_admin)])
async def stack_delete(name: str):
    try:
        await st.compose(name, "down", "--remove-orphans")
    except HTTPException as e:
        if e.status_code != 404:
            log.warning("compose down failed while deleting %s: %s", name, e.detail)
    return await run_in_threadpool(st.delete_stack, name)


@app.post("/api/stacks/{name}/validate", dependencies=[Depends(require_admin)])
async def stack_validate(body: StackBody):
    doc = st.validate_yaml(body.compose)
    return {"ok": True, "services": list(doc["services"].keys())}


@app.post("/api/stacks/{name}/{action}", dependencies=[Depends(require_admin)])
async def stack_action(name: str, action: str):
    if action not in st.ACTIONS:
        raise HTTPException(400, f"Unknown action; valid: {', '.join(st.ACTIONS)}")
    timeout = 1800 if action == "rebuild" else 600
    first = await st.compose(name, *st.ACTIONS[action], timeout=timeout)
    chained = st.CHAINED.get(action)
    if not chained:
        return first
    second = await st.compose(name, *chained, timeout=timeout)
    return {"ok": True, "output": first["output"] + "\n" + second["output"]}


@app.get("/api/stacks/{name}/metrics", dependencies=[Depends(current_user)])
async def stack_metrics(name: str):
    ids = await run_in_threadpool(dk.container_ids_for_project, name)
    return collector.stack(ids)


# ───────────────────────────── resources ─────────────────────────────
@app.get("/api/images", dependencies=[Depends(current_user)])
async def images():
    return await run_in_threadpool(dk.list_images)


@app.delete("/api/images/{image_id}", dependencies=[Depends(require_admin)])
async def image_delete(image_id: str, force: bool = False):
    return await run_in_threadpool(dk.remove_image, image_id, force)


@app.get("/api/volumes", dependencies=[Depends(current_user)])
async def volumes():
    return await run_in_threadpool(dk.list_volumes)


@app.delete("/api/volumes/{name}", dependencies=[Depends(require_admin)])
async def volume_delete(name: str, force: bool = False):
    return await run_in_threadpool(dk.remove_volume, name, force)


@app.get("/api/networks", dependencies=[Depends(current_user)])
async def networks():
    return await run_in_threadpool(dk.list_networks)


@app.delete("/api/networks/{network_id}", dependencies=[Depends(require_admin)])
async def network_delete(network_id: str):
    return await run_in_threadpool(dk.remove_network, network_id)


@app.post("/api/prune/{what}", dependencies=[Depends(require_admin)])
async def prune(what: str):
    return await run_in_threadpool(dk.prune, what)


@app.get("/api/system", dependencies=[Depends(current_user)])
async def system():
    return await run_in_threadpool(dk.system_info)


@app.get("/api/system/overview", dependencies=[Depends(current_user)])
async def system_overview(top: int = 8):
    return await run_in_threadpool(collector.overview, top)


@app.post("/api/system/df/refresh", dependencies=[Depends(require_admin)])
async def system_df_refresh():
    return await run_in_threadpool(collector.df, True)


@app.post("/api/system/docker/{action}", dependencies=[Depends(require_admin)])
async def system_docker_control(action: str):
    """Run systemctl daemon-reload or restart docker on the host (via nsenter)."""
    return await run_in_threadpool(docker_control, action)


# ───────────────────────────── kubernetes (optional) ─────────────────────────────
class K8sScaleBody(BaseModel):
    replicas: int


@app.get("/api/k8s/status", dependencies=[Depends(current_user)])
async def k8s_status():
    """Always 200 — {enabled:false} when KUBERNETES_ENABLED is off."""
    return await run_in_threadpool(kube.status)


@app.get("/api/k8s/overview", dependencies=[Depends(current_user)])
async def k8s_overview():
    return await run_in_threadpool(kube.overview)


@app.get("/api/k8s/namespaces", dependencies=[Depends(current_user)])
async def k8s_namespaces():
    return await run_in_threadpool(kube.list_namespaces)


@app.get("/api/k8s/nodes", dependencies=[Depends(current_user)])
async def k8s_nodes():
    return await run_in_threadpool(kube.list_nodes)


@app.get("/api/k8s/pods", dependencies=[Depends(current_user)])
async def k8s_pods(namespace: str | None = None):
    return await run_in_threadpool(kube.list_pods, namespace)


@app.get("/api/k8s/pods/{namespace}/{name}", dependencies=[Depends(current_user)])
async def k8s_pod_detail(namespace: str, name: str):
    return await run_in_threadpool(kube.get_pod, namespace, name)


@app.get("/api/k8s/pods/{namespace}/{name}/events", dependencies=[Depends(current_user)])
async def k8s_pod_events(namespace: str, name: str):
    return await run_in_threadpool(kube.list_events, namespace, "Pod", name)


@app.get("/api/k8s/pods/{namespace}/{name}/logs", dependencies=[Depends(current_user)])
async def k8s_pod_logs(namespace: str, name: str, container: str | None = None, tail: int = 300, previous: bool = False):
    text = await run_in_threadpool(kube.pod_logs, namespace, name, container, tail, previous)
    return {"logs": text}


@app.delete("/api/k8s/pods/{namespace}/{name}", dependencies=[Depends(require_admin)])
async def k8s_pod_delete(namespace: str, name: str):
    return await run_in_threadpool(kube.delete_pod, namespace, name)


@app.get("/api/k8s/events", dependencies=[Depends(current_user)])
async def k8s_events(namespace: str | None = None):
    return await run_in_threadpool(kube.list_events, namespace)


@app.get("/api/k8s/deployments", dependencies=[Depends(current_user)])
async def k8s_deployments(namespace: str | None = None):
    return await run_in_threadpool(kube.list_deployments, namespace)


@app.post("/api/k8s/deployments/{namespace}/{name}/scale", dependencies=[Depends(require_admin)])
async def k8s_deploy_scale(namespace: str, name: str, body: K8sScaleBody):
    return await run_in_threadpool(kube.scale_deployment, namespace, name, body.replicas)


@app.post("/api/k8s/deployments/{namespace}/{name}/restart", dependencies=[Depends(require_admin)])
async def k8s_deploy_restart(namespace: str, name: str):
    return await run_in_threadpool(kube.restart_deployment, namespace, name)


@app.get("/api/k8s/statefulsets", dependencies=[Depends(current_user)])
async def k8s_statefulsets(namespace: str | None = None):
    return await run_in_threadpool(kube.list_statefulsets, namespace)


@app.get("/api/k8s/daemonsets", dependencies=[Depends(current_user)])
async def k8s_daemonsets(namespace: str | None = None):
    return await run_in_threadpool(kube.list_daemonsets, namespace)


@app.get("/api/k8s/jobs", dependencies=[Depends(current_user)])
async def k8s_jobs(namespace: str | None = None):
    return await run_in_threadpool(kube.list_jobs, namespace)


@app.get("/api/k8s/cronjobs", dependencies=[Depends(current_user)])
async def k8s_cronjobs(namespace: str | None = None):
    return await run_in_threadpool(kube.list_cronjobs, namespace)


@app.get("/api/k8s/services", dependencies=[Depends(current_user)])
async def k8s_services(namespace: str | None = None):
    return await run_in_threadpool(kube.list_services, namespace)


@app.get("/api/k8s/ingresses", dependencies=[Depends(current_user)])
async def k8s_ingresses(namespace: str | None = None):
    return await run_in_threadpool(kube.list_ingresses, namespace)


@app.get("/api/k8s/pvcs", dependencies=[Depends(current_user)])
async def k8s_pvcs(namespace: str | None = None):
    return await run_in_threadpool(kube.list_pvcs, namespace)


@app.get("/api/k8s/pvs", dependencies=[Depends(current_user)])
async def k8s_pvs():
    return await run_in_threadpool(kube.list_pvs)


@app.get("/api/k8s/configmaps", dependencies=[Depends(current_user)])
async def k8s_configmaps(namespace: str | None = None):
    return await run_in_threadpool(kube.list_configmaps, namespace)


@app.get("/api/k8s/secrets", dependencies=[Depends(current_user)])
async def k8s_secrets(namespace: str | None = None):
    """Names and key names only — values are never returned."""
    return await run_in_threadpool(kube.list_secrets, namespace)


@app.websocket("/api/k8s/pods/{namespace}/{name}/logs/ws")
async def k8s_pod_logs_ws(ws: WebSocket, namespace: str, name: str, container: str | None = None, tail: int = 200):
    user = await ws_user(ws, ws.query_params.get("token"))
    if not user:
        return
    await ws.accept()
    if not kube.enabled():
        await ws.send_text("error: Kubernetes disabled")
        await ws.close()
        return
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    stop = threading.Event()

    def pump():
        try:
            for chunk in kube.iter_pod_logs(namespace, name, container, tail):
                if stop.is_set():
                    break
                loop.call_soon_threadsafe(queue.put_nowait, chunk)
        except Exception as exc:  # noqa: BLE001
            loop.call_soon_threadsafe(queue.put_nowait, f"error: {exc}")
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    task = loop.run_in_executor(None, pump)
    try:
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            await ws.send_text(chunk if chunk.endswith("\n") else chunk + "\n")
    except WebSocketDisconnect:
        pass
    finally:
        stop.set()
        task.cancel()


# ───────────────────────────── static frontend ─────────────────────────────
# The React build is baked into the image at ./static (see repo root Dockerfile).
# Mounted last so it never shadows the /api/* routes above.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str, request: Request):
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
