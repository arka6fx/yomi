# Yomi personal-agent capability map

Updated: 2026-09-27

This is the product decision log for evolving Yomi into a personal operator. It is
grounded in the current repository and in public product material; it is not a claim
that every competitor feature is available to every user.

## What the reference product demonstrates

The supplied Instinct screenshots show a deliberately small information architecture:
Workspace, Vault, Trusted people, Preferences, and a connector list. The visible
connector descriptions are outcome-oriented (read/search/draft/send), while the Vault
separates logins, payment cards, personal information, and agent items. The reference
also makes privacy, connection pause, deletion, and account controls first-class.

Instinct's public homepage claims text/call interaction, connections to applications and
devices (including email, messaging, screen, audio, and location), and proactive
life-admin work such as following up, arranging transport, and booking services.
[Official Instinct description](https://instinct.com/)

OpenInstinct is useful implementation evidence rather than an Instinct product claim:
it documents a per-deployment encrypted vault, a cloud browser, user-scoped Google
access, approval before purchases/email/calendar/destructive changes, and screenshots
after browser work. [OpenInstinct repository](https://github.com/Merit-Systems/OpenInstinct)

## Current Yomi audit

| Area | Current state | Gap / next move |
| --- | --- | --- |
| Identity and Telegram | Implemented; Telegram maps to the linked user and durable D1 history exists | Add unified web/Telegram run timeline |
| Email address | Implemented: `<alias>@mail.getyomi.in` via Cloudflare Email Routing to the Worker `email()` handler; Telegram alerts, agent inbox tools, receipts logged to spending | Let the agent reply from the address (Email Service send) |
| Agent loop | Implemented; tool loop, compaction, saved soul, Composio metering | Add structured plans, step events, cancellation and resumable runs |
| Memory | Implemented; memory CRUD, search, embeddings and privacy export/delete | Add provenance, confidence, correction and relationship/project entities |
| Connectors | Implemented; native Google/GitHub/Slack/etc. plus Composio and custom MCP | Add capability/risk display and per-tool permission settings |
| Approval | Implemented; approving replays the gated tool once (D1), Telegram shows inline Approve/Reject; buy/pay/place-order/book clicks on the computer are gated too | Extend the same gate to terminal writes and coordinate clicks on checkout pages |
| Browser | Implemented as HTTP scrape/search/extract; computer sandbox exists separately | Add browser session state, screenshot evidence and verification loop |
| Computer | Implemented per-user sandbox: pages read as text plus numbered elements (web_open/web_page/web_act), screenshots and input as fallback; logins saved to R2 between sleeps; live take-over view in the dashboard | Terminal coding agents; faster cold starts |
| Scheduling | Implemented: the 10-minute Worker cron fires due schedules (timezone-aware, default Asia/Kolkata) into the durable run ledger and delivers results on Telegram; the agent creates schedules from chat | Per-schedule run history in the dashboard; finer than 10-minute timing |
| Plans | Free (unlimited chat, 3 active routines) and Pro ($5: smarter engine, unlimited routines) via Dodo; no credits; usage still logged for cost tracking | Usage alerts before Workers AI costs grow |
| Vault | Implemented (D1): logins, cards, addresses, phones, agent items; secrets typed into the sandbox, never shown to the model | Add TOTP/2FA handoff and per-site login autofill |
| Money | Card payments need approval, then a 15-minute typing window; per-card monthly limits and a spend ledger | Add receipts from Gmail and budgets per category |
| Trusted people | Implemented (D1): email-based requests, mutual trust, silent blocks, pause; agent-to-agent messages delivered on Telegram after approval | Let a trusted person's Yomi answer availability questions from Calendar without a human hop |
| Observability | D1 `agent_runs` and privacy audit exist | Expose a redacted run timeline to the user |
| Dashboard | Implemented: home, skills, characters, routines, vault, computer, conversation (streaming), memory, activity, apps, billing | Keep every page on the same visual language |

## Capability frontier and priority

## Evidence-based comparison

| Capability | Instinct | ChatGPT agent | OpenInstinct evidence | Yomi today |
| --- | --- | --- | --- | --- |
| Natural messaging | Confirmed on official site (text/call) | Confirmed on web/mobile/desktop | iMessage implementation documented | Telegram confirmed; web dashboard is management-first |
| Connectors | Confirmed applications/devices at a high level | Confirmed apps/connectors | Google OAuth documented | Native connectors, Composio, custom MCP |
| Browser/computer | Confirmed on official site at a high level | Confirmed visual browser + terminal + apps | Confirmed cloud browser and screenshots | Per-user sandbox, screenshot/input/open/windows/terminal |
| Purchases/bookings | Official site gives examples; details not public | Confirmation required for consequential actions | Purchase approval documented | Connector writes gated; computer checkout gate is the next gap |
| Secret vault | Screenshot reference shows it; public implementation details limited | Takeover keeps passwords out of model context | Encrypted vault and handles documented | Encrypted connector tokens; no user-facing vault yet |
| Background/scheduled work | Proactive behavior claimed, implementation unknown | Scheduled tasks confirmed | Workstreams documented; jobs depend on deployment | Schedules and D1 run leasing implemented |
| Run transparency | Not publicly specified | On-screen narration and interruption documented | Screenshots/results reported | D1 runs exist; user-facing run timeline missing |

The comparison deliberately separates product claims from implementation evidence. For
example, the official Instinct site describes capabilities but does not document its
internal permission model; OpenInstinct is a separate open-source project and is not
proof of Instinct's private implementation.

### Phase 1 — make the current foundation trustworthy

1. A unified activity/run timeline: goal, tools, approvals, result, cost, duration and
   errors, with secrets and message bodies redacted.
2. A capability permission matrix: read-only, reversible, external communication,
   financial, and irreversible. Connector writes and computer actions use one gate.
3. A user-facing Vault for encrypted login/card/address handles. Raw values never enter
   model context; checkout always pauses for explicit approval.
4. One web/Telegram identity and history view, with the same pending approvals and
   schedules visible in both places.

### Phase 2 — proactive personal operator

1. Agent templates: morning brief, unanswered-message follow-up, deadline watch, price
   watch, research digest, and travel monitor.
2. Persistent run lifecycle: queued, running, waiting for approval, paused, failed,
   completed, cancelled; retry only idempotent steps.
3. Context graph entities for people, projects, tasks, events, documents, locations and
   commitments, backed by memory provenance.

### Phase 3 — high-capability execution

1. Browser goal execution: research → compare → prepare → approval → checkout → verify.
2. Semantic computer actions (accessibility tree/DOM before coordinates), visual
   checkpoints, upload/download handling and recovery from changed screens.
3. Delegated communication with trusted-person allowlists, message previews and quiet
   hours.

## Explicit non-goals

Yomi should not silently buy, send, delete, authenticate as the user, or expose stored
credentials. It should not build an invasive profile from sensitive attributes, and it
should not create a multi-agent swarm until a single durable run cannot solve the task.

## Decision log

- Use the existing Python loop, D1/Postgres stores, pending-action gate and sandbox;
  avoid a second agent runtime.
- Treat the screenshots as interaction inspiration: simple navigation, strong privacy
  controls, and outcome-oriented connectors—not a visual clone.
- Implement observable, reversible foundations before autonomous shopping or booking.
