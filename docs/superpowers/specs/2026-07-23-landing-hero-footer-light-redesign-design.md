# Landing Page Light Redesign (Hero, Footer, Content Sections) — Design

Date: 2026-07-23
Status: Implemented

## Supersession note

This spec **supersedes** `docs/superpowers/specs/2026-07-22-landing-page-redesign-design.md`.
That spec is now marked superseded. Nothing from it was implemented yet
(the live `landing-page.tsx` still matches its "before" state), so there
is no rollback concern — this doc replaces it as the single source of
truth for the landing page's visual redesign.

What carries forward from the old spec, adapted to a light palette
instead of a dark gradient: the per-section layout fixes (About,
How it works, Features, Data-use, Pricing) and the plain-copy direction
for headings. What changes: the old spec kept the hero dark
(`bg-zinc-950` + primary-color radial gradient) and explicitly left the
footer untouched — this spec replaces both with a light theme and a
full footer redesign.

## Summary

Visually calmer, more editorial direction inspired by reference sites
(soft serif-italic accents, warm paper backgrounds, dot-grid texture —
aesthetic only, not wellness-app content). Scope: the landing route
only (`apps/landing/src/components/landing/landing-page.tsx`,
`Nav.tsx` indirectly via shared tokens, `Footer.tsx`). Dashboard, docs,
terms, privacy, and support pages are explicitly unaffected — the site
stays hard-forced dark (`layout.tsx`'s `<html className="dark">`)
everywhere except this one route.

## Rejected approaches

- **Whole-site light re-theme** (flip the global `dark` class default).
  Rejected — far larger blast radius than requested, would re-skin the
  dashboard app UI, docs, and legal pages with no design work done for
  any of them.
- **Literal wellness-app photography/content** (mountains, nature
  scenes, calm-app copy). Rejected — Yomi is a productivity assistant;
  only the aesthetic (serif italics, paper texture, calmer palette) is
  being borrowed from the references, not their content or domain.
- **Keeping a photo hero, just lighter/warmer.** Rejected in favor of
  no photo at all — an abstract paper/gradient background reads as
  more "product," less "stock photo," and matches the dot-grid/paper
  texture the user liked in the reference set.

## Design

### 1. Scoped light theme (technical foundation)

Add to `apps/landing/src/app/globals.css`:

- `.landing-light` — a wrapper class that re-declares the CSS custom
  properties (`--background`, `--foreground`, `--card`,
  `--card-foreground`, `--border`, `--muted`, `--muted-foreground`,
  `--accent`, `--accent-foreground`) to their existing `:root` (light)
  values already defined at lines 6–27. Applied to the landing page's
  root wrapper div in place of the plain `text-foreground` class.
  `--primary` stays the same blue in both themes — no change needed.
- `.site-texture-bg-light` — replaces `.site-texture-bg` on this page
  only. Warm paper/cream base (`~#faf7f0`), a soft radial glow in
  `hsl(var(--primary))` at low opacity (top-left, echoing the current
  dark version's blue glow), fine dot-grid texture at low opacity, and
  a light-tuned grain (dark speckle at very low opacity instead of the
  current white-speckle-on-dark `.hero-grain`).
- `.landing-light .glass-card` — scoped override: soft white/cream
  translucent background, hairline warm-gray border, gentle shadow
  (replacing the current heavy black shadow tuned for a dark page).
  No JSX changes needed at any of the four `glass-card` call sites —
  the override cascades automatically.

Because `Nav.tsx` and `Footer.tsx` already consume semantic tokens
(`bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`)
rather than hardcoded colors, both adapt to the light scope with zero
changes to their own logic — only `Footer.tsx`'s markup changes (see
§4), not its color classes.

Nothing in `layout.tsx` changes. No other route is affected.

### 2. Hero (`landing-page.tsx` lines ~207–345)

- Remove the Unsplash `background-image` div (lines 213–219) and its
  dark vignette overlay (line 220) entirely.
- Section background becomes `site-texture-bg-light` (applied via the
  page-level wrapper, not a per-section class).
- Wordmark ("Yomi", line 259): recolor from `#eaf4ff` (tuned for a dark
  photo) to a deep ink/navy foreground tone; remove the drop-shadow
  (line 259's `drop-shadow-[...]`) — was compensating for a busy photo
  backdrop that no longer exists.
- Tagline (line 244–246): keep copy, add italic accent — "Your AI
  companion for work *and life*." with "and life" set in
  `font-serif italic` (Instrument Serif, already loaded as
  `--font-heading`), colored with `text-primary` or a muted ink tone.
  Subhead paragraph (line 249–254) unchanged.
- Badge row ("Early access" / "< 2s fast path" / "On Telegram...",
  lines 229–240): restyle from `border-white/15 bg-white/10` to
  `border-border bg-card/60` equivalents — same content, light pills.
- CTA buttons (lines 293–320): "Get started" primary button already
  uses semantic-adjacent styling (`bg-[#eaf4ff]`) — change to
  `bg-primary text-primary-foreground`. "See how it works" / "Text
  Yomi" secondary buttons change from `border-white/15 bg-white/10
  text-white` to `border-border bg-card/60 text-foreground`.
- Tag pills + "Your data is never stored" caption (lines 271–292):
  restyle from white/10 pills to `border-border bg-card` pills, same
  content.
- Bottom feature-icon row (lines 324–342): restyle
  `text-white/62` → `text-muted-foreground`, icon colors
  `text-sky-100` → `text-primary`.

### 3. Content sections — layout (carried forward from the superseded
spec, colors adapted to light)

- **About** (lines 348–369): drop the eyebrow label and centered
  `max-w-3xl` header-block ceremony. Left-aligned plain heading
  directly above the two-paragraph prose, no card, no grid.
- **How it works** (lines 508–542): replace the 3-up `glass-card` grid
  (`InteractionCard`) with a horizontal numbered sequence (steps 1/2/3,
  connecting line between them, flex row desktop / stacked mobile,
  number in a small circle). `InteractionCard` component is removed;
  its three label/description strings move inline into the new step
  markup.
- **Features** (lines 544–572): keep the 3-up grid, drop the
  icon-in-`bg-primary/10`-rounded-square badge, render the icon inline
  with the title instead of boxed above it.
- **Connectors** (lines 574–609): structurally unchanged — the
  icon-in-square here is a real app icon via `ConnectorIcon`, not
  decorative filler. Heading italic removed (plain heading).
- **Google Sign-In / Data-use sections** (lines 371–506, 611–725):
  left mostly as-is (already table/prose-driven). Heading italics
  removed. The "How your data is protected" `Check`-icon list
  (lines 662–699) collapses to plain prose with inline links.
- **Pricing** (lines 727–823): keep the 3-card comparison layout, drop
  the per-tier `Sparkles`/`Crown`/`Cuboid` icon (lines 89, 107, 125 and
  their render at line 766). Heading italic removed. Feature checkmark
  lists inside each card are kept (real enumerable "what's included"
  list).
- Heading italics removed from all six section headings per the
  original copy-pass direction (About/How-it-works/Features/
  Connectors/Data-use/Pricing) — the hero tagline's italic accent
  (§2) is the one intentional exception, since it's a single accent
  phrase, not a repeated six-section tic.

### 4. Footer (`Footer.tsx`) — full redesign, light, folk-inspired

Five-column layout on the same `site-texture-bg-light` paper background
as the hero (bookending the page — light hero, dark content sections in
between, light footer), replacing the current single-row dark layout
entirely:

1. **Brand column**: `BrandMark` (already theme-safe via `text-foreground`)
   + a one-line description ("AI assistant for Gmail, Calendar, Drive,
   GitHub, Slack, Notion, and more — on Telegram.") + `© {year} Yomi.
   All rights reserved.`
2. **Product**: Features (`/#features`), Integrations (`/#connectors`),
   Pricing (`/#pricing`), Dashboard (`/dashboard`)
3. **Resources**: Docs (`/docs`), Support (`/support`), How it works
   (`/#how-it-works`), Privacy (`/privacy`), Terms (`/terms`), GitHub
   (external)
4. **Company** (the Google-OAuth-required contact block — own
   dedicated column, content unchanged from today's `Footer.tsx` lines
   19–42, just restyled): Product name, Developer name + "Independent
   software developer", Support email, Website link.
5. A large ghosted "Yomi" wordmark spanning the bottom edge
   (`font-accent`, very large, low-opacity ink color, `aria-hidden`,
   non-interactive) — decorative only, no stat/counter (no fabricated
   usage numbers — Yomi is early access).

No live-status indicator ("Yomi is online") — explicitly skipped per
user decision, not just the numeric stat.

### 5. What's explicitly unchanged

`Nav.tsx` logic and color classes (adapts automatically via scoped
tokens), pricing logic (`handlePlanClick`, `useLocalPrice`), all
non-visual behavior (session handling, billing redirect, error
forwarding), and every other route (`dashboard`, `docs`, `terms`,
`privacy`, `support`) — all stay on the current dark theme, byte-for-byte.

## Testing

Static-prerendered (`dynamic = "force-static"`), purely presentational
page — no unit tests apply. Verification:

1. `bun run typecheck` + `bun run lint` in `apps/landing`.
2. Manual check via the `run` skill or `bun run dev`: landing page
   renders the full light theme correctly (hero, all seven content
   sections, footer) at mobile and desktop widths.
3. Spot-check `dashboard`, `docs`, `terms`, `privacy`, and `support`
   routes are visually unchanged (still dark) — confirms the scoping
   didn't leak.
