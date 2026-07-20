"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
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
import { authClient } from "@/lib/auth-client"
import { useLocalPrice } from "@/lib/local-price"

import Footer from "@/components/Footer"
import Nav from "@/components/Nav"
import { ConnectorIcon } from "@yomi/ui-connectors"

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })
}

const INK = "#17130E"
const MUTED = "#6B5F52"

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

const GOOGLE_WORKSPACE_APPS = [
  { id: "google", name: "Gmail" },
  { id: "google-calendar", name: "Calendar" },
  { id: "google-drive", name: "Drive" },
  { id: "google-docs", name: "Docs" },
  { id: "google-sheets", name: "Sheets" },
  { id: "google-slides", name: "Slides" },
  { id: "google-classroom", name: "Classroom" },
  { id: "google-tasks", name: "Tasks" },
  { id: "google-meet", name: "Meet" },
]

const OTHER_CONNECTORS: { id: string; name: string; description: string }[] = [
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
    icon: Sparkles,
  },
  {
    key: "pro",
    name: "Pro",
    priceUsd: 14.99,
    period: "/ month",
    badge: "Most Popular",
    description: "Text, voice, photos, and memory for everyday work.",
    features: [
      "2,500 credits / month",
      "Buy extra credit packs anytime",
      "Text, voice, photos & memory",
      "Unlimited app connectors",
      "Web dashboard",
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
      className="landing-card flex flex-col gap-3 rounded-2xl p-5"
    >
      <div className="flex items-center justify-between">
        <span
          className="rounded-full px-2 py-0.5 font-mono text-xs"
          style={{ background: "rgba(37,99,235,0.1)", color: "#2563EB" }}
        >
          {type}
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: MUTED }}>
          <ConnectorIcon id="telegram" size={14} />
          {mode}
        </span>
      </div>
      <p className="text-sm font-medium" style={{ color: INK }}>
        {label}
      </p>
      <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
        {description}
      </p>
    </motion.div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-medium uppercase tracking-widest" style={{ color: "#9C8F7D" }}>
      {children}
    </p>
  )
}

/** Stylized product mockup — replaces the stock photo hero with a real look at
    the Telegram conversation, so visitors see the product instead of scenery. */
function ProductMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.5 }}
      className="landing-hero-card mx-auto w-full max-w-xl overflow-hidden rounded-[28px]"
    >
      <div className="flex items-center gap-2 border-b border-black/[0.06] px-5 py-3.5">
        <span className="h-2.5 w-2.5 rounded-full bg-black/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-black/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-black/10" />
        <span
          className="ml-2 inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: MUTED }}
        >
          <ConnectorIcon id="telegram" size={13} />
          Yomi on Telegram
        </span>
      </div>

      <div className="flex flex-col gap-3 px-5 py-6 sm:px-7">
        <div className="flex justify-end">
          <div
            className="max-w-[78%] rounded-2xl rounded-tr-md px-4 py-2.5 text-sm"
            style={{ background: INK, color: "#F3EEE4" }}
          >
            summarize my unread email
          </div>
        </div>

        <div className="flex justify-start">
          <div
            className="max-w-[85%] rounded-2xl rounded-tl-md border border-black/[0.06] bg-white px-4 py-3 text-sm leading-relaxed"
            style={{ color: INK }}
          >
            3 new: an invoice from Vercel ($40), a reply from Priya about the deck, and a calendar
            invite for Thu 4pm.
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span
                className="rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ background: "rgba(37,99,235,0.1)", color: "#2563EB" }}
              >
                Reply to Priya
              </span>
              <span
                className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium"
                style={{ color: MUTED }}
              >
                Not now
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 border-t border-black/[0.06] pt-3.5 text-xs" style={{ color: MUTED }}>
          <span>Connected</span>
          <span className="flex items-center gap-1.5">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-white ring-1 ring-black/5">
              <ConnectorIcon id="google" size={12} />
            </span>
            <span className="grid h-5 w-5 place-items-center rounded-full bg-white ring-1 ring-black/5">
              <ConnectorIcon id="google-calendar" size={12} />
            </span>
            <span className="grid h-5 w-5 place-items-center rounded-full bg-white ring-1 ring-black/5">
              <ConnectorIcon id="google-drive" size={12} />
            </span>
          </span>
        </div>
      </div>
    </motion.div>
  )
}

export function LandingPage() {
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const { data: session } = authClient.useSession()
  const router = useRouter()
  const localPrice = useLocalPrice()

  // forward oauth error redirects (/?error=) to the signin page
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error")
    if (code) router.replace(`/signin?error=${encodeURIComponent(code)}`)
  }, [router])

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
    <div className="landing-warm-bg min-h-screen">
      <Nav variant="light" />

      <section
        id="hero"
        style={{ marginTop: "-74px" }}
        className="relative flex flex-col overflow-hidden pb-16 pt-32 sm:pb-24 sm:pt-36"
      >
        <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-5 text-center sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-7 flex flex-wrap items-center justify-center gap-3 text-xs font-medium"
            style={{ color: MUTED }}
          >
            <span className="rounded-full border border-black/10 bg-white/70 px-3 py-1.5">
              Early access
            </span>
            <span className="flex items-center gap-1.5">
              <Zap size={14} className="fill-[#2563EB] text-[#2563EB]" />
              &lt; 2s fast path
            </span>
            <span className="hidden h-1 w-1 rounded-full bg-black/15 sm:block" />
            <span>On Telegram · text, voice, or photo</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="font-accent text-5xl leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl"
            style={{ color: INK }}
          >
            The assistant that <span className="italic">actually</span> works across your apps.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-5 max-w-xl text-base leading-relaxed sm:text-lg"
            style={{ color: MUTED }}
          >
            Text it, talk to it, or snap a photo. Yomi reads your Gmail, Calendar, Drive, GitHub,
            Slack, Notion, and more — and acts on them, with your approval, from a single Telegram
            chat.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-8 flex flex-col items-center gap-3 sm:flex-row"
          >
            <Link
              href="/signup"
              className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-full px-6 text-sm font-semibold transition hover:opacity-90"
              style={{ background: INK, color: "#F3EEE4" }}
            >
              Get started free
              <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
            </Link>
            <button
              onClick={() => scrollTo("how-it-works")}
              className="inline-flex h-12 items-center justify-center rounded-full border border-black/12 bg-white/70 px-6 text-sm font-semibold transition hover:bg-white"
              style={{ color: INK }}
            >
              See how it works
            </button>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-5 text-xs"
            style={{ color: MUTED }}
          >
            Your data is never stored.{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-[#17130E]">
              Read the privacy policy
            </Link>
          </motion.p>
        </div>

        <div className="relative z-10 mx-auto mt-14 w-full max-w-5xl px-5 sm:px-8">
          <ProductMockup />
        </div>
      </section>

      {/* ── What is Yomi?────────────────────────────────────────────────── */}
      <section id="about" className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-8 text-center">
          <SectionLabel>About</SectionLabel>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight sm:text-5xl" style={{ color: INK }}>
            What is <span className="italic">Yomi</span>?
          </h2>
        </div>
        <div className="space-y-4 text-center text-sm leading-relaxed" style={{ color: MUTED }}>
          <p>
            Yomi is an AI productivity assistant that connects to the apps you already use so you
            can query, analyze, and act on your work using natural language, without switching apps
            or copy-pasting context.
          </p>
          <p>
            Ask Yomi to find a file, summarize a document, or pull context from your workspace, all
            from a single interface or via Telegram. Yomi only accesses your data when you ask a
            question, and for no other purpose.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20" id="how-it-works">
        <div className="mb-14 text-center">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight sm:text-5xl" style={{ color: INK }}>
            Three ways to <span className="italic">ask</span>.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm" style={{ color: MUTED }}>
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

      <section id="features" className="mx-auto max-w-5xl px-6 py-20">
        <div className="mb-14 text-center">
          <SectionLabel>Built to disappear</SectionLabel>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight sm:text-5xl" style={{ color: INK }}>
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
              className="landing-card rounded-2xl p-6"
            >
              <div
                className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: "rgba(37,99,235,0.1)" }}
              >
                <feature.icon size={20} color="#2563EB" />
              </div>
              <h3 className="mb-2 font-medium" style={{ color: INK }}>
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: MUTED }}>
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Supported Integrations ───────────────────────────────────────────── */}
      <section id="connectors" className="mx-auto max-w-5xl px-6 py-20">
        <div className="mb-14 text-center">
          <SectionLabel>Supported Integrations</SectionLabel>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight sm:text-5xl" style={{ color: INK }}>
            Your tools, one <span className="italic">conversation</span> away.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm" style={{ color: MUTED }}>
            Connect your apps once. Ask Yomi from the web or from Telegram, even with your laptop
            closed.
          </p>
        </div>

        <div className="mx-auto grid max-w-4xl gap-3 sm:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="landing-card flex flex-col gap-3 rounded-2xl p-5 sm:col-span-2"
          >
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {GOOGLE_WORKSPACE_APPS.slice(0, 5).map((app) => (
                  <span
                    key={app.id}
                    className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-white ring-2 ring-[#FBF7EF]"
                  >
                    <ConnectorIcon id={app.id} size={20} />
                  </span>
                ))}
                <span
                  className="grid h-9 w-9 place-items-center rounded-full bg-black/[0.04] text-[11px] font-medium ring-2 ring-[#FBF7EF]"
                  style={{ color: MUTED }}
                >
                  +4
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: INK }}>
                  Google Workspace
                </p>
                <p className="mt-0.5 text-xs leading-snug" style={{ color: MUTED }}>
                  {GOOGLE_WORKSPACE_APPS.map((a) => a.name).join(" · ")}
                </p>
              </div>
            </div>
          </motion.div>

          {OTHER_CONNECTORS.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="landing-card flex items-start gap-3 rounded-2xl p-4"
            >
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-inset ring-black/5">
                <ConnectorIcon id={c.id} size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: INK }}>
                  {c.name}
                </p>
                <p className="mt-0.5 text-xs leading-snug" style={{ color: MUTED }}>
                  {c.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Trust ─────────────────────────────────────────────────────────── */}
      <section id="privacy" className="mx-auto max-w-3xl px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="landing-card rounded-2xl p-7 sm:p-8"
        >
          <div className="mb-5 flex items-center gap-2.5">
            <Shield size={18} color="#2563EB" />
            <p className="text-sm font-medium" style={{ color: INK }}>
              Private by default
            </p>
          </div>
          <ul className="space-y-2.5 text-sm" style={{ color: MUTED }}>
            <li className="flex items-start gap-2.5">
              <Check size={14} className="mt-0.5 shrink-0" color="#2563EB" />
              Data from your connected apps is used only to answer the question you just asked,
              and is never stored afterward.
            </li>
            <li className="flex items-start gap-2.5">
              <Check size={14} className="mt-0.5 shrink-0" color="#2563EB" />
              OAuth tokens are encrypted at rest and never shared with third parties.
            </li>
            <li className="flex items-start gap-2.5">
              <Check size={14} className="mt-0.5 shrink-0" color="#2563EB" />
              Every action that changes something — sending an email, creating an event — is
              shown to you for approval first.
            </li>
            <li className="flex items-start gap-2.5">
              <Check size={14} className="mt-0.5 shrink-0" color="#2563EB" />
              You can disconnect any integration at any time from your dashboard.
            </li>
          </ul>
          <p className="mt-5 text-sm" style={{ color: MUTED }}>
            Full detail on data handling, Google API scopes, and your rights is in the{" "}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-[#17130E]" style={{ color: INK }}>
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="underline underline-offset-2 hover:text-[#17130E]" style={{ color: INK }}>
              Terms of Service
            </Link>
            .
          </p>
        </motion.div>
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-6 py-20">
        <div className="mb-14 text-center">
          <SectionLabel>Pricing</SectionLabel>
          <h2 className="font-accent text-4xl leading-[1.08] tracking-tight sm:text-5xl" style={{ color: INK }}>
            Simple, <span className="italic">honest</span> pricing.
          </h2>
          <p className="mt-3 text-sm" style={{ color: MUTED }}>
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
                className="landing-card relative flex flex-col rounded-2xl p-6"
                style={plan.popular ? { borderColor: "rgba(23,19,14,0.28)" } : undefined}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span
                      className="whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium"
                      style={{ background: INK, color: "#F3EEE4" }}
                    >
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="mb-5">
                  <div className="mb-2 flex items-center gap-2">
                    <Icon size={18} color="#2563EB" />
                    <p className="text-sm font-medium" style={{ color: INK }}>
                      {plan.name}
                    </p>
                    {!plan.popular && plan.badge && (
                      <span
                        className="rounded-full border border-black/10 px-1.5 py-0.5 text-[10px]"
                        style={{ color: MUTED }}
                      >
                        {plan.badge}
                      </span>
                    )}
                  </div>
                  <div className="mb-2 flex items-baseline gap-1">
                    <span className="font-accent text-4xl" style={{ color: INK }}>
                      {localPrice.format(plan.priceUsd)}
                    </span>
                    <span className="text-sm" style={{ color: MUTED }}>
                      {plan.period}
                    </span>
                  </div>
                  {localPrice.localized && plan.priceUsd > 0 && (
                    <p className="mb-1 text-xs" style={{ color: MUTED }}>
                      approx. — billed as ${plan.priceUsd} USD
                    </p>
                  )}
                  <p className="text-sm" style={{ color: MUTED }}>
                    {plan.description}
                  </p>
                </div>

                <ul className="mb-8 flex-1 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm" style={{ color: MUTED }}>
                      <Check size={14} className="mt-0.5 shrink-0" color="#2563EB" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handlePlanClick(plan.key)}
                  disabled={billingLoading !== null}
                  className="flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-medium transition-colors disabled:opacity-70"
                  style={
                    plan.popular
                      ? { background: INK, color: "#F3EEE4" }
                      : { border: "1px solid rgba(23,19,14,0.15)", color: INK }
                  }
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
          className="mt-8 text-center text-xs"
          style={{ color: MUTED }}
        >
          * Credits are a simple usage balance. Explore is a 30-day free trial; Pro and Max can buy
          extra credit packs.
        </motion.p>
      </section>

      <Footer variant="light" />
    </div>
  )
}
