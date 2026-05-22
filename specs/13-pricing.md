# Spec 13 — Pricing

## Purpose

Define Yomi's pricing tiers, feature gates, and billing integration. All billing is handled via Razorpay with USD pricing.

## Invariants

- All plans are billed monthly in USD.
- Razorpay is the sole payment processor — Stripe is not used.
- Free tier exists with limited daily usage.
- Plans: Free, Basic ($4/mo), Standard ($9/mo), Genesis ($19/mo).
- Payment methods: UPI, credit/debit cards, international cards (Razorpay supports all).

## Detailed Design

### Plan table

Plan | Price/mo | LLM calls/day | STT minutes/day | TTS | Screenshot analysis | Agent pipeline | Priority support
---|---|---|---|---|---|---|---
Free | $0 | 10 | 2 | Yes | No | No | No
Basic | $4 | 500 | 30 | Yes | Yes | No | Email
Standard | $9 | 2000 | 120 | Yes | Yes | Yes | Email
Genesis | $19 | 10000 | 600 | Yes | Yes | Yes | Priority

### Feature gates

The backend enforces plan caps at the API layer. Plans are stored in the `users.plan` column as enum values: `free | basic | standard | genesis`.

### Billing flow

1. User clicks "Subscribe" on the pricing page.
2. Frontend calls `POST /api/v1/billing/create-subscription` with their chosen plan.
3. Backend creates a Razorpay subscription via `razorpay.subscriptions.create()`.
4. Razorpay returns a `short_url` — user is redirected to Razorpay Checkout.
5. After payment, Razorpay sends a `subscription.activated` webhook.
6. Backend verifies webhook signature and upgrades the user's plan.
7. User's plan is now active → daily limits apply per plan caps.

### Cancel flow

- User cancels via Razorpay Customer Portal or by emailing support.
- Razorpay sends `subscription.cancelled` webhook.
- Backend downgrades user to `free` plan.

## Files to change

- `apps/backend/src/index.ts` — register billing routes.
- `apps/backend/src/middleware/rate-limit.ts` — use `plan` column for cap enforcement.
- `apps/landing/src/app/pricing/page.tsx` — pricing page with plan cards and Razorpay Checkout button.

## Files to create

- `apps/backend/src/routes/billing.ts` — Razorpay subscription creation + webhook handler.

## Open Questions

- Should we support annual billing with a discount? → Phase 1.
- Should we offer a self-serve cancel button? → Phase 0 uses email-based cancel; Phase 1 adds self-serve via Razorpay Customer Portal.
