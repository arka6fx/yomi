/**
 * Cloudflare Containers Worker for the Python backend (FastAPI).
 *
 * Builds Dockerfile into the YomiContainer image and routes every
 * incoming request straight to it. Config lives at wrangler.toml.
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
    STORAGE_BACKEND: workerEnv.STORAGE_BACKEND ?? "d1",
    STORAGE_GATEWAY_URL: workerEnv.STORAGE_GATEWAY_URL ?? "",
    STORAGE_GATEWAY_SECRET: workerEnv.STORAGE_GATEWAY_SECRET ?? "",
    APP_URL: workerEnv.APP_URL ?? "",
    BACKEND_URL: workerEnv.BACKEND_URL ?? "",
    WEB_ORIGIN: workerEnv.WEB_ORIGIN ?? "",
    CORS_ORIGIN: workerEnv.CORS_ORIGIN ?? "",
    BETTER_AUTH_SECRET: workerEnv.BETTER_AUTH_SECRET ?? "",
    // Better Auth OAuth client creds for dashboard web login (Google/GitHub)
    GOOGLE_CLIENT_ID: workerEnv.GOOGLE_CLIENT_ID ?? "",
    GOOGLE_CLIENT_SECRET: workerEnv.GOOGLE_CLIENT_SECRET ?? "",
    GITHUB_CLIENT_ID: workerEnv.GITHUB_CLIENT_ID ?? "",
    GITHUB_CLIENT_SECRET: workerEnv.GITHUB_CLIENT_SECRET ?? "",
    INTERNAL_API_KEY: workerEnv.INTERNAL_API_KEY ?? "",
    WORKERS_AI_FAST_MODEL: workerEnv.WORKERS_AI_FAST_MODEL ?? "@cf/zai-org/glm-5.3-flash",
    WORKERS_AI_AGENT_MODEL: workerEnv.WORKERS_AI_AGENT_MODEL ?? "@cf/zai-org/glm-5.3-flash",
    WORKERS_AI_SEARCH_MODEL: workerEnv.WORKERS_AI_SEARCH_MODEL ?? "@cf/zai-org/glm-5.3-flash",
    WORKERS_AI_EMBEDDING_MODEL: workerEnv.WORKERS_AI_EMBEDDING_MODEL ?? "@cf/baai/bge-base-en-v1.5",
    WORKERS_AI_STT_MODEL: workerEnv.WORKERS_AI_STT_MODEL ?? "@cf/openai/whisper-large-v3-turbo",
    TELEGRAM_BOT_TOKEN: workerEnv.TELEGRAM_BOT_TOKEN ?? "",
    TELEGRAM_BOT_USERNAME: workerEnv.TELEGRAM_BOT_USERNAME ?? "",
    TELEGRAM_DEEP_LINK_ENABLED: workerEnv.TELEGRAM_DEEP_LINK_ENABLED ?? "true",
    TELEGRAM_WEBHOOK_SECRET: workerEnv.TELEGRAM_WEBHOOK_SECRET ?? "",
    ENCRYPTION_KEY: workerEnv.ENCRYPTION_KEY ?? "",
    ENCRYPTION_KEY_FALLBACKS: workerEnv.ENCRYPTION_KEY_FALLBACKS ?? "",
    GOOGLE_INTEGRATIONS_CLIENT_ID: workerEnv.GOOGLE_INTEGRATIONS_CLIENT_ID ?? "",
    GOOGLE_INTEGRATIONS_CLIENT_SECRET: workerEnv.GOOGLE_INTEGRATIONS_CLIENT_SECRET ?? "",
    COMPOSIO_API_KEY: workerEnv.COMPOSIO_API_KEY ?? "",
    COMPOSIO_CONNECTORS: workerEnv.COMPOSIO_CONNECTORS ?? "",
    COMPOSIO_WEBHOOK_SECRET: workerEnv.COMPOSIO_WEBHOOK_SECRET ?? "",
    COMPOSIO_WEBHOOK_URL: workerEnv.COMPOSIO_WEBHOOK_URL ?? "",
    AGENT_MAX_STEPS: workerEnv.AGENT_MAX_STEPS ?? "25",
    AGENT_MAX_OUTPUT_TOKENS: workerEnv.AGENT_MAX_OUTPUT_TOKENS ?? "16384",
    DODO_ENV: workerEnv.DODO_ENV ?? "test",
    DODO_API_KEY: workerEnv.DODO_API_KEY ?? "",
    DODO_LIVE_API_BASE: workerEnv.DODO_LIVE_API_BASE ?? "https://live.dodopayments.com",
    DODO_LIVE_API_KEY: workerEnv.DODO_LIVE_API_KEY ?? "",
    DODO_LIVE_PRODUCT_CREDITS_85: workerEnv.DODO_LIVE_PRODUCT_CREDITS_85 ?? "",
    DODO_LIVE_PRODUCT_CREDITS_250: workerEnv.DODO_LIVE_PRODUCT_CREDITS_250 ?? "",
    DODO_LIVE_PRODUCT_CREDITS_750: workerEnv.DODO_LIVE_PRODUCT_CREDITS_750 ?? "",
    DODO_LIVE_PRODUCT_MAX: workerEnv.DODO_LIVE_PRODUCT_MAX ?? "",
    DODO_LIVE_PRODUCT_PRO: workerEnv.DODO_LIVE_PRODUCT_PRO ?? "",
    DODO_LIVE_WEBHOOK_SECRET: workerEnv.DODO_LIVE_WEBHOOK_SECRET ?? "",
    DODO_TEST_API_BASE: workerEnv.DODO_TEST_API_BASE ?? "https://test.dodopayments.com",
    DODO_TEST_API_KEY: workerEnv.DODO_TEST_API_KEY ?? "",
    DODO_TEST_PRODUCT_CREDITS_85: workerEnv.DODO_TEST_PRODUCT_CREDITS_85 ?? "",
    DODO_TEST_PRODUCT_CREDITS_250: workerEnv.DODO_TEST_PRODUCT_CREDITS_250 ?? "",
    DODO_TEST_PRODUCT_CREDITS_750: workerEnv.DODO_TEST_PRODUCT_CREDITS_750 ?? "",
    DODO_TEST_PRODUCT_MAX: workerEnv.DODO_TEST_PRODUCT_MAX ?? "",
    DODO_TEST_PRODUCT_PRO: workerEnv.DODO_TEST_PRODUCT_PRO ?? "",
    DODO_TEST_WEBHOOK_SECRET: workerEnv.DODO_TEST_WEBHOOK_SECRET ?? "",
    // Composio white-label auth configs (per-connector ac_ IDs; future wiring)
    COMPOSIO_ASANA_AUTH_CONFIG_ID: workerEnv.COMPOSIO_ASANA_AUTH_CONFIG_ID ?? "",
    COMPOSIO_ATTIO_AUTH_CONFIG_ID: workerEnv.COMPOSIO_ATTIO_AUTH_CONFIG_ID ?? "",
    COMPOSIO_CALENDAR_AUTH_CONFIG_ID: workerEnv.COMPOSIO_CALENDAR_AUTH_CONFIG_ID ?? "",
    COMPOSIO_CALENDLY_AUTH_CONFIG_ID: workerEnv.COMPOSIO_CALENDLY_AUTH_CONFIG_ID ?? "",
    COMPOSIO_CLASSROOM_AUTH_CONFIG_ID: workerEnv.COMPOSIO_CLASSROOM_AUTH_CONFIG_ID ?? "",
    COMPOSIO_CLOUDFLARE_AUTH_CONFIG_ID: workerEnv.COMPOSIO_CLOUDFLARE_AUTH_CONFIG_ID ?? "",
    COMPOSIO_DISCORD_AUTH_CONFIG_ID: workerEnv.COMPOSIO_DISCORD_AUTH_CONFIG_ID ?? "",
    COMPOSIO_DOCS_AUTH_CONFIG_ID: workerEnv.COMPOSIO_DOCS_AUTH_CONFIG_ID ?? "",
    COMPOSIO_DRIVE_AUTH_CONFIG_ID: workerEnv.COMPOSIO_DRIVE_AUTH_CONFIG_ID ?? "",
    COMPOSIO_DROPBOX_AUTH_CONFIG_ID: workerEnv.COMPOSIO_DROPBOX_AUTH_CONFIG_ID ?? "",
    COMPOSIO_DYNAMICS_365_AUTH_CONFIG_ID: workerEnv.COMPOSIO_DYNAMICS_365_AUTH_CONFIG_ID ?? "",
    COMPOSIO_EXA_AUTH_CONFIG_ID: workerEnv.COMPOSIO_EXA_AUTH_CONFIG_ID ?? "",
    COMPOSIO_FACEBOOK_AUTH_CONFIG_ID: workerEnv.COMPOSIO_FACEBOOK_AUTH_CONFIG_ID ?? "",
    COMPOSIO_FIGMA_AUTH_CONFIG_ID: workerEnv.COMPOSIO_FIGMA_AUTH_CONFIG_ID ?? "",
    COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID: workerEnv.COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID ?? "",
    COMPOSIO_FIREFLIES_AUTH_CONFIG_ID: workerEnv.COMPOSIO_FIREFLIES_AUTH_CONFIG_ID ?? "",
    COMPOSIO_GITHUB_AUTH_CONFIG_ID: workerEnv.COMPOSIO_GITHUB_AUTH_CONFIG_ID ?? "",
    COMPOSIO_GMAIL_AUTH_CONFIG_ID: workerEnv.COMPOSIO_GMAIL_AUTH_CONFIG_ID ?? "",
    COMPOSIO_GOOGLE_ADS_AUTH_CONFIG_ID: workerEnv.COMPOSIO_GOOGLE_ADS_AUTH_CONFIG_ID ?? "",
    COMPOSIO_GOOGLE_ANALYTICS_AUTH_CONFIG_ID: workerEnv.COMPOSIO_GOOGLE_ANALYTICS_AUTH_CONFIG_ID ?? "",
    COMPOSIO_GOOGLE_CLOUD_VISION_AUTH_CONFIG_ID: workerEnv.COMPOSIO_GOOGLE_CLOUD_VISION_AUTH_CONFIG_ID ?? "",
    COMPOSIO_GOOGLE_PHOTOS_AUTH_CONFIG_ID: workerEnv.COMPOSIO_GOOGLE_PHOTOS_AUTH_CONFIG_ID ?? "",
    COMPOSIO_GOOGLE_SEARCH_CONSOLE_AUTH_CONFIG_ID: workerEnv.COMPOSIO_GOOGLE_SEARCH_CONSOLE_AUTH_CONFIG_ID ?? "",
    COMPOSIO_MAPS_AUTH_CONFIG_ID: workerEnv.COMPOSIO_MAPS_AUTH_CONFIG_ID ?? "",
    COMPOSIO_MEET_AUTH_CONFIG_ID: workerEnv.COMPOSIO_MEET_AUTH_CONFIG_ID ?? "",
    COMPOSIO_SHEETS_AUTH_CONFIG_ID: workerEnv.COMPOSIO_SHEETS_AUTH_CONFIG_ID ?? "",
    COMPOSIO_SLIDES_AUTH_CONFIG_ID: workerEnv.COMPOSIO_SLIDES_AUTH_CONFIG_ID ?? "",
    COMPOSIO_TASKS_AUTH_CONFIG_ID: workerEnv.COMPOSIO_TASKS_AUTH_CONFIG_ID ?? "",
    // Cloudflare REST API (Browser Run, Workers AI, Vectorize)
    CLOUDFLARE_API_TOKEN: workerEnv.CLOUDFLARE_API_TOKEN ?? "",
    CLOUDFLARE_ACCOUNT_ID: workerEnv.CLOUDFLARE_ACCOUNT_ID ?? "",
    // R2 object storage (S3-compatible)
    R2_ACCESS_KEY_ID: workerEnv.R2_ACCESS_KEY_ID ?? "",
    R2_SECRET_ACCESS_KEY: workerEnv.R2_SECRET_ACCESS_KEY ?? "",
    R2_ENDPOINT: workerEnv.R2_ENDPOINT ?? "",
    R2_BUCKET: workerEnv.R2_BUCKET ?? "yomi-assets",
  };
}

declare global {
  interface Env {
    YOMI_CONTAINER: DurableObjectNamespace<YomiContainer>;
    ENVIRONMENT: string;
    DATABASE_URL: string;
    STORAGE_BACKEND: string;
    STORAGE_GATEWAY_URL: string;
    STORAGE_GATEWAY_SECRET: string;
    APP_URL: string;
    BACKEND_URL: string;
    WEB_ORIGIN: string;
    CORS_ORIGIN: string;
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    INTERNAL_API_KEY: string;
    WORKERS_AI_FAST_MODEL: string;
    WORKERS_AI_AGENT_MODEL: string;
    WORKERS_AI_SEARCH_MODEL: string;
    WORKERS_AI_EMBEDDING_MODEL: string;
    WORKERS_AI_STT_MODEL: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_BOT_USERNAME: string;
    TELEGRAM_DEEP_LINK_ENABLED: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    ENCRYPTION_KEY: string;
    ENCRYPTION_KEY_FALLBACKS: string;
    GOOGLE_INTEGRATIONS_CLIENT_ID: string;
    GOOGLE_INTEGRATIONS_CLIENT_SECRET: string;
    COMPOSIO_API_KEY: string;
    COMPOSIO_CONNECTORS: string;
    COMPOSIO_WEBHOOK_SECRET: string;
    COMPOSIO_WEBHOOK_URL: string;
    AGENT_MAX_STEPS: string;
    AGENT_MAX_OUTPUT_TOKENS: string;
    DODO_ENV: string;
    DODO_API_KEY: string;
    DODO_LIVE_API_BASE: string;
    DODO_LIVE_API_KEY: string;
    DODO_LIVE_PRODUCT_CREDITS_85: string;
    DODO_LIVE_PRODUCT_CREDITS_250: string;
    DODO_LIVE_PRODUCT_CREDITS_750: string;
    DODO_LIVE_PRODUCT_MAX: string;
    DODO_LIVE_PRODUCT_PRO: string;
    DODO_LIVE_WEBHOOK_SECRET: string;
    DODO_TEST_API_BASE: string;
    DODO_TEST_API_KEY: string;
    DODO_TEST_PRODUCT_CREDITS_85: string;
    DODO_TEST_PRODUCT_CREDITS_250: string;
    DODO_TEST_PRODUCT_CREDITS_750: string;
    DODO_TEST_PRODUCT_MAX: string;
    DODO_TEST_PRODUCT_PRO: string;
    DODO_TEST_WEBHOOK_SECRET: string;
    COMPOSIO_ASANA_AUTH_CONFIG_ID: string;
    COMPOSIO_ATTIO_AUTH_CONFIG_ID: string;
    COMPOSIO_CALENDAR_AUTH_CONFIG_ID: string;
    COMPOSIO_CALENDLY_AUTH_CONFIG_ID: string;
    COMPOSIO_CLASSROOM_AUTH_CONFIG_ID: string;
    COMPOSIO_CLOUDFLARE_AUTH_CONFIG_ID: string;
    COMPOSIO_DISCORD_AUTH_CONFIG_ID: string;
    COMPOSIO_DOCS_AUTH_CONFIG_ID: string;
    COMPOSIO_DRIVE_AUTH_CONFIG_ID: string;
    COMPOSIO_DROPBOX_AUTH_CONFIG_ID: string;
    COMPOSIO_DYNAMICS_365_AUTH_CONFIG_ID: string;
    COMPOSIO_EXA_AUTH_CONFIG_ID: string;
    COMPOSIO_FACEBOOK_AUTH_CONFIG_ID: string;
    COMPOSIO_FIGMA_AUTH_CONFIG_ID: string;
    COMPOSIO_FIRECRAWL_AUTH_CONFIG_ID: string;
    COMPOSIO_FIREFLIES_AUTH_CONFIG_ID: string;
    COMPOSIO_GITHUB_AUTH_CONFIG_ID: string;
    COMPOSIO_GMAIL_AUTH_CONFIG_ID: string;
    COMPOSIO_GOOGLE_ADS_AUTH_CONFIG_ID: string;
    COMPOSIO_GOOGLE_ANALYTICS_AUTH_CONFIG_ID: string;
    COMPOSIO_GOOGLE_CLOUD_VISION_AUTH_CONFIG_ID: string;
    COMPOSIO_GOOGLE_PHOTOS_AUTH_CONFIG_ID: string;
    COMPOSIO_GOOGLE_SEARCH_CONSOLE_AUTH_CONFIG_ID: string;
    COMPOSIO_MAPS_AUTH_CONFIG_ID: string;
    COMPOSIO_MEET_AUTH_CONFIG_ID: string;
    COMPOSIO_SHEETS_AUTH_CONFIG_ID: string;
    COMPOSIO_SLIDES_AUTH_CONFIG_ID: string;
    COMPOSIO_TASKS_AUTH_CONFIG_ID: string;
    CLOUDFLARE_API_TOKEN: string;
    CLOUDFLARE_ACCOUNT_ID: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_ENDPOINT: string;
    R2_BUCKET: string;
  }
}

// When the container is hibernated (scale-to-zero, `sleepAfter`) the runtime
// fails the request that wakes it with a transient 500 like "The container is
// not listening in the TCP address 10.0.0.1:8080" until the instance finishes
// booting. Retry those wake-up failures with backoff; pass every other
// response (including real app 500s) through untouched.
const WAKE_RETRY_DELAYS_MS = [1000, 2500, 5000, 10000, 15000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDispatch(env: Env): Promise<void> {
  // Orphan sweeper: recover agent runs whose executor died mid-run. Runs at
  // most every 10 minutes (see crons in wrangler.toml) and exits fast when
  // there is nothing to do, so idle containers still sleep.
  const key = (env as unknown as Record<string, string | undefined>).INTERNAL_API_KEY ?? "";
  if (!key) return;
  try {
    const container = getContainer(env.YOMI_CONTAINER);
    await container.fetch(
      new Request("http://localhost/internal/dispatch", {
        method: "POST",
        headers: { "x-yomi-internal": key },
      }),
    );
  } catch (error) {
    console.error("dispatch sweep failed", error);
  }
}

async function containerIsNotServed(response: Response): Promise<boolean> {
  if (response.status < 500 || response.status > 599) {
    return false;
  }
  const status = response.headers.get("cf-container-status") ?? "";
  if (/warming|cold|boot/i.test(status)) {
    return true;
  }
  // Clone before reading: the original body must stay untouched so the
  // response remains returnable when this is a real app error, not a wake-up.
  const text = await response.clone().text();
  return /not listening|tcp address|warming up|starting/i.test(text);
}

async function fetchContainer(request: Request, env: Env): Promise<Response> {
  const container = getContainer(env.YOMI_CONTAINER);
  let lastResponse: Response | undefined;
  for (const delay of WAKE_RETRY_DELAYS_MS) {
    const response = await container.fetch(request.clone()).catch(() => undefined);
    if (response && !(await containerIsNotServed(response))) {
      return response;
    }
    lastResponse = response ?? lastResponse;
    await sleep(delay);
  }
  return lastResponse ?? new Response("Container unavailable", { status: 502 });
}

// Cloudflare Email Routing (mail.getyomi.in catch-all) delivers here. The raw
// MIME goes to the container; unknown aliases are rejected at SMTP time.
const MAX_EMAIL_BYTES = 5 * 1024 * 1024;

async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  if (message.rawSize > MAX_EMAIL_BYTES) {
    message.setReject("Message too large");
    return;
  }
  const key = (env as unknown as Record<string, string | undefined>).INTERNAL_API_KEY ?? "";
  if (!key) {
    message.setReject("Mailbox unavailable");
    return;
  }
  const raw = await new Response(message.raw).arrayBuffer();
  const response = await fetchContainer(
    new Request("http://localhost/internal/inbound-email", {
      method: "POST",
      headers: { "x-yomi-internal": key, "x-yomi-to": message.to, "content-type": "message/rfc822" },
      body: raw,
    }),
    env,
  );
  if (response.status === 404) {
    message.setReject("No such mailbox");
  } else if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    console.error("inbound email failed", response.status, detail);
    // Fail the delivery rather than silently accepting mail we could not store.
    throw new Error(`inbound email failed: ${response.status}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return fetchContainer(request, env);
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runDispatch(env);
  },
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env);
  },
};
