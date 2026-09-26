# Spec 13 - Pricing

Billing is **pure credits**: a single credit balance is the only usage gate.
There are no per-feature monthly caps, and connectors are unlimited on every
plan.

## Plans

| Plan    | Price  | Monthly credits | Notes                                      |
| ------- | ------ | --------------- | ------------------------------------------ |
| Explore | $0/mo  | 100             | renews every 30 days; unlimited connectors |
| Pro     | $5/mo  | 300             | unlimited connectors; can buy credit packs |
| Max     | $40/mo | 750             | unlimited connectors; can buy credit packs |

## Credit costs

| Action               | Cost                                      |
| -------------------- | ----------------------------------------- |
| AI chat              | 1 credit                                  |
| Image analyze        | 1 credit                                  |
| Voice (STT input)    | 2 credits / minute                        |
| Telegram bot message | 3 credits                                 |
| Agent run            | 3 credits base + 1 per Composio tool call |

## Credit packs (Pro/Max only)

| Pack           | Credits | Price |
| -------------- | ------- | ----- |
| `credits_500`  | 85      | $5    |
| `credits_2000` | 250     | $15   |
| `credits_6000` | 750     | $40   |

## Enforcement

- Single chokepoint: `apps/api/src/services/metering.ts` → `chargeUsage()` —
  `hasBillablePlanAccess` (trial active / sub active / past_due grace) →
  `balance >= cost` else block → record `usage_events` row + `consumeCredits`.
  There is no owner bypass: every account, including the operator's, is metered
  against its plan like any other user.
- Out of credits: Explore → `subscription_required` (must subscribe); Pro/Max →
  `credits_exhausted` (buy a credit pack).
- Credits expire monthly (subscription cycle) and on upgrade from Explore; packs
  are added on top. Ledger: `apps/api/src/services/credit-ledger.ts`.
- Plan/cost source of truth: `packages/shared/src/plans.ts` (`PLANS`,
  `CREDIT_COSTS`, `CREDIT_PACKS`). Metering through backend `usage_events` +
  `credit_transactions`.

Billing provider: Dodo Payments. USD is canonical (Pro 500¢, Max 4000¢). Billing
routes: `apps/api/src/routes/billing.ts`; reserve: `routes/usage.ts`.
