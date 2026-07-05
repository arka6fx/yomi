# Credit System, AI Cost Optimization, and Dashboard Redesign — Roadmap

> **For agentic workers:** This is a ROADMAP, not a bite-sized execution plan.
> Each phase below must be expanded into its own detailed plan file (via
> superpowers:writing-plans, one file per phase) before execution. Use
> superpowers:subagent-driven-development or superpowers:executing-plans only
> once a phase has its own bite-sized plan.

**Source spec:** `specs/22-credit-ai-cost-dashboard-redesign.md`

**Goal:** Trace and instrument every billable AI request end-to-end, replace
static per-feature credit pricing with an internal dynamic policy driven by
actual token/tool/connector/voice/vision usage, and redesign the dashboard so
the frontend only ever sees a sanitized credit summary — never pricing
formulas or per-feature costs.

**Architecture:** Additive telemetry table (`ai_usage_events`) feeds a
versioned internal pricing service; a shared request-router classifies intent/
complexity and picks model + context + output budget before each call;
prompt/context assembly becomes modular so unneeded context (memory, RAG,
connector catalog, screen, voice rules) is skipped by default; `chargeUsage()`
grows a reserve/finalize settlement mode while old static-cost callers keep
working during migration; the landing dashboard is redesigned against a new
sanitized `usage-summary` contract, with implementation diagnostics moved to a
separate developer page.

**Tech Stack:** Hono/Bun backend (Cloudflare Workers), Drizzle + Neon,
Bun sidecar, AI SDK (`generateText`/`streamText`/`generateObject`), Next.js
landing dashboard.

## Global Constraints

- Do not expose internal credit pricing rules in frontend copy or public API
  contracts, at any point after this spec is implemented (spec header).
- Do not change Dodo product IDs or public plan prices in this pass.
- Do not remove existing credit balances, grants, or transaction history.
- Do not reduce quality-critical agent, coding, desktop-automation, or
  multi-step reasoning tasks to a smaller model by default.
- Do not store raw prompt content in telemetry beyond existing message/session
  tables — store counts, hashes, categories, and redacted metadata only.
- Static reserve endpoints (`/api/usage/interactions/reserve`) must remain
  backward compatible throughout rollout; old callers keep working.
- Every production model call (`generateText`, `streamText`, `generateObject`,
  rerank, compressor, memory extraction) must eventually set an explicit
  `maxTokens` — no silent unbounded calls.
- Cost estimates are stored in micros, never floats (`total_api_cost_micros`).
- `credit_policy_version` must be recorded on every dynamically-priced charge
  for reproducibility.

## Phase Sequencing

```
Phase 1 (Telemetry Foundation)
  -> Phase 2 (Dynamic Pricing)         -> Phase 6 (Dashboard API) -> Phase 7 (Landing Redesign)
  -> Phase 3 (Request Router)
       -> Phase 4 (Prompt/Context Optimization)
       -> Phase 5 (Model/Output Budgets)
  -> Phase 8 (Migration & Cleanup)  [after all of the above]
```

Phases 1 and 3 have no dependency on each other and can be built in parallel.
Phase 2 only needs Phase 1's telemetry shape (not live data) to define its
input type. Phase 6 needs both 1 (telemetry) and 2 (settled credits) for
accurate numbers, but can ship against partially-populated data first if
sequencing pressure requires it — flag this explicitly if that trade-off is
taken.

---

## Phase 1: Telemetry Foundation

**Objective:** Every billable AI call persists actual token/latency/tool/
connector/vision/voice usage into a canonical, additive table — without
changing any credit charges yet.

**Files:**
- Create: `packages/db/src/schema.ts` — add `ai_usage_events` table (see spec
  §"Schema Additions" for full column list: `usage_event_id`, `request_id`,
  `endpoint`, `surface`, `route`, `intent`, `complexity`, `model`, `provider`,
  `input_tokens`, `output_tokens`, `reasoning_tokens`, `cached_input_tokens`,
  `embedding_tokens`, `max_output_tokens`, `tool_calls`, `connector_count`,
  `connector_ids`, `vision_images`, `voice_duration_seconds`, `tts_chars`,
  `stt_audio_seconds`, `latency_ms`, `first_token_latency_ms`,
  `total_api_cost_micros`, `credit_policy_version`, `credits_estimated`,
  `credits_charged`, `status`, `error_code`, `metadata`, timestamps).
- Create: `packages/db/drizzle/*` — new migration for the table above, plus
  indexes on `(user_id, created_at)`, `usage_event_id`, `endpoint`, `model`,
  `status`, unique `request_id`.
- Create: `apps/backend/src/services/ai-telemetry.ts` — `startEvent()`,
  `finalizeEvent()`, `errorEvent()` helpers; idempotent on `request_id`.
- Modify: `packages/agent-core/src/model.ts` — expose usage/latency hooks from
  `doGenerate()`/`doStream()`, including final usage after streaming ends.
- Modify: `packages/agent-core/src/agent.ts` — return telemetry metadata
  alongside text, or accept a telemetry callback, so `runAgentLoop()` callers
  can report tool-call counts and connector IDs.
- Modify: `apps/backend/src/routes/memory.ts`, `apps/backend/src/routes/rag.ts`
  — call telemetry helpers around embedding calls.
- Modify: `apps/sidecar/src/pipeline/fast.ts`, `apps/sidecar/src/pipeline/
  agent.ts`, `apps/backend/src/agent/run.ts`,
  `apps/backend/src/gateway/gateway-runner.ts` — call `startEvent`/
  `finalizeEvent` around their model calls (wiring only, no pricing changes).

**Key interfaces produced:**
- `ai-telemetry.ts`: `startEvent(input: TelemetryStartInput): Promise<{ id: string }>`,
  `finalizeEvent(id: string, usage: TelemetryUsage): Promise<void>`,
  `errorEvent(id: string, code: string): Promise<void>`.
- `model.ts` provider now surfaces `{ promptTokens, completionTokens,
  reasoningTokens?, cachedInputTokens? }` consistently for both streaming and
  non-streaming calls.

**Tests:**
- Idempotency: calling `finalizeEvent` twice for the same `request_id` does
  not double-write.
- No raw prompt/content ever lands in `metadata` (reject-list test on known
  content-shaped keys).
- Streaming call records `first_token_latency_ms` and final token usage.

**Dependencies:** None — this is the foundation every later phase reads from.

**Acceptance criteria:** At least one call site (recommend: sidecar fast
path) writes a complete `ai_usage_events` row per request with zero change to
credits charged or user-visible behavior.

**Risks:** Schema migration touches a billing-adjacent area — keep this table
fully additive (no changes to `usage_events`) to avoid risk to the billing
chokepoint (`packages/agent-core` chargeUsage `metering.ts`).

---

## Phase 2: Dynamic Pricing Service

**Objective:** Define a versioned, backend-only policy that converts actual
usage into an integer credit charge, with a reserve/finalize settlement model,
while every existing static-cost caller keeps working unchanged.

**Files:**
- Create: `apps/backend/src/services/dynamic-credit-pricing.ts` — exports
  `type InternalCreditInput` (per spec: `model?`, `inputTokens`,
  `outputTokens`, `reasoningTokens?`, `cachedInputTokens?`,
  `embeddingTokens?`, `visionImages?`, `voiceDurationSeconds?`, `ttsChars?`,
  `toolCalls?`, `connectorCount?`, `surface`, `intent?`) and
  `priceUsage(input: InternalCreditInput): { credits: number; policyVersion: string }`.
- Modify: `apps/backend/src/services/credit-pricing.ts` — keep
  `creditsForUsage()` as the compatibility fallback used until callers migrate.
- Modify: `apps/backend/src/services/credit-ledger.ts` — add
  reservation/refund helpers (`reserveMinimum()`, `settle()`,
  `refundOverReserved()`).
- Modify: `apps/backend/src/services/metering.ts` — `chargeUsage()` gains a
  `mode: "reserve" | "finalize"` parameter; existing single-call-site behavior
  (implicit `"reserve"` + immediate consume) is preserved as the default when
  `mode` is omitted.

**Key interfaces produced:**
- `dynamic-credit-pricing.ts`: `InternalCreditInput`, `priceUsage()`,
  exported `CREDIT_POLICY_VERSION` constant.
- `credit-ledger.ts`: `reserveMinimum(userId, credits): Promise<ReservationId>`,
  `settle(reservationId, finalCredits): Promise<void>`.

**Tests:**
- Owner bypass still records telemetry but charges zero credits.
- Out-of-credits: reserve fails cleanly, no partial consumption.
- Race safety: two concurrent finalizes on the same reservation settle exactly
  once.
- Partial failure: a failed model call still finalizes at a minimum/zero
  charge and marks `ai_usage_events.status = "error"`.
- Idempotent settlement: re-running `settle()` with the same reservation ID is
  a no-op.

**Dependencies:** Phase 1 (needs `InternalCreditInput` shape to align with
`ai_usage_events` columns, though it can be developed against a stub before
Phase 1 lands live data).

**Acceptance criteria:** `priceUsage()` is unit-testable in isolation and not
yet wired into any live request path (kept behind a flag/unused import until
Phase 5).

**Risks:** This is the highest-blast-radius phase — it touches the billing
chokepoint. Land it fully backward compatible and unused-in-production first;
flip it on only in Phase 5/Rollout step 7.

---

## Phase 3: Request Router

**Objective:** A shared classifier returns a `RequestPlan` (route, intent,
complexity, context policy, model, output budget, reasoning level) without
computing any price, usable by both sidecar and backend.

**Files:**
- Create: `apps/backend/src/services/request-router.ts` — shared
  classification, complexity estimation, context policy, model selection,
  output budget logic (used by Telegram/backend agent path).
- Create: `apps/sidecar/src/router/request-plan.ts` — local mirror of the
  non-pricing routing policy, returns the same serializable `RequestPlan`
  shape for desktop/fast/agent paths.
- Modify: `apps/sidecar/src/router/llm.ts` — keep existing `gpt-5.5-mini`,
  `generateObject`, 80-token, 250ms-timeout classifier as the low-confidence
  fallback invoked only when heuristics in `request-plan.ts` are ambiguous.

**Key interfaces produced:**
```ts
type RequestPlan = {
  route: "fast" | "agent"
  intent: "greeting" | "simple_qa" | "writing" | "coding" | "connector_lookup"
    | "connector_action" | "memory_query" | "screen_qa" | "vision_analysis"
    | "voice" | "research" | "desktop_automation"
  complexity: "trivial" | "simple" | "normal" | "complex" | "critical"
  context: { memory: "none" | "profile" | "relevant" | "full"
    rag: "none" | "keyword" | "hybrid"
    connectors: string[]
    screen: boolean
    historyTurns: number }
  model: "gpt-5.5-mini" | "gpt-5.5"
  maxOutputTokens: number
  reasoning: "none" | "low" | "medium" | "high"
  telemetryEndpoint: string
}
```
(Exact shape from spec §"Intelligent Request Router" — copy verbatim.)

**Tests:** One fixture per intent in the spec's routing-rules table
(greeting, simple question, connector lookup, connector action, coding,
desktop automation, research, vision) asserting the expected `RequestPlan`
fields per the "Routing Rules" section.

**Dependencies:** Independent of Phases 1/2; only needs the
`telemetryEndpoint` naming convention agreed in Phase 1.

**Acceptance criteria:** `classifyRequest()` runs in "observe-only" mode
(logged via telemetry, per Rollout step 4) alongside existing routing without
changing which model/context is actually used yet.

**Risks:** Over-fitting heuristics to a few fixtures; keep the LLM fallback
path so ambiguous cases don't silently misroute.

---

## Phase 4: Prompt and Context Optimization

**Objective:** Replace monolithic prompt strings with modular assembly so
memory/RAG/connector-catalog/screen/voice sections are included only when the
`RequestPlan.context` says they're needed.

**Files:**
- Modify: `apps/sidecar/src/harness/prompt.ts` (`buildFastPrompt()`) —
  modularize into identity / personality / date / answer-format / voice /
  screen / connector-rules / memory-citation sections, each conditionally
  included.
- Modify: sidecar agent prompt builder (`buildAgentPrompt()`, referenced from
  `apps/sidecar/src/pipeline/agent.ts`) — same modularization, always keep
  desktop-automation and safety/approval rules when tools with side effects
  are available.
- Modify: `apps/backend/src/agent/run.ts` (`buildSystemWithContext()`) —
  same modularization for the Telegram path.
- Modify: `apps/sidecar/src/memory/subsystem.ts` (`loadMemoryContext()`) —
  accept a context plan/budget parameter instead of fixed 3500/3000/2500 char
  budgets; honor `context.memory`/`context.rag` from `RequestPlan`.

**Context budgets to implement (verbatim from spec):**
- Greeting: zero retrieved context.
- Simple QA: zero unless explicit memory language.
- Memory query: profile + top relevant memory, max 1200 chars.
- RAG query: top hybrid/MMR snippets, max 2000 chars.
- Connector query: connector result summaries only, max 3000 chars.
- Agent history: last 4 turns, summarize older turns.
- Telegram shared history: last 6 turns + one compact session summary.
- Screen: only selected screenshots; omit for self-contained knowledge, math,
  greeting, writing tasks.

**Tests:** Token-budget tests per prompt builder — assert that a "greeting"
`RequestPlan` produces a prompt under a fixed char/token ceiling, and that a
"desktop_automation" plan still includes safety/approval rules.

**Dependencies:** Phase 3 (`RequestPlan.context` drives every conditional).

**Acceptance criteria:** Measurable prompt-size reduction on greeting/simple-QA
fixtures with no regression in existing tool-availability/connector tests.

**Risks:** Removing context that's actually needed degrades answer quality —
keep escalation conservative per the spec's "Risks" section (favor including
context when confidence is low).

---

## Phase 5: Model and Output Budgets

**Objective:** No production model call omits `maxTokens`; simple Telegram
text and simple image analysis route to `gpt-5.5-mini`; dynamic pricing
(Phase 2) goes live behind a flag for low-risk paths.

**Files:**
- Modify: `apps/sidecar/src/pipeline/agent.ts` — add explicit
  `maxOutputTokens` from `RequestPlan`, make tool set conditional.
- Modify: `apps/sidecar/src/agent/compressor.ts` — explicit budget (400 per
  spec's Adaptive Output Budgets table).
- Modify: `apps/sidecar/src/tools/cron/cron-executor.ts` — explicit max output
  + telemetry wiring (reuse Phase 1 helpers).
- Modify: `apps/backend/src/gateway/gateway-runner.ts` (`analyzeImage()`) —
  route simple image Q&A to `gpt-5.5-mini`, keep `gpt-5.5` for detailed
  UI/chart/OCR/code-screenshot cases per spec's vision routing rule.
- Modify: `apps/backend/src/agent/run.ts` — memory extraction call gets an
  explicit cap (250 tokens per spec table) and skips low-value turns.
- Modify: `apps/backend/src/services/metering.ts` — flip `chargeUsage()` to
  `mode: "finalize"` using `dynamic-credit-pricing.ts` for the specific
  low-risk paths chosen for initial rollout (per Rollout step 6/7), guarded by
  an env flag.

**Output budget table to enforce (verbatim from spec):** greeting/ack 120,
simple QA 300, normal assistant 500, summary/explanation 600, connector
lookup 700, email/message draft 800, image analysis 500, coding/debugging
1400, desktop automation 1200, research/planning 1800, memory extraction 250,
context compression 400, intent classification 80.

**Tests:** A lint-style test/check that greps for `generateText(`/
`streamText(`/`generateObject(` call sites and asserts each supplies
`maxTokens` or an equivalent explicit option, excluding stream_options usage
tokens.

**Dependencies:** Phase 3 (model/budget comes from `RequestPlan`), Phase 1
(telemetry to measure before/after), Phase 2 (dynamic settlement math).

**Acceptance criteria:** No production model call missing an explicit output
budget; telemetry (Phase 1) shows reduced average tokens on greeting/simple-QA/
simple-image intents after rollout.

**Risks:** Over-aggressive mini-routing on ambiguous tasks reduces quality —
keep conservative escalation to `gpt-5.5` for automation/coding/multi-step
reasoning per spec Non-Goals.

---

## Phase 6: Dashboard API

**Objective:** Ship a sanitized `/api/billing/usage-summary` contract with no
pricing formulas, while `/api/billing/subscription` stays backward compatible.

**Files:**
- Create: `packages/shared/src/usage-contracts.ts` — public response shapes
  (no pricing formulas), matching the spec's JSON example under "Public
  Dashboard API Contract" (`plan`, `credits`, `monthlyUsage`, `recentActivity`,
  `actions`).
- Modify: `apps/backend/src/routes/billing.ts` — add the new summary route (or
  v2 shape) that maps internal usage `kind` values to friendly activity labels
  (`Desktop Chat`, `Voice Session`, `Notion Search`, `GitHub Task`, `Image
  Analysis`, `Telegram Chat`, `Scheduled Task`, `Memory Update`) server-side.

**Tests:** Contract test asserting the response matches the documented shape
and contains none of: static feature credit costs, model prices, token-to-
credit formulas, raw `usage_events` IDs, prompt/memory/connector payload
content.

**Dependencies:** Phase 1 (telemetry) and Phase 2 (settled dynamic credits)
for accurate `used`/`remaining` numbers — can ship earlier against
`usage_events` alone if sequencing requires, but flag the numbers as
provisional until Phase 2 is live.

**Acceptance criteria:** New endpoint returns the documented JSON shape;
`/api/billing/subscription` unchanged for existing consumers.

**Risks:** None significant — additive endpoint.

---

## Phase 7: Landing Dashboard Redesign

**Objective:** User-facing dashboard shows only plan/credits/trend/friendly
activity; all implementation diagnostics move to a developer page; all
per-action pricing copy is removed from marketing/docs.

**Files:**
- Modify: `apps/landing/src/app/dashboard/page.tsx` — replace usage section
  with premium top credit card (`1842 / 2500`, reset countdown, upgrade/buy
  action), monthly/daily trend chart, friendly recent-activity feed; remove
  static cost legend cards.
- Modify: `apps/landing/src/components/dashboard/StatusManager.tsx` — becomes
  the basis for a new `/dashboard/developer` route (or advanced-toggle tab)
  showing model distribution, token totals, estimated API cost, latency, tool
  calls, connector count, error rates — sourced from canonical telemetry.
- Modify: `apps/landing/src/components/landing/landing-page.tsx` — remove
  per-action credit pricing footnote.
- Modify: `apps/landing/src/app/page.tsx` — remove FAQ per-action pricing
  lines.
- Modify: `apps/landing/src/app/docs/page.tsx` — describe credits as included
  monthly usage, not per-feature rates.

**Copy to remove (verbatim list from spec):** `AI chat = 1 credit`,
`Telegram text = 1 base credit`, `Image/screen = +1 credit`,
`Voice input/output = +2 credits/min`, request-ID snippets in user-facing
recent activity, marketing FAQ lines describing credits per action.

**Dependencies:** Phase 6 (`usage-summary` contract must exist first).

**Acceptance criteria:** Grep-based check confirms no frontend file contains
the removed copy strings; dashboard renders plan, remaining credits, included
credits, reset date, monthly trend, and recent activity with no technical IDs
visible.

**Risks:** None significant beyond standard UI regression risk — verify
visually per this repo's UI-change convention (start dev server, click
through dashboard) before calling this phase done.

---

## Phase 8: Migration and Cleanup

**Objective:** Backfill historical data into the new model, remove dead
imports, and stand up ongoing cost-margin monitoring.

**Files:**
- Create: one-off backfill script (location TBD when this phase is planned in
  detail — likely `apps/backend/scripts/` or a Drizzle data migration) —
  populates monthly usage summaries from existing `usage_events` and
  `credit_transactions`.
- Modify: remove any remaining frontend imports of credit-pricing constants.
- Modify: remove public/frontend reliance on `creditConsumption`-by-feature
  anywhere it still exists after Phase 7.
- Add: monitoring/alerting for average cost per request, cost per user, and
  gross margin (exact tool TBD — likely reuses whatever the repo already uses
  for backend metrics; confirm during phase-detail planning).

**Dependencies:** All prior phases.

**Acceptance criteria:** Full spec "Acceptance Criteria" section (spec lines
760-776) passes as the final gate for this entire roadmap:
- No user-facing copy contains static per-feature credit prices.
- No dashboard API response exposes pricing formulas or model pricing.
- Every AI model call has an explicit max output budget.
- Every billable request persists full telemetry.
- Static reserve endpoints remained backward compatible during rollout.
- Credits are finalized from the dynamic pricing policy.
- Owner bypass still records telemetry but charges zero credits.
- Existing users keep balances, grants, credit packs, and subscriptions.
- Explore/paid out-of-credits behavior remains clear.
- Dashboard renders without technical IDs.
- Tests cover pricing policy, telemetry persistence, dashboard API contract,
  request routing, prompt module inclusion, and legacy compatibility.

---

## Spec Rollout Steps Mapped to Phases

| Spec rollout step | Phase |
| --- | --- |
| 1. Ship additive telemetry schema + service | Phase 1 |
| 2. Instrument provider/model calls, no charge changes | Phase 1 |
| 3. Deploy dashboard developer diagnostics internally | Phase 7 (developer page) |
| 4. Request router in observe-only mode | Phase 3 |
| 5. Modular prompt/context for fast path | Phase 4 |
| 6. Model/output routing for low-risk simple requests | Phase 5 |
| 7. Dynamic credit settlement behind env flag | Phase 2 + Phase 5 |
| 8. Migrate dashboard to sanitized summary | Phase 6 + Phase 7 |
| 9. Remove public pricing copy | Phase 7 |
| 10. Enable dynamic pricing globally after one billing cycle | Phase 8 |

## Open Decisions Before Phase-Detail Planning

- Where should the Phase 8 backfill script live, and does the team already
  have a metrics/alerting tool this should plug into (e.g. existing Cloudflare
  Workers observability, or a third-party APM)? Needs an answer before Phase
  8 can be planned in bite-sized detail.
- Confirm whether `apps/backend/src/routes/llm.ts` (raw LLM proxy) is even
  reachable in production today — spec flags it as needing auth/policy before
  telemetry is "complete"; if it's dev-only, Phase 1/5 scope can drop it.
