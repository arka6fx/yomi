"""Central settings, mirroring wrangler vars + Worker secrets.

Python reads env at import time (unlike the Workers pattern of reading per
invocation). Values that are optional degrade to empty/None; individual services
fail explicitly at call time where a secret is actually required.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.production"), env_file_encoding="utf-8", extra="ignore"
    )

    # core
    environment: str = "development"  # development | staging | production
    database_url: str = ""  # legacy postgres (Neon/RDS) — archived tooling only
    # d1 (Cloudflare D1 + Vectorize via gateway) is the default; "postgres" is
    # the legacy fallback for environments that never cut over.
    storage_backend: str = "d1"
    # Staged native D1 + Vectorize path; does not redirect existing ORM routes.
    storage_gateway_url: str = ""
    storage_gateway_secret: str = ""
    # Personal computer gateway (sandbox worker); unset until provisioned.
    computer_gateway_url: str = ""
    computer_gateway_secret: str = ""
    app_url: str = "https://getyomi.in"  # was YOMI_APP_URL / NEXT_PUBLIC_APP_URL
    backend_url: str = "https://api.getyomi.in"  # was BETTER_AUTH_BASE_URL
    web_origin: str = "https://getyomi.in"  # was BETTER_AUTH_URL
    cors_origin: str = "https://getyomi.in"

    # auth
    better_auth_secret: str = ""
    internal_api_key: str = ""  # x-yomi-internal shared internal-secret header
    # Better Auth OAuth client creds (dashboard web login). Read under the same
    # names the legacy TS backend used (Worker Secrets GOOGLE_CLIENT_ID, etc.).
    google_auth_client_id: str = Field(
        default="", validation_alias=AliasChoices("GOOGLE_AUTH_CLIENT_ID", "GOOGLE_CLIENT_ID")
    )
    google_auth_client_secret: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_AUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
    )
    github_auth_client_id: str = Field(
        default="", validation_alias=AliasChoices("GITHUB_AUTH_CLIENT_ID", "GITHUB_CLIENT_ID")
    )
    github_auth_client_secret: str = Field(
        default="",
        validation_alias=AliasChoices("GITHUB_AUTH_CLIENT_SECRET", "GITHUB_CLIENT_SECRET"),
    )

    # llm: Cloudflare Workers AI for everything (chat, embeddings, STT).
    # Embeddings are 768-dimensional (bge-base); the Vectorize indexes match.
    workers_ai_fast_model: str = "@cf/qwen/qwen3.8-27b"
    workers_ai_agent_model: str = "@cf/qwen/qwen3.8-27b"
    workers_ai_search_model: str = "@cf/meta/llama-3.1-8b-instruct"
    workers_ai_embedding_model: str = "@cf/baai/bge-base-en-v1.5"
    workers_ai_stt_model: str = "@cf/openai/whisper"

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
    # Cap the Composio tool surface handed to the agent: reads/diagnostics are
    # ranked first, then the rest alphabetically, truncated per connected app
    # and in total so the model context never floods (GitHub alone exposes ~900).
    composio_max_tools_per_app: int = 40
    composio_max_tools: int = 200

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

    @field_validator("*", mode="before")
    @classmethod
    def _strip_bom_and_whitespace(cls, value: object) -> object:
        # Worker secrets written from PowerShell on Windows can carry a leading
        # UTF-8 BOM; Composio's HTTP client fails with ascii UnicodeEncodeError.
        if isinstance(value, str):
            return value.lstrip("\ufeff\u200b \t\r\n")
        return value

    def composio_connector_ids(self) -> set[str]:
        return {c.strip() for c in self.composio_connectors.split(",") if c.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
