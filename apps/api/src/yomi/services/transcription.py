"""Inbound voice transcription for the Telegram gateway (STT).

Transcribes Telegram voice notes to text via Cloudflare Workers AI Whisper.
Replies are always text; we never synthesize audio back to the user.
"""

import base64
import logging

import httpx

from yomi.conf import settings

logger = logging.getLogger(__name__)

_transcribe_timeout = httpx.Timeout(120.0)


def _stt_payload(model: str, data: bytes) -> dict:
    """whisper-large-v3-turbo takes base64 audio; legacy whisper takes a byte list."""
    if "whisper-large-v3" in model:
        return {"audio": base64.b64encode(data).decode("ascii"), "vad_filter": True}
    return {"audio": list(data)}


async def transcribe_audio(data: bytes, mime_type: str | None = None) -> str:
    """Transcribe raw audio bytes to trimmed text.

    Raises on any transcription failure; the caller decides how to surface it.
    """
    account = (settings.cloudflare_account_id or "").strip()
    token = (settings.cloudflare_api_token or "").strip()
    if not account or not token:
        raise RuntimeError("Workers AI is not configured")
    url = (
        f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/"
        f"{settings.workers_ai_stt_model}"
    )
    async with httpx.AsyncClient(timeout=_transcribe_timeout) as client:
        res = await client.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=_stt_payload(settings.workers_ai_stt_model, data),
        )
    if res.status_code != 200:
        raise RuntimeError(f"Workers AI transcription failed: {res.status_code}")
    text = res.json().get("result", {}).get("text", "")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Workers AI returned an empty transcript")
    return text.strip()