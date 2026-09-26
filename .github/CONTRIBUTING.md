# Contributing to Yomi

Thanks for helping out. This guide covers setup, the development workflow, and
what a pull request needs to be merged.

## Development setup

**Prerequisites:** Node.js 22+, npm 10, [`uv`](https://docs.astral.sh/uv/), and
Python 3.11+ (uv can install it for you).

```bash
git clone https://github.com/arka6fx/yomi.git
cd yomi
npm install                              # JavaScript workspaces

cd apps/api
uv sync --dev                            # Python backend
cp .env.example .env                     # fill in the Cloudflare values
cd ../..
cp apps/web/.env.example apps/web/.env.local
```

Run the two apps in separate terminals:

```bash
npm run python:dev                       # backend   → http://localhost:8080
npm run dev --workspace @yomi/web        # dashboard → http://localhost:3000
```

## Where code goes

| Change                                   | Location                                |
| ---------------------------------------- | --------------------------------------- |
| API routes, agent, connectors, billing   | `apps/api/src/yomi/`                    |
| Database schema                          | a new file in `apps/api/migrations-d1/` |
| Marketing site and dashboard             | `apps/web/src/`                         |
| Computer-use desktop                     | `apps/sandbox/`                         |
| Types shared between TypeScript apps     | `packages/shared/`                      |
| Connector catalog shown in the dashboard | `packages/ui/src/catalog.ts`            |
| Documentation                            | `docs/`                                 |

The backend is the only thing that reads or writes storage. The web app talks to
it over `/api/*`.

Before adding a new capability, check the footprint ladder in
[`AGENTS.md`](../AGENTS.md#footprint-ladder): extend existing code before adding
a new tool, service, or package.

## Workflow

1. Branch from `main`: `git checkout -b feat/short-name` (or `fix/`, `docs/`).
2. Make focused commits using
   [Conventional Commits](https://www.conventionalcommits.org/): lowercase,
   imperative, 72 characters at most, no trailing period.

   ```text
   feat: add calendar digest routine
   fix: handle expired connector token
   docs: document d1 migration workflow
   ```

   Types: `feat`, `fix`, `refactor`, `perf`, `style`, `test`, `chore`, `docs`.

3. Run the checks below.
4. Open a pull request against `main` using the template.

## Checks

CI runs all of these, and a red build blocks the deploy.

```bash
# Python backend
npm run python:lint        # ruff
npm run python:test        # pytest

# TypeScript workspace
npm run format:check       # prettier (npm run format to fix)
npm run lint
npm run typecheck
npm run test               # vitest
npm run docs:check         # docs agree with the connector catalog
```

## Tests

- Python tests live in `apps/api/tests/` and run against an in-memory SQLite
  copy of the D1 schema. Mock `httpx` and model calls; tests must not reach the
  network.
- TypeScript tests sit next to the code they cover (`*.test.ts`) and run under
  Vitest.
- Test behavior, not private implementation details.

## Code style

- **Python:** ruff (`E, F, I, UP, B, SIM`), 100-character lines, async I/O
  throughout.
- **TypeScript:** ESLint and Prettier. No `as any` outside tests, no unused
  imports.
- Comment only what is not obvious from the code.
- Never commit secrets. Only `.env.example` templates belong in the repo.

## Pull requests

- Keep each pull request to one concern. Split large changes.
- Link the issue it resolves (`Closes #123`).
- If the change touches memory, encryption, retention, or personal data, say so
  in the description and explain how existing privacy guarantees are kept.
- If it makes a structural decision, add an ADR in `docs/adr/`, starting from
  [`0000-template.md`](../docs/adr/0000-template.md).
- If it adds a D1 migration, mention it so it gets applied before the deploy.

## Finding something to work on

Issues labeled `ready-for-agent` or `ready-for-human` are ready to pick up. The
label vocabulary is in
[`docs/agents/triage-labels.md`](../docs/agents/triage-labels.md).

## Security

Do not open a public issue for a vulnerability. Follow
[`SECURITY.md`](./SECURITY.md) to report it privately.

## Code of conduct

By taking part you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
