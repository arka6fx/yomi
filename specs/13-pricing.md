# Spec 13 - Pricing

## Purpose

Define Yomi's plans, feature gates, fair-use limits, and Dodo billing
behavior.

## Invariants

- Plans are **Explore**, **Pro**, and **Max**.
- Internal plan keys remain `explore`, `pro`, and `max`.
- Dodo Payments is the sole payment processor.
- Explore is a 30-day free trial with strict trial limits.
- Pro is the primary revenue plan and includes limited foreground automation.
- Max raises limits for power users and full foreground automation.
- Do not offer unlimited GPT-4.1, voice, image generation, or automation.
- AICredits is the LLM gateway. Cost guardrails should track actual AICredits
  wallet burn, not only token counts.

## Plan Matrix

| Plan    | Internal key | Price     | Annual suggestion | Core positioning                       |
| ----------- | ------------ | --------: | ----------------: | -------------------------------------- |
| Explore     | `explore`    |        $0 |                $0 | 30-day free trial with strict limits   |
| Pro         | `pro`        | $14.99/mo |           $144/yr | Daily assistant + limited automation   |
| Max         | `max`        | $39.99/mo |           $384/yr | Power-user automation + high limits    |

Suggested annual discount: about 20%.

India-local display pricing guidance:

| Plan    | Monthly | Annual     |
| ------- | ------: | ---------: |
| Explore |     ₹0 |         ₹0 |
| Pro     |   ₹999 |  ₹9,999/yr |
| Max     | ₹2,999 | ₹29,999/yr |

Current Dodo checkout amounts in the backend are USD cents:

| Plan | Amount |
| ---- | -----: |
| Pro  |   1499 |
| Max  |   3999 |

## Feature Gates

Limits are defined in `packages/shared/src/plans.ts` — the single source of truth.

| Feature                | Explore  | Pro             | Max              |
| ---------------------- | -------- | --------------- | ---------------- |
| AI chats / month       | 100      | 2,000           | 8,000            |
| Voice (minutes)        | 20       | 180             | 750              |
| Screenshots            | 25       | 400             | 2,000            |
| Advanced reasoning     | 5        | 100             | 500              |
| Desktop automation     | 10       | 75              | 750              |
| Browser automation     | 10       | 40              | 500              |
| Gateway messaging      | 50       | 2,000           | 8,000            |

Explore now includes limited reasoning and automation to allow feature
discovery. Upgrade prompts appear at 80% usage; hard enforcement at 100%.

### Quota Enforcement

All feature limits are enforced at the API level before execution:

| Checkpoint | File |
|-----------|------|
| Feature availability (limit === 0) | `middleware/subscription.ts` |
| Feature quota (used >= limit) | `routes/usage.ts POST /interactions/reserve` |
| Subscription billing access | `entitlements.ts hasBillablePlanAccess()` |

Enforcement returns HTTP 429 with `code: "quota_exceeded"` and upgrade
information. Subscription issues return HTTP 402.

## Automation Policy

- Automation is always foreground-only and visible through Mission Control.
- Explore users can see locked automation previews but cannot run automation.
- Pro can run bounded foreground tasks: browser form filling, tab actions,
  simple UIA app actions, short file organization, and guided workflows.
- Max can run full foreground automation: longer workflows, browser automation,
  native app automation, sub-agents, recovery, replay learning, and higher
  concurrency.
- Risky actions still require confirmation on Pro and Max.
- Password managers and banking apps/domains remain blocklisted for all plans.

## Cost Guardrails

Track per-user AICredits burn and degrade gracefully before users exceed plan
economics.

| Plan    | Expected AI cost/user | Hard cost cap/user | Target AI gross margin |
| ------- | --------------------: | -----------------: | ---------------------: |
| Explore |              ₹5-₹20/mo |              ₹25/mo | capped acquisition cost |
| Pro     |           ₹175-₹375/mo |             ₹450/mo |                 62-82% |
| Max     |         ₹800-₹1,700/mo |           ₹2,000/mo |                 33-73% |

When limits are reached:

- Advanced reasoning falls back to GPT-4.1 Mini.
- Voice falls back to text mode.
- Image generation falls back to image understanding where available.
- Automation falls back to normal assistant usage and upgrade messaging.
- Near hard cost caps, reduce priority, shorten context, and block expensive
  calls until the user upgrades or the period resets.

## Billing Flow

1. User starts checkout for Pro or Max.
2. Backend creates a Dodo Checkout Session.
3. User completes Dodo checkout.
4. Dodo sends a webhook.
5. Backend verifies the webhook signature.
6. Backend updates the user plan and subscription status.
7. Desktop sees the updated plan through auth/billing state refresh.

## Cancellation And Downgrade

Canceled or failed subscriptions downgrade access back to Explore after active
period rules are applied. Paid-only context, automation, and cloud mirror
features stop being included in new requests.

## Metering

- `usage_events` is append-only.
- Daily/monthly counters reset by the applicable billing window.
- Voice, images, reasoning, and automation limits are separate from regular
  chat.
- AICredits cost is stored or derivable per request so plan cost caps are
  enforceable.
- Local memory and cloud archive retrieval are context features, not separate
  billable events.

## Implemented Files

- `packages/shared/src/plans.ts` — single source of truth for all plan definitions
- `apps/backend/src/entitlements.ts` — derives limits from shared plans
- `apps/backend/src/routes/billing.ts` — uses shared plan configs for billing
- `apps/backend/src/routes/usage.ts` — full feature-level quota enforcement
- `apps/backend/src/middleware/subscription.ts` — feature availability gating
- `apps/landing/src/app/dashboard/page.tsx` — progress bars with used/limit/percentage
- `apps/landing/src/app/link/page.tsx` — upgrade prompts

## Future Work

- Track voice duration (seconds) instead of just count
- Annual Dodo subscriptions
- Self-serve cancellation portal
- Optional regional INR checkout amounts
