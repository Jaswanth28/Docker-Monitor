import os
from pathlib import Path


class Settings:
    stacks_dir: Path = Path(os.environ.get("STACKS_DIR", "/stacks")).resolve()

    infisical_url: str = os.environ.get("INFISICAL_URL", "")
    infisical_client_id: str = os.environ.get("INFISICAL_CLIENT_ID", "")
    infisical_client_secret: str = os.environ.get("INFISICAL_CLIENT_SECRET", "")
    infisical_project_id: str = os.environ.get("INFISICAL_PROJECT_ID", "")
    infisical_env: str = os.environ.get("INFISICAL_ENV", "prod")
    infisical_secret_path: str = os.environ.get("INFISICAL_SECRET_PATH", "/")

    jwt_algorithm: str = "HS256"
    jwt_ttl_minutes: int = int(os.environ.get("JWT_TTL_MINUTES", "720"))

    # Optional Kubernetes monitoring (read-only). Off by default.
    kubernetes_enabled: bool = os.environ.get("KUBERNETES_ENABLED", "").lower() in {"1", "true", "yes"}
    kubernetes_in_cluster: bool = os.environ.get("KUBERNETES_IN_CLUSTER", "").lower() in {"1", "true", "yes"}
    kubeconfig: str = os.environ.get("KUBECONFIG", "").strip()
    kubernetes_context: str = os.environ.get("KUBERNETES_CONTEXT", "").strip()

    @property
    def infisical_enabled(self) -> bool:
        return bool(self.infisical_url and self.infisical_client_id and self.infisical_client_secret and self.infisical_project_id)


settings = Settings()
