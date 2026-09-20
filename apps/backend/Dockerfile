# syntax=docker/dockerfile:1
# Production image for Cloudflare Containers (linux/amd64; built on the
# GitHub-hosted amd64 runner). The build context is the repo ROOT — set via
# `image_build_context = "../../"` in wrangler.toml — so the `yomi-db` path
# dependency (../../packages/db) resolves from the apps/backend lockfile.
# Migrations are NOT bundled or run here; the shared Postgres schema is applied
# to Neon by hand with alembic (see apps/backend/README.md).

FROM python:3.11-slim AS build
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
RUN pip install --no-cache-dir uv
WORKDIR /app/apps/backend
COPY apps/backend/pyproject.toml apps/backend/uv.lock ./
COPY packages/db /app/packages/db
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/src
ENV PATH="/app/.venv/bin:$PATH"
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=build /app/apps/backend/.venv /app/.venv
COPY apps/backend/src ./src
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import sys,urllib.request;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4).status==200 else 1)"
CMD ["python", "-m", "yomi.run"]