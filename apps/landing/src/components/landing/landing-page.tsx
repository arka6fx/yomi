"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowRight,
  Check,
  Crown,
  Cuboid,
  Download,
  Loader2,
  Mic,
  Monitor,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { useLocalPrice } from "@/lib/local-price"

import Footer from "@/components/Footer"
import Nav from "@/components/Nav"
import { ConnectorIcon } from "@yomi/ui-connectors"

type Platform = "mac" | "windows" | "unknown"

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("mac")) return "mac"
  if (ua.includes("win")) return "windows"
  return "unknown"
}

interface DownloadOption {
  label: string
  arch: string
  href: string
  note?: string
  disabled?: boolean
}

const platforms: Record<
  Exclude<Platform, "unknown">,
  {
    title: string
    icon: string
    options: DownloadOption[]
    instructions: string[]
    comingSoon?: boolean
  }
> = {
  mac: {
    title: "macOS",
    icon: "⌘",
    comingSoon: true,
    options: [
      {
        label: "macOS app",
        arch: "Soon",
        href: "#",
        note: "Coming soon",
        disabled: true,
      },
    ],
    instructions: [
      "macOS support is planned for a later release",
      "Use the Windows installer today",
      "Join early access to hear when macOS builds are available",
    ],
  },
  windows: {
    title: "Windows",
    icon: "⊞",
    options: [],
    instructions: [
      "Run the installer and follow the prompts",
      "Yomi will start automatically after install",
      "Find the Yomi icon in your system tray",
      "Grant microphone and screen permissions when prompted",
      "Press Ctrl+Space to start voice, or Ctrl+Enter to type",
    ],
  },
}

const allPlatforms: Exclude<Platform, "unknown">[] = ["mac", "windows"]

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })
}

const FEATURES = [
  {
    icon: Monitor,
    title: "Sees your screen",
    description:
      "Yomi captures context from whatever you're looking at. No copy-pasting, no describing. It just knows.",
  },
  {
    icon: Mic,
    title: "Hears your voice",
    description:
      "Push to talk or always-on VAD. Sub-2-second response on the fast path. Ask anything, anytime.",
  },
  {
    icon: Shield,
    title: "Private by default",
    description:
      "Screenshots are used only for your query and never stored by Yomi. No background recording, no silent capture.",
  },
]

const CONNECTORS: { id: string; name: string; description: string }[] = [
  { id: "google", name: "Gmail", description: "Read, send, and organize email" },
  { id: "google-calendar", name: "Google Calendar", description: "Create and manage events" },
  { id: "google-drive", name: "Google Drive", description: "Find, read, and edit files" },
  {
    id: "google-classroom",
    name: "Google Classroom",
    description: "Assignments, due dates, grades",
  },
  { id: "google-tasks", name: "Google Tasks", description: "Capture and complete to-dos" },
  { id: "google-contacts", name: "Google Contacts", description: "Look people up by name" },
  { id: "google-meet", name: "Google Meet", description: "Create links, recap past calls" },
  { id: "github", name: "GitHub", description: "Repos, issues, and pull requests" },
  { id: "notion", name: "Notion", description: "Search pages and databases" },
  { id: "slack", name: "Slack", description: "Read context, send approved messages" },
  { id: "linear", name: "Linear", description: "Issues and project tracking" },
]

const PLANS = [
  {
    key: "explore",
    name: "Explore",
    priceUsd: 0,
    period: "/ month",
    badge: "Free",
    description: "Try screen-aware AI, voice, and memory for 30 days. No card needed.",
    features: [
      "25 credits (30-day trial)",
      "Screen-aware AI & voice",
      "Image/screen analyze",
      "Local memory notepad",
      "Unlimited app connectors",
      "Telegram bot",
    ],
    cta: "Get started free",
    popular: false,
    icon: Sparkles,
  },
  {
    key: "pro",
    name: "Pro",
    priceUsd: 14.99,
    period: "/ month",
    badge: "Most Popular",
    description: "Screen, voice, memory, and images for everyday work.",
    features: [
      "2,500 credits / month",
      "Buy extra credit packs anytime",
      "Screen, voice, memory & images",
      "Unlimited app connectors",
      "Telegram bot",
    ],
    cta: "Subscribe",
    popular: true,
    icon: Crown,
  },
  {
    key: "max",
    name: "Max",
    priceUsd: 39.99,
    period: "/ month",
    badge: "Power users",
    description: "High-volume credits for power users.",
    features: [
      "Everything in Pro",
      "10,000 credits / month",
      "Buy extra credit packs anytime",
      "Unlimited app connectors",
      "Experimental features first",
    ],
    cta: "Subscribe",
    popular: false,
    icon: Cuboid,
  },
]

function Keys({ keys }: { keys: { sym: string; label: string }[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map(({ sym, label }, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <kbd className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            <span>{sym}</span>
            <span className="font-sans text-muted-foreground">{label}</span>
          </kbd>
          {i < keys.length - 1 && <span className="text-xs text-muted-foreground">+</span>}
        </span>
      ))}
    </span>
  )
}

function InteractionCard({
  type,
  hotkey,
  label,
  description,
}: {
  type: string
  hotkey: { sym: string; label: string }[]
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
          Type {type}
        </span>
        <Keys keys={hotkey} />
      </div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </motion.div>
  )
}

function WindowsMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 2.25 7.25 1.5v6H1.5v-5.25ZM8.75 1.3l5.75-.8v7H8.75v-6.2ZM1.5 8.5h5.75v6L1.5 13.7V8.5ZM8.75 8.5h5.75v7l-5.75-.8V8.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function LandingPage() {
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const { data: session } = authClient.useSession()
  const router = useRouter()
  const localPrice = useLocalPrice()
  const [detected, setDetected] = useState<Platform>("unknown")
  const [active, setActive] = useState<Exclude<Platform, "unknown">>("windows")
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  useEffect(() => {
    const p = detectPlatform()
    setDetected(p)
    if (p === "windows") setActive(p)
  }, [])

  // Download URL fetch removed — desktop app no longer distributed.

  // forward oauth error redirects (/?error=) to the signin page
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error")
    if (code) router.replace(`/signin?error=${encodeURIComponent(code)}`)
  }, [router])

  const current = platforms[active]
  const heroDownloadLabel = "Get for Windows"

  async function handlePlanClick(planKey: string) {
    if (planKey === "explore") {
      router.push(session ? "/dashboard" : "/signup")
      return
    }
    if (!session) {
      router.push(`/signup?plan=${planKey}`)
      return
    }
    setBillingLoading(planKey)
    try {
      const res = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.token}`,
        },
        body: JSON.stringify({ plan: planKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Billing error")
      window.location.href = data.short_url
    } catch {
      setBillingLoading(null)
    }
  }

  return (
    <div className="site-texture-bg min-h-screen text-foreground">
      {/* persistent sticky nav, floats above the full-bleed hero image */}
      <Nav />

      <section
        id="hero"
        style={{ marginTop: "-74px" }}
        className="relative flex min-h-screen flex-col overflow-hidden bg-zinc-950"
      >
        {/* full-bleed hero image + overlays — spans the entire section, behind the nav */}
        <div
          className="absolute inset-0 scale-105 bg-cover bg-[center_34%] opacity-90"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1499346030926-9a72daac6c63?auto=format&fit=crop&w=2400&q=88')",
          }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_64%_18%,rgba(219,234,254,0.22),transparent_20%),linear-gradient(180deg,rgba(8,31,66,0.04)_0%,rgba(8,31,66,0.22)_34%,rgba(3,8,20,0.74)_72%,rgba(3,8,20,0.98)_100%)]" />
        <div className="absolute inset-0 opacity-[0.16] hero-grain" />
        <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/65 to-transparent" />

        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-between px-5 pb-8 pt-28 sm:px-8 sm:pb-10 lg:px-10">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-6 flex flex-wrap items-center gap-3 text-xs font-medium text-white/70"
          >
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 backdrop-blur-md">
              Early access
            </span>
            <span className="flex items-center gap-1.5">
              <Zap size={14} className="fill-sky-200 text-sky-200" />
              &lt; 2s fast path
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-white/30 sm:block" />
            <span>Windows now · macOS coming soon</span>
          </motion.div>

          {/* big centered tagline — the heart of the hero */}
          <div className="animate-hero-rise-delayed mx-auto flex max-w-5xl flex-col items-center px-2 text-center">
            <p className="font-serif text-5xl leading-[1.04] tracking-tight text-white drop-shadow-[0_2px_24px_rgba(8,31,66,0.55)] sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
              Sees your <span className="italic text-sky-300">screen</span>, hears your{" "}
              <span className="italic text-cyan-200">voice</span>, and works across{" "}
              <span className="italic text-blue-200">your everyday apps</span>.
            </p>
          </div>

          <div>
            <div className="grid items-end gap-8 lg:grid-cols-[1fr_360px]">
              <h1 className="animate-hero-rise-delayed font-accent text-[4.8rem] leading-[0.82] tracking-normal text-[#eaf4ff] sm:text-[7.2rem] md:text-[9rem] lg:text-[11.2rem]">
                Yomi
                {/* the visible wordmark alone is a poor heading for search and screen readers */}
                <span className="sr-only"> — AI productivity assistant for Windows</span>
              </h1>

              <motion.div
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.35 }}
                className="pb-1 lg:pb-6"
              >
                <div className="mb-7 max-w-md">
                  <div className="flex flex-wrap gap-2">
                    {["Web app", "Telegram", "No copy-paste"].map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full border border-white/12 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-white/65 backdrop-blur-sm"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <p className="mt-4 font-serif text-sm italic text-white/40">
                    Your data is never stored.{" "}
                    <a
                      href="#google-data"
                      className="font-sans text-xs not-italic underline underline-offset-2 transition-colors hover:text-white/65"
                    >
                      Learn more
                    </a>
                  </p>
                </div>
                <div className="grid w-full max-w-md grid-cols-2 gap-3">
                  <Link
                    href="/signup"
                    className="group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-[#eaf4ff] px-5 text-sm font-semibold text-slate-950 transition hover:bg-white"
                  >
                    Get started
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-zinc-950 text-white transition group-hover:translate-x-0.5">
                      <ArrowRight size={14} />
                    </span>
                  </Link>
                  <button
                    onClick={() => scrollTo("how-it-works")}
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-white/15 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/15"
                  >
                    See how it works
                  </button>
                  <Link
                    href="/signup"
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/15"
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
              className="mt-6 grid gap-3 border-t border-white/10 pt-4 text-sm text-white/62 sm:grid-cols-3"
            >
              <span className="flex items-center gap-2">
                <Monitor size={15} className="text-sky-100" />
                Screen-aware responses
              </span>
              <span className="flex items-center gap-2">
                <Mic size={15} className="text-sky-100" />
                Voice and text hotkeys
              </span>
              <span className="flex items-center gap-2">
                <Shield size={15} className="text-sky-100" />
                Visible capture states
              </span>
            </motion.div>
          </div>
        </div>
      </section>

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
            access your Drive data. Below you will find exactly why sign-in is required and how your
            data is handled.
          </p>
        </div>
        <div className="space-y-4">
          {/* Purpose banner */}
          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-6 py-4 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">App purpose</p>
            <p>
              Yomi is a personal AI assistant. It accesses your Google Drive, with your explicit
              permission, to answer questions you ask in natural language. For example: &ldquo;Find
              the Q3 report in my Drive.&rdquo; or &ldquo;What does the product spec say about
              pricing?&rdquo; Yomi reads data on-demand per request and never stores it.
            </p>
            <p className="mt-2 text-xs text-muted-foreground/70">
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
                    Yomi uses Google&apos;s authentication system to confirm who you are, so it can
                    securely associate your connected apps, settings, and preferences with your
                    account. Anonymous access is not possible because Yomi operates on your personal
                    file data, so it cannot function without knowing which Google account to query.
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
                    authorization. Each permission is granted individually and can be revoked at any
                    time from your Yomi dashboard or from{" "}
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
                    Yomi&apos;s servers between requests. Your Google data is never sold, never used
                    to train AI models, and is not shared with any third party except the AI
                    inference provider used to generate your response, and solely for that purpose.
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
                    <span className="font-mono text-xs text-muted-foreground/70">drive.file</span>
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
              Yomi does not sell user data. Google API data is used only to respond to your current
              request and is discarded immediately after.
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
            Three ways to <span className="italic">interact</span>.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Voice, type, or just press enter. Yomi routes each request through the right context and
            model.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <InteractionCard
            type="A"
            hotkey={[
              { sym: "^", label: "Ctrl" },
              { sym: "␣", label: "Space" },
            ]}
            label="Voice + Screen"
            description="Press Ctrl+Space, speak your question, then press Enter. Yomi transcribes your voice, captures screen context, and responds with text and spoken audio."
          />
          <InteractionCard
            type="B"
            hotkey={[
              { sym: "^", label: "Ctrl" },
              { sym: "↵", label: "Enter" },
            ]}
            label="Type + Screen"
            description="Press Ctrl+Enter, type your question, then press Enter. Yomi intelligently includes your screen for spatial or UI queries and returns a fast text response."
          />
          <InteractionCard
            type="C"
            hotkey={[
              { sym: "^", label: "Ctrl" },
              { sym: "S", label: "S" },
            ]}
            label="Screen Q&A"
            description="Press Ctrl+S to capture your screen. Yomi analyzes what's on your display and provides step-by-step visual guidance overlaid on your screen."
          />
        </div>
      </section>

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

      {/* ── Supported Integrations ───────────────────────────────────────────── */}
      <section id="connectors" className="mx-auto max-w-5xl px-6 py-24">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Supported Integrations
          </p>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Your tools, one <span className="italic">conversation</span> away.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Connect your apps once. Ask Yomi from the web or from Telegram, even with your
            laptop closed.
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {CONNECTORS.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.04 }}
              className="flex items-start gap-3 rounded-2xl glass-card p-4"
            >
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-neutral-900 ring-1 ring-inset ring-black/5">
                <ConnectorIcon id={c.id} size={28} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{c.description}</p>
              </div>
            </motion.div>
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
            What Yomi accesses, and <span className="italic">why</span>.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Yomi only reads data when you ask a question. Nothing is stored between queries. You can
            revoke any integration at any time.
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
                <p className="font-mono text-xs text-muted-foreground/70">{row.scopes}</p>
                <p className="text-muted-foreground">{row.why}</p>
              </div>
            </div>
          ))}
        </div>

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
            Simple, <span className="italic">honest</span> pricing.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Start free. Upgrade when you outgrow it.
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl gap-5 sm:grid-cols-3">
          {PLANS.map((plan, i) => {
            const Icon = plan.icon
            return (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
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
                    <Icon size={18} className="text-primary" />
                    <p className="text-sm font-medium text-foreground">{plan.name}</p>
                    {!plan.popular && plan.badge && (
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <div className="mb-2 flex items-baseline gap-1">
                    <span className="font-accent text-4xl text-foreground">
                      {localPrice.format(plan.priceUsd)}
                    </span>
                    <span className="text-sm text-muted-foreground">{plan.period}</span>
                  </div>
                  {localPrice.localized && plan.priceUsd > 0 && (
                    <p className="mb-1 text-xs text-muted-foreground">
                      approx. — billed as ${plan.priceUsd} USD
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <ul className="mb-8 flex-1 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <Check size={14} className="mt-0.5 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePlanClick(plan.key)}
                  disabled={billingLoading !== null}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium transition-colors disabled:opacity-70 ${
                    plan.popular
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border text-foreground hover:bg-muted/50"
                  }`}
                >
                  {billingLoading === plan.key && <Loader2 size={14} className="animate-spin" />}
                  {billingLoading === plan.key ? "Redirecting..." : plan.cta}
                </button>
              </motion.div>
            )
          })}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mt-8 text-center text-xs text-muted-foreground"
        >
          * Credits are a simple usage balance. Explore is a 30-day free trial; Pro and Max can buy
          extra credit packs.
        </motion.p>
      </section>

      <section id="download" className="hidden">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Download
          </p>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Get <span className="italic">Yomi</span>.
          </h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-3 text-sm text-muted-foreground"
          >
            {detected === "windows"
              ? "We detected Windows. Ready to download."
              : "Windows is available now. macOS is coming soon."}
          </motion.p>
        </div>

        <div className="mx-auto max-w-2xl space-y-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mx-auto flex w-fit gap-1 rounded-xl border border-border bg-muted p-1"
          >
            {allPlatforms.map((p) => (
              <button
                key={p}
                onClick={() => setActive(p)}
                className={`relative rounded-lg px-5 py-2 text-sm font-medium transition-colors duration-200 ${
                  active === p ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active === p && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-lg border border-border bg-card shadow-sm"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">
                  {platforms[p].icon} {platforms[p].title}
                  {platforms[p].comingSoon && (
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                      (coming soon)
                    </span>
                  )}
                  {detected === p && (
                    <span className="ml-2 font-mono text-[10px] text-primary">(detected)</span>
                  )}
                </span>
              </button>
            ))}
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <h2 className="font-accent text-2xl text-foreground">{current.title} downloads</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {current.options.map((opt) => {
                  const className = `group flex items-center justify-between rounded-xl glass-card p-4 transition-colors ${
                    opt.disabled ? "cursor-not-allowed opacity-65" : "hover:border-primary/40"
                  }`
                  const content = (
                    <>
                      <div>
                        <div className="mb-0.5 flex items-center gap-2">
                          <Download
                            size={14}
                            className={`text-muted-foreground transition-colors ${
                              opt.disabled ? "" : "group-hover:text-primary"
                            }`}
                          />
                          <p className="text-sm font-medium text-foreground">{opt.label}</p>
                        </div>
                        {opt.note && (
                          <p className="pl-5 text-xs text-muted-foreground">{opt.note}</p>
                        )}
                      </div>
                      <span className="rounded-lg border border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                        {opt.arch}
                      </span>
                    </>
                  )
                  return opt.disabled ? (
                    <div key={opt.label} aria-disabled="true" className={className}>
                      {content}
                    </div>
                  ) : (
                    <a
                      key={opt.label}
                      href={opt.label === "Installer" && downloadUrl ? downloadUrl : opt.href}
                      className={className}
                    >
                      {content}
                    </a>
                  )
                })}
              </div>

              <div className="space-y-3 pt-4">
                <h2 className="font-accent text-2xl text-foreground">Install instructions</h2>
                <ol className="space-y-3">
                  {current.instructions.map((step, i) => (
                    <motion.li
                      key={step}
                      initial={{ opacity: 0, x: -8 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.3, delay: i * 0.06 }}
                      className="flex items-start gap-3"
                    >
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs text-primary">
                        {i + 1}
                      </span>
                      <span className="text-sm leading-relaxed text-muted-foreground">{step}</span>
                    </motion.li>
                  ))}
                </ol>
              </div>
            </motion.div>
          </AnimatePresence>

          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex items-start gap-3 rounded-xl glass-card p-4"
          >
            <span className="mt-0.5 shrink-0 text-base leading-none text-muted-foreground">ℹ</span>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Yomi is pre-release.{" "}
              <Link href="/signup" className="text-primary hover:underline">
                sign up for early access
                <ArrowRight size={12} className="ml-0.5 inline" />
              </Link>
            </p>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
