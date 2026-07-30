# Yomi Specs

Evergreen specifications for what Yomi is and how its pieces fit together. These
describe the intended system; they are kept in sync as features land. Read
`00-overview.md` first.

For the terse operational summary of the whole system, see the repo-root
`AGENTS.md`. For per-feature design/plan artifacts, see `docs/superpowers/`.

## System

| Spec                                     | Topic                                         |
| ---------------------------------------- | --------------------------------------------- |
| [00](00-overview.md)                     | Overview — surfaces, paths, memory model      |
| [01](01-architecture.md)                 | Architecture — backend, landing, APIs         |
| [09](09-harness.md)                      | Harness — prompt, tools, hooks, loop guards   |
| [10](10-memory.md)                       | Memory — backend canonical                    |
| [11](11-database.md)                     | Database — PostgreSQL (AWS RDS) tables        |
| [12](12-backend.md)                      | Backend — Hono Worker, auth, billing, gateway |
| [13](13-pricing.md)                      | Pricing — pure-credit model                   |
| [14](14-landing-page.md)                 | Landing page + dashboard                      |
| [15](15-dashboard-credits-connectors.md) | Dashboard credits + connectors                |
| [16](16-rag.md)                          | RAG — retrieval + Drive auto-sync             |
| [19](19-hermes-features.md)              | Agent features                                |

## Connectors

Per-connector tool surface, auth, and gaps — see [`connectors/`](connectors/),
starting with [`connectors/00-index.md`](connectors/00-index.md). Runtime defs
live in `packages/agent-core/src/connectors/`.

## Runbooks

- [`runbook-google-oauth.md`](runbook-google-oauth.md) — Google OAuth console
  setup.

## Archive

[`archive/`](archive/) holds superseded point-in-time plans and design/audit
docs kept for history. They are **not** current specs.
