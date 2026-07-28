from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    inference_service_url: str = "http://localhost:8000"
    api_host: str = "0.0.0.0"
    api_port: int = 8001
    jwt_secret: str = "super-secret-jwt-token-with-at-least-32-characters-long"
    jwt_algorithm: str = "HS256"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()