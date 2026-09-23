"""Minimal paid-plan Workers AI probe; prints no token or model response content."""

from __future__ import annotations

import asyncio

from yomi.conf import settings
from yomi.services.llm import chat_completion


async def main() -> int:
    configured = bool(settings.cloudflare_account_id and settings.cloudflare_api_token)
    print(f"configured={configured}")
    if not configured:
        return 2
    try:
        data = await chat_completion(
            "fast",
            [{"role": "user", "content": "Reply with exactly YOMI_WORKERS_AI_OK"}],
            timeout=30,
        )
        content = str((data.get("choices") or [{}])[0].get("message", {}).get("content", ""))
        print(f"probe={'ok' if 'YOMI_WORKERS_AI_OK' in content else 'unexpected_response'}")
        return 0
    except Exception as exc:  # noqa: BLE001 — probe reports a safe error class only
        print(f"probe_failed={type(exc).__name__}")
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
