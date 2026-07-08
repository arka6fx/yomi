#!/usr/bin/env bash
# Deploy the backend to the EC2 box (Docker + Caddy).
#
# The backend runs as a container behind Caddy on EC2 (api.getyomi.in), not on
# Cloudflare Workers. There is no GitHub CD for it yet: the security group locks
# SSH to the owner's IP, so GitHub-hosted runners can't reach the box. Run this
# from a machine whose IP is allowed in the `yomi-backend-sg` SSH rule.
#
# Secrets live in ~/yomi/.env.production ON THE BOX and are never shipped from
# here. This script only updates code, rebuilds the image, and restarts.
#
# Usage: KEY=path/to/yomi-key.pem HOST=ubuntu@34.227.91.40 scripts/deploy-backend.sh
set -euo pipefail

KEY="${KEY:?set KEY=path to the .pem SSH key}"
HOST="${HOST:?set HOST=ubuntu@<elastic-ip>}"
BRANCH="${BRANCH:-main}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "==> shipping ${BRANCH} to ${HOST}"
git -C "$REPO_ROOT" archive --format=tar.gz "$BRANCH" -o /tmp/yomi-deploy.tar.gz
scp -i "$KEY" -o ConnectTimeout=25 /tmp/yomi-deploy.tar.gz "${HOST}:/tmp/yomi-deploy.tar.gz"
rm -f /tmp/yomi-deploy.tar.gz

echo "==> extracting, rebuilding, restarting (env.production is preserved)"
ssh -i "$KEY" -o ConnectTimeout=25 -o ServerAliveInterval=30 "$HOST" '
  set -e
  tar xzf /tmp/yomi-deploy.tar.gz -C ~/yomi
  cd ~/yomi
  docker compose up -d --build backend
  sleep 6
  docker compose logs backend --tail 8 | grep -iE "listening|error" || true
'

echo "==> verifying public health"
curl -s -m 20 -w "\nHTTP %{http_code}\n" https://api.getyomi.in/health
