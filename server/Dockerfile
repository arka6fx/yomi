# syntax=docker/dockerfile:1
# Production image for Cloudflare Containers (linux/amd64 platform; the image is
# built on a GitHub-hosted amd64 runner). Deps are installed with uv against the
# frozen lockfile in a build stage; the runtime is a non-root user that only
# serves the app. Migrations are NOT bundled: the shared Postgres schema stays
# owned by the drizzle journal in packages/db (alembic in server/migrations is
# parity/stamping tooling only, so it would be wrong to run it here).

FROM python:3.11-slim AS build
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.11-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src \
    PATH="/app/.venv/bin:$PATH"
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --chown=appuser:appuser src ./src
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import sys,urllib.request;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4).status==200 else 1)"
CMD ["python", "-m", "yomi.run"]