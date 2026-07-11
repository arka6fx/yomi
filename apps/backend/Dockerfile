# Build context is the repo root (monorepo). See docker-compose.yml.
FROM oven/bun:1.3

WORKDIR /app

# Copy the whole monorepo (heavy apps excluded via .dockerignore) and install.
# We run TypeScript directly with Bun — no build step, which keeps memory low
# enough for a small EC2 instance.
#
# --frozen-lockfile: without it every rebuild re-resolves the caret ranges in
# package.json, so prod silently runs whatever npm served that day rather than
# the versions the test suite actually ran against.
COPY . .
RUN bun install --frozen-lockfile

WORKDIR /app/apps/backend

ENV PORT=3001
ENV ENVIRONMENT=production
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
