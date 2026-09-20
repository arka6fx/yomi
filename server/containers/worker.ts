/**
 * Cloudflare Containers Worker for the Python backend (FastAPI).
 *
 * Builds server/Dockerfile into the YomiContainer image and routes every
 * incoming request straight to it. Config lives at server/wrangler.toml.
 *
 * Ports/settings the image relies on:
 *   - defaultPort 8080  -> uvicorn listens here (yomi/run.py)
 *   - pingEndpoint      -> container health probe hits /health before serving
 *   - sleepAfter 5m     -> idle instances hibernate (scale-to-zero)
 *
 * Secrets are Worker Secrets (wrangler secret put <NAME>) surfaced through
 * `env`, then forwarded into the container via the envVars mapping below.
 */
import { env as runtimeEnv } from "cloudflare:workers";
import { Container, getContainer } from "@cloudflare/containers";

// The cloudflare:workers `env` global is typed against the (empty) ambient Env
// interface; secrets/bindings are defined in wrangler.toml + Worker Secrets and
// declared in the `declare global` block below, so cast to that shape.
const workerEnv = runtimeEnv as unknown as Record<string, string | undefined>;

export class YomiContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
  pingEndpoint = "localhost/health";

  envVars = {
    ENVIRONMENT: workerEnv.ENVIRONMENT ?? "production",
    DATABASE_URL: workerEnv.DATABASE_URL ?? "",
    APP_URL: workerEnv.APP_URL ?? "",
    BACKEND_URL: workerEnv.BACKEND_URL ?? "",
    WEB_ORIGIN: workerEnv.WEB_ORIGIN ?? "",
    CORS_ORIGIN: workerEnv.CORS_ORIGIN ?? "",
    BETTER_AUTH_SECRET: workerEnv.BETTER_AUTH_SECRET ?? "",
    INTERNAL_API_KEY: workerEnv.INTERNAL_API_KEY ?? "",
    OPENAI_API_KEY: workerEnv.OPENAI_API_KEY ?? "",
    OPENAI_BASE_URL: workerEnv.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    OPENAI_EMBEDDING_MODEL: workerEnv.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    OPENAI_FAST_MODEL: workerEnv.OPENAI_FAST_MODEL ?? "gpt-5.4-mini",
    OPENAI_AGENT_MODEL: workerEnv.OPENAI_AGENT_MODEL ?? "gpt-5.5",
    OPENAI_WEB_SEARCH_MODEL: workerEnv.OPENAI_WEB_SEARCH_MODEL ?? "gpt-5.4-mini",
    TELEGRAM_BOT_TOKEN: workerEnv.TELEGRAM_BOT_TOKEN ?? "",
    TELEGRAM_BOT_USERNAME: workerEnv.TELEGRAM_BOT_USERNAME ?? "",
    TELEGRAM_DEEP_LINK_ENABLED: workerEnv.TELEGRAM_DEEP_LINK_ENABLED ?? "true",
    ENCRYPTION_KEY: workerEnv.ENCRYPTION_KEY ?? "",
    ENCRYPTION_KEY_FALLBACKS: workerEnv.ENCRYPTION_KEY_FALLBACKS ?? "",
    GOOGLE_INTEGRATIONS_CLIENT_ID: workerEnv.GOOGLE_INTEGRATIONS_CLIENT_ID ?? "",
    GOOGLE_INTEGRATIONS_CLIENT_SECRET: workerEnv.GOOGLE_INTEGRATIONS_CLIENT_SECRET ?? "",
    COMPOSIO_API_KEY: workerEnv.COMPOSIO_API_KEY ?? "",
    COMPOSIO_CONNECTORS: workerEnv.COMPOSIO_CONNECTORS ?? "",
    AGENT_MAX_STEPS: workerEnv.AGENT_MAX_STEPS ?? "25",
    AGENT_MAX_OUTPUT_TOKENS: workerEnv.AGENT_MAX_OUTPUT_TOKENS ?? "16384",
    DODO_ENV: workerEnv.DODO_ENV ?? "test",
    DODO_API_KEY: workerEnv.DODO_API_KEY ?? "",
  };
}

declare global {
  interface Env {
    YOMI_CONTAINER: DurableObjectNamespace<YomiContainer>;
    ENVIRONMENT: string;
    DATABASE_URL: string;
    APP_URL: string;
    BACKEND_URL: string;
    WEB_ORIGIN: string;
    CORS_ORIGIN: string;
    BETTER_AUTH_SECRET: string;
    INTERNAL_API_KEY: string;
    OPENAI_API_KEY: string;
    OPENAI_BASE_URL: string;
    OPENAI_EMBEDDING_MODEL: string;
    OPENAI_FAST_MODEL: string;
    OPENAI_AGENT_MODEL: string;
    OPENAI_WEB_SEARCH_MODEL: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_BOT_USERNAME: string;
    TELEGRAM_DEEP_LINK_ENABLED: string;
    ENCRYPTION_KEY: string;
    ENCRYPTION_KEY_FALLBACKS: string;
    GOOGLE_INTEGRATIONS_CLIENT_ID: string;
    GOOGLE_INTEGRATIONS_CLIENT_SECRET: string;
    COMPOSIO_API_KEY: string;
    COMPOSIO_CONNECTORS: string;
    AGENT_MAX_STEPS: string;
    AGENT_MAX_OUTPUT_TOKENS: string;
    DODO_ENV: string;
    DODO_API_KEY: string;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.YOMI_CONTAINER).fetch(request);
  },
};