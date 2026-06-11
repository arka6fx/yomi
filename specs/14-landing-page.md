# Spec 14 - Landing Page

## Purpose

Define the public marketing site and conversion funnel. The landing app is
Next.js and contains public pages, pricing, auth entry points, and downloads. It
has no AI runtime logic.

## Invariants

- No LLM calls from the landing app.
- Pricing mirrors `specs/13-pricing.md`.
- Checkout uses backend Dodo billing routes.
- Public copy must not claim hidden cloud memory sync.
- Download links point to GitHub Releases or a CDN.

## Pages

```text
/          homepage
/pricing   plan comparison and checkout entry
/download  desktop app downloads
/privacy   privacy policy
/terms     terms of service
```

## Homepage Content

Sections:

1. Hero: Yomi as a desktop AI buddy for screen and voice.
2. How it works: hotkey, screen/mic context, answer/action.
3. Features: fast answers, screen-aware help, local memory, cloud archive
   mirror, and foreground automation.
4. Pricing teaser: Explore, Pro, Max.
5. Footer: privacy, terms, GitHub/community links.

Privacy positioning:

- local memory stays on device
- cloud archive mirror indexes Yomi-generated notes and session summaries
  securely
- visible capture/listening status
- password managers and banking apps are blocked from capture

## Pricing Page

|                      | Explore | Pro       | Max       |
| -------------------- | ------- | --------- | --------- |
| Price                | $0      | $14.99/mo | $39.99/mo |
| Chat                 | 100/mo  | 2,000/mo  | 8,000/mo  |
| Voice                | 20 min  | 180 min   | 750 min   |
| Screen analysis      | 25/mo   | 400/mo    | 2,000/mo  |
| Local memory         | limited | yes       | expanded  |
| Cloud archive mirror | no      | 250 MB    | 2 GB      |
| Automation           | no      | limited   | expanded  |

CTA behavior:

- signed-out users go through auth first
- Explore starts without checkout
- Pro starts Dodo checkout
- Max starts Dodo checkout

## Auth And Checkout

Landing auth uses Better Auth OAuth. Checkout and billing status are handled by
backend routes under `/api/billing`.

## Downloads

```text
macOS     .dmg builds
Windows   .exe or .msi installer
```

The page can detect platform with `navigator.userAgent` to highlight the
recommended download.

## Implemented Files

- `apps/landing/src/app/page.tsx`
- `apps/landing/src/app/pricing/page.tsx`
- `apps/landing/src/app/download/page.tsx`
- `apps/landing/src/app/layout.tsx`

## Future Work

- Annual billing checkout.
- Real product screenshots after packaging.
