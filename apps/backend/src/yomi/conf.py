"""Central settings, mirroring wrangler vars + Worker secrets.

Python reads env at import time (unlike the Workers pattern of reading per
invocation). Values that are optional degrade to empty/None; individual services
fail explicitly at call time where a secret is actually required.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.production"), env_file_encoding="utf-8", extra="ignore"
    )

    # core
    environment: str = "development"  # development | staging | production
    database_url: str = ""
    app_url: str = "https://getyomi.in"  # was YOMI_APP_URL / NEXT_PUBLIC_APP_URL
    backend_url: str = "https://api.getyomi.in"  # was BETTER_AUTH_BASE_URL
    web_origin: str = "https://getyomi.in"  # was BETTER_AUTH_URL
    cors_origin: str = "https://getyomi.in"

    # auth
    better_auth_secret: str = ""
    internal_api_key: str = ""  # x-yomi-internal shared internal-secret header

    # openai
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_embedding_model: str = "text-embedding-3-small"
    openai_fast_model: str = "gpt-5.4-mini"
    openai_agent_model: str = "gpt-5.5"
    openai_web_search_model: str = "gpt-5.4-mini"
    openai_stt_model: str = "gpt-4o-mini-transcribe"

    # telegram
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_deep_link_enabled: bool = True

    # encryption (AES-256-GCM; 64-char hex). FALLBACKS comma-separated, decrypt-only.
    encryption_key: str = ""
    encryption_key_fallbacks: str = ""

    # google integrations OAuth
    google_integrations_client_id: str = ""
    google_integrations_client_secret: str = ""

    # composio
    composio_api_key: str = ""
    composio_connectors: str = ""  # comma-separated connector ids backed by Composio
    composio_webhook_secret: str = ""  # HMAC secret that signs POST /api/webhooks/composio
    composio_webhook_url: str = ""  # override; default = {backend_url}/api/webhooks/composio

    # agent loop
    agent_max_steps: int = 25
    agent_max_output_tokens: int = 16384

    # dodo payments
    dodo_env: str = "test"  # test | live
    dodo_api_key: str = ""

    # cloudflare (Browser Run, Workers AI, R2, Vectorize via REST API)
    cloudflare_api_token: str = ""
    cloudflare_account_id: str = ""

    # R2 (S3-compatible) storage
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_endpoint: str = ""  # https://<account>.r2.cloudflarestorage.com
    r2_bucket: str = "yomi-assets"

    # telegram webhook secret (optional; set to verify Telegram requests)
    telegram_webhook_secret: str = ""

    def composio_connector_ids(self) -> set[str]:
        return {c.strip() for c in self.composio_connectors.split(",") if c.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()