"""Structure-aware Markdown chunking for the cloud RAG indexer.

Port of packages/shared/src/index.ts `chunkMarkdown`.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ChunkOptions:
    target_chars: int = 1800
    overlap: int = 220


def chunk_markdown(content: str, opts: ChunkOptions | None = None) -> list[str]:
    o = opts or ChunkOptions()
    target_chars = max(16, o.target_chars)
    overlap = max(0, min(o.overlap, target_chars // 2))
    text = content.replace("\r", "").strip()
    if not text:
        return []

    # Paragraph/heading segments (blank-line separated). Hard-split any oversized segment.
    segments: list[str] = []
    for block in text.split("\n\n"):
        trimmed = block.strip()
        if not trimmed:
            continue
        if len(trimmed) <= target_chars:
            segments.append(trimmed)
            continue
        start = 0
        while start < len(trimmed):
            end = min(len(trimmed), start + target_chars)
            piece = trimmed[start:end].strip()
            if piece:
                segments.append(piece)
            if end == len(trimmed):
                break
            start = max(0, end - overlap)

    # Greedily pack segments; carry a tail overlap from the previous chunk.
    chunks: list[str] = []
    current = ""
    for seg in segments:
        if not current:
            current = seg
            continue
        if len(current) + 2 + len(seg) <= target_chars:
            current += f"\n\n{seg}"
        else:
            chunks.append(current)
            tail = current[-overlap:].strip() if overlap > 0 else ""
            current = f"{tail}\n\n{seg}" if tail else seg
    if current.strip():
        chunks.append(current.strip())
    return chunks