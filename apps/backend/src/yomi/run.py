"""Production entrypoint (python -m yomi.run) for the container image.

Serves the FastAPI app on 0.0.0.0:8080 in a single process — horizontal scale
comes from Cloudflare Containers instances, not uvicorn workers.

log_config=None keeps the single redacted root handler from yomi/logging.py
(installed at import) so log lines are scrubbed exactly once instead of
duplicated by uvicorn's own config. proxy_headers lets request.client.reflect
the real client IP through the Cloudflare edge.
"""

from __future__ import annotations

import uvicorn

from yomi.app.main import app

HOST = "0.0.0.0"
PORT = 8080


def main() -> None:
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_config=None,
        timeout_graceful_shutdown=30,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()