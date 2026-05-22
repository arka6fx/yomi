"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import {
  Zap,
  Eye,
  MessageCircle,
  Layers,
  Sparkles,
  Shield,
  ArrowRight,
  Check,
  Command,
} from "lucide-react"

import { caveat } from "@/lib/fonts"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import WaitlistForm from "@/components/WaitlistForm"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

const ease = [0.25, 0.46, 0.45, 0.94] as const

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease } },
}

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
}

const features = [
  {
    icon: Zap,
    title: "Fast answers",
    description: "Cached prompt + single LLM call. Under 2 seconds on the fast path.",
  },
  {
    icon: Layers,
    title: "Autonomous tasks",
    description: "ReAct agent loop for multi-step workflows — research, code, and more.",
  },
  {
    icon: Eye,
    title: "Screen-aware",
    description: "Yomi sees what you see. Full context with a single screenshot.",
  },
  {
    icon: MessageCircle,
    title: "Voice in, voice out",
    description: "OpenAI Whisper STT + GPT-4o-mini TTS. Natural conversation flow.",
  },
  {
    icon: Shield,
    title: "Private by design",
    description: "Password managers and banking apps are never captured.",
  },
  {
    icon: Sparkles,
    title: "OpenAI-powered",
    description: "GPT-4.1 for agents, GPT-4.1-mini for fast answers, all in one key.",
  },
]

const plans = [
  {
    name: "Free",
    price: "$0",
    features: ["10 LLM calls / day", "2 STT minutes / day", "TTS included"],
    cta: "Join waitlist",
  },
  {
    name: "Basic",
    price: "$4",
    features: ["500 LLM calls / day", "30 STT minutes / day", "Screenshot analysis"],
    popular: true,
    cta: "Join waitlist",
  },
  {
    name: "Standard",
    price: "$9",
    features: ["2,000 LLM calls / day", "120 STT minutes / day", "Agent pipeline"],
    cta: "Join waitlist",
  },
  {
    name: "Genesis",
    price: "$19",
    features: ["10,000 LLM calls / day", "600 STT minutes / day", "Priority support"],
    cta: "Join waitlist",
  },
]

function YomiMockup() {
  return (
    <div className="relative">
      <div className="absolute -inset-10 bg-accent/5 blur-3xl rounded-full pointer-events-none" />
      <Card className="relative overflow-hidden shadow-2xl shadow-black/60 border-edge/60">
        {/* Titlebar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge/50 bg-panel-2">
          <div className="flex gap-1.5">
            <div className="size-2.5 rounded-full bg-red-500/50" />
            <div className="size-2.5 rounded-full bg-yellow-500/50" />
            <div className="size-2.5 rounded-full bg-green-500/50" />
          </div>
          <span className="font-mono text-[10px] text-caption tracking-[0.2em]">YOMI</span>
          <kbd className="font-mono text-[10px] text-caption bg-edge/60 px-1.5 py-0.5 rounded border border-edge">
            ⌘K
          </kbd>
        </div>

        {/* Prompt */}
        <div className="px-4 py-3 border-b border-edge/30">
          <div className="flex items-start gap-2.5">
            <div className="mt-[5px] size-1.5 rounded-full bg-accent shrink-0" />
            <p className="text-sm text-label/80 font-light">
              summarize what&apos;s on my screen
            </p>
          </div>
        </div>

        {/* Response */}
        <CardContent className="px-4 py-4 space-y-3">
          <p className="font-mono text-[10px] text-caption uppercase tracking-widest">
            I can see on your screen:
          </p>
          <div className="space-y-2">
            {[
              "Code editor — Python, line 42 has an error",
              "3 browser tabs about async/await",
              "Slack — 2 unread messages from your team",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="text-accent text-xs mt-0.5 shrink-0">▸</span>
                <span className="text-xs text-label/70 leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 pt-1">
            <span className="inline-block w-0.5 h-4 bg-accent animate-blink-cursor" />
          </div>
        </CardContent>

        {/* Status bar */}
        <div className="px-4 py-2 border-t border-edge/30 bg-panel-2 flex items-center justify-between">
          <span className="font-mono text-[10px] text-caption">answer · 0.6s</span>
          <div className="flex items-center gap-1.5">
            <div className="size-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="font-mono text-[10px] text-caption">active</span>
          </div>
        </div>
      </Card>
    </div>
  )
}

export function LandingPage() {
  return (
    <main className="min-h-dvh bg-canvas">
      <Nav />

      {/* ── Hero ───────────────────────────────────── */}
      <section className="relative min-h-[calc(100dvh-4rem)] flex items-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: [
              "radial-gradient(ellipse 900px 700px at 75% 20%, rgba(45,212,191,0.06) 0%, transparent 70%)",
              "radial-gradient(ellipse 700px 500px at 10% 85%, rgba(245,158,11,0.03) 0%, transparent 60%)",
            ].join(", "),
          }}
        />

        <div className="max-w-6xl mx-auto px-6 py-24 w-full relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              variants={stagger}
              initial="hidden"
              animate="visible"
              className="space-y-8"
            >
              <motion.div variants={fadeUp}>
                <Badge variant="default">
                  <span className="size-1.5 rounded-full bg-accent animate-pulse mr-2" />
                  Early access — join the waitlist
                </Badge>
              </motion.div>

              <motion.h1
                variants={fadeUp}
                className="text-5xl sm:text-6xl lg:text-[5rem] font-semibold leading-[1.03] tracking-tight"
              >
                Your AI buddy
                <br />
                <span className="text-accent">on every screen.</span>
              </motion.h1>

              <motion.p
                variants={fadeUp}
                className="text-lg text-caption leading-relaxed max-w-md"
              >
                Press <kbd className="font-mono text-xs bg-panel-2 border border-edge px-1.5 py-0.5 rounded text-label">⌘Space</kbd>. Yomi sees your screen, hears your voice, and acts — so you touch your laptop less.
              </motion.p>

              <motion.div variants={fadeUp} className="flex flex-wrap gap-3">
                <Link
                  href="#waitlist"
                  className={cn(buttonVariants({ size: "lg" }), "gap-2")}
                >
                  Join waitlist
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/pricing"
                  className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
                >
                  See plans
                </Link>
              </motion.div>

              <motion.div
                variants={fadeUp}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-xs text-caption">Available for</span>
                {["macOS", "Windows"].map((p) => (
                  <span
                    key={p}
                    className="px-2.5 py-1 rounded-md bg-panel border border-edge text-xs font-mono text-caption"
                  >
                    {p}
                  </span>
                ))}
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
              className="flex justify-center lg:justify-end"
            >
              <YomiMockup />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────── */}
      <section className="py-28 border-t border-edge/30">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <Badge variant="secondary" className="mb-4">How it works</Badge>
          <h2 className="text-4xl sm:text-5xl font-semibold mb-20">
            Three motions to{" "}
            <span className={cn(caveat.className, "text-accent text-5xl sm:text-6xl")}>done.</span>
          </h2>

          <div className="grid sm:grid-cols-3 gap-10 relative">
            <div className="hidden sm:block absolute top-8 left-[calc(16.7%+2rem)] right-[calc(16.7%+2rem)] h-px bg-gradient-to-r from-transparent via-edge to-transparent" />

            {[
              { icon: <Command className="size-6" />, num: "01", title: "Press the hotkey", desc: "Summon Yomi from anywhere. Works in any app, any window." },
              { icon: <Eye className="size-6" />, num: "02", title: "Yomi sees and hears", desc: "Instant screenshot plus your voice. Full context in under 300ms." },
              { icon: <Zap className="size-6" />, num: "03", title: "Done.", desc: "Answer spoken back. Task running in the background. Eyes stay on your work." },
            ].map((step) => (
              <div key={step.num} className="text-center space-y-5">
                <div className="mx-auto size-16 rounded-2xl bg-panel border border-edge flex items-center justify-center text-accent">
                  {step.icon}
                </div>
                <div>
                  <p className="font-mono text-xs text-caption mb-2 tracking-widest">{step.num}</p>
                  <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                  <p className="text-sm text-caption leading-relaxed max-w-xs mx-auto">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ────────────────────────────────── */}
      <section className="py-28 border-t border-edge/30">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-4">
            <Badge variant="secondary" className="mb-4">Features</Badge>
            <h2 className="text-4xl sm:text-5xl font-semibold mb-20">
              Every feature you&apos;ll actually{" "}
              <span className={cn(caveat.className, "text-accent text-5xl sm:text-6xl")}>use.</span>
            </h2>
          </div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {features.map((f) => (
              <motion.div key={f.title} variants={fadeUp}>
                <Card className="h-full border-edge/50 hover:border-accent/20 transition-colors">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent/10 border border-accent/10 mb-4">
                    <f.icon className="size-4 text-accent" />
                  </div>
                  <CardTitle className="text-base mb-1">{f.title}</CardTitle>
                  <CardDescription>{f.description}</CardDescription>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────── */}
      <section className="py-28 border-t border-edge/30">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <Badge variant="secondary" className="mb-4">Pricing</Badge>
          <h2 className="text-4xl sm:text-5xl font-semibold mb-4">
            Simple pricing.{" "}
            <span className={cn(caveat.className, "text-accent text-5xl sm:text-6xl")}>Powerful AI.</span>
          </h2>
          <p className="text-caption mb-20 max-w-sm mx-auto leading-relaxed">
            Start free. Upgrade when you need more.
            <br />
            Paid via Razorpay — cards, UPI, and international payments.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 text-left">
            {plans.map((plan) => (
              <Card
                key={plan.name}
                className={cn(
                  "relative flex flex-col",
                  plan.popular && "border-accent/30 shadow-xl shadow-accent/5",
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-accent text-canvas border-0 font-semibold">
                      Most popular
                    </Badge>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-semibold">{plan.price}</span>
                    {plan.price !== "$0" && (
                      <span className="text-sm text-caption">/mo</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-label/70">
                        <Check className="size-4 text-accent mt-0.5 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <div className="px-6 pb-6">
                  <Link
                    href="#waitlist"
                    className={cn(
                      buttonVariants({
                        variant: plan.popular ? "default" : "outline",
                      }),
                      "w-full",
                    )}
                  >
                    {plan.cta}
                  </Link>
                </div>
              </Card>
            ))}
          </div>

          <p className="text-center mt-10">
            <Link
              href="/pricing"
              className="text-sm text-accent hover:text-accent/80 transition-colors"
            >
              Compare all features →
            </Link>
          </p>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────── */}
      <section
        className="py-28 border-t border-edge/30 text-center"
        style={{
          background:
            "radial-gradient(ellipse 800px 400px at 50% 50%, rgba(45,212,191,0.04) 0%, transparent 70%)",
        }}
      >
        <div className="max-w-xl mx-auto px-6 space-y-6">
          <h2 className="text-4xl sm:text-5xl font-semibold">
            Be the first to try{" "}
            <span className={cn(caveat.className, "text-accent text-5xl sm:text-6xl")}>Yomi.</span>
          </h2>
          <p className="text-caption leading-relaxed">
            Join the waitlist and get early access when we launch.
          </p>
          <div id="waitlist" className="max-w-sm mx-auto">
            <WaitlistForm />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
