import base64
import os

import httpx

CF_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
CF_ACCOUNT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
BASE = f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT}/browser"

def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {CF_TOKEN}", "Content-Type": "application/json"}

async def scrape(url: str) -> str:
    async with httpx.AsyncClient() as client:
        res = await client.post(f"{BASE}/scrape", headers=_headers(), json={"url": url})
        res.raise_for_status()
        data = res.json()
        return data.get("result", {}).get("markdown", "")

async def screenshot(url: str) -> bytes:
    async with httpx.AsyncClient() as client:
        res = await client.post(f"{BASE}/screenshot", headers=_headers(), json={"url": url})
        res.raise_for_status()
        data = res.json()
        b64 = data.get("result", {}).get("screenshot", "")
        return base64.b64decode(b64)

async def extract(url: str, prompt: str) -> dict:
    async with httpx.AsyncClient() as client:
        res = await client.post(f"{BASE}/extract", headers=_headers(), json={"url": url, "prompt": prompt})
        res.raise_for_status()
        data = res.json()
        return data.get("result", {})

async def crawl(url: str, max_pages: int = 5) -> list:
    async with httpx.AsyncClient() as client:
        res = await client.post(f"{BASE}/crawl", headers=_headers(), json={"url": url, "max_pages": max_pages})
        res.raise_for_status()
        data = res.json()
        return data.get("result", {}).get("pages", [])
