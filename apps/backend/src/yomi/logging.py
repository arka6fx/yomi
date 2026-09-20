"""Logging with PII redaction (port of apps/backend services/privacy/logging.ts).

Must be imported early so every log line is scrubbed. The redaction is applied
in the handler, not at the call site.
"""

from __future__ import annotations

import logging
import re

# High-signal PII patterns: emails, phone numbers, bearer tokens, api keys in
# the wild, google oauth tokens, telegram bot tokens (long numeric:alpha form).
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "<email>"),
    (re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"), "<phone>"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE), "Bearer <token>"),
    (re.compile(r"\b(xox[baprs]-[A-Za-z0-9\-]+|ghp_[A-Za-z0-9]+)\b"), "<token>"),
    (
        re.compile(
            r"\bhttps?://[^\s]*(?:access_token|refresh_token|api_key|token)=[^\s&\"]+",
            re.IGNORECASE,
        ),
        "<redacted-url>",
    ),
    (re.compile(r"\b(?:sk-[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{20,})\b"), "<api-key>"),
    (re.compile(r"\b\d{8,}:[A-Za-z0-9_-]{30,}\b"), "<bot-token>"),
]


def redact_pii(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class _RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        original = record.msg
        if isinstance(record.msg, str):
            record.msg = redact_pii(record.msg)
        try:
            return super().format(record)
        finally:
            record.msg = original


def install_redaction() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(_RedactingFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


install_redaction()