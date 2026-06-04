# Spec 14 - Landing Page

## Purpose

Define the public marketing site and conversion funnel. The landing app is
Next.js and contains public pages, pricing, auth entry points, and downloads. It
has no AI runtime logic.

## Invariants

- No LLM calls from the landing app.
- Pricing mirrors `specs/13-pricing.md`.
- Checkout uses backend Razorpay routes.
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
   mirror, future agents.
4. Pricing teaser: Explore, Pro, Max.
5. Footer: privacy, terms, GitHub/community links.

Privacy positioning:

- local memory stays on device
- cloud archive mirror indexes Yomi-generated notes and session summaries
  securely
- visible capture/listening status
- password managers and banking apps are blocked from capture

## Pricing Page

|                      | Explore                | Pro       | Max       |
| -------------------- | ---------------------- | --------- | --------- |
| Price                | $0                     | $9.99/mo  | $24.99/mo |
| Chat                 | 150 trial interactions | 10000/day | 10000/day |
| Voice                | trial-limited          | 200/day   | 10000/day |
| Screen analysis      | yes                    | yes       | yes       |
| Local memory         | no                     | yes       | yes       |
| Cloud archive mirror | no                     | yes       | yes       |
| Agents               | no                     | no        | yes       |

CTA behavior:

- signed-out users go through auth first
- Explore starts without checkout
- Pro starts Razorpay checkout
- Max can show waitlist/coming-soon until public launch

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

- Annual billing copy.
- Public Max launch copy.
- Real product screenshots after packaging.
