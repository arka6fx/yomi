import Link from "next/link"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import WaitlistForm from "@/components/WaitlistForm"
import PricingCard from "@/components/PricingCard"

function YomiMockup() {
  return (
    <div className="relative w-full max-w-sm mx-auto lg:mx-0">
      {/* Ambient glow */}
      <div className="absolute -inset-8 bg-accent/8 blur-3xl rounded-full pointer-events-none" />

      {/* Floating panel */}
      <div className="relative bg-panel border border-edge rounded-2xl overflow-hidden shadow-2xl shadow-black/70 animate-float">
        {/* Titlebar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-panel-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
          </div>
          <span className="font-mono text-[11px] text-caption tracking-[0.2em]">YOMI</span>
          <kbd className="font-mono text-[10px] text-caption bg-edge/80 px-1.5 py-0.5 rounded border border-edge">
            ⌘K
          </kbd>
        </div>

        {/* User prompt */}
        <div className="px-4 py-3 border-b border-edge/50">
          <div className="flex items-start gap-2.5">
            <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
            <p className="text-sm text-label/90 font-light leading-relaxed">
              summarize what&apos;s on my screen
            </p>
          </div>
        </div>

        {/* Response */}
        <div className="px-4 py-4 space-y-3">
          <p className="font-mono text-[10px] text-caption uppercase tracking-widest">
            I can see on your screen:
          </p>
          <div className="space-y-2.5">
            {[
              "Code editor — Python script, line 42 has an error",
              "3 browser tabs open about async/await",
              "Slack — 2 unread messages from your team",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <span className="text-accent text-xs mt-0.5 flex-shrink-0">▸</span>
                <span className="text-xs text-label/75 leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 pt-1">
            <span className="inline-block w-0.5 h-4 bg-accent animate-blink-cursor" />
          </div>
        </div>

        {/* Status bar */}
        <div className="px-4 py-2 border-t border-edge/50 bg-panel-2 flex items-center justify-between">
          <span className="font-mono text-[10px] text-caption">haiku · 0.6s</span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="font-mono text-[10px] text-caption">active</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const steps = [
  {
    num: "01",
    icon: "⌘",
    key: "⌘ Space",
    title: "Press the hotkey",
    desc: "Summon Yomi from anywhere. Works in any app, any window, any time.",
  },
  {
    num: "02",
    icon: "◉",
    key: "see + hear",
    title: "Yomi sees and hears",
    desc: "Instant screenshot plus your voice. Full context captured in under 300 ms.",
  },
  {
    num: "03",
    icon: "⚡",
    key: "done",
    title: "Done.",
    desc: "Answer spoken back. Task running in the background. Eyes stay on your work.",
  },
]

const features = [
  {
    icon: "⚡",
    title: "Fast answers",
    desc: "Cached system prompt + single LLM call. Under 2 seconds on the fast path, always.",
  },
  {
    icon: "◎",
    title: "Autonomous tasks",
    desc: "ReAct agent loop with MCP connectors — calendar, email, Notion, browser, and more.",
  },
  {
    icon: "◉",
    title: "Persistent memory",
    desc: "Remembers your preferences, your projects, and the context from previous sessions.",
  },
  {
    icon: "◻",
    title: "Cross-platform",
    desc: "Mac menu bar, Windows system tray, Linux Waybar. Native feel on every OS.",
  },
  {
    icon: "⬡",
    title: "Private by default",
    desc: "Local-first. Password managers and banking apps are never captured. You control the data.",
  },
  {
    icon: "⊞",
    title: "Bring your own key",
    desc: "Use your own Anthropic or OpenAI key on any plan. No lock-in.",
  },
]

const plans = [
  {
    name: "Free",
    price: "Free",
    features: [
      "50 fast queries / day",
      "1 agent run / month",
      "Local STT + TTS",
      "Bring your own key",
    ],
    cta: "Join waitlist",
    ctaHref: "#waitlist",
  },
  {
    name: "Pro",
    price: "$20",
    features: [
      "Unlimited fast queries",
      "100 agent runs / month",
      "Cloud STT + TTS",
      "MCP connectors + cloud sync",
    ],
    cta: "Join waitlist",
    ctaHref: "#waitlist",
    popular: true,
  },
  {
    name: "Max",
    price: "$50",
    features: [
      "Unlimited fast queries",
      "500 agent runs / month",
      "Priority latency",
      "Cloud subagents",
    ],
    cta: "Join waitlist",
    ctaHref: "#waitlist",
  },
  {
    name: "Team",
    price: "$30",
    period: "/user/mo",
    features: [
      "Everything in Pro",
      "SSO + admin console",
      "Shared MCP connectors",
      "500 agent runs / user / mo",
    ],
    cta: "Contact us",
    ctaHref: "#waitlist",
  },
]

export default function Home() {
  return (
    <>
      <Nav />
      <main className="pt-16">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <section
          className="relative min-h-[calc(100vh-4rem)] flex items-center overflow-hidden"
          style={{
            background: [
              "radial-gradient(ellipse 900px 700px at 75% 20%, rgba(45,212,191,0.07) 0%, transparent 70%)",
              "radial-gradient(ellipse 700px 500px at 10% 85%, rgba(245,158,11,0.04) 0%, transparent 60%)",
            ].join(", "),
          }}
        >
          <div className="max-w-6xl mx-auto px-6 py-24 w-full">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              {/* Text */}
              <div className="space-y-8">
                <div
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-panel border border-edge text-xs font-mono text-caption animate-fade-up"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-warm animate-pulse" />
                  Early access — join the waitlist
                </div>

                <h1
                  className="font-display text-5xl sm:text-6xl lg:text-[5rem] font-extrabold leading-[1.03] tracking-tight animate-fade-up"
                  style={{ animationDelay: "80ms" }}
                >
                  Your AI buddy
                  <br />
                  <span className="text-accent">on every screen.</span>
                </h1>

                <p
                  className="text-lg text-caption leading-relaxed max-w-md animate-fade-up"
                  style={{ animationDelay: "160ms" }}
                >
                  Press a hotkey. Yomi sees your screen, hears your voice, and
                  acts — so you touch your laptop less.
                </p>

                <div
                  id="waitlist"
                  className="animate-fade-up"
                  style={{ animationDelay: "240ms" }}
                >
                  <WaitlistForm />
                </div>

                <div
                  className="flex flex-wrap items-center gap-2 animate-fade-up"
                  style={{ animationDelay: "320ms" }}
                >
                  <span className="text-xs text-caption">Available for</span>
                  {["macOS", "Windows", "Linux"].map((p) => (
                    <span
                      key={p}
                      className="px-2.5 py-1 rounded-md bg-panel border border-edge text-xs font-mono text-caption"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              {/* Mockup */}
              <div
                className="flex justify-center lg:justify-end animate-fade-up"
                style={{ animationDelay: "200ms" }}
              >
                <YomiMockup />
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────── */}
        <section className="py-28 border-t border-edge/40">
          <div className="max-w-6xl mx-auto px-6">
            <p className="font-mono text-xs text-caption uppercase tracking-widest text-center mb-3">
              How it works
            </p>
            <h2 className="font-display text-4xl sm:text-5xl font-extrabold text-center mb-20">
              Three keystrokes to done.
            </h2>

            <div className="grid sm:grid-cols-3 gap-10 relative">
              {/* Connector */}
              <div className="hidden sm:block absolute top-8 left-[calc(16.7%+2rem)] right-[calc(16.7%+2rem)] h-px bg-gradient-to-r from-transparent via-edge to-transparent" />

              {steps.map((step) => (
                <div key={step.num} className="text-center space-y-5">
                  <div className="mx-auto w-16 h-16 rounded-2xl bg-panel border border-edge flex items-center justify-center text-2xl font-mono text-accent">
                    {step.icon}
                  </div>
                  <div>
                    <p className="font-mono text-xs text-caption mb-2 tracking-widest">
                      {step.num}
                    </p>
                    <h3 className="font-display text-xl font-bold mb-2">{step.title}</h3>
                    <p className="text-sm text-caption leading-relaxed max-w-xs mx-auto">
                      {step.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────────── */}
        <section className="py-28 border-t border-edge/40">
          <div className="max-w-6xl mx-auto px-6">
            <p className="font-mono text-xs text-caption uppercase tracking-widest text-center mb-3">
              Features
            </p>
            <h2 className="font-display text-4xl sm:text-5xl font-extrabold text-center mb-20">
              Every feature you&apos;ll actually use.
            </h2>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="group p-6 rounded-2xl bg-panel border border-edge hover:border-accent/25 transition-all"
                >
                  <div className="mb-4 w-10 h-10 rounded-xl bg-panel-2 border border-edge group-hover:border-accent/20 flex items-center justify-center text-lg transition-all">
                    {f.icon}
                  </div>
                  <h3 className="font-display font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-caption leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Pricing teaser ────────────────────────────────────── */}
        <section className="py-28 border-t border-edge/40">
          <div className="max-w-6xl mx-auto px-6">
            <p className="font-mono text-xs text-caption uppercase tracking-widest text-center mb-3">
              Pricing
            </p>
            <h2 className="font-display text-4xl sm:text-5xl font-extrabold text-center mb-4">
              Simple pricing. Powerful AI.
            </h2>
            <p className="text-center text-caption mb-20 max-w-sm mx-auto leading-relaxed">
              Start free. Upgrade when you need more.
              <br />
              Annual plans save 2 months.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {plans.map((plan) => (
                <PricingCard key={plan.name} {...plan} />
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

        {/* ── CTA ───────────────────────────────────────────────── */}
        <section
          className="py-28 border-t border-edge/40"
          style={{
            background:
              "radial-gradient(ellipse 800px 400px at 50% 50%, rgba(45,212,191,0.05) 0%, transparent 70%)",
          }}
        >
          <div className="max-w-xl mx-auto px-6 text-center space-y-6">
            <h2 className="font-display text-4xl sm:text-5xl font-extrabold">
              Be the first to try Yomi.
            </h2>
            <p className="text-caption leading-relaxed">
              Join the waitlist and get early access when we launch.
            </p>
            <WaitlistForm />
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
