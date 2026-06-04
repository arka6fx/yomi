# Spec 13 - Pricing

## Purpose

Define Yomi's plans, feature gates, fair-use limits, and Razorpay billing
behavior.

## Invariants

- Plans are `explore`, `pro`, and `max`.
- Razorpay is the sole payment processor.
- Explore is a limited trial, not a forever unlimited free tier.
- Pro includes screen-aware chat and local memory, but no agents.
- Max adds agents/subagents when launched.
- Local memory stays local for all plans.
- Cloud RAG mirrors non-personal Yomi memory artifacts for paid plans.

## Plan Matrix

| Plan    |     Price | Core limits                          | Context                             | Agents              |
| ------- | --------: | ------------------------------------ | ----------------------------------- | ------------------- |
| Explore |        $0 | 30-day trial, 150 total interactions | screen analysis only                | no                  |
| Pro     |  $9.99/mo | chat 10000/day, voice 200/day        | local memory + cloud archive mirror | no                  |
| Max     | $24.99/mo | chat/voice 10000/day                 | local memory + cloud archive mirror | yes, 10000 runs/day |

Razorpay plan amounts:

| Plan | Amount |
| ---- | -----: |
| Pro  |    999 |
| Max  |   2499 |

The amount values are the smallest configured billing units used by the
backend/Razorpay integration.

## Feature Gates

| Feature              | Explore | Pro     | Max       |
| -------------------- | ------- | ------- | --------- |
| Text chat            | limited | yes     | yes       |
| Voice                | limited | 200/day | 10000/day |
| Screen analysis      | yes     | yes     | yes       |
| Local memory engine  | no      | yes     | yes       |
| Cloud archive mirror | no      | yes     | yes       |
| File upload RAG      | no      | no      | no        |
| Agent mode           | no      | no      | yes       |

Current implementation detail: normal Max purchase/access can remain blocked
until launch while owner/dev accounts can test Max-gated paths.

## Billing Flow

1. User starts checkout for Pro or Max.
2. Backend creates a Razorpay subscription.
3. User completes Razorpay checkout.
4. Razorpay sends a webhook.
5. Backend verifies the webhook signature.
6. Backend updates the user plan and subscription status.
7. Desktop sees the updated plan through auth/billing state refresh.

## Cancellation And Downgrade

Canceled or failed subscriptions downgrade access back to Explore after the
active period rules are applied. Paid-only context features stop being included
in new sidecar requests.

## Metering

Usage is enforced by backend APIs and shared usage helpers. Important behavior:

- `usage_events` is append-only.
- Daily counters reset by UTC date.
- Voice and agent limits are separate from regular chat where applicable.
- Local memory and cloud archive retrieval are sidecar context features, not
  separate billable events.

## Implemented Files

- `apps/backend/src/routes/billing.ts`
- `apps/backend/src/routes/usage.ts`
- `apps/backend/src/usage.ts`
- `apps/landing/src/app/pricing/page.tsx`
- `packages/shared/src/index.ts`

## Future Work

- Annual billing.
- Self-serve cancellation portal.
- Public Max launch flag.
