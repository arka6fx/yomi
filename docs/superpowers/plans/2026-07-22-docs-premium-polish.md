# Docs Site Premium Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the docs site's hero, section icons, and banners a premium visual treatment, staying within the site's existing restrained aesthetic.

**Architecture:** A new `DocsHero.tsx` client component replaces the docs page's inline hero markup (adds a second gradient layer and an entrance animation). The existing `Eyebrow`/`Section`/`Feature` helper components in `docs/page.tsx` gain a shared `tone` system for per-section icon coloring. The closing CTA and pricing cards get matching visual upgrades (glow, icon boxes, real buttons).

**Tech Stack:** Next.js (App Router), React, Tailwind, lucide-react, framer-motion — `apps/landing`.

## Global Constraints

- Stay within the existing restrained aesthetic — no glassmorphism, no animated backgrounds, no per-section scroll-triggered reveals. Reuse the same radial-gradient-glow technique and `framer-motion` fade/slide-up pattern already used elsewhere in this codebase.
- Do not touch `DocsShell.tsx`, `DocsHeader.tsx`, `DocsSidebar.tsx`, `DocsToc.tsx`, the connector grid's icon wrapper, the Telegram command table, or the privacy checklist layout — none of these were called out and all already work well.
- No automated frontend test, consistent with every UI feature shipped this session.

---

### Task 1: `DocsHero` component

**Files:**
- Create: `apps/landing/src/components/docs/DocsHero.tsx`
- Modify: `apps/landing/src/app/docs/page.tsx`

**Interfaces:**
- Produces: `export function DocsHero()` — a self-contained, no-prop client component. `docs/page.tsx` imports and renders it in place of its inline hero `<header>`.

- [ ] **Step 1: Create `DocsHero.tsx`**

```tsx
"use client"

import { motion } from "framer-motion"
import { Sparkles } from "lucide-react"

export function DocsHero() {
  return (
    <header className="relative overflow-hidden border-b border-border">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 120% at 50% -10%, hsl(var(--primary) / 0.18), transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 80% at 85% 10%, hsl(280 70% 60% / 0.12), transparent 65%)",
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 py-16 text-center sm:py-20">
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary"
        >
          <Sparkles size={11} />
          Documentation
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="mt-5 font-serif text-5xl tracking-tight sm:text-6xl"
        >
          Everything Yomi does, <span className="font-serif italic text-primary">today</span>.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16 }}
          className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground"
        >
          A complete, honest map of what&apos;s shipped: the Telegram bot, every app connector,
          memory, voice, and how plans and credits work.
        </motion.p>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Import `DocsHero` in `docs/page.tsx`**

In `apps/landing/src/app/docs/page.tsx`, find:

```tsx
import { DocsShell } from "@/components/docs/DocsShell"
```

Change to:

```tsx
import { DocsShell } from "@/components/docs/DocsShell"
import { DocsHero } from "@/components/docs/DocsHero"
```

- [ ] **Step 3: Replace the inline hero banner with `<DocsHero />`**

Find:

```tsx
      <DocsShell
        banner={
          <header className="relative overflow-hidden border-b border-border">
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(70% 120% at 50% -10%, hsl(var(--primary) / 0.18), transparent 60%)",
              }}
            />
            <div className="relative mx-auto max-w-5xl px-6 py-16 text-center sm:py-20">
              <Eyebrow>
                <Sparkles size={11} />
                Documentation
              </Eyebrow>
              <h1 className="mt-5 font-serif text-4xl tracking-tight sm:text-5xl">
                Everything Yomi does, <span className="font-serif italic text-primary">today</span>.
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                A complete, honest map of what&apos;s shipped: the Telegram bot, every app
                connector, memory, voice, and how plans and credits work.
              </p>
            </div>
          </header>
        }
      >
```

Change to:

```tsx
      <DocsShell banner={<DocsHero />}>
```

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: both pass. The `Sparkles` import in `docs/page.tsx` stays in use (it's still used by the "Two routing paths" `Feature` at the Web section), so no unused-import error there.

- [ ] **Step 5: Commit**

```bash
git add apps/landing/src/components/docs/DocsHero.tsx apps/landing/src/app/docs/page.tsx
git commit -m "feat(landing): add animated hero to docs site"
```

---

### Task 2: Per-section icon color tinting

**Files:**
- Modify: `apps/landing/src/app/docs/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (independent region of the same file — Task 1 only touched the hero banner JSX and the import block; this task touches the `Eyebrow`/`Section`/`Feature` helper functions below it and 10 `<Section>` call sites).
- Produces: `type Tone`, `TONE_CLASSES`, `Eyebrow({ children, tone?, icon? })`, `Section({ id, eyebrow, title, tone?, icon?, children })`, `Feature({ icon, title, tone?, children })` — all used identically by Task 3 (which also touches `Feature`-free sections, so no direct dependency, but keeps the same `Tone` type available).

- [ ] **Step 1: Add new icon imports**

Find:

```tsx
import {
  Brain,
  Check,
  CircleDot,
  Image as ImageIcon,
  Keyboard,
  Mic,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
```

Change to:

```tsx
import {
  Brain,
  Check,
  CircleDot,
  Globe,
  Image as ImageIcon,
  Keyboard,
  Lock,
  Mic,
  Plug,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
```

- [ ] **Step 2: Add the `Tone` type and `TONE_CLASSES` map**

Find:

```tsx
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
      {children}
    </span>
  )
}
```

Change to:

```tsx
type Tone =
  | "primary"
  | "emerald"
  | "sky"
  | "blue"
  | "violet"
  | "amber"
  | "rose"
  | "teal"
  | "yellow"
  | "cyan"

const TONE_CLASSES: Record<Tone, { badge: string; icon: string }> = {
  primary: { badge: "border-primary/25 bg-primary/10 text-primary", icon: "bg-primary/10 text-primary" },
  emerald: {
    badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    icon: "bg-emerald-500/10 text-emerald-400",
  },
  sky: { badge: "border-sky-500/25 bg-sky-500/10 text-sky-400", icon: "bg-sky-500/10 text-sky-400" },
  blue: { badge: "border-blue-500/25 bg-blue-500/10 text-blue-400", icon: "bg-blue-500/10 text-blue-400" },
  violet: {
    badge: "border-violet-500/25 bg-violet-500/10 text-violet-400",
    icon: "bg-violet-500/10 text-violet-400",
  },
  amber: {
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    icon: "bg-amber-500/10 text-amber-400",
  },
  rose: { badge: "border-rose-500/25 bg-rose-500/10 text-rose-400", icon: "bg-rose-500/10 text-rose-400" },
  teal: { badge: "border-teal-500/25 bg-teal-500/10 text-teal-400", icon: "bg-teal-500/10 text-teal-400" },
  yellow: {
    badge: "border-yellow-500/25 bg-yellow-500/10 text-yellow-400",
    icon: "bg-yellow-500/10 text-yellow-400",
  },
  cyan: { badge: "border-cyan-500/25 bg-cyan-500/10 text-cyan-400", icon: "bg-cyan-500/10 text-cyan-400" },
}

function Eyebrow({
  children,
  tone = "primary",
  icon,
}: {
  children: React.ReactNode
  tone?: Tone
  icon?: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${TONE_CLASSES[tone].badge}`}
    >
      {icon}
      {children}
    </span>
  )
}
```

- [ ] **Step 3: Add `tone`/`icon` passthrough to `Section`**

Find:

```tsx
function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 border-t border-border/60 py-12 first:border-t-0 first:pt-0"
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-serif text-3xl tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  )
}
```

Change to:

```tsx
function Section({
  id,
  eyebrow,
  title,
  tone = "primary",
  icon,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  tone?: Tone
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 border-t border-border/60 py-12 first:border-t-0 first:pt-0"
    >
      <Eyebrow tone={tone} icon={icon}>
        {eyebrow}
      </Eyebrow>
      <h2 className="mt-4 font-serif text-3xl tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Add `tone` to `Feature`**

Find:

```tsx
function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
```

Change to:

```tsx
function Feature({
  icon,
  title,
  tone = "primary",
  children,
}: {
  icon: React.ReactNode
  title: string
  tone?: Tone
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div
        className={`flex size-9 items-center justify-center rounded-lg ${TONE_CLASSES[tone].icon}`}
      >
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}
```

- [ ] **Step 5: Apply tone+icon to the "Getting started" section**

Find:

```tsx
        <Section id="getting-started" eyebrow="Setup" title="Getting started">
```

Change to:

```tsx
        <Section
          id="getting-started"
          eyebrow="Setup"
          title="Getting started"
          tone="emerald"
          icon={<Rocket size={11} />}
        >
```

- [ ] **Step 6: Apply tone+icon to the "Web" section, and tone to its `Feature` cards**

Find:

```tsx
        <Section id="web" eyebrow="Web" title="The web app">
          <p>
            Open Yomi in your browser from the dashboard. It connects to your apps and can read
            documents, search email, and act across your connected tools. Voice and vision work
            through your browser too.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<ImageIcon size={17} />} title="Image analysis">
              Upload a screenshot or photo and get grounded answers in context.
            </Feature>
            <Feature icon={<Keyboard size={17} />} title="Voice & text">
              Type or speak your question. A fast path replies in about two seconds.
            </Feature>
            <Feature icon={<ShieldCheck size={17} />} title="Visible actions">
              Actions that send or change things pause for your approval first.
            </Feature>
            <Feature icon={<Sparkles size={17} />} title="Two routing paths">
              Simple questions take the quick path; anything needing your apps runs the full agent.
            </Feature>
          </div>
        </Section>
```

Change to:

```tsx
        <Section id="web" eyebrow="Web" title="The web app" tone="sky" icon={<Globe size={11} />}>
          <p>
            Open Yomi in your browser from the dashboard. It connects to your apps and can read
            documents, search email, and act across your connected tools. Voice and vision work
            through your browser too.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<ImageIcon size={17} />} title="Image analysis" tone="sky">
              Upload a screenshot or photo and get grounded answers in context.
            </Feature>
            <Feature icon={<Keyboard size={17} />} title="Voice & text" tone="sky">
              Type or speak your question. A fast path replies in about two seconds.
            </Feature>
            <Feature icon={<ShieldCheck size={17} />} title="Visible actions" tone="sky">
              Actions that send or change things pause for your approval first.
            </Feature>
            <Feature icon={<Sparkles size={17} />} title="Two routing paths" tone="sky">
              Simple questions take the quick path; anything needing your apps runs the full agent.
            </Feature>
          </div>
        </Section>
```

- [ ] **Step 7: Apply tone+icon to the "Telegram" section**

Find:

```tsx
        <Section id="telegram" eyebrow="Messaging" title="Telegram bot">
```

Change to:

```tsx
        <Section
          id="telegram"
          eyebrow="Messaging"
          title="Telegram bot"
          tone="blue"
          icon={<Send size={11} />}
        >
```

- [ ] **Step 8: Apply tone+icon to the "Connectors" section**

Find:

```tsx
        <Section id="connectors" eyebrow="Integrations" title="App connectors">
```

Change to:

```tsx
        <Section
          id="connectors"
          eyebrow="Integrations"
          title="App connectors"
          tone="violet"
          icon={<Plug size={11} />}
        >
```

- [ ] **Step 9: Apply tone+icon to the "Memory" section, and tone to its `Feature` cards**

Find:

```tsx
        <Section id="memory" eyebrow="Context" title="Memory & knowledge">
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<Brain size={17} />} title="Long-term memory">
              Yomi remembers durable facts about you and your projects, so it doesn&apos;t ask the
              same thing twice. Starting a new chat clears the conversation, never your memory.
            </Feature>
            <Feature icon={<CircleDot size={17} />} title="Your documents (RAG)">
              Synced documents become searchable context, so answers can draw on your own material.
            </Feature>
          </div>
        </Section>
```

Change to:

```tsx
        <Section
          id="memory"
          eyebrow="Context"
          title="Memory & knowledge"
          tone="amber"
          icon={<Brain size={11} />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<Brain size={17} />} title="Long-term memory" tone="amber">
              Yomi remembers durable facts about you and your projects, so it doesn&apos;t ask the
              same thing twice. Starting a new chat clears the conversation, never your memory.
            </Feature>
            <Feature icon={<CircleDot size={17} />} title="Your documents (RAG)" tone="amber">
              Synced documents become searchable context, so answers can draw on your own material.
            </Feature>
          </div>
        </Section>
```

- [ ] **Step 10: Apply tone+icon to the "Voice & vision" section, and tone to its `Feature` cards**

Find:

```tsx
        <Section id="voice-vision" eyebrow="Multimodal" title="Voice & vision">
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<Mic size={17} />} title="Speak and listen">
              Voice notes are transcribed, and Yomi can reply with a spoken voice message when you
              ask.
            </Feature>
            <Feature icon={<ImageIcon size={17} />} title="Image analysis">
              Send a screenshot or photo and Yomi describes, reads, or reasons about what&apos;s in
              it.
            </Feature>
          </div>
        </Section>
```

Change to:

```tsx
        <Section
          id="voice-vision"
          eyebrow="Multimodal"
          title="Voice & vision"
          tone="rose"
          icon={<Mic size={11} />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<Mic size={17} />} title="Speak and listen" tone="rose">
              Voice notes are transcribed, and Yomi can reply with a spoken voice message when you
              ask.
            </Feature>
            <Feature icon={<ImageIcon size={17} />} title="Image analysis" tone="rose">
              Send a screenshot or photo and Yomi describes, reads, or reasons about what&apos;s in
              it.
            </Feature>
          </div>
        </Section>
```

- [ ] **Step 11: Apply tone+icon to the "Approvals" section**

Find:

```tsx
        <Section id="approvals" eyebrow="Control" title="Approvals & safety">
```

Change to:

```tsx
        <Section
          id="approvals"
          eyebrow="Control"
          title="Approvals & safety"
          tone="teal"
          icon={<ShieldCheck size={11} />}
        >
```

- [ ] **Step 12: Apply tone+icon to the "Plans & credits" section**

Find:

```tsx
        <Section id="plans" eyebrow="Billing" title="Plans & credits">
```

Change to:

```tsx
        <Section
          id="plans"
          eyebrow="Billing"
          title="Plans & credits"
          tone="yellow"
          icon={<Sparkles size={11} />}
        >
```

- [ ] **Step 13: Apply tone+icon to the "Privacy" section**

Find:

```tsx
        <Section id="privacy" eyebrow="Trust" title="Privacy">
```

Change to:

```tsx
        <Section
          id="privacy"
          eyebrow="Trust"
          title="Privacy"
          tone="cyan"
          icon={<Lock size={11} />}
        >
```

- [ ] **Step 14: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: both pass. The "Overview" section (`id="overview"`) is intentionally left untouched — it keeps the default `tone="primary"` and no icon, per the spec's table.

- [ ] **Step 15: Commit**

```bash
git add apps/landing/src/app/docs/page.tsx
git commit -m "feat(landing): color-code docs section icons by topic"
```

---

### Task 3: Banner upgrades — closing CTA and pricing cards

**Files:**
- Modify: `apps/landing/src/app/docs/page.tsx`

**Interfaces:**
- Consumes: nothing new from Tasks 1–2 (a separate, non-overlapping region of the same file — the closing CTA block and the "Plans & credits" pricing grid, which Task 2 did not touch beyond the `<Section>` wrapper tag itself).

- [ ] **Step 1: Add `Crown` and `Cuboid` icon imports**

Find:

```tsx
import {
  Brain,
  Check,
  CircleDot,
  Globe,
  Image as ImageIcon,
  Keyboard,
  Lock,
  Mic,
  Plug,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
```

Change to:

```tsx
import {
  Brain,
  Check,
  CircleDot,
  Crown,
  Cuboid,
  Globe,
  Image as ImageIcon,
  Keyboard,
  Lock,
  Mic,
  Plug,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
```

- [ ] **Step 2: Add plan icons and a glow to the featured card in the pricing grid**

Find:

```tsx
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                name: "Explore",
                price: "Free",
                credits: "25 credits",
                note: "30-day trial to try everything.",
              },
              {
                name: "Pro",
                price: "$14.99/mo",
                credits: "2,500 credits",
                note: "Higher limits + credit packs.",
                featured: true,
              },
              {
                name: "Max",
                price: "$39.99/mo",
                credits: "10,000 credits",
                note: "Highest limits for heavy use.",
              },
            ].map((p) => (
              <div
                key={p.name}
                className={
                  p.featured
                    ? "rounded-2xl border border-primary/40 bg-primary/5 p-5"
                    : "rounded-2xl border border-border bg-card/60 p-5"
                }
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-foreground">{p.name}</span>
                  <span className="text-sm text-muted-foreground">{p.price}</span>
                </div>
                <p className="mt-2 font-serif text-xl text-foreground">{p.credits}</p>
                <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>
              </div>
            ))}
          </div>
```

Change to:

```tsx
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                name: "Explore",
                price: "Free",
                credits: "25 credits",
                note: "30-day trial to try everything.",
                icon: Sparkles,
              },
              {
                name: "Pro",
                price: "$14.99/mo",
                credits: "2,500 credits",
                note: "Higher limits + credit packs.",
                icon: Crown,
                featured: true,
              },
              {
                name: "Max",
                price: "$39.99/mo",
                credits: "10,000 credits",
                note: "Highest limits for heavy use.",
                icon: Cuboid,
              },
            ].map((p) => (
              <div
                key={p.name}
                className={
                  p.featured
                    ? "rounded-2xl border border-primary/40 bg-primary/5 p-5 shadow-lg shadow-primary/10"
                    : "rounded-2xl border border-border bg-card/60 p-5"
                }
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <p.icon size={15} className="text-primary" />
                    {p.name}
                  </span>
                  <span className="text-sm text-muted-foreground">{p.price}</span>
                </div>
                <p className="mt-2 font-serif text-xl text-foreground">{p.credits}</p>
                <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>
              </div>
            ))}
          </div>
```

- [ ] **Step 3: Upgrade the closing CTA banner**

Find:

```tsx
        <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/60 p-6">
          <Send size={18} className="text-primary" />
          <p className="text-sm text-muted-foreground">
            Ready to try it?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Create your account
            </Link>{" "}
            or{" "}
            <Link href="/dashboard" className="font-medium text-primary hover:underline">
              open the dashboard
            </Link>
            .
          </p>
        </div>
```

Change to:

```tsx
        <div className="relative mt-12 overflow-hidden rounded-2xl border border-primary/20 bg-card/60 p-6 sm:p-8">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 140% at 15% 0%, hsl(var(--primary) / 0.14), transparent 60%)",
            }}
          />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Send size={18} />
              </div>
              <p className="text-sm text-muted-foreground">
                Ready to try it? Create your account or open the dashboard to get started.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                Open the dashboard
              </Link>
              <Link
                href="/signup"
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Create your account
              </Link>
            </div>
          </div>
        </div>
```

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/landing && bun run typecheck && bun run lint`
Expected: both pass. `<p.icon size={15} className="text-primary" />` is a valid JSX member-expression component reference (React/JSX supports dotted component tags regardless of the base identifier's casing) — `tsc`/`eslint` should raise no error here.

- [ ] **Step 5: Commit**

```bash
git add apps/landing/src/app/docs/page.tsx
git commit -m "feat(landing): upgrade docs closing CTA and pricing cards"
```

---

### Task 4: Whole-monorepo verification and visual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Run full monorepo typecheck, lint, and test**

Run (from repo root): `bun run typecheck && bun run lint && bun run test`
Expected: all pass. Frontend-only change, no backend code touched.

- [ ] **Step 2: Visually verify `/docs` in a browser**

Unlike every other UI feature shipped this session, `/docs` does not require
authentication — `DocsHeader` only reads the session to choose a link label,
it doesn't gate rendering. Start the dev server (`bun run dev`) and use the
playwright MCP tools (`mcp__playwright__browser_navigate` to
`http://localhost:3000/docs`, then `mcp__playwright__browser_take_screenshot`
and/or `mcp__playwright__browser_snapshot`) to confirm:

- The hero renders with the bigger headline and layered glow, and the
  eyebrow/headline/subtext appear (the entrance animation will have already
  completed by the time the snapshot is taken — that's expected, just confirm
  the content is present and styled).
- Section eyebrow badges show distinct colors/icons scrolling down through
  Getting Started (emerald/Rocket), Web (sky/Globe), Telegram (blue/Send),
  Connectors (violet/Plug), Memory (amber/Brain), Voice & vision (rose/Mic),
  Approvals (teal/ShieldCheck), Plans & credits (yellow/Sparkles), Privacy
  (cyan/Lock).
- The Web/Memory/Voice & vision `Feature` card icon boxes are tinted to match
  their section.
- The pricing cards show plan icons (Sparkles/Crown/Cuboid) and the Pro card
  has a visible shadow/glow.
- The closing CTA shows the tinted icon box and two real buttons.

If the dev server or browser tooling is unavailable in this environment,
report that explicitly rather than fabricating a "verified" result.

- [ ] **Step 3: Report status**

Summarize: tests/typecheck/lint pass/fail, and what the visual walkthrough
confirmed (or why it couldn't be completed).
