"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Zap, Monitor, Shield, Check, ArrowRight, Mic, Loader2, Download, Crown, Sparkles, Cuboid } from "lucide-react"
import { authClient } from "@/lib/auth-client"

import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

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
}

const platforms: Record<
  Exclude<Platform, "unknown">,
  { title: string; icon: string; options: DownloadOption[]; instructions: string[] }
> = {
  mac: {
    title: "macOS",
    icon: "⌘",
    options: [
      { label: "Apple Silicon", arch: ".dmg", href: "https://github.com/arka6fx/yomi/releases/latest", note: "M1 / M2 / M3" },
      { label: "Intel", arch: ".dmg", href: "https://github.com/arka6fx/yomi/releases/latest", note: "x86_64" },
    ],
    instructions: [
      "Open the downloaded .dmg file",
      "Drag Yomi to your Applications folder",
      "Open Yomi from Applications",
      "Grant screen recording permission when prompted",
      "Yomi appears in your menu bar",
    ],
  },
  windows: {
    title: "Windows",
    icon: "⊞",
    options: [
      { label: "Installer", arch: ".exe", href: "https://github.com/arka6fx/yomi/releases/latest" },
      { label: "MSI package", arch: ".msi", href: "https://github.com/arka6fx/yomi/releases/latest" },
    ],
    instructions: [
      "Run the installer and follow the prompts",
      "Yomi will start automatically after install",
      "Find the Yomi icon in your system tray",
      "Grant microphone and screen permissions when prompted",
      "Press the hotkey to start",
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
    description: "Yomi captures context from whatever you're looking at. No copy-pasting, no describing — it just knows.",
  },
  {
    icon: Mic,
    title: "Hears your voice",
    description: "Push to talk or always-on VAD. Sub-2-second response on the fast path. Ask anything, anytime.",
  },
  {
    icon: Shield,
    title: "Private by default",
    description: "Local STT, on-device screen analysis, encrypted memory sync. Your data stays on your machine.",
  },
]

const PLANS = [
  {
    key: "explore",
    name: "Explore",
    price: "$0",
    period: "/ month",
    badge: "30-day trial",
    description: "Try everything Yomi has to offer — no card needed.",
    features: [
      "Voice & text interaction",
      "Screenshot analysis",
      "Memory & personalization",
      "Voice input & output",
      "Window controls & docking",
      "Streaming responses",
      "150 total interactions",
    ],
    cta: "Get started free",
    popular: false,
    icon: Sparkles,
  },
  {
    key: "pro",
    name: "Pro",
    price: "$9.99",
    period: "/ month",
    badge: "Most Popular",
    description: "Unlimited interaction for everyday use.",
    features: [
      "Everything in Explore",
      "Unlimited standard interactions*",
      "Better memory",
      "Faster response queue",
      "Priority compute",
      "Enhanced personalization",
    ],
    cta: "Subscribe",
    popular: true,
    icon: Crown,
  },
  {
    key: "max",
    name: "Max",
    price: "$24.99",
    period: "/ month",
    badge: "Power User",
    description: "Full agentic capabilities for creators.",
    features: [
      "Everything in Pro",
      "Spawn agents & sub-agents",
      "Background execution",
      "Long-running tasks",
      "Autonomous workflows",
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
          <kbd className="inline-flex items-center gap-1 font-mono text-xs bg-muted border border-border px-1.5 py-0.5 rounded text-foreground">
            <span>{sym}</span>
            <span className="text-muted-foreground font-sans">{label}</span>
          </kbd>
          {i < keys.length - 1 && (
            <span className="text-muted-foreground text-xs">+</span>
          )}
        </span>
      ))}
    </span>
  )
}

function InteractionCard({ type, hotkey, label, description }: {
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
      className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-full">
          Type {type}
        </span>
        <Keys keys={hotkey} />
      </div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </motion.div>
  )
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const { data: session } = authClient.useSession()
  const router = useRouter()

  const [detected, setDetected] = useState<Platform>("unknown")
  const [active, setActive] = useState<Exclude<Platform, "unknown">>("mac")

  useEffect(() => {
    const p = detectPlatform()
    setDetected(p)
    if (p !== "unknown") setActive(p)
  }, [])

  const current = platforms[active]

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
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    <div className="min-h-screen bg-background text-foreground">

      <Nav />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        id="hero"
        className="relative min-h-[calc(100vh-64px)] flex items-center justify-center overflow-hidden py-28"
      >
        {/* Multi-layer gradient background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            className="absolute -top-32 left-1/4 w-[700px] h-[700px] rounded-full blur-[150px]"
            style={{ background: "radial-gradient(circle, rgba(255,175,80,0.09), transparent 65%)" }}
          />
          <div
            className="absolute bottom-0 right-1/4 w-[600px] h-[600px] rounded-full blur-[130px]"
            style={{ background: "radial-gradient(circle, rgba(255,130,100,0.06), transparent 65%)" }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[420px] rounded-full blur-[200px]"
            style={{ background: "radial-gradient(circle, rgba(255,205,120,0.04), transparent 65%)" }}
          />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background/80 pointer-events-none" />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-xs text-muted-foreground mb-8 backdrop-blur-sm"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Now in early access
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2 }}
            className="text-5xl sm:text-6xl md:text-7xl font-light mb-6"
            style={{ letterSpacing: "-0.04em", lineHeight: 1.08 }}
          >
            <span className="bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/75">
              Your AI buddy,
            </span>
            <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-200 via-orange-200 to-rose-200">
              on every screen.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="text-base sm:text-lg text-muted-foreground mb-10 max-w-xl mx-auto leading-relaxed"
          >
            Press{" "}
            <Keys keys={[{ sym: "⌘", label: "Cmd" }, { sym: "⇧", label: "Shift" }, { sym: "␣", label: "Space" }]} />
            {" "}on Mac or{" "}
            <Keys keys={[{ sym: "^", label: "Ctrl" }, { sym: "⇧", label: "Shift" }, { sym: "␣", label: "Space" }]} />
            {" "}on Windows. Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.45 }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            <Link
              href="/signup"
              className="group flex items-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-7 py-3 hover:bg-primary/90 transition-all shadow-[0_0_28px_-4px_hsl(var(--primary)/0.5)] hover:shadow-[0_0_40px_-4px_hsl(var(--primary)/0.7)]"
            >
              Get early access
              <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <button
              onClick={() => scrollTo("pricing")}
              className="flex items-center gap-2 rounded-xl border border-border bg-card/40 backdrop-blur-sm text-foreground font-medium px-7 py-3 hover:bg-card/60 transition-all"
            >
              See plans
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.6 }}
            className="flex flex-wrap items-center justify-center gap-5 mt-14 text-sm text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Zap size={14} className="text-primary fill-primary" />
              &lt; 2s fast path
            </span>
            <span className="w-px h-4 bg-border" />
            <span className="flex items-center gap-1.5">
              <Monitor size={14} className="text-primary" />
              macOS + Windows
            </span>
            <span className="w-px h-4 bg-border" />
            <span className="flex items-center gap-1.5">
              <Shield size={14} className="text-primary" />
              Private by default
            </span>
          </motion.div>
        </div>
      </section>

      {/* ── How it works: Interaction Types ──────────────────────────── */}
      <section className="py-24 max-w-5xl mx-auto px-6" id="how-it-works">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            How it works
          </p>
          <h2
            className="text-3xl sm:text-4xl font-light text-foreground"
            style={{ letterSpacing: "-0.03em" }}
          >
            Three ways to interact.
          </h2>
          <p className="text-muted-foreground mt-3 text-sm max-w-md mx-auto">
            Voice, type, or just press enter — every interaction counts the same.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <InteractionCard
            type="A"
            hotkey={[{ sym: "^", label: "Ctrl" }, { sym: "⇧", label: "Shift" }, { sym: "␣", label: "Space" }]}
            label="Voice + Screen"
            description="Speak your question. Yomi hears you, sees your screen, and responds with text and voice."
          />
          <InteractionCard
            type="B"
            hotkey={[{ sym: "^", label: "Ctrl" }, { sym: "⇧", label: "Shift" }, { sym: "↵", label: "Enter" }]}
            label="Type + Screen"
            description="Type a question. Yomi captures your screen and returns a text response."
          />
          <InteractionCard
            type="C"
            hotkey={[{ sym: "^", label: "Ctrl" }, { sym: "⇧", label: "Shift" }, { sym: "↵", label: "Enter" }]}
            label="Just Screen"
            description="Press Ctrl+Shift+Enter, then press Enter again with an empty input. Yomi studies your screen and tells you what's on it."
          />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section id="features" className="py-24 max-w-5xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Built to disappear
          </p>
          <h2
            className="text-3xl sm:text-4xl font-light text-foreground"
            style={{ letterSpacing: "-0.03em" }}
          >
            Everything you need, nothing you don't.
          </h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-5">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="rounded-2xl border border-border bg-card p-6"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <feature.icon size={20} className="text-primary" />
              </div>
              <h3 className="font-medium text-foreground mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 max-w-5xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Pricing
          </p>
          <h2
            className="text-3xl sm:text-4xl font-light text-foreground"
            style={{ letterSpacing: "-0.03em" }}
          >
            Simple, honest pricing.
          </h2>
          <p className="text-muted-foreground mt-3 text-sm">
            Start free. Upgrade when you outgrow it.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {PLANS.map((plan, i) => {
            const Icon = plan.icon
            return (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className={`relative rounded-2xl border p-6 flex flex-col ${
                  plan.popular
                    ? "border-primary bg-card shadow-[0_0_40px_-12px_hsl(var(--primary)/0.4)]"
                    : "border-border bg-card"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={18} className="text-primary" />
                    <p className="text-sm font-medium text-foreground">{plan.name}</p>
                    {!plan.popular && plan.badge && (
                      <span className="text-[10px] text-muted-foreground border border-border px-1.5 py-0.5 rounded-full">
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span
                      className="text-4xl font-light text-foreground"
                      style={{ letterSpacing: "-0.03em" }}
                    >
                      {plan.price}
                    </span>
                    <span className="text-sm text-muted-foreground">{plan.period}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                      <Check size={14} className="text-primary mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePlanClick(plan.key)}
                  disabled={billingLoading !== null}
                  className={`w-full flex items-center justify-center gap-2 rounded-xl font-medium py-2.5 text-sm transition-colors disabled:opacity-70 ${
                    plan.popular
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border text-foreground hover:bg-muted/50"
                  }`}
                >
                  {billingLoading === plan.key && <Loader2 size={14} className="animate-spin" />}
                  {billingLoading === plan.key ? "Redirecting…" : plan.cta}
                </button>
              </motion.div>
            )
          })}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-xs text-muted-foreground mt-8"
        >
          * Fair usage protection applies. All plans include a 30-day free trial on Explore.
        </motion.p>
      </section>

      {/* ── Download ─────────────────────────────────────────────────── */}
      <section id="download" className="py-24 max-w-5xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            Download
          </p>
          <h2
            className="text-3xl sm:text-4xl font-light text-foreground"
            style={{ letterSpacing: "-0.03em" }}
          >
            Get Yomi.
          </h2>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="text-muted-foreground mt-3 text-sm"
          >
            {detected !== "unknown"
              ? `We detected ${platforms[detected as Exclude<Platform, "unknown">]?.title}. Ready to download.`
              : "Choose your platform below."}
          </motion.p>
        </div>

        <div className="max-w-2xl mx-auto space-y-10">
          {/* Platform tabs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="flex gap-1 p-1 rounded-xl bg-muted border border-border w-fit mx-auto"
          >
            {allPlatforms.map((p) => (
              <button
                key={p}
                onClick={() => setActive(p)}
                className={`relative px-5 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  active === p
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active === p && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-lg bg-card border border-border shadow-sm"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">
                  {platforms[p].icon} {platforms[p].title}
                  {detected === p && (
                    <span className="ml-2 text-[10px] text-primary font-mono">(detected)</span>
                  )}
                </span>
              </button>
            ))}
          </motion.div>

          {/* Download options */}
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <h2
                className="text-xl font-light text-foreground"
                style={{ letterSpacing: "-0.03em" }}
              >
                {current.title} downloads
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {current.options.map((opt) => (
                  <a
                    key={opt.label}
                    href={opt.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-4 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors group"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <Download size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                        <p className="font-medium text-sm text-foreground">{opt.label}</p>
                      </div>
                      {opt.note && (
                        <p className="text-xs text-muted-foreground pl-5">{opt.note}</p>
                      )}
                    </div>
                    <span className="font-mono text-xs text-muted-foreground group-hover:text-primary transition-colors border border-border group-hover:border-primary/40 px-2 py-1 rounded-lg">
                      {opt.arch}
                    </span>
                  </a>
                ))}
              </div>

              {/* Instructions */}
              <div className="pt-4 space-y-3">
                <h2
                  className="text-xl font-light text-foreground"
                  style={{ letterSpacing: "-0.03em" }}
                >
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
                      <span className="text-xs font-mono text-primary bg-primary/10 w-6 h-6 flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-muted-foreground leading-relaxed">{step}</span>
                    </motion.li>
                  ))}
                </ol>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* GitHub note */}
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="rounded-xl border border-border bg-card p-4 flex items-start gap-3"
          >
            <span className="text-muted-foreground text-base leading-none mt-0.5 shrink-0">ℹ</span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Downloads come directly from{" "}
              <a
                href="https://github.com/arka6fx/yomi/releases"
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Releases
              </a>
              . Yomi is pre-release —{" "}
              <Link href="/signup" className="text-primary hover:underline">
                sign up for early access
                <ArrowRight size={12} className="inline ml-0.5" />
              </Link>
            </p>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
