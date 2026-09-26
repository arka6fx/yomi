# Yomi documentation

Documentation for people building and running Yomi. User-facing help is at
[getyomi.in/docs](https://getyomi.in/docs).

## Start here

| Document                                   | Read it to                                                      |
| ------------------------------------------ | --------------------------------------------------------------- |
| [`architecture.md`](./architecture.md)     | Understand how the system fits together                         |
| [`runbook.md`](./runbook.md)               | Deploy, migrate, configure secrets, and troubleshoot production |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Set up a dev environment and open a pull request                |
| [`../CONTEXT.md`](../CONTEXT.md)           | Learn the domain vocabulary                                     |

## Specifications

[`specs/`](./specs/README.md) holds the evergreen product specs: memory,
harness, pricing, RAG, the dashboard, and one page per connector under
[`specs/connectors/`](./specs/connectors/00-index.md).
[`specs/archive/`](./specs/archive/) keeps superseded plans for history only.

## Architecture decision records

Decisions that shape the codebase, in [`adr/`](./adr/). Start a new one from
[`0000-template.md`](./adr/0000-template.md).

| ADR                                                               | Decision                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [0001](./adr/0001-proactive-suggestions-deterministic-earning.md) | Proactive suggestions are earned deterministically; the LLM only phrases them |
| [0002](./adr/0002-retire-desktop-telegram-only.md)                | Retire the desktop client; Telegram is the only chat surface                  |
| [0003](./adr/0003-session-summaries-via-memory-engine.md)         | Session summaries reuse the memory engine                                     |
| [0005](./adr/0005-capability-based-security-model.md)             | Capability-based security model                                               |
| [0006](./adr/0006-contradiction-resolution-at-extraction.md)      | Contradictions are resolved during memory extraction                          |
| [0007](./adr/0007-google-drive-auto-sync-rag-r2.md)               | Google Drive auto-syncs into RAG through R2                                   |

## Product

- [`product/personal-agent-capability-map.md`](./product/personal-agent-capability-map.md):
  what a personal agent should be able to do, and where Yomi stands.

## Working agreements

Conventions used by maintainers and coding agents:

- [`agents/issue-tracker.md`](./agents/issue-tracker.md): how issues are filed
  and tracked
- [`agents/triage-labels.md`](./agents/triage-labels.md): the label vocabulary
- [`agents/domain.md`](./agents/domain.md): where domain docs live
