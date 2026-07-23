# Landing Hero/Footer Light Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the landing page (only) a light, editorial redesign — no-photo paper-textured hero with a serif-italic accent tagline, de-templated content sections, and a new folk-inspired light footer — while every other route stays on the current dark theme, byte-for-byte.

**Architecture:** Scope the light theme to the landing route via CSS custom-property overrides on a wrapper class (`.landing-light`), rather than touching the global `dark` class in `layout.tsx`. A new `LandingFooter.tsx` component (light, landing-only) replaces the shared `Footer.tsx` import in `landing-page.tsx`; the shared `Footer.tsx` itself is untouched so docs/terms/privacy/support keep their current dark footer unchanged.

**Tech Stack:** Next.js (App Router), Tailwind CSS (CSS custom properties for theming), Framer Motion, lucide-react icons. No test framework applies (static-prerendered, purely presentational page) — verification is `bun run typecheck`, `bun run lint`, and manual browser checks.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-landing-hero-footer-light-redesign-design.md` (supersedes `2026-07-22-landing-page-redesign-design.md`, which is now marked superseded).
- Only the landing route (`apps/landing/src/components/landing/landing-page.tsx` and what it renders) changes. `layout.tsx`, `Nav.tsx`, and every other route (`dashboard`, `docs`, `terms`, `privacy`, `support`) must remain unchanged — still dark theme, still using the existing shared `Footer.tsx`.
- No photography anywhere in the new hero — paper/gradient background only.
- No fabricated usage stats or "online" status indicator in the footer — the brand column gets a plain description line instead.
- The four Google-OAuth-required footer fields (Product name, Developer name + "Independent software developer", Support email, Website link) must all remain present with unchanged content — verification content, not decoration.
- Exactly one italic accent in the whole page's headings: "and life" in the hero tagline. All six content-section headings (About, How it works, Features, Connectors, Data-use, Pricing) lose their italic word.
- After every task: `bun run typecheck` and `bun run lint` (both run from `apps/landing`) must pass before committing.
- Commands in this plan assume the working directory is `apps/landing` unless stated otherwise.

---

## File Structure

- **Modify:** `apps/landing/src/app/globals.css` — add `.landing-light` (scoped CSS variable overrides), `.site-texture-bg-light` (paper background + primary-color glow + dot-grid + grain), `.landing-light .glass-card` (light card override).
- **Modify:** `apps/landing/src/components/landing/landing-page.tsx` — root wrapper class, hero markup/copy, About/How-it-works/Features/Connectors/Data-use/Pricing content, footer import.
- **Create:** `apps/landing/src/components/landing/LandingFooter.tsx` — new light, folk-inspired footer, used only by `landing-page.tsx`.
- **Unchanged:** `apps/landing/src/components/Footer.tsx` (still used by `docs`, `terms`, `privacy`, `support` — do not touch), `apps/landing/src/components/Nav.tsx` (already theme-token-driven, adapts automatically), `apps/landing/src/app/layout.tsx`.

---

### Task 1: Scoped light-theme CSS foundation

**Files:**
- Modify: `apps/landing/src/app/globals.css`
- Modify: `apps/landing/src/components/landing/landing-page.tsx:203` (root wrapper class only)

**Interfaces:**
- Produces: CSS classes `.landing-light`, `.site-texture-bg-light` — consumed by Task 2 (hero) and Task 5 (footer). `.landing-light .glass-card` override — consumed automatically by every existing `glass-card` usage in the file (How-it-works, Features, Connectors, Data-use, Pricing), no further JSX changes needed for those.

- [ ] **Step 1: Add the scoped theme classes to `globals.css`**

Open `apps/landing/src/app/globals.css`. Find the `.site-texture-bg` block (starts at line 208) and add the following new rules directly after its closing `}` (after line 269, still inside the same `@layer base { ... }` block):

```css
  .landing-light {
    --background: 0 0% 98%;
    --foreground: 0 0% 13%;
    --card: 0 0% 99%;
    --card-foreground: 0 0% 13%;
    --popover: 0 0% 99%;
    --popover-foreground: 0 0% 13%;
    --primary: 214 88% 54%;
    --primary-foreground: 0 0% 100%;
    --secondary: 214 100% 91%;
    --secondary-foreground: 218 67% 24%;
    --muted: 0 0% 94%;
    --muted-foreground: 0 0% 39%;
    --accent: 0 0% 91%;
    --accent-foreground: 0 0% 13%;
    --border: 0 0% 85%;
    --input: 0 0% 85%;
    --ring: 214 88% 54%;
  }

  .site-texture-bg-light {
    position: relative;
    isolation: isolate;
    background: #faf7f0;
  }

  .site-texture-bg-light::before {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -2;
    pointer-events: none;
    background:
      radial-gradient(
        ellipse 60% 45% at 12% 8%,
        rgba(37, 99, 235, 0.1) 0%,
        rgba(37, 99, 235, 0.04) 45%,
        transparent 72%
      ),
      radial-gradient(circle at 22% 26%, rgba(120, 113, 98, 0.5) 0 1px, transparent 1.2px),
      radial-gradient(circle at 68% 54%, rgba(120, 113, 98, 0.5) 0 1px, transparent 1.2px),
      linear-gradient(180deg, #fdfbf5 0%, #faf7f0 45%, #f5f1e6 100%);
    background-size:
      auto,
      28px 28px,
      28px 28px,
      auto;
  }

  .site-texture-bg-light::after {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    opacity: 0.05;
    background-image:
      radial-gradient(circle at 15% 20%, rgba(20, 20, 15, 0.9) 0 0.7px, transparent 0.8px),
      radial-gradient(circle at 75% 50%, rgba(20, 20, 15, 0.6) 0 0.7px, transparent 0.8px);
    background-size:
      2.5px 2.5px,
      3.5px 3.5px;
    mix-blend-mode: multiply;
  }

  .landing-light .glass-card {
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    border: 1px solid rgba(120, 113, 98, 0.14);
    box-shadow:
      0 8px 24px rgba(120, 113, 98, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.6);
  }
```

- [ ] **Step 2: Apply the wrapper class to the landing page root**

In `apps/landing/src/components/landing/landing-page.tsx`, find line 203:

```tsx
    <div className="site-texture-bg min-h-screen text-foreground">
```

Replace with:

```tsx
    <div className="landing-light site-texture-bg-light min-h-screen text-foreground">
```

- [ ] **Step 3: Verify — typecheck and lint**

Run (from `apps/landing`):

```bash
bun run typecheck
bun run lint
```

Expected: both PASS with no errors.

- [ ] **Step 4: Verify — visual check**

Run `bun run dev` (or use the `run` skill) and open `http://localhost:3000`. Expected at this point (hero itself is not yet updated — that's Task 2, so it will still show the old dark photo hero):

- Scrolling past the hero, the About/How-it-works/Features/Connectors/Data-use/Pricing sections now render on a warm cream/paper background instead of dark navy, with dark ink text (previously near-invisible dark-on-dark or reliant on the forced `.dark` tokens).
- Card-shaped elements (feature cards, connector tiles, pricing cards, the data-use callout boxes) now look like soft white/cream translucent panels instead of dark glass panels.
- The floating nav bar automatically looks light (no code change needed there — confirms the token-scoping works).

- [ ] **Step 5: Commit**

```bash
git add apps/landing/src/app/globals.css apps/landing/src/components/landing/landing-page.tsx
git commit -m "feat(landing): scope a light theme to the landing route"
```

---

### Task 2: Hero redesign — no-photo paper background, restyled copy/CTAs

**Files:**
- Modify: `apps/landing/src/components/landing/landing-page.tsx:207-345` (hero section)

**Interfaces:**
- Consumes: `.site-texture-bg-light` background (from Task 1, applied at the page root — the hero section itself needs no own background now).
- Produces: no new exports; this task only changes JSX inside the existing `LandingPage` component.

- [ ] **Step 1: Replace the hero section**

Find the `<section id="hero" ...>` block, lines 207–345 in `landing-page.tsx` (from `<section` through its matching `</section>`). Replace the entire block with:

```tsx
      <section
        id="hero"
        style={{ marginTop: "-74px" }}
        className="relative flex min-h-screen flex-col overflow-hidden"
      >
        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-between px-5 pb-8 pt-28 sm:px-8 sm:pb-10 lg:px-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-6 flex flex-wrap items-center gap-3 text-xs font-medium text-muted-foreground"
          >
            <span className="rounded-full border border-border bg-card/70 px-3 py-1.5 backdrop-blur-md">
              Early access
            </span>
            <span className="flex items-center gap-1.5">
              <Zap size={14} className="fill-primary/30 text-primary" />
              &lt; 2s fast path
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-border sm:block" />
            <span>On Telegram · text, voice, or photo</span>
          </motion.div>

          {/* big centered tagline — the heart of the hero */}
          <div className="animate-hero-rise-delayed mx-auto flex max-w-5xl flex-col items-center px-2 text-center">
            <p className="font-serif text-5xl leading-[1.04] tracking-tight text-foreground sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
              Your <span className="text-primary">AI companion</span> for work{" "}
              <em className="italic">and life</em>.
            </p>
            {/* plain-language purpose statement, visible on load with no scroll or JS
                animation required — reviewers and crawlers should not have to hunt for it */}
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Yomi is an AI assistant you message on Telegram with text, voice, or a photo. It
              connects to Gmail, Google Calendar, Google Drive, GitHub, Slack, Notion, and Linear
              so you can ask questions and get things done in plain language — Yomi asks for your
              approval before it changes anything.
            </p>
          </div>

          <div>
            <div className="grid items-end gap-8 lg:grid-cols-[1fr_360px]">
              <h1 className="animate-hero-rise-delayed font-accent text-[4.8rem] leading-[0.82] tracking-normal text-foreground sm:text-[7.2rem] md:text-[9rem] lg:text-[11.2rem]">
                Yomi
                {/* the visible wordmark alone is a poor heading for search and screen readers */}
                <span className="sr-only"> — AI productivity assistant on Telegram</span>
              </h1>

              <motion.div
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.35 }}
                className="pb-1 lg:pb-6"
              >
                <div className="mb-7 max-w-md">
                  <div className="flex flex-wrap gap-2">
                    {["Telegram", "Web dashboard", "No copy-paste"].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-border bg-card/50 px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground backdrop-blur-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <p className="mt-4 font-serif text-sm italic text-muted-foreground/70">
                    Your data is never stored.{" "}
                    <a
                      href="#google-data"
                      className="font-sans text-xs not-italic underline underline-offset-2 transition-colors hover:text-foreground"
                    >
                      Learn more
                    </a>
                  </p>
                </div>
                <div className="grid w-full max-w-md grid-cols-2 gap-3">
                  <Link
                    href={session ? "/dashboard" : "/signup"}
                    className="group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                  >
                    {session ? "Go to dashboard" : "Get started"}
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-foreground text-primary transition group-hover:translate-x-0.5">
                      <ArrowRight size={14} />
                    </span>
                  </Link>
                  <button
                    onClick={() => scrollTo("how-it-works")}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-border bg-card/60 px-5 text-sm font-semibold text-foreground backdrop-blur-md transition hover:bg-card/80"
                  >
                    See how it works
                  </button>
                  <Link
                    // Signed-in users go straight to the Telegram connect flow;
                    // signup's callbackURL already sends new users there too, so
                    // this used to hard-code /signup and re-prompt already
                    // logged-in users to sign up all over again.
                    href={session ? "/link" : "/signup"}
                    className="col-span-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card/60 px-5 text-sm font-semibold text-foreground backdrop-blur-md transition hover:bg-card/80"
                  >
                    <ConnectorIcon id="telegram" size={17} />
                    Text Yomi
                  </Link>
                </div>
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.9, delay: 0.6 }}
              className="mt-6 grid gap-3 border-t border-border pt-4 text-sm text-muted-foreground sm:grid-cols-3"
            >
              <span className="flex items-center gap-2">
                <MessageSquare size={15} className="text-primary" />
                Text, voice, or photo
              </span>
              <span className="flex items-center gap-2">
                <Layers size={15} className="text-primary" />
                Works across your apps
              </span>
              <span className="flex items-center gap-2">
                <Shield size={15} className="text-primary" />
                Never stored
              </span>
            </motion.div>
          </div>
        </div>
      </section>
```

- [ ] **Step 2: Verify — typecheck and lint**

```bash
bun run typecheck
bun run lint
```

Expected: both PASS.

- [ ] **Step 3: Verify — visual check**

`bun run dev`, open `http://localhost:3000`. Expected:

- No photograph anywhere in the hero. Warm paper background with a very subtle blue glow and fine dot texture, matching the sections below it (from Task 1).
- Tagline reads "Your **AI companion** for work *and life*." with "AI companion" in the primary blue and "and life" in italic serif.
- Giant "Yomi" wordmark renders in dark ink (not the old pale `#eaf4ff`), no drop-shadow.
- Badge row, CTA buttons, and tag pills all read clearly against the light background (dark text/borders, not the old white-on-transparent treatment).

- [ ] **Step 4: Commit**

```bash
git add apps/landing/src/components/landing/landing-page.tsx
git commit -m "feat(landing): redesign hero — no photo, light paper background, italic accent"
```

---

### Task 3: About section + How-it-works numbered sequence

**Files:**
- Modify: `apps/landing/src/components/landing/landing-page.tsx`

**Interfaces:**
- Consumes: `ConnectorIcon` (already imported), `motion` (already imported).
- Produces: new `STEPS` const (module scope) replacing the removed `InteractionCard` component + its three call sites. No exports change.

- [ ] **Step 1: Remove the `InteractionCard` component**

Delete the entire `InteractionCard` function, currently lines 129–161:

```tsx
function InteractionCard({
  type,
  mode,
  label,
  description,
}: {
  type: string
  mode: string
  label: string
  description: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5 }}
      className="flex flex-col gap-3 rounded-2xl glass-card p-5"
    >
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
          {type}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ConnectorIcon id="telegram" size={14} />
          {mode}
        </span>
      </div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </motion.div>
  )
}
```

Delete it entirely (including the blank line before `export function LandingPage()`).

- [ ] **Step 2: Add a `STEPS` const**

Add this new const directly after the `CONNECTORS` array (after its closing `]`, before `const PLANS = [`):

```tsx
const STEPS = [
  {
    mode: "Text",
    label: "Type a message",
    description:
      "Send a plain message on Telegram — 'summarize my unread email' or 'what's on my calendar tomorrow?' Yomi replies fast, pulling context from your connected apps.",
  },
  {
    mode: "Voice",
    label: "Send a voice note",
    description:
      "Tap and hold to record. Yomi transcribes your voice note, answers the question, and can reply with spoken audio when you're on the go.",
  },
  {
    mode: "Photo",
    label: "Snap a photo",
    description:
      "Send a picture — a receipt, a whiteboard, a screenshot. Yomi reads what's in the image and acts on it across your apps.",
  },
]
```

- [ ] **Step 3: Add `ChevronRight` to the lucide-react import**

Find the import block at the top of the file:

```tsx
import {
  ArrowRight,
  Check,
  Crown,
  Cuboid,
  Layers,
  Loader2,
  MessageSquare,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react"
```

Replace with (drops `Crown`/`Cuboid`/`Sparkles`, used only by Pricing tier icons removed in Task 4 — leaving them in now would fail lint as unused once Task 4 lands, so drop them here to keep each task's lint clean):

```tsx
import {
  ArrowRight,
  Check,
  ChevronRight,
  Layers,
  Loader2,
  MessageSquare,
  Shield,
  Zap,
} from "lucide-react"
```

- [ ] **Step 4: Replace the About section**

Find the About section, lines 347–369:

```tsx
      {/* ── What is Yomi?────────────────────────────────────────────────── */}
      <section id="about" className="mx-auto max-w-3xl px-6 py-20">
        <div className="mb-8 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            About
          </p>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            What is <span className="italic">Yomi</span>?
          </h2>
        </div>
        <div className="space-y-4 text-center text-sm leading-relaxed text-muted-foreground">
          <p>
            Yomi is an AI productivity assistant that connects to the apps you already use so you
            can query, analyze, and act on your work using natural language, without switching apps
            or copy-pasting context.
          </p>
          <p>
            Ask Yomi to find a file, summarize a document, or pull context from your workspace, all
            from a single interface or via Telegram. Yomi only accesses your data
            when you ask a question, and for no other purpose.
          </p>
        </div>
      </section>
```

Replace with:

```tsx
      {/* ── What is Yomi?────────────────────────────────────────────────── */}
      <section id="about" className="mx-auto max-w-3xl px-6 py-20">
        <h2 className="mb-6 font-accent text-3xl leading-[1.1] tracking-tight text-foreground sm:text-4xl">
          What is Yomi?
        </h2>
        <div className="space-y-4 text-left text-sm leading-relaxed text-muted-foreground">
          <p>
            Yomi is an AI productivity assistant that connects to the apps you already use so you
            can query, analyze, and act on your work using natural language, without switching apps
            or copy-pasting context.
          </p>
          <p>
            Ask Yomi to find a file, summarize a document, or pull context from your workspace, all
            from a single interface or via Telegram. Yomi only accesses your data
            when you ask a question, and for no other purpose.
          </p>
        </div>
      </section>
```

- [ ] **Step 5: Replace the How-it-works section**

Find the How-it-works section (`<section className="mx-auto max-w-5xl px-6 py-24" id="how-it-works">` through its matching `</section>`, originally lines 508–542):

```tsx
      <section className="mx-auto max-w-5xl px-6 py-24" id="how-it-works">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            How it works
          </p>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Three ways to <span className="italic">ask</span>.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Type, talk, or send a photo — all from your Telegram chat. Yomi routes each request
            through the right context and model.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <InteractionCard
            type="A"
            mode="Text"
            label="Type a message"
            description="Send a plain message on Telegram — 'summarize my unread email' or 'what's on my calendar tomorrow?' Yomi replies fast, pulling context from your connected apps."
          />
          <InteractionCard
            type="B"
            mode="Voice"
            label="Send a voice note"
            description="Tap and hold to record. Yomi transcribes your voice note, answers the question, and can reply with spoken audio when you're on the go."
          />
          <InteractionCard
            type="C"
            mode="Photo"
            label="Snap a photo"
            description="Send a picture — a receipt, a whiteboard, a screenshot. Yomi reads what's in the image and acts on it across your apps."
          />
        </div>
      </section>
```

Replace with:

```tsx
      <section className="mx-auto max-w-5xl px-6 py-24" id="how-it-works">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            How it works
          </p>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Three ways to reach Yomi
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Type, talk, or send a photo — all from your Telegram chat. Yomi routes each request
            through the right context and model.
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.mode} className="relative">
              {i > 0 && (
                <ChevronRight
                  size={16}
                  className="absolute -left-6 top-3 hidden text-border sm:block"
                />
              )}
              <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full border border-primary/30 bg-primary/10 font-mono text-sm font-medium text-primary">
                {i + 1}
              </span>
              <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                {step.label}
                <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                  <ConnectorIcon id="telegram" size={12} />
                  {step.mode}
                </span>
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>
      </section>
```

- [ ] **Step 6: Verify — typecheck and lint**

```bash
bun run typecheck
bun run lint
```

Expected: both PASS. If lint fails on unused `Crown`/`Cuboid`/`Sparkles` imports, confirm Step 3 above was applied — the import block should list only `ArrowRight, Check, ChevronRight, Layers, Loader2, MessageSquare, Shield, Zap`.

- [ ] **Step 7: Verify — visual check**

`bun run dev`, open `http://localhost:3000`. Expected:

- About section is left-aligned prose, no eyebrow label, no centered heading block.
- How-it-works shows three numbered steps (1/2/3) side by side on desktop with small chevrons between them, not three separate glass cards.

- [ ] **Step 8: Commit**

```bash
git add apps/landing/src/components/landing/landing-page.tsx
git commit -m "refactor(landing): de-template About and How-it-works sections"
```

---

### Task 4: Features, Connectors, Data-use, Pricing — de-template + de-italicize

**Files:**
- Modify: `apps/landing/src/components/landing/landing-page.tsx`

**Interfaces:**
- Consumes: `FEATURES`, `PLANS` consts (already defined, `PLANS` loses its `icon` field this task).
- Produces: no new exports.

- [ ] **Step 1: Remove `icon` fields from `PLANS`**

In the `PLANS` const, remove the `icon: Sparkles,` / `icon: Crown,` / `icon: Cuboid,` line from each of the three plan objects. For example:

```tsx
  {
    key: "explore",
    name: "Explore",
    priceUsd: 0,
    period: "/ month",
    badge: "Free",
    description: "Try Yomi on Telegram with text, voice, and memory for 30 days. No card needed.",
    features: [
      "25 credits (30-day trial)",
      "Text, voice & photo on Telegram",
      "Durable memory",
      "Unlimited app connectors",
      "Web dashboard",
    ],
    cta: "Get started free",
    popular: false,
  },
```

(Remove `icon: Sparkles,` — was between `popular: false,` and the closing brace. Do the same for the `pro` object, removing `icon: Crown,`, and the `max` object, removing `icon: Cuboid,`.)

- [ ] **Step 2: Replace the Features section**

Find the Features section (`<section id="features" ...>` through its `</section>`, originally lines 544–572):

```tsx
      <section id="features" className="mx-auto max-w-5xl px-6 py-24">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Built to disappear
          </p>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Everything you need, <span className="italic">nothing</span> you don't.
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl glass-card p-6"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <feature.icon size={20} className="text-primary" />
              </div>
              <h3 className="mb-2 font-medium text-foreground">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </section>
```

Replace with:

```tsx
      <section id="features" className="mx-auto max-w-5xl px-6 py-24">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Built to disappear
          </p>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            What Yomi does
          </h2>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl glass-card p-6"
            >
              <h3 className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <feature.icon size={18} className="text-primary" />
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </section>
```

- [ ] **Step 3: De-italicize the Connectors heading**

Find (in the Connectors section, originally around line 580):

```tsx
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Your tools, one <span className="italic">conversation</span> away.
          </h2>
```

Replace with:

```tsx
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Connects to the apps you use
          </h2>
```

- [ ] **Step 4: De-italicize the Data-use heading**

Find (originally around line 617):

```tsx
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            What Yomi accesses, and <span className="italic">why</span>.
          </h2>
```

Replace with:

```tsx
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            What Yomi accesses, and why
          </h2>
```

- [ ] **Step 5: Collapse the "How your data is protected" checklist to prose**

Find the block (originally lines 654–707):

```tsx
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-8 max-w-3xl rounded-2xl glass-card p-6 text-sm text-muted-foreground"
        >
          <p className="mb-3 font-medium text-foreground">How your data is protected</p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 shrink-0 text-primary" />
              Data from integrations is used only to answer your current query and is never stored
              after the request completes.
            </li>
            <li className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 shrink-0 text-primary" />
              OAuth tokens are encrypted at rest using AES-256-GCM and are never shared with third
              parties.
            </li>
            <li className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 shrink-0 text-primary" />
              Yomi&apos;s use of Google API data complies with the{" "}
              <Link
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="text-primary underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </Link>
              , including the Limited Use requirements.
            </li>
            <li className="flex items-start gap-2">
              <Check size={14} className="mt-0.5 shrink-0 text-primary" />
              You can disconnect any integration instantly from your dashboard or from{" "}
              <Link
                href="https://myaccount.google.com/permissions"
                className="text-primary underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Account settings
              </Link>
              .
            </li>
          </ul>
          <p className="mt-4">
            Read our full{" "}
            <Link href="/privacy" className="text-primary underline underline-offset-2">
              Privacy Policy
            </Link>{" "}
            for details on data handling and your rights.
          </p>
        </motion.div>
```

Replace with:

```tsx
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-8 max-w-3xl rounded-2xl glass-card p-6 text-sm leading-relaxed text-muted-foreground"
        >
          <p className="mb-3 font-medium text-foreground">How your data is protected</p>
          <p className="mb-3">
            Data from integrations is used only to answer your current query and is never stored
            after the request completes. OAuth tokens are encrypted at rest using AES-256-GCM and
            are never shared with third parties.
          </p>
          <p className="mb-3">
            Yomi&apos;s use of Google API data complies with the{" "}
            <Link
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="text-primary underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </Link>
            , including the Limited Use requirements. You can disconnect any integration instantly
            from your dashboard or from{" "}
            <Link
              href="https://myaccount.google.com/permissions"
              className="text-primary underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Account settings
            </Link>
            .
          </p>
          <p>
            Read our full{" "}
            <Link href="/privacy" className="text-primary underline underline-offset-2">
              Privacy Policy
            </Link>{" "}
            for details on data handling and your rights.
          </p>
        </motion.div>
```

- [ ] **Step 6: De-italicize the Pricing heading**

Find (originally around line 732):

```tsx
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Simple, <span className="italic">honest</span> pricing.
          </h2>
```

Replace with:

```tsx
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Pricing
          </h2>
```

- [ ] **Step 7: Remove the tier icon from the Pricing card render**

Find (originally around lines 741–773):

```tsx
          {PLANS.map((plan, i) => {
            const Icon = plan.icon
            return (
              <motion.div
```

Replace with:

```tsx
          {PLANS.map((plan, i) => {
            return (
              <motion.div
```

Then find, in the same card's header:

```tsx
                <div className="mb-5">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon size={18} className="text-primary" />
                    <p className="text-sm font-medium text-foreground">{plan.name}</p>
```

Replace with:

```tsx
                <div className="mb-5">
                  <div className="mb-2 flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{plan.name}</p>
```

- [ ] **Step 8: Verify — typecheck and lint**

```bash
bun run typecheck
bun run lint
```

Expected: both PASS.

- [ ] **Step 9: Verify — visual check**

`bun run dev`, open `http://localhost:3000`. Expected:

- Feature cards show the icon inline next to the title, no boxed badge above it.
- Connectors, Data-use, and Pricing headings are plain (no italic word).
- The "How your data is protected" box reads as two short paragraphs, not a checkmark list.
- Pricing cards show no tier icon next to the plan name.

- [ ] **Step 10: Commit**

```bash
git add apps/landing/src/components/landing/landing-page.tsx
git commit -m "refactor(landing): de-template Features/Connectors/Data-use/Pricing, remove italics"
```

---

### Task 5: New light `LandingFooter` (folk-inspired), swap import

**Files:**
- Create: `apps/landing/src/components/landing/LandingFooter.tsx`
- Modify: `apps/landing/src/components/landing/landing-page.tsx` (import + usage only)
- Unchanged: `apps/landing/src/components/Footer.tsx` (still used by `docs`/`terms`/`privacy`/`support` — do not touch)

**Interfaces:**
- Consumes: `BrandMark` from `@/components/BrandMark` (already theme-token-driven, no changes needed there).
- Produces: default export `LandingFooter` (React component, no props) — consumed by `landing-page.tsx`.

- [ ] **Step 1: Create `LandingFooter.tsx`**

```tsx
import Link from "next/link"
import { BrandMark } from "@/components/BrandMark"

const PRODUCT_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Integrations", href: "/#connectors" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Dashboard", href: "/dashboard" },
]

const RESOURCE_LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Docs", href: "/docs" },
  { label: "Support", href: "/support" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "GitHub", href: "https://github.com/arka6fx/yomi", external: true },
]

export default function LandingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative overflow-hidden border-t border-border">
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <BrandMark size="sm" />
            <p className="mt-4 max-w-[22ch] text-sm leading-relaxed text-muted-foreground">
              AI assistant for Gmail, Calendar, Drive, GitHub, Slack, Notion, and more — on
              Telegram.
            </p>
            <p className="mt-4 text-xs text-muted-foreground/70">
              © {year} Yomi. All rights reserved.
            </p>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Product
            </p>
            <ul className="space-y-2.5">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Resources
            </p>
            <ul className="space-y-2.5">
              {RESOURCE_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact / developer info — required for Google OAuth verification.
              Content must not change: product name, developer identity, support
              email, and website link all need to stay present and accurate. */}
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Company
            </p>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground/70">Product</p>
                <p className="text-foreground">Yomi: AI Productivity Assistant</p>
              </div>
              <div>
                <p className="text-muted-foreground/70">Developer</p>
                <p className="text-foreground">Arka Garai</p>
                <p className="text-xs text-muted-foreground/70">Independent software developer</p>
              </div>
              <div>
                <p className="text-muted-foreground/70">Support</p>
                <a
                  href="mailto:contact.arkagarai@gmail.com"
                  className="text-foreground transition-colors hover:text-primary"
                >
                  contact.arkagarai@gmail.com
                </a>
              </div>
              <div>
                <p className="text-muted-foreground/70">Website</p>
                <a
                  href="https://getyomi.in"
                  className="text-foreground transition-colors hover:text-primary"
                >
                  getyomi.in
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* decorative ghost wordmark — non-interactive, no fabricated stat */}
      <p
        aria-hidden="true"
        className="pointer-events-none select-none overflow-hidden whitespace-nowrap pb-4 text-center font-accent text-[18vw] italic leading-none text-foreground/[0.05] sm:text-[14vw]"
      >
        Yomi
      </p>
    </footer>
  )
}
```

Note: this footer intentionally does **not** apply its own `landing-light`/`site-texture-bg-light` classes — it's rendered as the last child inside `LandingPage`'s root div (Task 1), so it already inherits the scoped light CSS variables and sits on the same fixed paper background. No duplicate background layer needed.

- [ ] **Step 2: Swap the import and usage in `landing-page.tsx`**

Find:

```tsx
import Footer from "@/components/Footer"
```

Replace with:

```tsx
import LandingFooter from "@/components/landing/LandingFooter"
```

Find (near the end of the component, currently the last line before the closing `</div>`):

```tsx
      <Footer />
```

Replace with:

```tsx
      <LandingFooter />
```

- [ ] **Step 3: Verify — typecheck and lint**

```bash
bun run typecheck
bun run lint
```

Expected: both PASS.

- [ ] **Step 4: Verify — visual check**

`bun run dev`, open `http://localhost:3000`, scroll to the bottom. Expected:

- Light paper-background footer with 4 columns (Brand, Product, Resources, Company) and a large, very faint "Yomi" wordmark beneath them.
- No stat counter, no "online" status indicator.
- The Company column shows all four required fields: "Yomi: AI Productivity Assistant", "Arka Garai" / "Independent software developer", the `contact.arkagarai@gmail.com` mailto link, and the `getyomi.in` link.

Then separately check `http://localhost:3000/docs`, `/terms`, `/privacy`, `/support` — their footers must be unchanged (still the old dark, single-row, compact footer), confirming `Footer.tsx` was not touched and this new component is landing-only.

- [ ] **Step 5: Commit**

```bash
git add apps/landing/src/components/landing/LandingFooter.tsx apps/landing/src/components/landing/landing-page.tsx
git commit -m "feat(landing): add folk-inspired light footer, landing-only"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

From `apps/landing`:

```bash
bun run typecheck
bun run lint
```

Expected: both PASS.

- [ ] **Step 2: Full manual browser pass on the landing page**

`bun run dev` (or the `run` skill), open `http://localhost:3000` at both a mobile width (~375px) and desktop width (~1440px). Walk the whole page top to bottom and confirm against the design spec (`docs/superpowers/specs/2026-07-23-landing-hero-footer-light-redesign-design.md`):

- Hero: no photo, paper background, italic "and life" accent, dark-ink wordmark, light CTAs/badges/pills.
- About: left-aligned plain prose, no card.
- How it works: numbered 1/2/3 sequence, not cards.
- Features: icon inline with title.
- Connectors: unchanged grid, plain heading.
- Google Sign-In / Data-use: plain headings, prose instead of checklist in the "How your data is protected" box.
- Pricing: plain "Pricing" heading, no tier icons, feature checklists still present.
- Footer: 4-column light layout, ghost wordmark, all 4 required contact fields present, no stat/status indicator.
- Nothing overflows horizontally at either width; all interactive elements (CTA buttons, nav links, footer links) are reachable and legible.

- [ ] **Step 3: Confirm other routes are unaffected**

At the same dev server, open `/dashboard` (if reachable without auth, otherwise skip and note it), `/docs`, `/terms`, `/privacy`, `/support`. Confirm all five still render the original dark theme with the original compact `Footer.tsx` — no light-theme bleed, no layout changes.

- [ ] **Step 4: Update the plan/spec status**

In `docs/superpowers/plans/2026-07-23-landing-hero-footer-light-redesign.md`, nothing further to change. In `docs/superpowers/specs/2026-07-23-landing-hero-footer-light-redesign-design.md`, change the `Status:` line from "Approved (design); pending implementation plan" to "Implemented".

```bash
git add docs/superpowers/specs/2026-07-23-landing-hero-footer-light-redesign-design.md
git commit -m "docs: mark landing light redesign spec as implemented"
```
