from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The .env lives at the repo root; resolve it absolutely so the backend loads it
# regardless of the working directory (e.g. when started from backend/ by the dev
# scripts). In the container there is no such file and the real env vars injected
# by Docker Compose take precedence anyway.
_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    """App configuration. Real env vars (set by Docker Compose from .env) take
    precedence; the local .env file is a dev convenience."""

    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    # Postgres (shared instance, db `grocery`). Default points at the loopback
    # for local dev; in the container it comes from compose `environment`.
    database_url: str = "postgresql+psycopg://grocery_app:grocery@localhost:5432/grocery"

    # Signed session cookie secret.
    session_secret: str = "dev-insecure-change-me"

    # Dev convenience: create_all() the tables on startup. In production Alembic
    # owns the schema (the container runs `alembic upgrade head` first), so this
    # is set to false there.
    db_auto_create: bool = True

    # Imprint / privacy-policy provider details (§ 5 DDG, Art. 13 GDPR). Empty
    # by default: a privately run instance is not subject to the imprint duty,
    # and the frontend hides the imprint link unless name+street+city are set.
    legal_name: str = ""
    legal_care_of: str = ""
    legal_street: str = ""
    legal_city: str = ""
    legal_country: str = ""
    legal_email: str = ""
    legal_vat_id: str = ""
    # Named in the privacy policy as the Art. 28 GDPR processor.
    legal_hosting_provider: str = ""

    # The two seeded accounts (created on first start if name+password are set).
    user1_name: str = ""
    user1_password: str = ""
    user1_color: str = "#3b82f6"
    user2_name: str = ""
    user2_password: str = ""
    user2_color: str = "#ef4444"


settings = Settings()
