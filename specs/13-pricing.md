# Spec 11 — Pricing & Billing

## Purpose

Define subscription plans, Stripe integration, usage metering logic, and cap enforcement. Billing lives entirely in the cloud backend.

## Invariants

- Free tier costs near zero (local STT by default, BYOK option).
- All token + minute usage is recorded in `usage_events` before it is billed or capped.
- Hard caps return HTTP 429 — never silently drop requests.
- Stripe webhook must verify `stripe-signature` before processing any event.
- The `subscriptions` table is provider-agnostic (Stripe today, extensible tomorrow).

## Detailed Design

### Plan Matrix

| Plan | Price | Fast queries/day | Agent runs/mo | STT | TTS | MCP | Cloud sync |
|---|---|---|---|---|---|---|---|
| **Free** | $0 | 50 | 1 | Local only | Local only | ✗ | ✗ |
| **Pro** | ~$20/mo | Unlimited (fair-use) | 100 | ElevenLabs cloud | ElevenLabs cloud | ✓ | ✓ |
| **Max** | ~$50/mo | Unlimited | 500 | ElevenLabs cloud | ElevenLabs cloud | ✓ | ✓ |
| **Team** | ~$30/user/mo | Unlimited | 500/user | Cloud | Cloud | ✓ | ✓ |

**BYOK (Bring Your Own Key):** any plan can set their own `ANTHROPIC_API_KEY` in settings. When BYOK is active, token costs are not charged against their plan cap but a thin platform fee applies ($5/mo discount on Pro, credited). The sidecar detects BYOK and calls the backend `/api/llm/stream` route which uses the user's key instead of the platform key.

**Annual discount:** 2 months free (~17% off). Implemented as a Stripe coupon applied at checkout.

### Stripe Setup

**Products and Prices:**
```
Product: Yomi Pro
  Price: price_pro_monthly   $20/mo recurring
  Price: price_pro_annual    $200/yr recurring (2 months free)

Product: Yomi Max
  Price: price_max_monthly   $50/mo recurring
  Price: price_max_annual    $500/yr recurring

Product: Yomi Team
  Price: price_team_monthly  $30/user/mo recurring (per-seat)
```

**Checkout flow:**
```typescript
// POST /api/billing/create-checkout
const session = await stripe.checkout.sessions.create({
  customer: user.stripeCustomerId,
  mode: "subscription",
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: `${FRONTEND_URL}/settings/billing?success=1`,
  cancel_url: `${FRONTEND_URL}/settings/billing`,
  allow_promotion_codes: true,
})
return { url: session.url }
```

**Customer Portal (manage / cancel):**
```typescript
const portal = await stripe.billingPortal.sessions.create({
  customer: user.stripeCustomerId,
  return_url: `${FRONTEND_URL}/settings/billing`,
})
return { url: portal.url }
```

### Usage Metering

Plan limits are defined in a config object (not a DB table — allows instant changes):

```typescript
export const PLAN_LIMITS = {
  free:  { fastQueriesPerDay: 50,  agentRunsPerMonth: 1,   hardCapTokensPerDay: 50_000 },
  pro:   { fastQueriesPerDay: null, agentRunsPerMonth: 100, hardCapTokensPerDay: 1_000_000 },
  max:   { fastQueriesPerDay: null, agentRunsPerMonth: 500, hardCapTokensPerDay: 5_000_000 },
  team:  { fastQueriesPerDay: null, agentRunsPerMonth: 500, hardCapTokensPerDay: 5_000_000 },
}
```

**Cap enforcement (middleware on `/api/llm/stream`):**
```typescript
async function enforceUsageCap(userId: string, plan: string) {
  const limits = PLAN_LIMITS[plan]
  const today = startOfDay(new Date())

  const dailyTokens = await db
    .select({ sum: sum(usageEvents.inputTokens + usageEvents.outputTokens) })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, today)))

  if (limits.hardCapTokensPerDay && dailyTokens > limits.hardCapTokensPerDay) {
    throw new HTTPException(429, { message: "Daily token limit reached. Upgrade to continue." })
  }

  if (dailyTokens > limits.hardCapTokensPerDay * 0.8) {
    // Soft cap: add warning header, don't block
    c.header("X-Yomi-Usage-Warning", "80% of daily limit reached")
  }
}
```

### Stripe Webhook Events

| Event | Handler |
|---|---|
| `checkout.session.completed` | Create/update `subscriptions` row; set `plan` on `user` |
| `customer.subscription.updated` | Sync plan, status, `currentPeriodEnd` |
| `customer.subscription.deleted` | Downgrade to free |
| `invoice.payment_failed` | Mark subscription `status = "past_due"`, send email |
| `invoice.paid` | Reset usage counters for new period |
| `customer.created` | Store `stripeCustomerId` on user |

### Cost Estimation

At launch, dominant costs are LLM tokens + ElevenLabs minutes.

**Break-even estimate (Pro at $20/mo):**
- Anthropic Haiku: ~$0.25 per 1M input + $1.25 per 1M output tokens
- 1M fast-path queries/mo × 200 input + 100 output tokens = $0.25 + $0.12 = $0.37
- ElevenLabs STT: $0.12/hr audio ≈ $0.002/query at 1min avg
- ElevenLabs TTS: $0.30/1k chars ≈ $0.03/query at 100 chars avg
- Pro user 100 queries/day × 30 days = 3000 queries/mo
- Estimated cost per Pro user: ~$3.50/mo → margin: ~$16.50 ✓

Free tier: local STT (cost = 0), local whisper.cpp TTS fallback (cost = 0) → free users cost < $0.01/mo.

## Files to change

- `apps/backend/src/index.ts` — register billing routes
- `apps/backend/src/middleware/auth.ts` — plan check in session middleware

## Files to create

- `apps/backend/src/routes/billing.ts` — Stripe checkout, portal, webhook
- `packages/db/src/schema.ts` — subscriptions, usage_events tables

## Open Questions

- Usage-based billing add-ons (pay-as-you-go for agent runs beyond plan limit): design in Phase 3.
- Team billing: per-seat counting via Stripe metered subscriptions or fixed-seat count. Decide at Phase 4.
