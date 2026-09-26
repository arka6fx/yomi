#!/bin/bash
# Installs dependencies so tests, linters and type checks work in Claude Code
# on the web. Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# JavaScript workspaces (apps/web, packages/*). `npm ci` installs exactly what
# the lockfile pins and never rewrites it; skip it when node_modules already
# matches the lockfile, so cached sessions start fast.
lock_hash="$(sha256sum package-lock.json | cut -d' ' -f1)"
stamp="node_modules/.yomi-lock-hash"
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$lock_hash" ]; then
  npm ci --no-audit --no-fund --loglevel=error
  echo "$lock_hash" > "$stamp"
fi

# Python backend (apps/api) with dev tools: pytest, ruff, pyright.
if ! command -v uv >/dev/null 2>&1; then
  python3 -m pip install --quiet --user uv
  export PATH="$HOME/.local/bin:$PATH"
  echo "export PATH=\"$HOME/.local/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi
(cd apps/api && uv sync --dev --frozen --quiet)
