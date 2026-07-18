# Build context is the repo root (monorepo). See docker-compose.yml.
FROM oven/bun:1.3

WORKDIR /app

# Copy the whole monorepo (heavy apps excluded via .dockerignore) and install.
# We run TypeScript directly with Bun — no build step, which keeps memory low
# enough for a small EC2 instance.
#
# NOT --frozen-lockfile: .dockerignore prunes apps/landing from the build
# context, so the workspace set here never matches the lockfile and bun
# aborts. That means caret ranges get re-resolved on every rebuild, so anything
# whose behaviour we depend on must be pinned exactly in package.json instead
# (see better-auth — a minor bump there changed OAuth state handling).
COPY . .
RUN bun install

WORKDIR /app/apps/backend

ENV PORT=3001
ENV ENVIRONMENT=production
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
