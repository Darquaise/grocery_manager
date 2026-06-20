from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App configuration. Real env vars (set by Docker Compose from .env) take
    precedence; the local .env file is a dev convenience."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres (shared instance, db `grocery`). Default points at the loopback
    # for local dev; in the container it comes from compose `environment`.
    database_url: str = "postgresql+psycopg://grocery_app:grocery@localhost:5432/grocery"

    # Signed session cookie secret.
    session_secret: str = "dev-insecure-change-me"

    # The two seeded accounts (created on first start if name+password are set).
    user1_name: str = ""
    user1_password: str = ""
    user1_color: str = "#3b82f6"
    user2_name: str = ""
    user2_password: str = ""
    user2_color: str = "#ef4444"


settings = Settings()
