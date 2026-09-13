"""Read-only view of the `dm_infisical_projects` table that
`scripts/bootstrap_infisical.py` writes to — in Infisical's own Postgres
database (infisical-db), not a separate database for the dashboard.

Best-effort: if the DB isn't reachable (bootstrap never ran, wrong
password, table doesn't exist yet) this returns an empty list rather
than raising, since it only powers an informational panel.
"""
from __future__ import annotations

import os

DB_HOST = os.environ.get("INFISICAL_DB_HOST", "infisical-db")
DB_PASSWORD = os.environ.get("INFISICAL_DB_PASSWORD", "")


def _dsn() -> str:
    return f"postgresql://infisical:{DB_PASSWORD}@{DB_HOST}:5432/infisical"


def list_projects() -> list[dict]:
    if not DB_PASSWORD:
        return []
    try:
        import psycopg
    except ImportError:
        return []
    try:
        with psycopg.connect(_dsn(), connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT org_name, project_id, project_name, environment_slug,
                           identity_client_id, admin_email, created_at
                    FROM dm_infisical_projects
                    ORDER BY created_at DESC
                    """
                )
                cols = [d.name for d in cur.description]
                return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception:  # noqa: BLE001 — table may not exist yet, DB may be down, etc.
        return []
