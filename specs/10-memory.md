# Spec 10 - Memory

Yomi uses backend-canonical memory. Telegram is the only interaction surface;
there is no local/offline client, so all memory lives on the backend.

- `memory_entries`: durable facts, preferences, decisions, projects,
  corrections, open threads.
- `memory_sources`: provenance links to documents/chunks/source paths.
- `memory_relations`: typed links between memories.
- `memory_embeddings`: semantic retrieval storage.
- `/api/memory/add`, `/search`, `/entries`, `/sync`, `/forget`, `PATCH /:id`,
  `DELETE /:id`.

Rules:

- Store only durable future-use context.
- Never store secrets, passwords, raw screenshots, audio, or large opaque blobs.
- Backend memory is used by Telegram and connector agents.
