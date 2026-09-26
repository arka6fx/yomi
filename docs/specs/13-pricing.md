# Spec 13 - Pricing

Two plans. Chat is unlimited on both, and there are no credits.

| Plan | Key       | Price    | Routines | Engine                                      |
| ---- | --------- | -------- | -------- | ------------------------------------------- |
| Free | `explore` | $0       | 3 active | fast (reasoning effort low)                 |
| Pro  | `pro`     | $5/month | no cap   | smarter (same model, reasoning effort high) |

Everything else is identical on both plans: Telegram text, voice and photos,
every connector, memory, browsing, research, characters, vault, and approvals.
Pro also gets priority support.

## Enforcement

- **Routines:** `SCHEDULE_LIMITS` in
  `apps/api/src/yomi/services/schedule_parser.py`, checked by
  `schedules_d1.ensure_schedule_capacity()` when a routine is created or
  enabled.
- **Engine:** `services/agent/loop.py` picks the `agent` purpose for Pro and
  `fast` for Free.
- **Usage log:** every billable action still calls
  `services/billing_d1.charge_usage()`. It writes a `usage_events` row for cost
  visibility and always succeeds; it never debits or blocks.

## Retired

- **Credits and credit packs.** `CREDIT_PACKS` is empty and
  `POST /api/billing/create-credit-pack` returns `410 credit_packs_retired`. The
  credit ledger tables remain but are dormant.
- **Max ($40).** `effective_plan_for_user()` maps anyone still on `max` to
  `pro`.

## Source of truth

- Backend: `apps/api/src/yomi/shared/plans.py`
- Web: `apps/web/src/lib/plans.ts` (`PLANS`, `FREE_ROUTINES`), rendered by
  `/pricing`

Billing provider: Dodo Payments, USD. Pro is 500¢ a month.
