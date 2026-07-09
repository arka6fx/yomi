# Credit System, AI Cost Optimization, And Dashboard Redesign

> Status: proposed implementation spec. This file is the source of truth for the
> next architecture pass. Do not expose internal credit pricing rules in
> frontend copy or public API contracts after this spec is implemented.

## Executive Summary

Yomi currently has a working pure-credit billing model, but the credit charge is
still a static pre-flight reservation by feature: chat, voice, analyze, and
bot_message. The UI and marketing pages expose those implementation prices. The
AI runtime already receives token usage from the OpenAI-compatible provider
adapter, but canonical backend usage rows are usually created before the model
call and are not updated with actual token usage, model cost, tool count,
connector activity, vision images, latency, or dynamic credit computation.

The target architecture keeps credits as a user-facing abstraction and makes
pricing an internal backend policy. User-facing surfaces show only plan,
remaining credits, included credits, used credits, reset date, monthly trend,
and friendly recent activity. Developer diagnostics move to a separate page.

## Goals

- Trace every AI request through desktop, sidecar, backend, memory, RAG,
  connectors, model calls, usage logging, credit deduction, and dashboard.
- Persist actual AI telemetry for every billable request.
- Reduce average AI cost without reducing quality.
- Introduce an internal request router that decides context, model, reasoning,
  max output, and telemetry before each request.
- Redesign credits so the frontend never knows per-feature or per-model pricing.
- Redesign the dashboard into a premium SaaS experience.
- Preserve Dodo products, plan prices, and existing credit balances.

## Non-Goals

- Do not change Dodo product IDs or public plan prices in this pass.
- Do not remove existing credit balances, grants, or transaction history.
- Do not reduce quality-critical agent, coding, desktop automation, or
  multi-step reasoning tasks to a smaller model by default.
- Do not store raw prompt content in telemetry beyond existing message/session
  tables. Store counts, hashes, categories, and redacted metadata.

## Current Architecture Overview

### Monorepo Areas

- `apps/desktop`: Electron shell and renderer. Captures user input, audio, and
  screen context, then talks to the sidecar.
- `apps/sidecar`: local Hono server, intent routing, fast pipeline, agent
  pipeline, local connector registry, memory client, local usage insights.
- `apps/backend`: Hono/Bun Cloudflare Worker backend for auth, billing,
  canonical credits, Telegram gateway, memory, RAG, integrations, and LLM proxy.
- `apps/landing`: Next.js marketing, dashboard, account linking, billing UI.
- `packages/agent-core`: OpenAI-compatible model adapter, connector
  tool loop, connector definitions.
- `packages/db`: Drizzle schema for Better Auth, credits, usage events, agent
  sessions, memory, RAG, integrations, and pending actions.
- `packages/shared`: plan definitions, shared contracts, chunking utilities.

### AI Runtime

- `packages/agent-core/src/model.ts` implements the OpenAI-compatible provider.
- Default chat base URL is `OPENAI_BASE_URL` or OpenAI-compatible fallback.
- Default full model is `gpt-5.5`.
- Default embedding model is `text-embedding-3-small`.
- Streaming requests include `stream_options: { include_usage: true }`.
- The adapter returns `usage.promptTokens` and `usage.completionTokens`, but
  most callers do not persist it into canonical backend usage rows.

### Credit Runtime

- `packages/shared/src/plans.ts` defines plans, included credits, feature
  limits, credit packs, and static `CREDIT_COSTS`.
- `apps/backend/src/services/credit-pricing.ts` maps feature kind to static
  credit charge.
- `apps/backend/src/services/metering.ts` is the current billing chokepoint.
- `apps/backend/src/services/credit-ledger.ts` owns grants, consumption,
  transactions, account balance, and expiry.
- `apps/backend/src/routes/usage.ts` exposes `/api/usage/interactions/reserve`
  for pre-flight charging and `/api/usage` for generic usage event insertion.
- `apps/backend/src/routes/billing.ts` exposes `/api/billing/subscription`,
  which powers the dashboard.

### Dashboard Runtime

- `apps/landing/src/app/dashboard/page.tsx` fetches `/api/billing/subscription`.
- The dashboard currently renders `creditsUsed / totalCredits`, remaining
  credits, credit packs, recent transactions, connector count, and explicit cost
  legend cards.
- The dashboard currently exposes implementation details such as
  `AI chat: 1 credit`, `Image/screen: +1 credit`, and
  `Voice input/output: +2 credits/min`.
- `apps/landing/src/components/dashboard/StatusManager.tsx` shows status and
  diagnostics. This should become the basis for a developer/diagnostics page.

## Complete Request Flow: Desktop Typed Message

1. User types into the desktop app.
2. Desktop sends a request to sidecar `/query`, `/query/fast`, or
   `/query/agent`.
3. `apps/sidecar/src/index.ts` parses the request.
4. `/query` calls `resolveText()` from `apps/sidecar/src/pipeline/fast.ts` so
   STT is not paid twice when audio is present.
5. `/query` calls `classifyIntent()` from `apps/sidecar/src/router/intent.ts`.
6. The LLM fallback classifier is `apps/sidecar/src/router/llm.ts`, using
   `generateObject`, `gpt-5.4-mini`, `maxTokens: 80`, and a 250 ms timeout.
7. Sidecar emits `router_decision` over SSE.
8. Sidecar writes a local usage event via `logUsageEvent({ kind })`, but without
   model, tokens, latency, or cost.
9. Fast requests call `fastPipeline()` in `apps/sidecar/src/pipeline/fast.ts`.
10. Agent requests call `runGraph()` in `apps/sidecar/src/graph/run.ts`, which
    currently delegates to `agentPipeline()` in
    `apps/sidecar/src/pipeline/agent.ts`.
11. The selected pipeline calls `reserveInteraction("chat")` in
    `apps/sidecar/src/usage/reserve.ts`, unless `skipReserve` is true.
12. `reserveInteraction()` calls backend `/api/usage/interactions/reserve`.
13. Backend `usageRouter` calls `chargeUsage()` in
    `apps/backend/src/services/metering.ts`.
14. `chargeUsage()` checks owner bypass, plan access, current credit balance,
    and static cost from `creditsForUsage()`.
15. `chargeUsage()` inserts a `usage_events` row with zero tokens and consumes
    credits immediately through `consumeCredits()`.
16. Sidecar continues only if the reservation succeeds.
17. Fast path builds prompt via `buildFastPrompt()` in
    `apps/sidecar/src/harness/prompt.ts`.
18. Fast path conditionally includes screenshot images using
    `needsScreenContext()`.
19. Fast path loads memory for Pro/Max via `loadMemoryContext()` in
    `apps/sidecar/src/memory/subsystem.ts`.
20. `loadMemoryContext()` calls cloud memory, cloud RAG, and profile retrieval
    in parallel, with fixed character budgets of 3500, 3000, and 2500.
21. Fast path calls `streamText()` with `gpt-5.4-mini` and heuristic max tokens
    of 800, 1100, 1200, or 1400.
22. Agent path builds prompt via `buildAgentPrompt()` and always includes
    connector info plus memory context for Pro/Max.
23. Agent path builds all agent tools with `createAgentTools()` and calls
    `streamText()` with `gpt-5.5`, `maxSteps` defaulting to 20, and no explicit
    `maxTokens`.
24. The provider adapter sends `/chat/completions` and streams back text, tool
    calls, and final token usage.
25. Sidecar streams chunks to desktop over SSE.
26. TTS may synthesize chunks via ElevenLabs in fast mode and one merged
    response in agent mode.
27. Fast path writes session memory and triggers structured memory extraction.
28. Actual model usage is not linked back to the backend reservation event.
29. Dashboard later fetches `/api/billing/subscription` and shows the
    pre-charged credits, not actual cost-derived credits.

## Complete Request Flow: Telegram Text Message

1. Telegram webhook enters `GatewayRunner.onIncoming()` in
   `apps/backend/src/gateway/gateway-runner.ts`.
2. Link, control, approval, and onboarding commands are handled before paid
   work.
3. For ordinary text, backend loads or creates the shared agent session through
   `apps/backend/src/services/agent-sessions.ts`.
4. Backend calls `runAgent()` in `apps/backend/src/agent/run.ts`.
5. `runAgent()` checks plan access with `hasBillablePlanAccess()`.
6. `runAgent()` calls `chargeUsage({ kind: "bot_message" })` before connector,
   memory, RAG, or LLM work.
7. Backend initializes `ConnectorRegistry` with backend-safe connector tools.
8. Backend fetches memory, RAG, and memory profile in parallel.
9. Backend builds a system prompt with `buildSystemWithContext()`.
10. Backend calls `runAgentLoop()` in `packages/agent-core/src/agent.ts`.
11. `runAgentLoop()` calls `generateText()` with default `gpt-5.5`, connector
    tools, `maxSteps`, and adaptive `maxTokens` from backend heuristics.
12. Backend captures memory using `captureBackendMemory()` with a second
    `generateText()` call on `gpt-5.4-mini`.
13. Backend appends the turn to `agent_messages`.
14. Backend sends the reply to Telegram.
15. Actual token usage and tool count are not persisted onto the original
    `usage_events` row.

## Complete Request Flow: Telegram Voice Or Image

### Voice

1. `GatewayRunner` sees `msg.audioUrl`.
2. It calls `featureQuotaBlock()` with static `voice` cost.
3. It transcribes through `transcribeAudioUrl()` in
   `apps/backend/src/services/transcription.ts`.
4. It inserts an add-on usage event through `recordGatewayCreditAddon()` and
   consumes static voice credits.
5. It then treats the transcript as a normal Telegram text message, causing a
   separate `bot_message` charge and agent LLM call.
6. If the user asks for a voice reply, `sendVoiceReplyIfRequested()` calls
   `synthesizeSpeech()` and records another voice add-on charge.

### Image

1. `GatewayRunner` sees `msg.imageUrl`.
2. It calls `featureQuotaBlock()` with static `analyze` cost.
3. It downloads and base64 encodes the image.
4. It calls `generateText()` directly in `analyzeImage()` with `gpt-5.5` and
   `maxTokens: 420`.
5. It records a static analyze add-on credit charge after the model call.
6. Token usage and image size/count are not persisted.

## Current OpenAI-Compatible Call Sites

| Area                        | File                                           | API                           | Model                                             | Budget                  | Notes                                                                          |
| --------------------------- | ---------------------------------------------- | ----------------------------- | ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Sidecar fast answer         | `apps/sidecar/src/pipeline/fast.ts`            | `streamText`                  | `OPENAI_FAST_MODEL` or `gpt-5.4-mini`         | 800-1400                | Good model choice, context often too broad for Pro/Max.                        |
| Sidecar agent               | `apps/sidecar/src/pipeline/agent.ts`           | `streamText`                  | `OPENAI_AGENT_MODEL` or `gpt-5.5`             | none explicit           | Highest risk: full tools, memory/RAG, up to 20 steps.                          |
| Sidecar router LLM fallback | `apps/sidecar/src/router/llm.ts`               | `generateObject`              | `gpt-5.4-mini`                                    | 80                      | Good, but should be avoided when heuristics are confident.                     |
| Sidecar compressor          | `apps/sidecar/src/agent/compressor.ts`         | `generateText`                | `COMPRESSOR_MODEL`, fast model, or `gpt-5.4-mini` | none explicit           | Should add explicit budget.                                                    |
| Sidecar cron agent          | `apps/sidecar/src/tools/cron/cron-executor.ts` | `generateText`                | job model or cron model                           | none explicit           | Needs max output and telemetry.                                                |
| Backend Telegram agent      | `apps/backend/src/agent/run.ts`                | `runAgentLoop`/`generateText` | default `gpt-5.5`                                 | 450-900                 | Good cap, but always fetches memory/RAG/profile.                               |
| Backend memory extraction   | `apps/backend/src/agent/run.ts`                | `generateText`                | `gpt-5.4-mini`                                    | none explicit           | Should be capped and skip for low-value turns.                                 |
| Backend image analysis      | `apps/backend/src/gateway/gateway-runner.ts`   | `generateText`                | `gpt-5.5`                                         | 420                     | Consider mini for simple image Q&A.                                            |
| Agent core loop             | `packages/agent-core/src/agent.ts`             | `generateText`                | `gpt-5.5` default                                 | caller-supplied         | Shared path, must emit telemetry.                                              |
| Embeddings: sidecar/shared  | `packages/agent-core/src/model.ts`             | `/embeddings`                 | `text-embedding-3-small`                          | input sliced 8000 chars | Needs telemetry for embedding tokens/cost.                                     |
| Embeddings: backend memory  | `apps/backend/src/routes/memory.ts`            | `/embeddings`                 | `text-embedding-3-small`                          | per memory/search       | Needs telemetry and cache awareness.                                           |
| Embeddings: backend RAG     | `apps/backend/src/routes/rag.ts`               | `/embeddings`                 | `text-embedding-3-small`                          | per chunk/query         | Indexing can be expensive; batch/caching needed.                               |
| Optional RAG rerank         | `apps/backend/src/lib/rerank.ts`               | likely LLM when enabled       | env-controlled                                    | unknown                 | Must be included in telemetry.                                                 |
| Backend LLM proxy           | `apps/backend/src/routes/llm.ts`               | raw proxy                     | client-provided                                   | client-provided         | Needs authentication, telemetry, and policy enforcement before production use. |

## Current Cost Drivers

### Highest Cost Areas

1. Sidecar agent `gpt-5.5` streaming with tools and no explicit output cap.
2. Backend Telegram agent `gpt-5.5` with connector tools, memory, RAG, and
   follow-up memory extraction.
3. Vision/image analysis using `gpt-5.5` for all Telegram images.
4. Memory/RAG retrieval injection on every Pro/Max fast and agent request.
5. RAG indexing, because each chunk is embedded one-by-one.
6. Backend memory search, because query embeddings happen per search.
7. TTS, especially agent mode synthesizing the full final text and Telegram
   voice replies up to 1200 chars.

### Token Inefficiencies

- Fast prompts always include answer format rules, voice rules, examples,
  connector catalog, screen rules, and full identity block.
- Agent prompts always include connector info and broad tool/capability rules.
- Pro/Max memory context always loads memory, RAG, and profile together, even
  for greetings and simple factual questions.
- Backend Telegram always loads memory, RAG, and profile before agent execution.
- Connector info includes all available connectors plus connected connectors on
  every prompt.
- Sidecar agent has no explicit response budget.
- Compressor and memory extraction have no explicit `maxTokens`.
- Conversation history is appended directly, with compression only when
  thresholds are crossed.

## Target Architecture

### Prerequisite: Cost Analytics Before Optimization

Before changing model routing, prompts, context retrieval, or dynamic pricing,
ship an admin-only analytics surface backed by canonical telemetry. This
prevents optimizing from intuition and gives a baseline for every later change.

The internal dashboard must track:

- Cost per endpoint.
- Cost per model.
- Average input and output tokens.
- Average response latency.
- Cost per connector.
- Daily and monthly AI spend.
- Top 10 most expensive users for debugging and abuse detection.
- Token distribution by task type.

This dashboard is not user-facing billing UI. It is an owner/admin diagnostics
tool and may expose internal model names, endpoint names, token counts, and cost
estimates. It must not expose raw prompt text, raw connector payloads, secrets,
OAuth tokens, or unredacted user content.

### Request Pipeline

```text
Request
  -> normalize input
  -> classify intent
  -> estimate complexity
  -> build context plan
  -> reserve minimum credits or authorize balance
  -> execute model/tool/voice/retrieval calls
  -> collect telemetry
  -> compute final internal credit charge
  -> consume or adjust credits
  -> persist usage event and analytics
  -> return response
```

### New Internal Modules

- `apps/backend/src/services/ai-telemetry.ts`: canonical telemetry ingestion and
  usage event finalization.
- `apps/backend/src/services/dynamic-credit-pricing.ts`: internal cost-to-credit
  policy, versioned and not imported by frontend.
- `apps/backend/src/services/request-router.ts`: shared request classification,
  complexity estimation, context policy, model selection, and output budget.
- `apps/sidecar/src/router/request-plan.ts`: local mirror of non-pricing routing
  policy, returning a serializable request plan.
- `packages/shared/src/usage-contracts.ts`: public API response shapes without
  pricing formulas.
- `packages/agent-core/src/telemetry.ts`: provider-level hooks for model usage,
  latency, tool calls, and request metadata.

## Intelligent Request Router

The router returns a `RequestPlan`, not a price.

```ts
type RequestPlan = {
  route: "fast" | "agent"
  intent:
    | "greeting"
    | "simple_qa"
    | "writing"
    | "coding"
    | "connector_lookup"
    | "connector_action"
    | "memory_query"
    | "screen_qa"
    | "vision_analysis"
    | "voice"
    | "research"
    | "desktop_automation"
  complexity: "trivial" | "simple" | "normal" | "complex" | "critical"
  context: {
    memory: "none" | "profile" | "relevant" | "full"
    rag: "none" | "keyword" | "hybrid"
    connectors: string[]
    screen: boolean
    historyTurns: number
  }
  model: "gpt-5.4-mini" | "gpt-5.5"
  maxOutputTokens: number
  reasoning: "none" | "low" | "medium" | "high"
  telemetryEndpoint: string
}
```

### Routing Rules

- Greeting: mini, no memory, no RAG, no connectors, no screenshot, 100-150
  tokens.
- Simple question: mini, no memory unless explicit prior-context language,
  200-300 tokens.
- Normal assistant response: mini, relevant memory only when useful, 350-500
  tokens.
- Writing/email drafting: mini by default, relevant profile/memory, 600-800
  tokens.
- Connector lookup: mini by default, only the named connected provider, 500-800
  tokens.
- Connector action with side effects: full model when planning/approval is
  needed, only required connector, 800-1200 tokens.
- Coding/debugging: full model for non-trivial tasks, 1000-1400 tokens.
- Desktop automation: full model, screenshot only when required, 800-1200
  tokens.
- Multi-step research/planning: full model, relevant RAG/connectors, 1500+ with
  hard cap chosen by task.
- Vision: mini for simple caption/summary; full model for detailed UI debugging,
  charts, OCR-heavy tasks, or code/error screenshots.

## Adaptive Context Policy

### Prompt Modules

Prompts should be assembled from modules instead of monolithic strings.

- Identity: always, short.
- Personality/soul: always when configured, compact.
- Date/environment: always, one line.
- Answer formatting: only when the route requires copy-ready output, code, MCQ,
  or long-form writing.
- Voice rules: only when `tts` is true.
- Screen rules: only when an image is attached and selected by context plan.
- Connector rules: only when connector intent exists or the user mentions an
  app.
- Connector catalog: replace full catalog with connected providers plus a
  compact unavailable-provider policy.
- Memory citation rule: only when memory or RAG snippets are injected.
- Desktop automation rules: only in agent/desktop tasks.
- Safety and approval rules: only when tools with side effects are available.

### Context Budgets

- Greeting: zero retrieved context.
- Simple QA: zero retrieved context unless explicit memory language appears.
- Memory query: profile plus top relevant memory, max 1200 chars.
- RAG query: top snippets after hybrid/MMR, max 2000 chars by default.
- Connector query: only connector result summaries, max 3000 chars.
- Agent history: last 4 turns by default, summarize older turns before the
  model.
- Telegram shared history: last 6 turns max, plus one compact session summary.
- Screen: include only selected screenshots; omit screenshots for self-contained
  knowledge, math, greeting, and writing tasks.

## Adaptive Output Budgets

Every model call must set an explicit max output budget.

| Intent                   | Default Max Output Tokens |
| ------------------------ | ------------------------: |
| Greeting/acknowledgement |                       120 |
| Simple QA                |                       300 |
| Normal assistant         |                       500 |
| Summary/explanation      |                       600 |
| Connector lookup         |                       700 |
| Email/message draft      |                       800 |
| Image analysis           |                       500 |
| Coding/debugging         |                      1400 |
| Desktop automation       |                      1200 |
| Research/planning        |                      1800 |
| Memory extraction        |                       250 |
| Context compression      |                       400 |
| Intent classification    |                        80 |

No production model call may omit `maxTokens` or equivalent.

## Model Routing Policy

### Use `gpt-5.4-mini` By Default For

- Fast chat and simple Q&A.
- Intent classification.
- Email/message summaries and drafts.
- Calendar/email/file lookup summarization.
- Connector search result synthesis.
- Memory extraction.
- Context compression.
- RAG reranking if an LLM reranker remains enabled.
- Simple image description.

### Use `gpt-5.5` For

- Desktop automation with tools.
- Multi-step agent planning.
- Risky connector actions requiring approval reasoning.
- Non-trivial coding and debugging.
- Complex visual reasoning.
- Research tasks requiring multiple sources and synthesis.

## Telemetry Design

### Schema Additions

Keep `usage_events` for the user-facing ledger and add columns or a companion
table for detailed AI telemetry. Prefer a companion table to avoid risky legacy
migration on the billing-critical table.

```ts
ai_usage_events
  id uuid primary key
  usage_event_id uuid null references usage_events(id)
  user_id text not null
  conversation_id uuid null
  request_id text not null unique
  endpoint text not null
  surface text not null -- desktop | telegram | dashboard | cron | backend
  route text null -- fast | agent | gateway | rag | memory | tts | stt
  intent text null
  complexity text null
  model text null
  provider text null
  input_tokens integer not null default 0
  output_tokens integer not null default 0
  reasoning_tokens integer not null default 0
  cached_input_tokens integer not null default 0
  embedding_tokens integer not null default 0
  max_output_tokens integer not null default 0
  tool_calls integer not null default 0
  connector_count integer not null default 0
  connector_ids text[] not null default '{}'
  vision_images integer not null default 0
  voice_duration_seconds integer not null default 0
  tts_chars integer not null default 0
  stt_audio_seconds integer not null default 0
  latency_ms integer not null default 0
  first_token_latency_ms integer null
  total_api_cost_micros integer not null default 0
  credit_policy_version text not null
  credits_estimated integer not null default 0
  credits_charged integer not null default 0
  status text not null -- started | done | error | cancelled
  error_code text null
  metadata jsonb
  created_at timestamp not null default now()
  completed_at timestamp null
```

### Telemetry Requirements

- Capture actual token usage from `doGenerate()` and `doStream()` in
  `packages/agent-core/src/model.ts`.
- Capture model ID, endpoint, surface, request ID, latency, max output tokens,
  and status.
- Capture tool call count in `runAgentLoop()` and `agentPipeline()`.
- Capture connector IDs from connector registry/tools.
- Capture image count and approximate input image bytes for vision.
- Capture voice input seconds and TTS output chars.
- Capture embedding token estimate and model for RAG/memory indexing/search.
- Persist final dynamic credit charge on both `usage_events.creditsCharged` and
  `ai_usage_events.credits_charged`.
- Store cost estimates in micros, not floats.

## Dynamic Credit Pricing

Dynamic pricing must be backend-only and versioned.

```ts
type InternalCreditInput = {
  model?: string
  inputTokens: number
  outputTokens: number
  reasoningTokens?: number
  cachedInputTokens?: number
  embeddingTokens?: number
  visionImages?: number
  voiceDurationSeconds?: number
  ttsChars?: number
  toolCalls?: number
  connectorCount?: number
  surface: string
  intent?: string
}
```

Policy requirements:

- Return integer credits.
- Apply a minimum charge where needed, but do not expose it externally.
- Include model, tokens, voice, vision, connector/tool overhead, and future
  reasoning token pricing.
- Use `credit_policy_version` for reproducibility.
- Keep a reserve/settle model for long-running requests.
- On request start, reserve a conservative minimum if balance exists.
- On completion, settle final charge by consuming additional credits or
  refunding over-reserved credits.
- If final charge exceeds balance, allow the completed request but block the
  next request and mark account depleted. Do not interrupt already-completed
  work.

## Public Dashboard API Contract

Replace feature-pricing fields with a stable credit summary endpoint. This can
be implemented as a new `/api/billing/usage-summary` route or as a v2 shape in
`/api/billing/subscription`.

```json
{
  "plan": {
    "key": "pro",
    "name": "Pro",
    "status": "active",
    "isOwner": false
  },
  "credits": {
    "remaining": 1842,
    "included": 2500,
    "used": 658,
    "totalAvailableThisPeriod": 2500,
    "resetAt": "2026-08-01T00:00:00.000Z",
    "expiringSoon": 0,
    "expiringSoonAt": null
  },
  "monthlyUsage": {
    "days": [{ "date": "2026-07-01", "credits": 42 }]
  },
  "recentActivity": [
    {
      "id": "public-safe-id",
      "label": "Desktop Chat",
      "category": "desktop_chat",
      "credits": 3,
      "createdAt": "2026-07-04T10:30:00.000Z"
    }
  ],
  "actions": {
    "canBuyCredits": true,
    "canUpgrade": true,
    "upgradeUrl": "/dashboard?upgrade=true"
  }
}
```

Frontend must not receive:

- Static feature credit costs.
- Model prices.
- Token-to-credit formulas.
- Raw usage event IDs in user-facing activity.
- Prompt, memory, or connector payload content.

## Dashboard Redesign

### User-Facing Dashboard

- Top card: current plan, remaining credits, progress bar, `1842 / 2500`, reset
  countdown, and primary upgrade/buy credits action.
- Usage section: monthly credit usage trend, daily trend, and friendly recent
  activity.
- Recent activity labels: Desktop Chat, Voice Session, Notion Search, GitHub
  Task, Image Analysis, Telegram Chat, Scheduled Task, Memory Update.
- Integrations section: connected apps and health, no cost rules.
- Credit packs: visible only to Pro/Max or when user needs to upgrade first.
- Empty states should explain value, not mechanics.

### Developer Diagnostics Page

- Move implementation diagnostics out of the main dashboard.
- Candidate route: `/dashboard/developer` or a `status` tab gated behind an
  advanced toggle.
- Show model distribution, token totals, estimated API cost, latency, tool
  calls, connector count, and error rates.
- Reuse `StatusManager` and sidecar `insights` concepts, backed by canonical
  backend telemetry.

### Copy To Remove

- `AI chat = 1 credit`.
- `Telegram text = 1 base credit`.
- `Image/screen = +1 credit`.
- `Voice input/output = +2 credits/min`.
- Request ID snippets in user-facing recent activity.
- Marketing FAQ lines that describe credits per action.

## Backend Implementation Plan

### Phase 1: Telemetry Foundation

- Add `ai_usage_events` table and migration.
- Add indexes on user/time, usage event, endpoint, model, status, and request
  ID.
- Add `ai-telemetry` service for start/finalize/error events.
- Add tests for idempotency and no raw prompt storage.
- Add provider callbacks or wrapper helpers around `generateText`, `streamText`,
  `generateObject`, embeddings, STT, and TTS.

### Phase 2: Dynamic Pricing Service

- Add `dynamic-credit-pricing.ts` with a versioned policy.
- Keep old `creditsForUsage()` as a compatibility fallback during migration.
- Add settlement flow: authorize/reserve, finalize, refund/extra debit.
- Update `chargeUsage()` to support `mode: "reserve" | "finalize"` while keeping
  old callers working.
- Add tests for owner bypass, out-of-credits, race safety, partial failure, and
  idempotent settlement.

### Phase 3: Request Router

- Add request planning service with heuristic-first classification.
- Use LLM classifier only when confidence is low or route is ambiguous.
- Return context plan, model, max output, reasoning level, and telemetry labels.
- Add tests for greetings, simple QA, screen Q&A, connector lookup, connector
  action, coding, desktop automation, and research.

### Phase 4: Prompt And Context Optimization

- Replace monolithic prompt builders with modular prompt assembly.
- Make voice rules conditional on TTS.
- Make answer-format rules conditional on output type.
- Make screen rules conditional on selected screenshots.
- Load memory/RAG/profile according to context plan.
- Restrict connector info to connected or explicitly referenced providers.
- Add token-budget tests for prompt builders.

### Phase 5: Model And Output Budgets

- Ensure every `generateText`, `streamText`, `generateObject`, rerank,
  compressor, and memory extraction call sets `maxTokens`.
- Route simple Telegram text and simple image analysis to `gpt-5.4-mini`.
- Keep full `gpt-5.5` for complex agents and high-risk tasks.
- Add telemetry comparison dashboards before and after rollout.

### Phase 6: Dashboard API

- Add `usage-summary` response shape.
- Keep `/api/billing/subscription` backward compatible until the landing app is
  migrated.
- Map internal kinds to friendly activity labels server-side.
- Exclude pricing formulas from all dashboard responses.

### Phase 7: Landing Dashboard Redesign

- Replace the account usage section in
  `apps/landing/src/app/dashboard/page.tsx`.
- Remove static cost legends from account and Telegram cards.
- Add premium top credit card, trend chart, and activity feed.
- Move detailed status to developer/diagnostics page.
- Update marketing, FAQ, docs, and plan-card copy to describe included credits
  without per-action pricing.

### Phase 8: Migration And Cleanup

- Backfill monthly usage summaries from existing `usage_events` and
  `credit_transactions`.
- Keep old transaction history visible as friendly labels.
- Remove frontend imports of credit pricing constants.
- Remove public reliance on `creditConsumption` by feature.
- Add monitoring for average cost per request, cost per user, and gross margin.

## File-Level Change Map

### Backend

- `packages/db/src/schema.ts`: add telemetry table and optional usage event
  fields.
- `packages/db/drizzle/*`: add migration.
- `apps/backend/src/services/metering.ts`: support reserve/finalize settlement.
- `apps/backend/src/services/credit-pricing.ts`: replace static public pricing
  with internal dynamic policy or compatibility shim.
- `apps/backend/src/services/credit-ledger.ts`: add reservation/refund helpers
  if needed.
- `apps/backend/src/routes/usage.ts`: accept telemetry finalization and keep old
  reserve endpoint compatible.
- `apps/backend/src/routes/billing.ts`: add sanitized summary shape and remove
  feature pricing from response consumed by new dashboard.
- `apps/backend/src/agent/run.ts`: use request router, conditional memory/RAG,
  telemetry, dynamic settlement.
- `apps/backend/src/gateway/gateway-runner.ts`: route voice/image/text through
  telemetry and dynamic settlement.
- `apps/backend/src/routes/memory.ts`: telemetry for embeddings and memory
  search.
- `apps/backend/src/routes/rag.ts`: telemetry for indexing/search embeddings and
  optional rerank.
- `apps/backend/src/routes/llm.ts`: require auth/policy or limit to internal
  clients before telemetry is considered complete.

### Sidecar

- `apps/sidecar/src/index.ts`: request plan before pipeline, pass telemetry IDs.
- `apps/sidecar/src/pipeline/fast.ts`: modular prompt, conditional context,
  adaptive model/output budget, usage finalization.
- `apps/sidecar/src/pipeline/agent.ts`: explicit max output, conditional tools,
  telemetry, dynamic settlement.
- `apps/sidecar/src/router/llm.ts`: keep low budget and add telemetry.
- `apps/sidecar/src/memory/subsystem.ts`: accept context plan and budgets.
- `apps/sidecar/src/usage/reserve.ts`: replace `reserveInteraction(kind)` with
  request authorization and settlement, keeping old API during migration.
- `apps/sidecar/src/insights/*`: eventually read canonical telemetry or mark as
  local developer-only.

### Agent Core

- `packages/agent-core/src/model.ts`: expose usage and latency hooks, including
  streaming final usage.
- `packages/agent-core/src/agent.ts`: require `maxTokens` or apply safe default;
  return telemetry metadata alongside text or accept callback.
- `packages/agent-core/src/tools.ts`: count connector/tool calls and provider
  IDs.

### Landing

- `apps/landing/src/app/dashboard/page.tsx`: consume sanitized summary and
  remove credit pricing rules.
- `apps/landing/src/components/dashboard/StatusManager.tsx`: move to developer
  diagnostics or keep as advanced status.
- `apps/landing/src/components/landing/landing-page.tsx`: remove per-action
  credit pricing footnote.
- `apps/landing/src/app/page.tsx`: remove FAQ per-action pricing.
- `apps/landing/src/app/docs/page.tsx`: describe credits as included monthly
  usage, not per-feature rates.

## Acceptance Criteria

- No user-facing frontend copy contains static per-feature credit prices.
- No dashboard API response exposes pricing formulas or model pricing.
- Every AI model call has explicit max output budget.
- Every billable request persists telemetry with user, endpoint, model, tokens,
  latency, tool count, connector count, vision count, voice duration, estimated
  cost, and credits charged.
- Static reserve endpoints remain backward compatible during rollout.
- Credits are finalized from backend dynamic pricing policy.
- Owner bypass still records telemetry but charges zero credits.
- Existing users keep balances, grants, credit packs, and subscriptions.
- Explore out-of-credits and paid-plan out-of-credits behavior remains clear.
- Dashboard renders plan, remaining credits, included credits, reset date,
  monthly trend, and recent activity without technical IDs.
- Tests cover pricing policy, telemetry persistence, dashboard API contract,
  request routing, prompt module inclusion, and legacy compatibility.

## Estimated Savings

Expected savings after routing and context optimization:

- Fast desktop chat: 20-45 percent less prompt token cost by skipping
  memory/RAG, connector catalog, screen rules, and voice rules when not needed.
- Telegram text: 25-50 percent less average cost by skipping memory/RAG/profile
  on trivial/simple requests and routing simple tasks to mini.
- Vision: 30-60 percent less cost for simple image analysis by using mini and
  tighter output budgets.
- Agent tasks: 15-35 percent less cost through explicit output caps, fewer
  injected tools/connectors, and earlier history summaries.
- Memory extraction: 50 percent or more less auxiliary cost by skipping
  low-value turns and capping output.

These are estimates. Actual savings must be measured from `ai_usage_events`
after rollout.

## Risks

- Dynamic pricing can surprise users if credits deplete faster than before. The
  UI must frame credits as usage capacity, not fixed action pricing.
- Over-aggressive routing to mini could reduce quality for ambiguous tasks. Use
  conservative escalation to full model for automation, coding, and multi-step
  reasoning.
- Post-request settlement can create negative UX if a request completes but
  depletes credits. Use pre-flight minimum authorization and clear depletion
  copy.
- Telemetry must avoid prompt/content storage to preserve privacy commitments.
- Sidecar offline/local-dev mode must degrade gracefully when backend telemetry
  is unavailable.
- Schema migration touches billing-critical tables; prefer additive tables and
  backward-compatible service changes.

## Rollout Plan

1. Ship additive telemetry schema and backend telemetry service.
2. Instrument provider/model calls without changing credit charges.
3. Deploy dashboard developer diagnostics internally.
4. Add request router in observe-only mode and compare planned vs actual
   choices.
5. Enable modular prompt/context selection for fast path.
6. Enable model/output routing for low-risk simple requests.
7. Enable dynamic credit settlement behind an env flag.
8. Migrate dashboard to sanitized credit summary.
9. Remove public pricing copy from marketing/docs/dashboard.
10. Enable dynamic pricing globally after one billing cycle of telemetry.

## Future Scalability Considerations

- Add per-user and per-plan gross margin dashboards.
- Add model provider abstraction for multiple vendors with normalized telemetry.
- Add cache accounting for repeated prompts and reusable connector summaries.
- Add RAG embedding batching and dedupe by content hash.
- Add sampled prompt-token audits in development only, never public analytics.
- Add anomaly detection for runaway agents, connector loops, and expensive
  tools.
- Add per-request cost ceilings based on plan and balance.
- Add queueing/backpressure for long-running Telegram and scheduled tasks.
