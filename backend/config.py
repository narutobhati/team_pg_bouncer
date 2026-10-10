from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    sarvam_api_key: str = ""
    groq_api_key: str = ""
    openrouter_api_key: str = ""
    openrouter_api_key_personal: str = ""
    gemini_api_key: str = ""
    upload_dir: str = "./uploads"
    database_url: str = "sqlite:///./hackathon.db"
    port: int = 8080

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
