"""Inbound voice transcription for the Telegram gateway (STT).

Transcribes Telegram voice notes to text via OpenAI's `gpt-4o-mini-transcribe`.
Replies are always text; we never synthesize audio back to the user.
"""

import logging

import openai

from yomi.conf import settings

logger = logging.getLogger(__name__)

_MIME_EXTENSION = {
    "audio/ogg": "voice.ogg",
    "audio/oga": "voice.oga",
    "audio/opus": "voice.opus",
    "audio/mpeg": "voice.mp3",
    "audio/mp4": "voice.m4a",
    "audio/wav": "voice.wav",
    "audio/x-wav": "voice.wav",
    "audio/x-m4a": "voice.m4a",
}


async def transcribe_audio(data: bytes, mime_type: str | None = None) -> str:
    """Transcribe raw audio bytes to trimmed text.

    Raises on any transcription failure; the caller decides how to surface it.
    """
    mime = (mime_type or "audio/ogg").lower()
    filename = _MIME_EXTENSION.get(mime, "voice.ogg")
    client = openai.AsyncOpenAI(api_key=settings.openai_api_key)
    transcript = await client.audio.transcriptions.create(
        model=settings.openai_stt_model,
        file=(filename, data, mime),
    )
    if isinstance(transcript, str):
        return transcript.strip()
    return transcript.text.strip()