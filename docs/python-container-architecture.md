# Architecture: Python Container ↔ Cloudflare Services

> [!IMPORTANT]
> The backend is **Python FastAPI in a Cloudflare Container**, not a Worker.
> Bindings (`env.BROWSER`, `env.AI`, `env.VECTORIZE`) only work inside Workers.
> The Python container accesses all Cloudflare services via **REST APIs**.

```
┌──────────────────────────────────────────────────────┐
│  Thin Worker (apps/backend/containers/worker.ts)           │
│  Has bindings: BROWSER, AI, VECTORIZE, R2, KV       │
│  Forwards requests + secrets to Python container     │
└──────────────────┬───────────────────────────────────┘
                   │ envVars (secrets forwarded)
                   ▼
┌──────────────────────────────────────────────────────┐
│  Python Container (apps/backend/src/yomi/)                 │
│  FastAPI + uvicorn                                   │
│                                                      │
│  Accesses Cloudflare via REST API:                   │
│  • Browser Run  → REST API (scrape, screenshot, CDP) │
│  • Workers AI  → REST API (models, embeddings)       │
│  • Vectorize   → REST API (query, upsert)            │
│  • R2          → S3-compatible API (aiobotocore)     │
│  • KV          → REST API (get/put)                  │
│                                                      │
│  Direct connections:                                 │
│  • Postgres (asyncpg → Neon)                        │
│  • OpenAI (gpt-5.4-mini, gpt-5.5)                   │
│  • Telegram Bot API                                  │
└──────────────────────────────────────────────────────┘
```

---

## Task 1 — Deploy the Container (unblock now)

```bash
# Push to main triggers deploy-backend.yml, or deploy manually:
cd server && npx wrangler deploy

# Verify
curl https://yomi-server.<subdomain>.workers.dev/health
curl https://yomi-server.<subdomain>.workers.dev/health/db

# Manage secrets
cd server && npx wrangler secret list
npx wrangler secret put <NAME>
```

---

## Task 2 — Browser Run via REST API

Browser Run has a REST API the Python container calls directly — no Worker binding needed.

```bash
# Add secrets
cd server && npx wrangler secret put CLOUDFLARE_API_TOKEN
cd server && npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
```

Create `apps/backend/src/yomi/services/browser.py`:

```python
import httpx
import os
import base64

CF_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
CF_ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/browser"

async def scrape(url: str) -> str:
    """Extract page content as markdown."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/content",
            headers={"Authorization": f"Bearer {CF_TOKEN}"},
            json={"url": url, "format": ["markdown"]},
        )
        return resp.json()

async def screenshot(url: str) -> bytes:
    """Capture a screenshot of a page."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/screenshot",
            headers={"Authorization": f"Bearer {CF_TOKEN}"},
            json={"url": url},
        )
        return base64.b64decode(resp.json()["image"])

async def extract(url: str, prompt: str) -> dict:
    """AI-powered structured extraction from a page."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/json",
            headers={"Authorization": f"Bearer {CF_TOKEN}"},
            json={"url": url, "prompt": prompt},
        )
        return resp.json()

async def crawl(url: str, max_pages: int = 10) -> list:
    """Crawl multiple pages from a site."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/crawl",
            headers={"Authorization": f"Bearer {CF_TOKEN}"},
            json={"url": url, "limit": max_pages},
        )
        return resp.json()
```

Register in the Python agent loop:
- `scrape(url)` → "Browse a webpage and get its content"
- `screenshot(url)` → "Take a screenshot of a webpage"
- `extract(url, prompt)` → "Extract specific data from a webpage"
- `crawl(url)` → "Crawl multiple pages from a site"

For full CDP control (click, type, interact): use the Browser Run CDP WebSocket endpoint.
See: <https://developers.cloudflare.com/browser-run/cdp/>

---

## Task 3 — Workers AI via REST API

> [!NOTE]
> Do NOT replace gpt-5.5 for the main agent loop. Workers AI is for pre-classification,
> post-processing summarization, and free embeddings (if adopting Vectorize).

Add to `apps/backend/pyproject.toml` if not already present: `httpx` (already there).

Create `apps/backend/src/yomi/services/cloudflare_ai.py`:

```python
import httpx
import os

CF_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
CF_ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/ai/run"

async def embed(texts: list[str]) -> list[list[float]]:
    """Generate embeddings via Workers AI (free 10K Neurons/day, 768-dim)."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/@cf/baai/bge-base-en-v1.5",
            headers={"Authorization": f"Bearer {CF_TOKEN}"},
            json={"text": texts},
        )
        return resp.json()["data"]

async def run_model(model: str, messages: list[dict]) -> dict:
    """Run a Workers AI model (light tasks: classification, summary)."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/{model}",
            headers={"Authorization": f"Bearer {CF_TOKEN}"},
            json={"messages": messages},
        )
        return resp.json()

async def classify(text: str) -> str:
    """Classify text intent cheaply using free Neurons."""
    return await run_model("@cf/meta/llama-3.3-70b-instruct-fp8-fast", [
        {"role": "system", "content": "Classify the user intent in one word."},
        {"role": "user", "content": text},
    ])
```

> [!TIP]
> Workers AI embeddings are 768-dim; your pgvector schema uses 1536-dim (OpenAI).
> Either create a separate Vectorize index at 768-dim, or keep using OpenAI embeddings.

---

## Task 4 — Vectorize via REST API (optional)

```bash
# Create index (1536-dim to match OpenAI text-embedding-3-small)
npx wrangler vectorize create yomi-memory --dimensions=1536 --metric=cosine
```

Create `apps/backend/src/yomi/services/vectorize.py`:

```python
import httpx
import os

CF_TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
CF_ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
INDEX = "yomi-memory"
BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/vectorize/v2/indexes"

async def upsert_vectors(vectors: list[dict]):
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/{INDEX}/insert",
            headers={"Authorization": f"Bearer {CF_TOKEN}"},
            json={"vectors": vectors},
        )
        return resp.json()

async def query_vectors(vector: list[float], top_k: int = 5) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE}/{INDEX}/query",
            headers={"Authorization": f"Bearer {CF_TOKEN}"},
            json={"vector": vector, "topK": top_k},
        )
        return resp.json()["result"]["matches"]
```

> [!NOTE]
> This is optional — pgvector already works. Dual-write strategy: pgvector (canonical) +
> Vectorize (fast reads). Read from Vectorize first, fall back to pgvector.

---

## Task 5 — R2 via S3 API

```bash
npx wrangler r2 bucket create yomi-assets
# Create R2 API token with R2 read/write scope in Cloudflare dashboard
cd server && npx wrangler secret put R2_ACCESS_KEY_ID
cd server && npx wrangler secret put R2_SECRET_ACCESS_KEY
cd server && npx wrangler secret put R2_ENDPOINT
```

Add to `apps/backend/pyproject.toml`: `aiobotocore`

Create `apps/backend/src/yomi/services/storage.py`:

```python
import aiobotocore.session
import os
import uuid

async def upload_file(user_id: str, file_type: str, data: bytes, ext: str) -> str:
    """Upload to R2, return the object key."""
    session = aiobotocore.session.get_session()
    key = f"users/{user_id}/{file_type}/{uuid.uuid4()}.{ext}"
    async with session.create_client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    ) as client:
        await client.put_object(Bucket="yomi-assets", Key=key, Body=data)
    return key

async def get_file(key: str) -> bytes:
    """Download from R2."""
    session = aiobotocore.session.get_session()
    async with session.create_client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    ) as client:
        resp = await client.get_object(Bucket="yomi-assets", Key=key)
        return await resp["Body"].read()
```

---

## Task 6 — Python Agent Loop

Port the TS agent loop (the deleted `packages/agent-core/src/agent.ts`, AI SDK
`ToolLoopAgent`) to Python. Completed at `apps/backend/src/yomi/services/agent/loop.py`:

```python
import json
import openai
import os
from .tools import registry  # your tool registry

client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

async def run_agent_loop(
    messages: list[dict],
    user_id: str,
    max_steps: int = int(os.environ.get("AGENT_MAX_STEPS", "25")),
) -> str:
    """Main agent loop — equivalent to TS ToolLoopAgent."""
    tools = registry.get_openai_tools()

    for step in range(max_steps):
        response = await client.chat.completions.create(
            model=os.environ.get("OPENAI_AGENT_MODEL", "gpt-5.5"),
            messages=messages,
            tools=tools,
        )
        choice = response.choices[0]

        if choice.finish_reason == "stop":
            return choice.message.content

        if choice.finish_reason == "tool_calls":
            messages.append(choice.message.model_dump())
            for tool_call in choice.message.tool_calls:
                result = await registry.execute(
                    tool_call.function.name,
                    **json.loads(tool_call.function.arguments),
                    user_id=user_id,
                )
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": str(result),
                })

        # context compression: compress older turns if too long
        if len(messages) > 50:
            messages = await compress_context(messages)

    # grace-call wrap-up on step cap
    messages.append({
        "role": "system",
        "content": "Wrap up now — you've hit the step limit. Summarize what you found.",
    })
    response = await client.chat.completions.create(
        model=os.environ.get("OPENAI_AGENT_MODEL", "gpt-5.5"),
        messages=messages,
    )
    return response.choices[0].message.content
```

Port these from TS:
- **Connector registry** — each connector (`Gmail`, `Calendar`, `GitHub`, …) becomes a Python class with `get_tools() → list[dict]` (OpenAI function schemas) and `execute(tool_name, **kwargs) → Any`
- **Approval gate** — mutating tools return a `pending_action` instead of executing; user approves via Telegram
- **Context compression** — compress older turns via gpt-5.4-mini or Workers AI

---

## Task 7 — Port Telegram Gateway to Python

> [!TIP]
> **Key difference from TS**: the Python container has no 30-second request limit.
> You don't need the queue consumer pattern — process inline. This SIMPLIFIES the architecture.

Create `apps/backend/src/yomi/gateway/telegram.py`:

```python
from fastapi import APIRouter, Request
import httpx
import os

router = APIRouter()
BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]

@router.post("/gateway/telegram")
async def webhook(request: Request):
    update = await request.json()
    await process_update(update)
    return {"ok": True}

async def process_update(update: dict):
    message = update.get("message", {})
    chat_id = message["chat"]["id"]
    user_id = str(message["from"]["id"])

    if "voice" in message:
        ogg_data = await download_telegram_file(message["voice"]["file_id"])
        await storage.upload_file(user_id, "voice", ogg_data, "ogg")
        text = await transcribe(ogg_data)
    elif "photo" in message:
        photo_data = await download_telegram_file(message["photo"][-1]["file_id"])
        await storage.upload_file(user_id, "image", photo_data, "jpg")
        text = await analyze_image(photo_data)
    elif "text" in message:
        text = message["text"]
    else:
        return

    response = await run_agent_loop(
        messages=await load_history(user_id),
        user_id=user_id,
    )
    await send_telegram_message(chat_id, response)
```

---

## Priority Order

| # | Task | Effort | Impact |
|---|------|--------|--------|
| 1 | Deploy container | 5 min | Unblocks everything |
| 2 | Browser Run via REST API | ~2 hrs | **Highest** — computer use |
| 3 | Python agent loop | ~1 day | **Core** — replaces TS loop |
| 4 | Port Telegram gateway | ~1 day | **Core** — removes TS dependency |
| 5 | R2 file storage | ~1 hr | Medium — persistent media |
| 6 | Workers AI for embeddings | ~1 hr | Medium — cost savings |
| 7 | Vectorize (optional) | ~2 hrs | Low — pgvector works |
| 8 | Port connectors to Python | ~1 week | Long-term |
