"""Pure RAG helpers shared by the Postgres routes and the D1 backend.

Moved verbatim from ``yomi.app.routes.rag`` so both storage paths apply
identical cleaning, hashing, and retrieval knobs. No I/O here.
"""

from __future__ import annotations

import hashlib
import math
import os
import re

MAX_DOCUMENT_CHARS = 120_000
MIRROR_SOURCE_TYPE = "mirror"

# Hybrid retrieval knobs (safe defaults so unset env never breaks search).
RAG_CANDIDATES = max(5, int(os.environ.get("RAG_CANDIDATES", "30") or 30))
RAG_RRF_K = max(1, int(os.environ.get("RAG_RRF_K", "60") or 60))
try:
    RAG_MMR_LAMBDA = float(os.environ.get("RAG_MMR_LAMBDA", "") or "")
    if not math.isfinite(RAG_MMR_LAMBDA):
        raise ValueError
except ValueError:
    RAG_MMR_LAMBDA = 0.7

_REDACT_IMAGE = re.compile(r"data:image/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+")
_REDACT_BASE64 = re.compile(r"[A-Za-z0-9+/=]{400,}")
_COLLAPSE_NEWLINES = re.compile(r"\n{3,}")


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _clean(value: str, max_len: int) -> str:
    text = _REDACT_IMAGE.sub("[redacted image]", value.replace("\r", ""))
    text = _REDACT_BASE64.sub("[redacted base64]", text)
    text = _COLLAPSE_NEWLINES.sub("\n\n", text)
    return text[:max_len].strip()


def _source_hash(path: str, content: str) -> str:
    return _hash(f"{path}\0{content}")
