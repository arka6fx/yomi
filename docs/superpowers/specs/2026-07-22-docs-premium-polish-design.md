# Docs Site Premium Polish — Design

## Context

The docs site (`apps/landing/src/app/docs/page.tsx` + `apps/landing/src/components/docs/*`)
is the sixth and final sub-project from the original combined UI-redesign
request, explicitly deprioritized to last. Unlike the other five (connections
page, post-signup screen, custom MCP servers, settings menu, dashboard home),
no reference screenshot was provided for this one — the direction comes from
the user's explicit instruction: give the hero text, icons, and banners a
premium look.

The docs site already has solid infrastructure: `DocsShell.tsx` (scroll-spy,
sidebar, table of contents), `DocsHeader.tsx` (sticky search header),
`DocsSidebar.tsx`/`DocsToc.tsx`, and `docs/page.tsx` (the actual content —
`Eyebrow`, `Section`, and `Feature` helper components, ten `Section`s, a
connector grid, a Telegram command table, a pricing grid, and a closing CTA).
None of that navigation/search infrastructure is in scope here — it already
works well and wasn't called out. This is a visual-polish pass on three
specific things: the hero, the icons, and the banners.

## Direction

Refined polish within the site's existing restrained aesthetic (serif
headlines, subtle radial glow, muted cards, the same design tokens used by
the dashboard) — not a stylistic departure (no glassmorphism, no animated
mesh backgrounds, no per-scroll section animations). More depth and color,
same visual language.

## 1. Hero

Currently an inline `<header>` passed as `DocsShell`'s `banner` prop
(`docs/page.tsx:146-169`): one radial gradient layer, `Eyebrow` with a
`Sparkles` icon, an `h1` at `text-4xl sm:text-5xl`, and a subtext paragraph.
Static — no entrance animation, since `docs/page.tsx` is a server component
and the header markup is plain JSX.

Extracted into a new client component, `apps/landing/src/components/docs/DocsHero.tsx`:

- A second radial-gradient layer behind the existing one, offset and using a
  secondary hue, for more depth (still subtle — this is a glow, not a
  background pattern).
- Headline bumped to `text-5xl sm:text-6xl` with the same tight tracking.
- A staggered fade-up entrance on mount (`framer-motion`, matching the
  `initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}` pattern
  already used throughout the dashboard): eyebrow first, then headline, then
  subtext, each offset by a small transition delay (0s / 0.08s / 0.16s).

`docs/page.tsx` swaps its inline `banner={<header>...}</header>}` for
`banner={<DocsHero />}`.

## 2. Icons — per-section color tinting

Every `Feature` card currently renders its icon in the same flat
`bg-primary/10 text-primary` box (`docs/page.tsx:132-135`), and section
`Eyebrow`s are plain text with no icon (except the hero's, which keeps
`Sparkles`). This reads as one undifferentiated color across ten sections.

Both `Eyebrow` and `Feature` gain a `tone` prop; `Eyebrow` also gains an
optional `icon` slot. A shared tone-to-class map:

```ts
const TONE_CLASSES: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  emerald: "bg-emerald-500/10 text-emerald-400",
  sky: "bg-sky-500/10 text-sky-400",
  blue: "bg-blue-500/10 text-blue-400",
  violet: "bg-violet-500/10 text-violet-400",
  amber: "bg-amber-500/10 text-amber-400",
  rose: "bg-rose-500/10 text-rose-400",
  teal: "bg-teal-500/10 text-teal-400",
  yellow: "bg-yellow-500/10 text-yellow-400",
  cyan: "bg-cyan-500/10 text-cyan-400",
}
```

(These are the same raw Tailwind palette utilities already used elsewhere in
the codebase for status/badge coloring — e.g. the dashboard's plan-status
badges — not a new pattern.)

One tone per section, applied to that section's `Eyebrow` icon and all of its
`Feature` cards:

| Section | Tone | Eyebrow icon |
| --- | --- | --- |
| Overview | `primary` | (none — kept plain, it's the intro) |
| Getting started | `emerald` | `Rocket` |
| Web | `sky` | `Globe` |
| Telegram | `blue` | `Send` |
| Connectors | `violet` | `Plug` |
| Memory | `amber` | `Brain` |
| Voice & vision | `rose` | `Mic` |
| Approvals | `teal` | `ShieldCheck` |
| Plans & credits | `yellow` | `Sparkles` |
| Privacy | `cyan` | `Lock` |

The connector grid's icon wrapper (`docs/page.tsx:272`, `bg-muted/60` around
each `ConnectorIcon`) is **not** changed — those icons already carry their
own brand colors, and tinting the wrapper too would clash rather than add
polish.

## 3. Banners

**Closing CTA** (`docs/page.tsx:386-399`): currently a plain bordered card
with a bare `Send` icon and two inline text links. Upgraded to match the
hero's glow treatment at a smaller scale (one subtle radial layer), the
`Send` icon moved into a tinted icon box (reusing the `Feature` icon-box
styling, `primary` tone), and the two inline links replaced with real
buttons — a filled primary button ("Create your account") and an outline
secondary button ("Open the dashboard").

**Pricing cards** (`docs/page.tsx:326-364`, the Explore/Pro/Max grid):
currently plain text plan names. Each card gets the same icon its dashboard
counterpart already uses — `Sparkles` (Explore), `Crown` (Pro), `Cuboid`
(Max), imported from `lucide-react` (only `Sparkles` is currently imported in
this file; `Crown` and `Cuboid` are added) — in a small tinted icon box next
to the plan name, giving visual continuity with the real pricing UI in the
dashboard. The featured Pro card additionally gets a soft glow/shadow
(`shadow-lg shadow-primary/10`) on top of its existing `border-primary/40
bg-primary/5` treatment.

## Out of scope

- `DocsShell`, `DocsHeader`, `DocsSidebar`, `DocsToc` — navigation/search
  infrastructure, not called out, already solid.
- Scroll-triggered per-section reveal animations — the hero gets an
  on-mount entrance; sections do not get scroll-into-view animations. Adding
  those would mean building on top of `DocsShell`'s existing
  `IntersectionObserver` scroll-spy logic, which is unrelated complexity
  beyond "hero, icons, banners."
- The connector grid, Telegram command table, and privacy checklist layouts
  — unchanged structurally; only the section's `Eyebrow` icon/tone applies.

## Testing

No automated test — consistent with every UI feature shipped this session.
Verification is typecheck/lint/test plus a manual browser walkthrough.
Unlike every other UI feature this session, `/docs` does not require
authentication (`DocsHeader` reads the session only to decide which link
label to show, it doesn't gate rendering), so the manual walkthrough is
expected to actually succeed in this sandbox rather than hit the
sign-in-redirect blocker seen everywhere else.
