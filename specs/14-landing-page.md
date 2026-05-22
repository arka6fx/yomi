# Spec 14 — Landing Page

## Purpose

Marketing site and conversion funnel for Yomi. Built with Next.js 16 on Cloudflare Pages (via `@opennextjs/cloudflare`). Covers the public-facing homepage, waitlist capture, pricing page, and download page. This is the first thing a potential user sees — it must communicate the value prop fast, collect emails before launch, and hand off to Razorpay Checkout or a download link post-launch.

## Invariants

- No AI logic, no LLM calls. Static + minimal server components only.
- No auth session on the landing page — it's fully public.
- Waitlist emails are collected via a simple API route (`/api/waitlist`) and proxied to the backend Neon insert. No third-party form providers.
- Pricing table always reflects the plan matrix from `specs/13-pricing.md` — keep in sync.
- Download links point to GitHub Releases (or a CDN). Never self-host binaries on Cloudflare Pages.
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

1. **Hero** — headline + subheadline + waitlist input + platform badges (Mac / Windows only)
2. **How it works** — 3-step visual: hotkey → Yomi sees + hears → done
3. **Features** — fast answers, autonomous tasks, persistent memory, Mac + Windows, private by default
4. **Pricing teaser** — Free / Basic / Standard / Genesis cards, link to `/pricing`
5. **Footer** — links to `/privacy`, `/terms`, GitHub, Discord

### Waitlist API route

```typescript
// apps/landing/src/app/api/waitlist/route.ts
export async function POST(req: Request) {
  const { email } = await req.json()
  if (!email || !email.includes("@")) {
    return Response.json({ error: "invalid email" }, { status: 400 })
  }
  // Proxy to backend for Neon insert — keeps DB creds off landing
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

| | Free | Basic ($4/mo) | Standard ($9/mo) | Genesis ($19/mo) |
|---|---|---|---|---|
| LLM calls/day | 10 | 500 | 2000 | 10000 |
| STT minutes/day | 2 | 30 | 120 | 600 |
| TTS | ✓ | ✓ | ✓ | ✓ |
| Screenshot analysis | ✗ | ✓ | ✓ | ✓ |
| Agent pipeline | ✗ | ✗ | ✓ | ✓ |
| Priority support | ✗ | Email | Email | Priority |

CTA buttons link to the backend's Razorpay checkout (`/api/v1/billing/create-subscription`) once logged in, or to the waitlist during pre-launch.

### Download page

```
Mac       .dmg (Apple Silicon) · .dmg (Intel)
Windows   .exe installer · .msi
```

Links to GitHub Releases for the current version. Auto-detects platform via `navigator.userAgent` to highlight the right download. Shows install instructions per platform (drag to Applications, run installer).

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

### Cloudflare Pages config

`wrangler.json` — see `specs/15-deploy.md` for full config.

## Files to change

- `apps/landing/src/app/layout.tsx` — root layout with metadata, font, Tailwind base
- `apps/landing/src/app/page.tsx` — homepage (hero + sections)
- `apps/landing/src/app/pricing/page.tsx` — update to Basic/Standard/Genesis plans
- `apps/landing/src/app/download/page.tsx` — remove Linux download links

## Files to create

- `apps/landing/open-next.config.ts` — OpenNext config for Cloudflare Pages
- `apps/landing/wrangler.json` — Pages config

## Open Questions

- Waitlist storage: proxy to backend (`/api/waitlist` Hono route + Neon insert) vs Resend Audiences API directly from the landing. Backend proxy keeps key management consistent — prefer that.
- Illustrations / screenshots: placeholder SVGs at spec time, real screenshots at launch.
- Analytics: Vercel Analytics won't work on Cloudflare Pages — use Plausible (self-hosted or cloud) or Cloudflare Web Analytics. Decide at launch.
- Discord invite link: needs a server to exist first.
