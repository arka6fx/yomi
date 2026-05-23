"use client"

import { useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { Zap, Monitor, Shield, Check, ArrowRight, Mic, Menu, X } from "lucide-react"
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
    href: "/signup",
    popular: false,
  },
  {
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
    href: "/signup",
    popular: false,
  },
  {
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
    href: "/signup",
    popular: true,
  },
  {
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
    href: "/signup",
    popular: false,
  },
]

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)

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
            <Link href="/" className="font-display text-2xl font-bold text-foreground select-none">
              Yomi
            </Link>

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
        {/* Gradient mesh */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            className="absolute -top-32 left-1/4 w-[600px] h-[600px] rounded-full blur-[140px]"
            style={{ background: "radial-gradient(circle, rgba(255,224,194,0.12), transparent 70%)" }}
          />
          <div
            className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full blur-[120px]"
            style={{ background: "radial-gradient(circle, rgba(255,200,140,0.08), transparent 70%)" }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[400px] rounded-full blur-[160px]"
            style={{ background: "radial-gradient(circle, rgba(255,224,194,0.06), transparent 70%)" }}
          />
          <div
            className="absolute inset-0 opacity-[0.035]"
            style={{
              backgroundImage: "radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-xs text-muted-foreground mb-8 backdrop-blur-sm"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Now in early access
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="text-5xl sm:text-6xl md:text-7xl font-light text-foreground mb-6"
            style={{ letterSpacing: "-0.04em", lineHeight: 1.08 }}
          >
            Your AI buddy,
            <br />
            <span className="text-primary">on every screen.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto leading-relaxed"
          >
            Press{" "}
            <kbd className="font-mono text-xs bg-muted border border-border px-1.5 py-0.5 rounded text-foreground">
              ⌘⇧Space
            </kbd>
            {" "}on Mac or{" "}
            <kbd className="font-mono text-xs bg-muted border border-border px-1.5 py-0.5 rounded text-foreground">
              Ctrl+Shift+Space
            </kbd>
            {" "}on Windows. Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            <Link
              href="/signup"
              className="flex items-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-7 py-3 hover:bg-primary/90 transition-colors"
            >
              Get early access
              <ArrowRight size={16} />
            </Link>
            <button
              onClick={() => scrollTo("pricing")}
              className="flex items-center gap-2 rounded-xl border border-border bg-card/60 backdrop-blur-sm text-foreground font-medium px-7 py-3 hover:bg-card transition-colors"
            >
              See plans
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
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

              <Link
                href={plan.href}
                className={`block text-center rounded-xl font-medium py-2.5 text-sm transition-colors ${
                  plan.popular
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border text-foreground hover:bg-muted/50"
                }`}
              >
                {plan.cta}
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  )
}
