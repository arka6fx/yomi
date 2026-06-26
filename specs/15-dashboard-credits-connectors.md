# Dashboard Credits & Connector Plan

> Status: implemented (historical plan). Billing is now **pure credits** (credits are the
> only usage gate); the dashboard meter shows `creditsUsed / totalCredits` where
> `totalCredits = balance + consumed this period`. Current model: spec 13.

## Goals

- Simplify dashboard metering around a single credits meter instead of per-feature bars.
- Remove connector count limits from all plans; connector usage is governed by credits and runtime, not caps.
- Update credit/copy accounting so Telegram is presented as base text + media add-ons.
- Move Telegram connection card to the top of the Integrations tab, before app connectors.
- Keep Dodo plan product IDs and credit-pack product IDs unchanged.

## Changes

### Connector limits removed (`packages/shared/src/plans.ts`)

`PlanConfig.limits.connectors` changed from `number` to `number | null`. All three plans (`explore`, `pro`, `max`) set `connectors: null` (was `2`, `8`, `8`).

`featureLimit()` return type broadened to `PlanConfig["limits"][FeatureKey]` to reflect the nullable return.

### Connector enforcement removed

- `apps/backend/src/routes/integrations.ts`: removed `checkConnectorLimit()` call and connector-count enforcement.
- `apps/backend/src/agent/run.ts`: no longer slices connected providers by connector limit.
- `apps/backend/src/routes/billing.ts`: plan feature copy uses "App connectors" without a cap number.
- `apps/landing/src/app/dashboard/page.tsx`: removed `limitReached` prop from `<ConnectorMarketplace>`; connector count displayed as `N connected` (unlimited style).

### Dashboard credit meter (`apps/landing/src/app/dashboard/page.tsx`)

Replaced per-feature usage bars with a single credit meter:
- Progress bar: `creditsUsed / totalCredits`
- Legend cards:
  - AI chat — 1 credit
  - Telegram text — 1 base credit
  - Image/screen — +1 credit
  - Voice input/output — +2 credits/min
- Credit consumption shown as a secondary grid (not competing meters).
- Credit packs section unchanged.

### Telegram card in Integrations tab

Moved the Telegram linked-account card from the Account tab to the top of the Integrations tab, above the health warning panel and `ConnectorMarketplace`. Includes link/unlink/manage and loading states.

### Label consistency

- `"Screen analyze"` → `"Image/screen analyze"` everywhere:
  - Dashboard plan feature arrays
  - Dashboard `CREDIT_USAGE_LABELS`
  - Landing page plan cards (`apps/landing/src/components/landing/landing-page.tsx`)
  - Backend billing plan features (`apps/backend/src/routes/billing.ts`)
  - Backend usage route label (`apps/backend/src/routes/usage.ts`)

### Test fixes

- `apps/backend/src/routes/billing.test.ts`: connector limit expectation changed from `{ limit: 8 }` to `{ limit: null }`.
- `apps/backend/src/gateway/gateway-runner.test.ts`: DB mock includes `usageEvents`, `creditAccounts`, `creditGrants`, `creditTransactions`, `paymentRecords` for new credit-ledger imports; credit-ledger mock includes all exported functions.
- `apps/backend/src/routes/billing.test.ts`: auth mock exports `getAuth`.

## Files Changed

```
packages/shared/src/plans.ts
apps/backend/src/routes/integrations.ts
apps/backend/src/agent/run.ts
apps/backend/src/routes/billing.ts
apps/backend/src/routes/usage.ts
apps/backend/src/routes/billing.test.ts
apps/backend/src/gateway/gateway-runner.test.ts
apps/landing/src/app/dashboard/page.tsx
apps/landing/src/app/page.tsx
apps/landing/src/components/landing/landing-page.tsx
```

## Out of Scope

Updating Dodo subscription product IDs or credit-pack product IDs. Modifying subscription pricing or the credit-pack catalog.
