# Spec 14 — Landing Page

## Purpose

Marketing site and conversion funnel for Yomi. Built with Next.js 16 on Vercel. Covers the public-facing homepage, waitlist capture, pricing page, and download page. This is the first thing a potential user sees — it must communicate the value prop fast, collect emails before launch, and hand off to Stripe checkout or a download link post-launch.

## Invariants

- No AI logic, no LLM calls. Static + minimal server components only.
- No auth session on the landing page — it's fully public.
- Waitlist emails are collected via a simple API route (`/api/waitlist`) and stored externally (Resend audience or a simple Neon insert). No third-party form providers.
- Pricing table always reflects the plan matrix from `specs/13-pricing.md` — keep in sync.
- Download links point to GitHub Releases (or a CDN). Never self-host binaries on Vercel.
- `NEXT_PUBLIC_BACKEND_URL` is the only env var the landing app uses — everything else is public.

## Detailed Design

### Pages

```
/               Homepage — hero, how it works, features, pricing teaser, waitlist CTA
/pricing        Full pricing table with plan comparison
/download       Post-launch: platform-specific download links + install instructions
/privacy        Privacy policy (static)
/terms          Terms of service (static)
```

### Homepage sections

1. **Hero** — headline + subheadline + waitlist input + platform badges (Mac / Windows / Linux)
2. **How it works** — 3-step visual: hotkey → Yomi sees + hears → done
3. **Features** — fast answers, autonomous tasks, persistent memory, cross-platform, private by default
4. **Pricing teaser** — Free / Pro / Max cards, "Team" callout, link to `/pricing`
5. **Footer** — links to `/privacy`, `/terms`, GitHub, Discord

### Waitlist API route

```typescript
// apps/landing/src/app/api/waitlist/route.ts
export async function POST(req: Request) {
  const { email } = await req.json()
  if (!email || !email.includes("@")) {
    return Response.json({ error: "invalid email" }, { status: 400 })
  }
  // Store in Neon via backend or directly
  await fetch(`${process.env.BACKEND_URL}/api/waitlist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  })
  return Response.json({ ok: true })
}
```

### Pricing page

Full comparison table mirroring `specs/13-pricing.md`:

| | Free | Pro ($20/mo) | Max ($50/mo) | Team ($30/user/mo) |
|---|---|---|---|---|
| Fast queries | 50/day | Unlimited | Unlimited | Unlimited |
| Agent runs | 1/mo | 100/mo | 500/mo | 500/user/mo |
| STT | Local | Cloud | Cloud | Cloud |
| TTS | Local | Cloud | Cloud | Cloud |
| MCP connectors | ✗ | ✓ | ✓ | ✓ |
| Cloud sync | ✗ | ✓ | ✓ | ✓ |
| BYOK | ✓ | ✓ | ✓ | ✓ |
| Annual discount | — | 2 months free | 2 months free | 2 months free |

CTA buttons link to the backend's Stripe checkout (`/api/billing/create-checkout`) once logged in, or to the waitlist during pre-launch.

### Download page

```
Mac        .dmg (Apple Silicon) · .dmg (Intel)
Windows    .exe installer · .msi
Linux      .AppImage · .deb · .rpm
```

Links to GitHub Releases for the current version. Auto-detects platform via `navigator.userAgent` to highlight the right download. Shows install instructions per platform (drag to Applications, run installer, `chmod +x` for AppImage).

### Tech choices

- **Tailwind CSS** — already in `devDependencies`
- **No component library** — keep the bundle lean; hand-rolled components only
- **No client-side state** — waitlist form uses native `fetch`, no React Query or SWR
- **`next/image`** — for all screenshots/illustrations (auto-optimised)
- **`next/font`** — system font stack or Geist (already in Next.js 16)

### SEO + meta

```typescript
// app/layout.tsx
export const metadata = {
  title: "Yomi — Your AI buddy on every screen",
  description: "Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.",
  openGraph: { ... },
  twitter: { card: "summary_large_image", ... },
}
```

### Vercel config

```json
// vercel.json (if needed)
{
  "buildCommand": "cd ../.. && bun run build --filter=@yomi/landing",
  "outputDirectory": "apps/landing/.next",
  "framework": "nextjs"
}
```

## Files to change

- `apps/landing/src/app/layout.tsx` — root layout with metadata, font, Tailwind base
- `apps/landing/src/app/page.tsx` — homepage (hero + sections)

## Files to create

- `apps/landing/src/app/pricing/page.tsx` — full pricing comparison table
- `apps/landing/src/app/download/page.tsx` — platform download links
- `apps/landing/src/app/privacy/page.tsx` — privacy policy (static text)
- `apps/landing/src/app/terms/page.tsx` — terms of service (static text)
- `apps/landing/src/app/api/waitlist/route.ts` — POST handler, proxies to backend
- `apps/landing/src/components/WaitlistForm.tsx` — email input + submit
- `apps/landing/src/components/PricingCard.tsx` — reusable plan card
- `apps/landing/src/components/Nav.tsx` — top nav
- `apps/landing/src/components/Footer.tsx` — footer links
- `apps/landing/tailwind.config.ts` — Tailwind config (if not present)
- `apps/landing/postcss.config.mjs` — PostCSS config (if not present)

## Open Questions

- Waitlist storage: proxy to backend (`/api/waitlist` Hono route + Neon insert) vs Resend Audiences API directly from the landing. Backend proxy keeps key management consistent — prefer that.
- Illustrations / screenshots: placeholder SVGs at spec time, real screenshots at launch.
- Analytics: Vercel Analytics (zero-config, privacy-friendly) or Plausible. Decide at Phase 5.
- Discord invite link: needs a server to exist first.
