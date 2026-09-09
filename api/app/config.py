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

    @property
    def infisical_enabled(self) -> bool:
        return bool(self.infisical_url and self.infisical_client_id and self.infisical_client_secret and self.infisical_project_id)


settings = Settings()
