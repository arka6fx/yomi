"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Zap, Monitor, Shield, Check, ArrowRight, Mic, Menu, X, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { authClient } from "@/lib/auth-client"
import { HandWrittenTitle } from "@/components/ui/hand-writing-text"
import Footer from "@/components/Footer"

const NAV_LINKS: { label: string; href?: string; scrollTo?: string }[] = [
  { label: "Features", scrollTo: "features" },
  { label: "Pricing",  scrollTo: "pricing" },
  { label: "Download", href: "/download" },
]

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
    key: "free",
    name: "Free",
    price: "$0",
    period: "/month",
    description: "Local AI assistance, no card required.",
    features: [
      "10 LLM calls / day",
      "2 STT minutes / day",
      "Text-to-speech",
      "macOS + Windows",
    ],
    cta: "Get started",
    popular: false,
  },
  {
    key: "basic",
    name: "Basic",
    price: "$4",
    period: "/month",
    description: "More calls and screenshot analysis for daily use.",
    features: [
      "500 LLM calls / day",
      "30 STT minutes / day",
      "Text-to-speech",
      "Screenshot analysis",
      "Email support",
    ],
    cta: "Start free trial",
    popular: false,
  },
  {
    key: "standard",
    name: "Standard",
    price: "$9",
    period: "/month",
    description: "Full agent pipeline for power users.",
    features: [
      "2 000 LLM calls / day",
      "120 STT minutes / day",
      "Text-to-speech",
      "Screenshot analysis",
      "Agent pipeline",
      "Email support",
    ],
    cta: "Start free trial",
    popular: true,
  },
  {
    key: "genesis",
    name: "Genesis",
    price: "$19",
    period: "/month",
    description: "Maximum capacity and priority support.",
    features: [
      "10 000 LLM calls / day",
      "600 STT minutes / day",
      "Text-to-speech",
      "Screenshot analysis",
      "Agent pipeline",
      "Priority support",
    ],
    cta: "Get Genesis",
    popular: false,
  },
]

function ElegantShape({
  className,
  delay = 0,
  width = 400,
  height = 100,
  rotate = 0,
  gradient = "from-amber-300/[0.08]",
}: {
  className?: string
  delay?: number
  width?: number
  height?: number
  rotate?: number
  gradient?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -100, rotate: rotate - 15 }}
      animate={{ opacity: 1, y: 0, rotate }}
      transition={{
        duration: 2.4,
        delay,
        ease: [0.23, 0.86, 0.39, 0.96],
        opacity: { duration: 1.2 },
      }}
      className={cn("absolute", className)}
    >
      <motion.div
        animate={{ y: [0, 16, 0] }}
        transition={{ duration: 13, repeat: Infinity, ease: "easeInOut" }}
        style={{ width, height }}
        className="relative"
      >
        <div
          className={cn(
            "absolute inset-0 rounded-full",
            "bg-gradient-to-r to-transparent",
            gradient,
            "backdrop-blur-[1px] border border-white/[0.06]",
            "shadow-[0_4px_32px_0_rgba(255,180,80,0.04)]",
            "after:absolute after:inset-0 after:rounded-full",
            "after:bg-[radial-gradient(circle_at_50%_50%,rgba(255,200,100,0.05),transparent_70%)]"
          )}
        />
      </motion.div>
    </motion.div>
  )
}

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

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const { data: session } = authClient.useSession()
  const router = useRouter()

  async function handlePlanClick(planKey: string) {
    if (planKey === "free") {
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

      {/* ── Floating navbar ─────────────────────────────────────────── */}
      <div className="sticky top-3 z-50 px-4">
        <motion.header
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-5xl mx-auto rounded-2xl border border-border bg-card/80 backdrop-blur-xl shadow-sm"
        >
          <div className="flex items-center justify-between px-4 md:px-6 py-3">
            <button
              onClick={() => scrollTo("hero")}
              className="font-display text-2xl font-bold text-foreground select-none"
            >
              Yomi
            </button>

            <nav className="hidden md:flex items-center gap-7">
              {NAV_LINKS.map(link => link.scrollTo ? (
                <button
                  key={link.label}
                  onClick={() => scrollTo(link.scrollTo!)}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </button>
              ) : (
                <Link
                  key={link.label}
                  href={link.href!}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-1">
              {session ? (
                <>
                  <Link
                    href="/dashboard"
                    className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-xl hover:bg-muted/50"
                  >
                    Dashboard
                  </Link>
                  <button
                    onClick={() => authClient.signOut().then(() => router.push("/"))}
                    className="bg-primary text-primary-foreground text-sm font-medium px-4 py-1.5 rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href="/signin"
                    className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-xl hover:bg-muted/50"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/signup"
                    className="bg-primary text-primary-foreground text-sm font-medium px-4 py-1.5 rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    Get started
                  </Link>
                </>
              )}
              <button
                className="md:hidden ml-1 text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                onClick={() => setMenuOpen(v => !v)}
                aria-label="Toggle menu"
              >
                {menuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden border-t border-border"
              >
                <div className="px-4 py-3 flex flex-col gap-0.5">
                  {NAV_LINKS.map(link => link.scrollTo ? (
                    <button
                      key={link.label}
                      onClick={() => { scrollTo(link.scrollTo!); setMenuOpen(false) }}
                      className="py-2.5 px-3 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left"
                    >
                      {link.label}
                    </button>
                  ) : (
                    <Link
                      key={link.label}
                      href={link.href!}
                      onClick={() => setMenuOpen(false)}
                      className="py-2.5 px-3 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {link.label}
                    </Link>
                  ))}
                  <div className="flex gap-2 mt-2 pt-2 border-t border-border">
                    <Link
                      href="/signin"
                      onClick={() => setMenuOpen(false)}
                      className="flex-1 text-center py-2 rounded-xl text-sm text-muted-foreground border border-border hover:bg-muted/50 transition-colors"
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/signup"
                      onClick={() => setMenuOpen(false)}
                      className="flex-1 text-center py-2 rounded-xl text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Sign up
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>
      </div>

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
          {/* top/bottom vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background/80 pointer-events-none" />
        </div>

        {/* Floating geometric shapes */}
        <div className="absolute inset-0 overflow-hidden">
          <ElegantShape
            delay={0.2}
            width={520}
            height={130}
            rotate={12}
            gradient="from-amber-400/[0.10]"
            className="left-[-8%] md:left-[-4%] top-[18%] md:top-[22%]"
          />
          <ElegantShape
            delay={0.45}
            width={400}
            height={100}
            rotate={-16}
            gradient="from-rose-400/[0.07]"
            className="right-[-4%] md:right-[0%] top-[58%] md:top-[64%]"
          />
          <ElegantShape
            delay={0.35}
            width={260}
            height={68}
            rotate={-10}
            gradient="from-orange-300/[0.09]"
            className="left-[6%] md:left-[10%] bottom-[6%] md:bottom-[12%]"
          />
          <ElegantShape
            delay={0.6}
            width={180}
            height={50}
            rotate={22}
            gradient="from-amber-200/[0.07]"
            className="right-[16%] md:right-[22%] top-[8%] md:top-[14%]"
          />
          <ElegantShape
            delay={0.7}
            width={130}
            height={36}
            rotate={-26}
            gradient="from-yellow-300/[0.06]"
            className="left-[20%] md:left-[26%] top-[3%] md:top-[7%]"
          />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.25, 0.4, 0.25, 1] }}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-xs text-muted-foreground mb-8 backdrop-blur-sm"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Now in early access
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.2, ease: [0.25, 0.4, 0.25, 1] }}
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
            transition={{ duration: 0.8, delay: 0.35, ease: [0.25, 0.4, 0.25, 1] }}
            className="text-base sm:text-lg text-muted-foreground mb-10 max-w-xl mx-auto leading-relaxed"
          >
            Press{" "}
            <Keys keys={[{ sym: "⌘", label: "Cmd" }, { sym: "⇧", label: "Shift" }, { sym: "␣", label: "Space" }]} />
            {" "}on Mac or{" "}
            <Keys keys={[{ sym: "^", label: "Ctrl" }, { sym: "⇧", label: "Shift" }, { sym: "␣", label: "Space" }]} />
            {" "}on Windows. Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, delay: 0.4 }}
            className="-mb-2"
          >
            <HandWrittenTitle
              title="free to start"
              subtitle="no credit card needed"
              className="max-w-xs mx-auto"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.45, ease: [0.25, 0.4, 0.25, 1] }}
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

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section id="features" className="py-24 max-w-5xl mx-auto px-6">
        <div className="text-center mb-14">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
            How it works
          </p>
          <h2
            className="text-3xl sm:text-4xl font-light text-foreground"
            style={{ letterSpacing: "-0.03em" }}
          >
            Built to disappear.
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
            All plans include a 14-day free trial.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLANS.map((plan, i) => (
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
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-5">
                <p className="text-sm font-medium text-muted-foreground mb-1">{plan.name}</p>
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

              <ul className="space-y-3 mb-8 flex-1">
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
          ))}
        </div>
      </section>

      <Footer />
    </div>
  )
}
