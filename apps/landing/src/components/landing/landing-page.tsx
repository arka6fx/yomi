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

import Footer from "@/components/Footer"
import Nav from "@/components/Nav"

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
    options: [
      { label: "Installer", arch: ".exe", href: "/api/download" },
    ],
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

const PLANS = [
  {
    key: "explore",
    name: "Explore",
    price: "$0",
    period: "/ month",
    annual: "$0 / year",
    badge: "Free",
    description: "Start with screen-aware AI, voice, and memory basics. No card needed.",
    features: [
      "100 AI chats / month",
      "20 min voice / month",
      "25 screenshot analyses",
      "50 local memories",
      "Messaging bots (limited)",
      "Window controls & docking",
      "Streaming responses",
    ],
    cta: "Get started free",
    popular: false,
    icon: Sparkles,
  },
  {
    key: "pro",
    name: "Pro",
    price: "$14.99",
    period: "/ month",
    annual: "$144 / year",
    badge: "Most Popular",
    description: "Daily screen, voice, memory, images, and useful foreground automation.",
    features: [
      "2,000 AI chats / month",
      "180 min voice / month",
      "400 screenshot analyses",
      "100 advanced reasoning uses",
      "75 desktop automation runs",
      "40 browser automation runs",
      "Messaging bots (full access)",
      "Faster response queue",
    ],
    cta: "Subscribe",
    popular: true,
    icon: Crown,
  },
  {
    key: "max",
    name: "Max",
    price: "$39.99",
    period: "/ month",
    annual: "$384 / year",
    badge: "Power users",
    description: "Heavy automation, long-context work, and high-volume creation.",
    features: [
      "Everything in Pro",
      "8,000 AI chats / month",
      "750 min voice / month",
      "500 advanced reasoning uses",
      "750 desktop automation runs",
      "500 browser automation runs",
      "Messaging bots (priority)",
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
  const [detected, setDetected] = useState<Platform>("unknown")
  const [active, setActive] = useState<Exclude<Platform, "unknown">>("windows")

  useEffect(() => {
    const p = detectPlatform()
    setDetected(p)
    if (p === "windows") setActive(p)
  }, [])

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
      <Nav />

      <section id="hero" className="px-4 pb-10 pt-6 sm:px-6 lg:pb-12">
        <div className="relative mx-auto min-h-[calc(100vh-96px)] max-w-7xl overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 sm:rounded-[36px]">
          <div
            className="absolute inset-0 scale-105 bg-cover bg-[center_34%] opacity-90"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=88')",
            }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_64%_18%,rgba(219,234,254,0.22),transparent_20%),linear-gradient(180deg,rgba(8,31,66,0.04)_0%,rgba(8,31,66,0.22)_34%,rgba(3,8,20,0.74)_72%,rgba(3,8,20,0.98)_100%)]" />
          <div className="absolute inset-0 opacity-[0.16] hero-grain" />
          <div className="absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/65 to-transparent" />

          <div className="relative z-10 flex min-h-[calc(100vh-96px)] flex-col justify-end px-5 pb-6 pt-24 sm:px-8 sm:pb-8 lg:px-10">
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

            <div className="grid items-end gap-8 lg:grid-cols-[1fr_360px]">
              <motion.h1
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, delay: 0.2 }}
                className="font-accent text-[4.8rem] font-medium leading-[0.82] tracking-normal text-[#eaf4ff] sm:text-[7.2rem] md:text-[9rem] lg:text-[11.2rem]"
              >
                Yomi
              </motion.h1>

              <motion.div
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.35 }}
                className="pb-1 lg:pb-6"
              >
                <div className="mb-6 flex items-start gap-5">
                  <span className="font-accent text-5xl leading-none text-[#eaf4ff]">*</span>
                  <p className="max-w-sm text-sm leading-5 text-white/78 sm:text-base sm:leading-6">
                    Yomi is a Windows AI buddy that sees your screen, hears your voice, and helps
                    you move through laptop work without breaking flow.
                  </p>
                </div>
                <div className="flex flex-col items-start gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href="/signup"
                      className="group inline-flex h-12 items-center gap-4 rounded-full bg-[#eaf4ff] px-6 text-sm font-semibold text-slate-950 transition hover:bg-white"
                    >
                      Get started
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-zinc-950 text-white transition group-hover:translate-x-1">
                        <ArrowRight size={16} />
                      </span>
                    </Link>
                    <button
                      onClick={() => scrollTo("how-it-works")}
                      className="inline-flex h-12 items-center rounded-full border border-white/15 bg-white/10 px-6 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/15"
                    >
                      See how it works
                    </button>
                  </div>
                  <button
                    onClick={() => scrollTo("download")}
                    className="inline-flex h-12 items-center gap-2 self-center rounded-lg border border-sky-200/40 bg-[linear-gradient(135deg,#38bdf8_0%,#2563eb_100%)] px-5 text-sm font-semibold text-white shadow-[0_10px_28px_rgba(37,99,235,0.36),inset_0_1px_0_rgba(255,255,255,0.28)] transition hover:scale-[1.02] hover:shadow-[0_14px_36px_rgba(37,99,235,0.48),inset_0_1px_0_rgba(255,255,255,0.34)]"
                  >
                    <WindowsMark />
                    {heroDownloadLabel}
                  </button>
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

      <section className="mx-auto max-w-5xl px-6 py-24" id="how-it-works">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            How it works
          </p>
          <h2 className="font-accent text-3xl font-medium text-foreground sm:text-4xl">
            Three ways to interact.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Voice, type, or just press enter. Every interaction counts the same.
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
          <h2 className="font-accent text-3xl font-medium text-foreground sm:text-4xl">
            Everything you need, nothing you don't.
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

      <section id="pricing" className="mx-auto max-w-5xl px-6 py-24">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Pricing
          </p>
          <h2 className="font-accent text-3xl font-medium text-foreground sm:text-4xl">
            Simple, honest pricing.
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
                    <span className="font-accent text-4xl font-medium text-foreground">
                      {plan.price}
                    </span>
                    <span className="text-sm text-muted-foreground">{plan.period}</span>
                  </div>
                  <p className="mb-2 text-xs text-muted-foreground">{plan.annual}</p>
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
          * Fair usage protection applies. Explore is free with monthly limits.
        </motion.p>
      </section>

      <section id="download" className="mx-auto max-w-5xl px-6 py-24">
        <div className="mb-14 text-center">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Download
          </p>
          <h2 className="font-accent text-3xl font-medium text-foreground sm:text-4xl">
            Get Yomi.
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
              <h2 className="font-accent text-xl font-medium text-foreground">
                {current.title} downloads
              </h2>
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
                      href={opt.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={className}
                    >
                      {content}
                    </a>
                  )
                })}
              </div>

              <div className="space-y-3 pt-4">
                <h2 className="font-accent text-xl font-medium text-foreground">
                  Install instructions
                </h2>
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
              Downloads come directly from{" "}
              <a
                href="https://github.com/arka6fx/yomi-releases/releases"
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Releases
              </a>
              . Yomi is pre-release.{" "}
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
