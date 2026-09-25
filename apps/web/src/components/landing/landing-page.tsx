// Deliberately NOT "use client". This page is almost entirely static marketing copy, but it
// used to be one big client component, so all of it hydrated and it pulled framer-motion in
// with it — measured at ~2.5s of LCP and every bit of the page's TBT. The three things that
// genuinely need the browser are client islands (ChatDemo, PlanButton,
// OauthErrorRedirect) and the entrance animations are now CSS.
import Link from "next/link"
import { Check, ChevronRight, Layers, MessageSquare, Shield } from "lucide-react"
import { formatUsd } from "@/lib/local-price"

import LandingFooter from "@/components/landing/LandingFooter"
import { ChatDemo } from "@/components/landing/ChatDemo"
import { OauthErrorRedirect } from "@/components/landing/OauthErrorRedirect"
import { PlanButton } from "@/components/landing/PlanButton"
import Nav from "@/components/Nav"
// Deliberately the /icons subpath, not the package root. The root barrel also re-exports
// three "use client" components, so importing anything from it makes those client entry
// points and ships all ~50 connector SVGs (116 KiB) to the browser for a server-only page.
import { ConnectorIcon } from "@yomi/ui/icons"

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Text, voice, or photo",
    description:
      "Message Yomi on Telegram however you like. Type a question, send a voice note, or snap a photo. It understands all three.",
  },
  {
    icon: Layers,
    title: "Works across your apps",
    description:
      "Connect Gmail, Calendar, Drive, GitHub, Slack, Notion, and more once. Then just ask, and Yomi acts across them for you.",
  },
  {
    icon: Shield,
    title: "Private by default",
    description:
      "Your data is read only to answer the question you just asked, and never stored afterward. Every change is shown for approval first.",
  },
]

const CONNECTORS: { id: string; name: string; description: string }[] = [
  { id: "google", name: "Gmail", description: "Read, send, and organize email" },
  { id: "google-calendar", name: "Google Calendar", description: "Create and manage events" },
  { id: "google-drive", name: "Google Drive", description: "Find, read, and edit files" },
  { id: "google-docs", name: "Google Docs", description: "Create and edit docs from Markdown" },
  { id: "google-sheets", name: "Google Sheets", description: "Read, edit, and chart spreadsheets" },
  { id: "google-slides", name: "Google Slides", description: "Build decks from Markdown" },
  {
    id: "google-classroom",
    name: "Google Classroom",
    description: "Assignments, due dates, grades",
  },
  { id: "google-tasks", name: "Google Tasks", description: "Capture and complete to-dos" },
  { id: "google-meet", name: "Google Meet", description: "Create links, recap past calls" },
  { id: "google-maps", name: "Google Maps", description: "Search for places near a location" },
  { id: "github", name: "GitHub", description: "Repos, issues, and pull requests" },
  { id: "notion", name: "Notion", description: "Search pages and databases" },
  { id: "slack", name: "Slack", description: "Read context, send approved messages" },
  { id: "linear", name: "Linear", description: "Issues and project tracking" },
]

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

const PLANS = [
  {
    key: "explore",
    name: "Explore",
    priceUsd: 0,
    period: "/ month",
    badge: "Free forever",
    description: "Text, voice, and memory on Telegram, free every month. No card needed.",
    features: [
      "100 credits every month",
      "Text, voice & photo on Telegram",
      "Durable memory",
      "Unlimited app connectors",
      "Web dashboard",
    ],
    cta: "Get started free",
    popular: false,
  },
  {
    key: "pro",
    name: "Pro",
    priceUsd: 5,
    period: "/ month",
    badge: "Most Popular",
    description: "Text, voice, photos, and memory for everyday work.",
    features: [
      "300 credits / month",
      "Buy extra credit packs anytime",
      "Text, voice, photos & memory",
      "Unlimited app connectors",
      "Web dashboard",
    ],
    cta: "Subscribe",
    popular: true,
  },
  {
    key: "max",
    name: "Max",
    priceUsd: 40,
    period: "/ month",
    badge: "Power users",
    description: "High-volume credits for power users.",
    features: [
      "Everything in Pro",
      "750 credits / month",
      "Buy extra credit packs anytime",
      "Unlimited app connectors",
      "Experimental features first",
    ],
    cta: "Subscribe",
    popular: false,
  },
]

export function LandingPage() {
  return (
    <div className="landing-light site-texture-bg-light min-h-screen text-foreground">
      <OauthErrorRedirect />
      {/* persistent sticky nav, floats above the hero */}
      <Nav />

      <main>
        <section
          id="hero"
          style={{ marginTop: "-74px" }}
          className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 pb-8 pt-32"
        >
          {/* Dusk sky and layered ridgelines, drawn in CSS/SVG so it costs no image bytes. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(90% 60% at 50% 100%, rgba(255,190,150,0.55), transparent 70%)," +
                "linear-gradient(180deg, #5b7fc7 0%, #9aa7e0 30%, #f0b7a4 62%, #f7cfae 78%, #3a3f5c 100%)",
            }}
          />
          <svg
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-[55%] w-full"
            viewBox="0 0 1440 500"
            preserveAspectRatio="none"
          >
            <path
              d="M0 260 L180 150 L330 240 L520 90 L700 230 L880 120 L1060 250 L1250 140 L1440 220 V500 H0Z"
              fill="#6d6f93"
              opacity="0.55"
            />
            <path
              d="M0 330 L150 250 L300 320 L470 210 L640 330 L820 230 L1000 340 L1180 250 L1440 320 V500 H0Z"
              fill="#474a6e"
              opacity="0.8"
            />
            <path
              d="M0 410 L200 340 L380 400 L560 330 L760 420 L960 350 L1160 420 L1440 360 V500 H0Z"
              fill="#2a2c45"
            />
          </svg>

          <h1 className="sr-only">Yomi — AI productivity assistant on Telegram</h1>
          <div className="relative z-10">
            <ChatDemo />
          </div>
          <a
            href="#about"
            className="relative z-10 mt-6 rounded-full bg-white/15 px-4 py-2 text-xs font-medium text-white backdrop-blur-md hover:bg-white/25"
          >
            what can yomi do? ↓
          </a>
        </section>

        {/* ── What is Yomi?────────────────────────────────────────────────── */}
        <section id="about" className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="mb-6 font-accent text-3xl leading-[1.1] tracking-tight text-foreground sm:text-4xl">
            What is Yomi?
          </h2>
          <div className="space-y-4 text-left text-sm leading-relaxed text-muted-foreground">
            <p>
              Yomi is an AI productivity assistant that connects to the apps you already use so you
              can query, analyze, and act on your work using natural language, without switching
              apps or copy-pasting context.
            </p>
            <p>
              Ask Yomi to find a file, summarize a document, or pull context from your workspace,
              all from a single interface or via Telegram. Yomi only accesses your data when you ask
              a question, and for no other purpose.
            </p>
          </div>
        </section>

        {/* ── How Yomi Uses Google Data ─────────────────────────────────────── */}
        <section id="google-data" className="mx-auto max-w-3xl px-6 py-10">
          <div className="mb-8 text-center">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Google Sign-In &amp; Data Policy
            </p>
            <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Why Yomi Needs Google Sign-In
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Yomi uses Google Sign-In to authenticate your identity and to request permission to
              access your Drive data. Below you will find exactly why sign-in is required and how
              your data is handled.
            </p>
          </div>
          <div className="space-y-4">
            {/* Purpose banner */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 px-6 py-4 text-sm text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">App purpose</p>
              <p>
                Yomi is a personal AI assistant. It accesses your Google Drive, with your explicit
                permission, to answer questions you ask in natural language. For example:
                &ldquo;Find the Q3 report in my Drive.&rdquo; or &ldquo;What does the product spec
                say about pricing?&rdquo; Yomi reads data on-demand per request and never stores it.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Yomi&apos;s use of Google API data complies with the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-muted-foreground"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
            </div>

            {/* Why Google Sign-In is required */}
            <div className="rounded-2xl border border-sky-500/15 bg-sky-500/5 p-6 text-sm text-muted-foreground">
              <p className="mb-4 font-medium text-foreground">Why Google Sign-In is required</p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary">
                    1
                  </div>
                  <div>
                    <p className="font-medium text-foreground">To verify your identity</p>
                    <p className="mt-0.5">
                      Yomi uses Google&apos;s authentication system to confirm who you are, so it
                      can securely associate your connected apps, settings, and preferences with
                      your account. Anonymous access is not possible because Yomi operates on your
                      personal file data, so it cannot function without knowing which Google account
                      to query.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary">
                    2
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      To request permission to access your Drive
                    </p>
                    <p className="mt-0.5">
                      Google&apos;s OAuth consent screen lets you choose exactly which services Yomi
                      may access. Yomi cannot retrieve your Drive files without your explicit
                      authorization. Each permission is granted individually and can be revoked at
                      any time from your Yomi dashboard or from{" "}
                      <a
                        href="https://myaccount.google.com/permissions"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        Google Account settings
                      </a>
                      .
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary">
                    3
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      Your data is never stored, sold, or shared
                    </p>
                    <p className="mt-0.5">
                      When you ask a question, Yomi fetches only the data needed to answer it and
                      discards it immediately after responding. No Drive files are retained on
                      Yomi&apos;s servers between requests. Your Google data is never sold, never
                      used to train AI models, and is not shared with third parties except the
                      providers required to deliver the features you use: our AI inference provider,
                      and — for connected apps routed through Composio — Composio, which manages
                      those integrations on our behalf.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl glass-card p-6 text-sm text-muted-foreground">
              <p className="mb-4">
                Yomi only accesses Google data after you explicitly authorize access through
                Google&apos;s OAuth consent flow. You may revoke access at any time.
              </p>
              <p className="mb-4 font-medium text-foreground">
                Depending on the integrations you enable, Yomi may request:
              </p>
              <ul className="mb-4 space-y-4">
                <li className="flex items-start gap-3">
                  <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                  <div>
                    <p className="font-medium text-foreground">Google Drive</p>
                    <p className="mt-0.5">
                      <span className="font-mono text-xs text-muted-foreground/90">drive.file</span>
                    </p>
                    <p className="mt-1">
                      <strong className="text-foreground/80">Purpose:</strong> To search, read, and
                      navigate files you choose to share with Yomi. For example: &ldquo;Find the Q3
                      budget spreadsheet&rdquo; or &ldquo;What does the product spec say about
                      pricing?&rdquo;
                    </p>
                  </div>
                </li>
              </ul>
              <p>
                Yomi does not sell user data. Google API data is used only to respond to your
                current request and is discarded immediately after.
              </p>
            </div>
          </div>
        </section>

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
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-2xl glass-card p-6">
                <h3 className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <feature.icon size={18} className="text-primary" />
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Supported Integrations ───────────────────────────────────────────── */}
        <section id="connectors" className="mx-auto max-w-5xl px-6 py-24">
          <div className="mb-14 text-center">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Supported Integrations
            </p>
            <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Connects to the apps you use
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Connect your apps once. Ask Yomi from the web or from Telegram, even with your laptop
              closed.
            </p>
          </div>

          <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {CONNECTORS.map((c) => (
              <div key={c.id} className="flex items-start gap-3 rounded-2xl glass-card p-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-neutral-900 ring-1 ring-inset ring-black/5">
                  <ConnectorIcon id={c.id} size={28} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{c.name}</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {c.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Data & Integrations transparency ─────────────────────────────── */}
        <section id="data-use" className="mx-auto max-w-5xl px-6 py-24">
          <div className="mb-14 text-center">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Transparency
            </p>
            <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              What Yomi accesses, and why
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Yomi only reads data when you ask a question. Nothing is stored between queries. You
              can revoke any integration at any time.
            </p>
          </div>

          <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl glass-card">
            {[
              {
                provider: "Google Drive",
                scopes: "drive.file",
                why: "To list and read files you choose to share with Yomi, so you can ask questions about their content.",
              },
              {
                provider: "Notion",
                scopes: "Public integration",
                why: "To search pages, read content, and create or update pages and database entries.",
              },
            ].map((row, i) => (
              <div
                key={row.provider}
                className={`flex flex-col gap-1 px-6 py-4 text-sm sm:flex-row sm:gap-4 ${
                  i < 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="w-44 shrink-0 font-medium text-foreground">{row.provider}</div>
                <div className="flex flex-1 flex-col gap-1">
                  <p className="font-mono text-xs text-muted-foreground/90">{row.scopes}</p>
                  <p className="text-muted-foreground">{row.why}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mx-auto mt-8 max-w-3xl rounded-2xl glass-card p-6 text-sm leading-relaxed text-muted-foreground">
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
          </div>

          {/* Privacy & Security CTA */}
          <div className="mx-auto mt-8 flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/privacy"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
            >
              <Shield size={14} />
              View Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
            >
              View Terms of Service
            </Link>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-5xl px-6 py-24">
          <div className="mb-14 text-center">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Pricing
            </p>
            <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              Pricing
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Start free. Upgrade when you outgrow it.
            </p>
          </div>

          <div className="mx-auto grid max-w-4xl gap-5 sm:grid-cols-3">
            {PLANS.map((plan) => {
              return (
                <div
                  key={plan.name}
                  className={`relative flex flex-col rounded-2xl glass-card p-6 ${
                    plan.popular
                      ? "border-primary shadow-[0_0_40px_-12px_hsl(var(--primary)/0.4)]"
                      : ""
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                      <span className="whitespace-nowrap rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                        {plan.badge}
                      </span>
                    </div>
                  )}

                  <div className="mb-5">
                    <div className="mb-2 flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{plan.name}</p>
                      {!plan.popular && plan.badge && (
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <div className="mb-2 flex items-baseline gap-1">
                      <span className="font-accent text-4xl text-foreground">
                        {formatUsd(plan.priceUsd)}
                      </span>
                      <span className="text-sm text-muted-foreground">{plan.period}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  </div>

                  <ul className="mb-8 flex-1 space-y-2.5">
                    {plan.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2.5 text-sm text-muted-foreground"
                      >
                        <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <PlanButton planKey={plan.key} label={plan.cta} popular={plan.popular} />
                </div>
              )
            })}
          </div>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            * Credits are a simple usage balance. Explore is free every month, forever; Pro and Max
            can buy extra credit packs.
          </p>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}
