from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional


class Settings(BaseSettings):
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    inference_service_url: str = "http://localhost:8000"
    inference_api_key: str = ""
    api_host: str = "0.0.0.0"
    api_port: int = 8001
    app_env: str = "development"
    cors_origins: str = "http://localhost:5174,http://localhost:3000"
    # Transactional email via Resend SMTP (read from backend/.env.local)
    resend_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_from: str = ""
    jwt_secret: str = Field(
        default="",
        description="Set via JWT_SECRET env var. Must be >= 32 chars in production.",
    )
    jwt_algorithm: str = "HS256"

    class Config:
        env_file = ".env.local"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()