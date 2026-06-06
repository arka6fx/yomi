# Spec 13 - Pricing

## Purpose

Define Yomi's plans, feature gates, fair-use limits, and Razorpay billing
behavior.

## Invariants

- Plans are **Explore**, **Pro**, and **Max**.
- Internal plan keys remain `explore`, `pro`, and `max`.
- Razorpay is the sole payment processor.
- Explore is free with monthly limits, not a time-limited trial.
- Pro is the primary revenue plan and includes limited foreground automation.
- Max raises limits for power users and full foreground automation.
- Do not offer unlimited GPT-4.1, voice, image generation, or automation.
- AICredits is the LLM gateway. Cost guardrails should track actual AICredits
  wallet burn, not only token counts.

## Plan Matrix

| Plan    | Internal key | Price     | Annual suggestion | Core positioning                       |
| ----------- | ------------ | --------: | ----------------: | -------------------------------------- |
| Explore     | `explore`    |        $0 |                $0 | Free starter with strict limits        |
| Pro         | `pro`        | $14.99/mo |           $144/yr | Daily assistant + limited automation   |
| Max         | `max`        | $39.99/mo |           $384/yr | Power-user automation + high limits    |

Suggested annual discount: about 20%.

India-local Razorpay pricing guidance:

| Plan    | Monthly | Annual     |
| ------- | ------: | ---------: |
| Explore |     ₹0 |         ₹0 |
| Pro     |   ₹999 |  ₹9,999/yr |
| Max     | ₹2,999 | ₹29,999/yr |

Current Razorpay checkout amounts in the backend are USD cents:

| Plan | Amount |
| ---- | -----: |
| Pro  |   1499 |
| Max  |   3999 |

## Feature Gates

| Feature                    | Explore | Pro                 | Max                  |
| -------------------------- | ------- | ------------------- | -------------------- |
| Text chat                  | 100/mo  | 2,000/mo            | 8,000/mo             |
| Default assistant          | 4.1 mini | 4.1 mini            | 4.1 mini             |
| Advanced reasoning         | 5/mo    | 100/mo              | 500/mo               |
| Long-context mode          | no      | 15/mo               | 150/mo               |
| Screenshot understanding   | 25/mo   | 400/mo              | 2,000/mo             |
| Image understanding        | 10/mo   | 200/mo              | 1,000/mo             |
| Image generation           | no      | 30 low or 12 medium | 200 low or 80 medium |
| Voice STT                  | 20 min  | 180 min             | 750 min              |
| TTS output                 | 5k chars | 60k chars          | 250k chars           |
| Local memory               | 50      | 3,000               | 15,000               |
| Cloud memory mirror        | no      | 250 MB              | 2 GB                 |
| Desktop automation         | no      | 75 runs/mo          | 750 runs/mo          |
| Browser automation         | no      | 40 runs/mo          | 500 runs/mo          |
| Automation max duration    | n/a     | 7 min/run           | 45 min/run           |
| Automation concurrency     | n/a     | 1 active run        | 3 active runs        |
| Experimental/early access  | no      | limited             | first access         |
| Priority                   | best effort | priority         | highest              |

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
2. Backend creates a Razorpay subscription.
3. User completes Razorpay checkout.
4. Razorpay sends a webhook.
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

- `apps/backend/src/routes/billing.ts`
- `apps/backend/src/routes/usage.ts`
- `apps/backend/src/middleware/subscription.ts`
- `apps/landing/src/components/landing/landing-page.tsx`
- `apps/landing/src/app/dashboard/page.tsx`
- `packages/shared/src/index.ts`

## Future Work

- Annual Razorpay subscriptions.
- Self-serve cancellation portal.
- Full backend quota enforcement for all limits in this spec.
- Optional regional INR checkout amounts.
