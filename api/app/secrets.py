"""Secret loading: Infisical first, environment variables as fallback.

Secrets the dashboard needs:
  JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, VIEWER_USERNAME, VIEWER_PASSWORD_HASH
"""
from __future__ import annotations

import logging
import os
import time

from .config import settings

log = logging.getLogger("dm.secrets")

REQUIRED = ["JWT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD_HASH"]
OPTIONAL = ["VIEWER_USERNAME", "VIEWER_PASSWORD_HASH"]


class SecretStore:
    def __init__(self) -> None:
        self._values: dict[str, str] = {}
        self.source = "env"
        self.error: str | None = None
        self.loaded_at: float = 0

    def load(self) -> None:
        values: dict[str, str] = {}
        if settings.infisical_enabled:
            try:
                values = self._load_from_infisical()
                self.source = "infisical"
                self.error = None
            except Exception as exc:  # noqa: BLE001
                self.error = f"{type(exc).__name__}: {exc}"
                log.warning("Infisical unavailable, falling back to env: %s", self.error)
                self.source = "env (infisical failed)"
        else:
            self.source = "env"
        for key in REQUIRED + OPTIONAL:
            if key not in values and os.environ.get(key):
                values[key] = os.environ[key]
        missing = [k for k in REQUIRED if not values.get(k)]
        if missing:
            log.error("Missing required secrets: %s", ", ".join(missing))
        self._values = values
        self.loaded_at = time.time()

    def _load_from_infisical(self) -> dict[str, str]:
        from infisical_sdk import InfisicalSDKClient

        client = InfisicalSDKClient(host=settings.infisical_url)
        client.auth.universal_auth.login(
            client_id=settings.infisical_client_id,
            client_secret=settings.infisical_client_secret,
        )
        resp = client.secrets.list_secrets(
            project_id=settings.infisical_project_id,
            environment_slug=settings.infisical_env,
            secret_path=settings.infisical_secret_path,
        )
        return {s.secretKey: s.secretValue for s in resp.secrets}

    def get(self, key: str, default: str = "") -> str:
        return self._values.get(key, default)

    @property
    def missing(self) -> list[str]:
        return [k for k in REQUIRED if not self._values.get(k)]

    def status(self) -> dict:
        return {
            "source": self.source,
            "error": self.error,
            "loaded_at": self.loaded_at,
            "missing": self.missing,
            "infisical_configured": settings.infisical_enabled,
            "viewer_enabled": bool(self.get("VIEWER_USERNAME") and self.get("VIEWER_PASSWORD_HASH")),
        }


store = SecretStore()
