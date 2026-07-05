# Spec 10 - Memory

Yomi uses a hybrid memory model.

Backend canonical memory:

- `memory_entries`: durable facts, preferences, decisions, projects,
  corrections, open threads.
- `memory_sources`: provenance links to documents/chunks/source paths.
- `memory_relations`: typed links between memories.
- `memory_embeddings`: semantic retrieval storage.
- `/api/memory/add`, `/search`, `/entries`, `/sync`, `/forget`, `PATCH /:id`,
  `DELETE /:id`.

Sidecar local memory:

- `~/.yomi/yomi.md` for stable user instructions.
- `~/.yomi/memory.db` for local extracted memories and embeddings.
- `~/.yomi/memory/profile.static.md` and `profile.dynamic.md` for compact
  profiles.
- `~/.yomi/sessions/` for recent turn history.
- Local RAG over notes and project files.

Rules:

- Store only durable future-use context.
- Never store secrets, passwords, raw screenshots, audio, or large opaque blobs.
- Backend memory is used by Telegram and connector agents.
- Sidecar memory remains useful offline and syncs durable facts when signed in.
