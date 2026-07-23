# Landing Page Visual/Copy Redesign — Design

Date: 2026-07-22
Status: **Superseded** by
`docs/superpowers/specs/2026-07-23-landing-hero-footer-light-redesign-design.md`
(2026-07-23) — never implemented. That spec carries forward this one's
per-section layout/copy fixes, adapted to a light palette instead of a
dark gradient, and replaces its dark hero + "footer unchanged" call
with a light hero and full footer redesign.

## Summary

Fix the "AI slop" feel of the marketing landing page
(`apps/landing/src/components/landing/landing-page.tsx`) — a single
824-line client component rendered by `apps/landing/src/app/page.tsx`.
The page reads as machine-generated because six of its seven sections
(About, How it works, Features, Connectors, Data-use, Pricing) share one
identical template — uppercase eyebrow label, heading with exactly one
italicized word, centered subtext, then a grid of `glass-card` boxes
with an icon in a `bg-primary/10 rounded-xl` badge — plus a generic
stock-photo hero and marketing-flavored copy (checkmark-list overuse,
filler phrasing like "everything you need, nothing you don't").

This is a targeted fix, not a rebuild: the existing design system
(primary blue `214 88% 54%`, Instrument Serif for headings via
`font-accent`, Inter body, `glass-card`/`hero-grain`/`hero-grid`
utilities already in `apps/landing/src/app/globals.css`) stays. What
changes is (1) the hero's stock photo, (2) breaking the six-section
template into layouts that fit what each section actually is, (3)
removing the italic-word heading tic and excess checkmark lists, (4)
a plain-language copy pass.

Scope confirmed with the user: landing page only — the `/docs` page
(which shares some of the same patterns from very recent commits) is
explicitly out of scope for this pass.

## Rejected approaches

- **Full visual rebuild** (new type pairing, drop glassmorphism, custom
  illustration system). Rejected by the user in favor of a targeted fix
  — lower risk, and the underlying design system (color/type tokens)
  isn't what's broken, the template repetition and stock photo are.
- **Product-relevant hero visual** (e.g. a stylized Telegram chat
  mockup) or **a better-sourced photo**. Rejected in favor of an
  abstract/brand gradient — user picked this directly; a literal
  chat-mockup hero risks its own cliché ("fake screenshot" is as
  recognizable a SaaS-hero trope as the stock photo it'd replace).

## Design

### 1. Hero (`landing-page.tsx` lines ~207–341)

Remove the `background-image` Unsplash `<div>` (lines 213–219) entirely.
Replace with a dark gradient built from the existing `--primary` HSL
token plus the already-defined `.hero-grain` utility (currently just
layered decoratively on top of the photo — reuse it as the actual
texture instead of a garnish):

- Base: `bg-zinc-950` (unchanged) with a radial gradient using
  `hsl(var(--primary))` at low opacity centered near the wordmark,
  fading to the existing near-black bottom (`rgba(3,8,20,0.98)`) —
  same vertical vignette shape as today, new source color instead of
  a photo showing through it.
- Keep `.hero-grain` (mix-blend screen noise) and the top-edge
  black-to-transparent gradient (line 222) as-is — those aren't part
  of the "stock photo" problem.
- No other hero content changes: wordmark, tagline, tag pills,
  CTA buttons, and the bottom feature-icon row (lines 320–338) stay.
  Those aren't part of the six-section template and aren't what the
  user flagged.

### 2. Per-section layout changes

The shared "eyebrow + italic heading + centered subtext" header block
is dropped as a copy-pasted unit; each section keeps only the pieces
that fit it. Heading italics are removed everywhere (plain headline
text, no `<span className="italic">`).

- **About** (lines 344–365): drop the eyebrow label and the
  `max-w-3xl` centered-header wrapper entirely. Render as a plain
  left-aligned (not centered) heading directly above the two-paragraph
  prose, no card, no grid — it's two sentences of description and
  doesn't need a section-header ceremony.
- **How it works** (lines 504–538): replace the 3-up `glass-card` grid
  (`InteractionCard`) with a horizontal numbered sequence — steps
  1/2/3 inline with a connecting line between them (flex row on
  desktop, stacked on mobile), number in a small circle instead of
  the current card's type-badge pill. `InteractionCard` is removed;
  its three content strings (label/description per mode) move inline
  into the new step markup.
- **Features** (lines 540–568): keep the 3-up grid (three genuinely
  parallel items), but stop matching the Connectors grid's visual
  identity — drop the icon-in-`bg-primary/10`-rounded-square badge,
  render the icon inline with the title instead of boxed above it.
- **Connectors** (lines 570–605): unchanged structurally — 14 items in
  a grid is the correct shape, and the icon-in-square there is an
  actual app icon (via `ConnectorIcon`), not decorative badge filler.
  Eyebrow label and heading kept, italic removed from the heading.
- **Data-use / Google Sign-In sections** (lines 367–502, 607–721):
  left mostly as-is — already table/prose-driven, the least
  template-matched part of the page. Only change: remove heading
  italics, and the "How your data is protected" `Check`-icon list
  (lines 658–695) — 4 items, at least one of which is really just a
  link, not a bullet fact — collapses to plain prose with inline
  links instead of a checklist.
- **Pricing** (lines 723–819): keep the 3-card comparison layout
  (correct shape for comparing 3 plans), but drop the
  `Sparkles`/`Crown`/`Cuboid` per-tier icon (lines 89, 107, 125 and
  their render at line 762) — cliché tier iconography that adds no
  information the plan name doesn't already convey. Heading italic
  removed. Feature checkmark lists inside each card are kept — that's
  a real enumerable list (what's included), not a padded fake list.

### 3. Copy pass

Direct/plain tone per the user's choice — shorter sentences, headings
state what the section is about without a stylistic hook. Concretely:

| Location | Before | After (direction, not final wording) |
|---|---|---|
| About heading | "What is *Yomi*?" | "What is Yomi?" |
| How-it-works heading | "Three ways to *ask*." | "Three ways to reach Yomi" |
| Features heading | "Everything you need, *nothing* you don't." | Plain statement of what the features section is (e.g. "What Yomi does") |
| Connectors heading | "Your tools, one *conversation* away." | Plain statement (e.g. "Connects to the apps you use") |
| Data-use heading | "What Yomi accesses, and *why*." | Kept close to as-is minus italics — already fairly plain |
| Pricing heading | "Simple, *honest* pricing." | "Pricing" or "Plans" |

Exact final copy is written at implementation time against the real
component, not locked down here — the table above is the direction
(cut the italic hook, cut soft marketing filler), not a copy-paste
script.

### 4. What's explicitly unchanged

`Nav`, `Footer`, the Google Sign-In data-policy sections' factual
content (legal/compliance text — reworded for italics/lists only, not
re-scoped), pricing logic (`handlePlanClick`, `useLocalPrice`), and all
non-visual behavior (session handling, billing redirect, error
forwarding).

## Testing

This is a static-prerendered (`dynamic = "force-static"`), purely
presentational page with no business logic changes — no unit tests
apply. Verification is: `bun run typecheck` + `bun run lint` in
`apps/landing`, then a manual check of the rendered page in a real
browser (light and dark mode, mobile width) using the `run` skill or
`bun run dev`, comparing against this design's section-by-section
list before calling it done.
