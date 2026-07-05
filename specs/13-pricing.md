# Spec 13 - Pricing

Billing is **pure credits**: a single credit balance is the only usage gate.
There are no per-feature monthly caps, and connectors are unlimited on every
plan.

## Plans

| Plan    | Price     | Monthly credits | Notes                                      |
| ------- | --------- | --------------- | ------------------------------------------ |
| Explore | $0/mo     | 100             | 30-day free trial; unlimited connectors    |
| Pro     | $14.99/mo | 2,500           | unlimited connectors; can buy credit packs |
| Max     | $39.99/mo | 10,000          | unlimited connectors; can buy credit packs |

## Credit costs

| Action               | Cost               |
| -------------------- | ------------------ |
| AI chat              | 1 credit           |
| Image/screen analyze | 1 credit           |
| Voice (STT/TTS)      | 2 credits / minute |
| Telegram bot message | 1 credit           |

## Credit packs (Pro/Max only)

| Pack           | Credits | Price  |
| -------------- | ------- | ------ |
| `credits_500`  | 500     | $4.99  |
| `credits_2000` | 2,000   | $14.99 |
| `credits_6000` | 6,000   | $39.99 |

## Enforcement

- Single chokepoint: `apps/backend/src/services/metering.ts` → `chargeUsage()` —
  owner bypass → `hasBillablePlanAccess` (trial active / sub active / past_due
  grace) → `balance >= cost` else block → record `usage_events` row +
  `consumeCredits`.
- Out of credits: Explore → `subscription_required` (must subscribe); Pro/Max →
  `credits_exhausted` (buy a credit pack). Owner email bypasses all checks.
- Credits expire monthly (subscription cycle) and on upgrade from Explore; packs
  are added on top. Ledger: `apps/backend/src/services/credit-ledger.ts`.
- Plan/cost source of truth: `packages/shared/src/plans.ts` (`PLANS`,
  `CREDIT_COSTS`, `CREDIT_PACKS`). Metering through backend `usage_events` +
  `credit_transactions`.

Billing provider: Dodo Payments. USD is canonical (Pro 1499¢, Max 3999¢).
Billing routes: `apps/backend/src/routes/billing.ts`; reserve:
`routes/usage.ts`.
