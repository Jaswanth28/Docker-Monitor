#!/usr/bin/env python3
"""One-time Infisical bootstrap for Docker Monitor.

Replaces the manual "log into the Infisical UI, create an org, a project,
a machine identity, attach Universal Auth, generate a client secret" dance
with a single script. On success it:

  1. Creates the very first Infisical org + admin account (POST /api/v1/admin/bootstrap).
  2. Creates a project for this dashboard to read secrets from.
  3. Creates a machine identity (org role: admin) and attaches Universal Auth to it.
  4. Generates a Universal Auth client secret for that identity.
  5. Writes a row describing what it created into a new `dm_infisical_projects`
     table in Infisical's OWN Postgres database (infisical-db) — the dashboard
     reads this back via GET /api/infisical/projects.
  6. If run with the project's .env bind-mounted at /app/.env, patches
     INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET / INFISICAL_PROJECT_ID in
     place. Otherwise it prints them for you to paste in.

Run it once, right after `docker compose up -d infisical infisical-db infisical-redis`:

    docker compose run --rm -v "${PWD}/.env:/app/.env" app \\
        python scripts/bootstrap_infisical.py

Safe to re-run: if Infisical has already been bootstrapped (org/admin exist),
it exits early with instructions instead of erroring halfway through.
"""
from __future__ import annotations

import os
import re
import secrets
import sys
import time

import httpx

INFISICAL_URL = os.environ.get("INFISICAL_URL", "http://infisical:8080").rstrip("/")
ADMIN_EMAIL = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "admin@docker-monitor.local")
ADMIN_PASSWORD = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD") or secrets.token_urlsafe(18)
ORG_NAME = os.environ.get("BOOTSTRAP_ORG_NAME", "Docker Monitor")
PROJECT_NAME = os.environ.get("BOOTSTRAP_PROJECT_NAME", "docker-monitor")
IDENTITY_NAME = os.environ.get("BOOTSTRAP_IDENTITY_NAME", "docker-monitor-dashboard")
ENV_SLUG = os.environ.get("INFISICAL_ENV", "prod")
ENV_FILE = os.environ.get("ENV_FILE_PATH", "/app/.env")

DB_HOST = os.environ.get("INFISICAL_DB_HOST", "infisical-db")
DB_PASSWORD = os.environ.get("INFISICAL_DB_PASSWORD", "")
DB_DSN = f"postgresql://infisical:{DB_PASSWORD}@{DB_HOST}:5432/infisical"


def log(msg: str) -> None:
    print(f"[bootstrap] {msg}", flush=True)


def wait_for_infisical(timeout: float = 90.0) -> None:
    log(f"Waiting for Infisical at {INFISICAL_URL} ...")
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            r = httpx.get(f"{INFISICAL_URL}/api/status", timeout=5.0)
            if r.status_code < 500:
                log("Infisical is reachable.")
                return
        except httpx.HTTPError as exc:
            last_error = exc
        time.sleep(2.0)
    raise SystemExit(f"Timed out waiting for Infisical to come up: {last_error}")


def bootstrap_instance() -> dict:
    """POST /api/v1/admin/bootstrap — creates the first org + admin + instance identity."""
    r = httpx.post(
        f"{INFISICAL_URL}/api/v1/admin/bootstrap",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "organization": ORG_NAME},
        timeout=20.0,
    )
    if r.status_code == 400:
        raise SystemExit(
            "Infisical has already been bootstrapped (an org/admin already exists).\n"
            "This script only sets things up on a brand-new instance. If you need a new\n"
            "project + machine identity on an already-bootstrapped instance, create them\n"
            "from the Infisical UI: Access Control > Machine Identities, or ask for a\n"
            "follow-up '--project-only' mode.\n"
            f"Server said: {r.text}"
        )
    r.raise_for_status()
    return r.json()


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create_project(token: str) -> dict:
    r = httpx.post(
        f"{INFISICAL_URL}/api/v1/projects",
        json={"projectName": PROJECT_NAME, "projectDescription": "Secrets for the Docker Monitor dashboard"},
        headers=auth_headers(token),
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()["project"]


def create_identity(token: str, org_id: str) -> dict:
    r = httpx.post(
        f"{INFISICAL_URL}/api/v1/identities",
        # Org role "admin" keeps this simple for a single-tenant self-hosted setup:
        # the identity can read/write secrets across the org without a separate
        # per-project membership step. Tighten this by hand later if you run
        # multiple untrusted projects on the same Infisical instance.
        json={"name": IDENTITY_NAME, "organizationId": org_id, "role": "admin"},
        headers=auth_headers(token),
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()["identity"]


def attach_universal_auth(token: str, identity_id: str) -> dict:
    r = httpx.post(
        f"{INFISICAL_URL}/api/v1/auth/universal-auth/identities/{identity_id}",
        json={},
        headers=auth_headers(token),
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()["identityUniversalAuth"]


def create_client_secret(token: str, identity_id: str) -> str:
    r = httpx.post(
        f"{INFISICAL_URL}/api/v1/auth/universal-auth/identities/{identity_id}/client-secrets",
        json={"description": "docker-monitor bootstrap"},
        headers=auth_headers(token),
        timeout=20.0,
    )
    r.raise_for_status()
    return r.json()["clientSecret"]


def try_grant_project_access(token: str, project_id: str, identity_id: str) -> bool:
    """Best-effort: add the identity as a project member so secret reads work even
    on Infisical versions where org-admin alone doesn't imply project access.
    Not fatal if this fails — the org-admin role usually covers it."""
    try:
        r = httpx.post(
            f"{INFISICAL_URL}/api/v1/projects/{project_id}/memberships/identities/{identity_id}",
            json={"role": "admin"},
            headers=auth_headers(token),
            timeout=20.0,
        )
        if r.status_code < 300:
            return True
        log(f"Note: explicit project membership grant returned {r.status_code} ({r.text[:200]}) — "
            "continuing, since org-admin role usually already grants access.")
        return False
    except httpx.HTTPError as exc:
        log(f"Note: could not explicitly grant project membership ({exc}) — continuing.")
        return False


def record_in_postgres(row: dict) -> None:
    if not DB_PASSWORD:
        log("INFISICAL_DB_PASSWORD not set — skipping the Postgres record (everything else still worked).")
        return
    try:
        import psycopg
    except ImportError:
        log("psycopg not installed — skipping the Postgres record (pip install 'psycopg[binary]').")
        return
    try:
        with psycopg.connect(DB_DSN, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS dm_infisical_projects (
                        id SERIAL PRIMARY KEY,
                        org_id TEXT NOT NULL,
                        org_slug TEXT,
                        org_name TEXT,
                        project_id TEXT NOT NULL,
                        project_slug TEXT,
                        project_name TEXT,
                        environment_slug TEXT,
                        identity_id TEXT,
                        identity_client_id TEXT,
                        admin_email TEXT,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
                cur.execute(
                    """
                    INSERT INTO dm_infisical_projects
                        (org_id, org_slug, org_name, project_id, project_slug, project_name,
                         environment_slug, identity_id, identity_client_id, admin_email)
                    VALUES (%(org_id)s, %(org_slug)s, %(org_name)s, %(project_id)s, %(project_slug)s,
                            %(project_name)s, %(environment_slug)s, %(identity_id)s,
                            %(identity_client_id)s, %(admin_email)s)
                    """,
                    row,
                )
            conn.commit()
        log("Recorded the new project in Infisical's Postgres (table dm_infisical_projects).")
    except Exception as exc:  # noqa: BLE001
        log(f"Warning: couldn't write to Postgres ({exc}) — everything else still worked.")


def patch_env_file(client_id: str, client_secret: str, project_id: str) -> bool:
    if not os.path.isfile(ENV_FILE):
        return False
    with open(ENV_FILE, "r") as f:
        content = f.read()

    def _set(content: str, key: str, value: str) -> str:
        pattern = rf"^{key}=.*$"
        replacement = f"{key}={value}"
        if re.search(pattern, content, flags=re.MULTILINE):
            return re.sub(pattern, replacement, content, flags=re.MULTILINE)
        return content.rstrip("\n") + f"\n{replacement}\n"

    content = _set(content, "INFISICAL_CLIENT_ID", client_id)
    content = _set(content, "INFISICAL_CLIENT_SECRET", client_secret)
    content = _set(content, "INFISICAL_PROJECT_ID", project_id)
    with open(ENV_FILE, "w") as f:
        f.write(content)
    return True


def main() -> None:
    wait_for_infisical()

    log(f"Bootstrapping Infisical org '{ORG_NAME}' with admin {ADMIN_EMAIL} ...")
    boot = bootstrap_instance()
    org = boot["organization"]
    admin_token = boot["identity"]["credentials"]["token"]
    log(f"Org created: {org['name']} ({org['id']})")

    log(f"Creating project '{PROJECT_NAME}' ...")
    project = create_project(admin_token)
    log(f"Project created: {project['name']} ({project['id']})")

    log(f"Creating machine identity '{IDENTITY_NAME}' ...")
    identity = create_identity(admin_token, org["id"])
    ua = attach_universal_auth(admin_token, identity["id"])
    client_id = ua["clientId"]
    client_secret = create_client_secret(admin_token, identity["id"])
    log(f"Machine identity ready: {identity['name']} ({identity['id']})")

    try_grant_project_access(admin_token, project["id"], identity["id"])

    record_in_postgres({
        "org_id": org["id"], "org_slug": org.get("slug"), "org_name": org["name"],
        "project_id": project["id"], "project_slug": project.get("slug"), "project_name": project["name"],
        "environment_slug": ENV_SLUG, "identity_id": identity["id"], "identity_client_id": client_id,
        "admin_email": ADMIN_EMAIL,
    })

    patched = patch_env_file(client_id, client_secret, project["id"])

    print("\n" + "=" * 72)
    print("Infisical is bootstrapped. Admin login (save this now, it isn't stored anywhere):")
    print(f"  URL:      {INFISICAL_URL.replace('infisical:8080', 'localhost:8085')}")
    print(f"  Email:    {ADMIN_EMAIL}")
    print(f"  Password: {ADMIN_PASSWORD}")
    print()
    if patched:
        print(f"Wrote INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET / INFISICAL_PROJECT_ID into {ENV_FILE}.")
        print("Restart the app so it picks them up:  docker compose up -d --build app")
    else:
        print("Add these to your .env, then run: docker compose up -d --build app")
        print(f"  INFISICAL_CLIENT_ID={client_id}")
        print(f"  INFISICAL_CLIENT_SECRET={client_secret}")
        print(f"  INFISICAL_PROJECT_ID={project['id']}")
    print("=" * 72)


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPStatusError as exc:
        sys.exit(f"[bootstrap] Infisical API error {exc.response.status_code}: {exc.response.text}")
