import type { Metadata } from "next"
import Link from "next/link"
import {
  Brain,
  Check,
  CircleDot,
  Image as ImageIcon,
  Keyboard,
  Mic,
  Monitor,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { ConnectorIcon } from "@yomi/ui-connectors"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Everything Yomi can do today: the desktop assistant, Telegram bot, app connectors, memory, voice, and how plans and credits work.",
  alternates: { canonical: "https://yomi.arka6fx.com/docs" },
}

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "getting-started", label: "Getting started" },
  { id: "desktop", label: "Desktop assistant" },
  { id: "telegram", label: "Telegram bot" },
  { id: "connectors", label: "App connectors" },
  { id: "memory", label: "Memory & knowledge" },
  { id: "voice-vision", label: "Voice & vision" },
  { id: "approvals", label: "Approvals & safety" },
  { id: "plans", label: "Plans & credits" },
  { id: "privacy", label: "Privacy" },
]

const CONNECTORS: { id: string; name: string; access: string }[] = [
  { id: "google", name: "Gmail", access: "Read, search, send, organize, and delete email" },
  { id: "google-calendar", name: "Google Calendar", access: "Read availability and create, edit, or delete events" },
  { id: "google-drive", name: "Google Drive", access: "Browse, read, create, rename, and delete files" },
  { id: "google-classroom", name: "Google Classroom", access: "Read classes, assignments, due dates, and grades" },
  { id: "github", name: "GitHub", access: "Repositories, issues, and pull requests" },
  { id: "notion", name: "Notion", access: "Search and read your shared pages and databases" },
  { id: "slack", name: "Slack", access: "Read channel context and send approved messages" },
  { id: "linear", name: "Linear", access: "Issues and project tracking (OAuth or API key)" },
]

const TELEGRAM_COMMANDS: { cmd: string; what: string }[] = [
  { cmd: "/new", what: "Start a fresh conversation (clears the current chat context)" },
  { cmd: "/stop", what: "Stop whatever Yomi is currently doing" },
  { cmd: "/pending", what: "Show actions waiting for your approval" },
  { cmd: "/approve", what: "Approve the pending action (or pick one if several)" },
  { cmd: "/deny", what: "Reject the pending action" },
  { cmd: "/help", what: "List the available commands" },
]

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
      {children}
    </span>
  )
}

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
    <section id={id} className="scroll-mt-28 border-t border-border/60 py-12 first:border-t-0 first:pt-0">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 font-serif text-3xl tracking-tight text-foreground sm:text-4xl">{title}</h2>
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

export default function DocsPage() {
  return (
    <div className="site-texture-bg min-h-dvh text-foreground">
      <Nav />

      {/* Header */}
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
            A complete, honest map of what&apos;s shipped: the desktop assistant, the Telegram bot, every app
            connector, memory, voice, and how plans and credits work.
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 lg:grid-cols-[200px_1fr]">
        {/* Sidebar */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24 space-y-1">
            {NAV.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0">
          <Section id="overview" eyebrow="Overview" title="What Yomi is">
            <p>
              Yomi is an AI assistant that runs in your Windows system tray. It can <strong className="text-foreground">see your screen</strong>,{" "}
              <strong className="text-foreground">hear your voice</strong>, and <strong className="text-foreground">act across your apps</strong>,
              so you can ask questions about your work in plain language instead of switching windows and copy-pasting.
            </p>
            <p>
              You reach Yomi two ways: the <a className="text-primary hover:underline" href="#desktop">desktop overlay</a> on your
              PC, and the <a className="text-primary hover:underline" href="#telegram">Telegram bot</a> when you&apos;re away from it. Both share
              the same memory and connected apps.
            </p>
          </Section>

          <Section id="getting-started" eyebrow="Setup" title="Getting started">
            <ol className="space-y-3">
              {[
                ["Download for Windows", "Grab the installer and launch Yomi. It lives in your system tray."],
                ["Sign in", "Continue with Google or GitHub. No password to manage."],
                ["Connect your apps", "Link Gmail, Calendar, Drive and others from the dashboard with one click each."],
                ["Link Telegram (optional)", "Use the dashboard's secure link flow to chat with Yomi from your phone."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <span>
                    <span className="font-medium text-foreground">{t}.</span> {d}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-sm">
              macOS is planned; Windows is available today.
            </p>
          </Section>

          <Section id="desktop" eyebrow="Desktop" title="The desktop assistant">
            <p>
              Yomi sits quietly in your tray and appears as a floating overlay when you call it. It reads the
              screen you point it at, so answers are grounded in what you&apos;re actually looking at.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Feature icon={<Monitor size={17} />} title="Screen-aware answers">
                Ask about whatever&apos;s on screen, like a doc, an error, or a dashboard, and get a grounded answer.
              </Feature>
              <Feature icon={<Keyboard size={17} />} title="Voice & text hotkeys">
                Trigger Yomi by hotkey, then type or speak. A fast path replies in about two seconds.
              </Feature>
              <Feature icon={<ShieldCheck size={17} />} title="Visible capture states">
                You always see when Yomi is capturing the screen, so nothing happens silently.
              </Feature>
              <Feature icon={<Sparkles size={17} />} title="Two routing paths">
                Simple questions take the quick path; anything needing your apps runs the full agent.
              </Feature>
            </div>
          </Section>

          <Section id="telegram" eyebrow="Messaging" title="Telegram bot">
            <p>
              Connect Telegram from the dashboard&apos;s secure link flow, then message Yomi like any chat. It handles
              text, <strong className="text-foreground">voice notes</strong> (transcribed automatically), and{" "}
              <strong className="text-foreground">images/screenshots</strong> for analysis.
            </p>
            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {TELEGRAM_COMMANDS.map((c) => (
                    <tr key={c.cmd} className="hover:bg-muted/40">
                      <td className="w-28 px-4 py-2.5 font-mono text-primary">{c.cmd}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{c.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="connectors" eyebrow="Integrations" title="App connectors">
            <p>
              Connect the tools you already use. Yomi requests OAuth access (or an API key) and only acts
              when you ask. Connect and manage them from your dashboard.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {CONNECTORS.map((c) => (
                <div key={c.id} className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-4">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                    <ConnectorIcon id={c.id} size={20} />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{c.name}</span>
                    <span className="block text-sm text-muted-foreground">{c.access}</span>
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="memory" eyebrow="Context" title="Memory & knowledge">
            <div className="grid gap-3 sm:grid-cols-2">
              <Feature icon={<Brain size={17} />} title="Long-term memory">
                Yomi remembers durable facts about you and your projects, so it doesn&apos;t ask the same thing twice.
                Starting a new chat clears the conversation, never your memory.
              </Feature>
              <Feature icon={<CircleDot size={17} />} title="Your documents (RAG)">
                Synced documents become searchable context, so answers can draw on your own material.
              </Feature>
            </div>
          </Section>

          <Section id="voice-vision" eyebrow="Multimodal" title="Voice & vision">
            <div className="grid gap-3 sm:grid-cols-2">
              <Feature icon={<Mic size={17} />} title="Speak and listen">
                Voice notes are transcribed, and Yomi can reply with a spoken voice message when you ask.
              </Feature>
              <Feature icon={<ImageIcon size={17} />} title="Image & screen analysis">
                Send a screenshot or photo and Yomi describes, reads, or reasons about what&apos;s in it.
              </Feature>
            </div>
          </Section>

          <Section id="approvals" eyebrow="Control" title="Approvals & safety">
            <p>
              Actions that send or change things, like sending an email, pause for your approval first. Review the
              preview, then approve or deny (on Telegram, use <span className="font-mono text-primary">/approve</span> and{" "}
              <span className="font-mono text-primary">/deny</span>). Yomi never sends on your behalf without a confirmation.
            </p>
          </Section>

          <Section id="plans" eyebrow="Billing" title="Plans & credits">
            <p>
              Every interaction draws from a single credit balance: 1 credit per AI chat, +1 per image/screen,
              2 per voice minute, 1 per Telegram message. Each plan includes a monthly credit allowance. When you
              run out, Explore upgrades to a paid plan and Pro/Max can top up with credit packs.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { name: "Explore", price: "Free", credits: "100 credits", note: "30-day trial to try everything." },
                { name: "Pro", price: "$14.99/mo", credits: "2,500 credits", note: "Higher limits + credit packs.", featured: true },
                { name: "Max", price: "$39.99/mo", credits: "10,000 credits", note: "Highest limits for heavy use." },
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
            <p className="text-sm">
              Roughly: AI chats and Telegram messages cost 1 credit, image/screen analysis adds 1, and voice adds about
              2 per minute. See <Link href="/pricing" className="text-primary hover:underline">pricing</Link> for the full breakdown.
            </p>
          </Section>

          <Section id="privacy" eyebrow="Trust" title="Privacy">
            <ul className="space-y-2.5">
              {[
                "Screen capture is always visible. Yomi never reads your screen silently.",
                "Connected-app data is used to answer your request, not stored beyond what's needed.",
                "Google Drive file contents are not retained.",
                "You can disconnect any app at any time from the dashboard.",
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check size={16} className="mt-0.5 shrink-0 text-primary" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </Section>

          <div className="mt-12 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/60 p-6">
            <Send size={18} className="text-primary" />
            <p className="text-sm text-muted-foreground">
              Ready to try it?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">Create your account</Link> or{" "}
              <Link href="/download" className="font-medium text-primary hover:underline">download for Windows</Link>.
            </p>
          </div>
        </main>
      </div>

      <Footer />
    </div>
  )
}
