# Security Policy

## Reporting a vulnerability

Do **not** open a public issue or pull request for a security vulnerability.

Please report it privately by emailing
**[contact.arkagarai@gmail.com](mailto:contact.arkagarai@gmail.com)**. If
possible include:

- The affected component (`apps/backend`, `apps/landing`, `packages/agent-core`,
  etc.)
- Steps to reproduce, or a minimal proof of concept
- Any impact you've observed

You should receive an acknowledgment within 3 business days. We'll work with you
to validate, fix, and coordinate disclosure responsibly. We'll credit you in the
release notes (if you want to be named).

## Scope

In scope:

- The backend: `apps/backend/**`
- The dashboard/web app: `apps/landing/**`
- Shared packages: `packages/**`

Out of scope (not vulnerabilities in this repository):

- Vulnerabilities in third-party dependencies — report them upstream.
- Public infrastructure (the production Workers at `api.getyomi.in` /
  `getyomi.in` and Neon/OpenAI/etc. accounts) — these are operated by the
  maintainers and are not reproducible by outside contributors.

## Security practices in this repo

- Real secrets (API keys, OAuth tokens, encryption keys) never live in the repo.
  Only `.env.example` templates are committed; real values stay in gitignored
  files and Cloudflare Worker secrets.
- OAuth tokens are encrypted at rest (`ENCRYPTION_KEY`); `hook_logs` are
  PII-redacted; `mcp_connections.oauth_tokens` are encrypted.
- User memory is user-owned: export and delete remain possible at all times.
- Before you push, check that your diff contains no secrets:

  ```bash
  git diff --cached --check
  ```

  and that no real env file is staged (`git status` should never show `.env` or
  `.env.production` as new additions).
