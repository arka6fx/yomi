# Build context is the repo root (monorepo). See docker-compose.yml.
FROM oven/bun:1.3

WORKDIR /app

# Copy the whole monorepo (heavy apps excluded via .dockerignore) and install.
# We run TypeScript directly with Bun — no build step, which keeps memory low
# enough for a small EC2 instance.
COPY . .
RUN bun install

WORKDIR /app/apps/backend

ENV PORT=3001
ENV ENVIRONMENT=production
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
