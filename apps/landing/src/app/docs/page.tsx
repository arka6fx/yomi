import type { Metadata } from "next"
import Link from "next/link"
import {
  Brain,
  Check,
  CircleDot,
  Crown,
  Cuboid,
  Globe,
  Image as ImageIcon,
  Keyboard,
  Lock,
  Mic,
  Plug,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { ConnectorIcon, buildCatalog } from "@yomi/ui-connectors"
import type { ConnectorCategory } from "@yomi/ui-connectors"
import Footer from "@/components/Footer"
import { DocsShell } from "@/components/docs/DocsShell"
import { DocsHero } from "@/components/docs/DocsHero"

export const metadata: Metadata = {
  title: "Docs: connectors, voice, memory, and credits",
  description:
    "Everything Yomi can do today: Telegram bot, app connectors, memory, voice, and how plans and credits work.",
  alternates: { canonical: "https://getyomi.in/docs" },
}

// Live from the same catalog the dashboard's Connections tab uses — this used
// to be its own hand-maintained list of 14 connectors and silently fell years
// behind the ~50 Composio actually wired up. Single source of truth now.
const CONNECTED_CATALOG = buildCatalog().filter((c) => c.available)

const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  email: "Email",
  productivity: "Productivity",
  communication: "Communication",
  meetings: "Meetings",
  developer: "Developer",
  crm: "CRM",
  "data-analytics": "Data & analytics",
  data: "Data",
  finance: "Finance",
  "file-management": "File management",
  "file-storage": "File storage",
  "customer-support": "Customer support",
  food: "Food",
  other: "Other",
}

// Display order for category sections — only ones with connectors render.
const CATEGORY_ORDER: ConnectorCategory[] = [
  "email",
  "productivity",
  "communication",
  "meetings",
  "developer",
  "crm",
  "data-analytics",
  "data",
  "finance",
  "file-management",
  "file-storage",
  "customer-support",
  "food",
  "other",
]

const CONNECTORS_BY_CATEGORY = CATEGORY_ORDER.map((category) => ({
  category,
  label: CATEGORY_LABELS[category],
  connectors: CONNECTED_CATALOG.filter((c) => c.category === category),
})).filter((group) => group.connectors.length > 0)

const TELEGRAM_COMMANDS: { cmd: string; what: string }[] = [
  { cmd: "/new", what: "Start a fresh conversation (clears the current chat context)" },
  { cmd: "/stop", what: "Stop whatever Yomi is currently doing" },
  { cmd: "/pending", what: "Show actions waiting for your approval" },
  { cmd: "/approve", what: "Approve the pending action (or pick one if several)" },
  { cmd: "/deny", what: "Reject the pending action" },
  { cmd: "/help", what: "List the available commands" },
]

type Tone =
  | "primary"
  | "emerald"
  | "sky"
  | "blue"
  | "violet"
  | "amber"
  | "rose"
  | "teal"
  | "yellow"
  | "cyan"

const TONE_CLASSES: Record<Tone, { badge: string; icon: string }> = {
  primary: { badge: "border-primary/25 bg-primary/10 text-primary", icon: "bg-primary/10 text-primary" },
  emerald: {
    badge: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    icon: "bg-emerald-500/10 text-emerald-400",
  },
  sky: { badge: "border-sky-500/25 bg-sky-500/10 text-sky-400", icon: "bg-sky-500/10 text-sky-400" },
  blue: { badge: "border-blue-500/25 bg-blue-500/10 text-blue-400", icon: "bg-blue-500/10 text-blue-400" },
  violet: {
    badge: "border-violet-500/25 bg-violet-500/10 text-violet-400",
    icon: "bg-violet-500/10 text-violet-400",
  },
  amber: {
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    icon: "bg-amber-500/10 text-amber-400",
  },
  rose: { badge: "border-rose-500/25 bg-rose-500/10 text-rose-400", icon: "bg-rose-500/10 text-rose-400" },
  teal: { badge: "border-teal-500/25 bg-teal-500/10 text-teal-400", icon: "bg-teal-500/10 text-teal-400" },
  yellow: {
    badge: "border-yellow-500/25 bg-yellow-500/10 text-yellow-400",
    icon: "bg-yellow-500/10 text-yellow-400",
  },
  cyan: { badge: "border-cyan-500/25 bg-cyan-500/10 text-cyan-400", icon: "bg-cyan-500/10 text-cyan-400" },
}

function Eyebrow({
  children,
  tone = "primary",
  icon,
}: {
  children: React.ReactNode
  tone?: Tone
  icon?: React.ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] ${TONE_CLASSES[tone].badge}`}
    >
      {icon}
      {children}
    </span>
  )
}

function Section({
  id,
  eyebrow,
  title,
  tone = "primary",
  icon,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  tone?: Tone
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 border-t border-border/60 py-12 first:border-t-0 first:pt-0"
    >
      <Eyebrow tone={tone} icon={icon}>
        {eyebrow}
      </Eyebrow>
      <h2 className="mt-4 font-serif text-3xl tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  )
}

function Feature({
  icon,
  title,
  tone = "primary",
  children,
}: {
  icon: React.ReactNode
  title: string
  tone?: Tone
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div
        className={`flex size-9 items-center justify-center rounded-lg ${TONE_CLASSES[tone].icon}`}
      >
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

export default function DocsPage() {
  return (
    <div className="site-texture-bg min-h-dvh text-foreground">
      <DocsShell banner={<DocsHero />}>
        <Section id="overview" eyebrow="Overview" title="What Yomi is">
          <p>
            Yomi is an AI assistant that connects to the apps you already use. It can{" "}
            <strong className="text-foreground">analyze images and screenshots</strong>,{" "}
            <strong className="text-foreground">hear your voice</strong>, and{" "}
            <strong className="text-foreground">act across your apps</strong>, so you can ask
            questions about your work in plain language instead of switching windows and
            copy-pasting.
          </p>
          <p>
            You reach Yomi through the{" "}
            <a className="text-primary hover:underline" href="#web">
              web app
            </a>{" "}
            or the{" "}
            <a className="text-primary hover:underline" href="#telegram">
              Telegram bot
            </a>
            . Both share the same memory and connected apps.
          </p>
        </Section>

        <Section
          id="getting-started"
          eyebrow="Setup"
          title="Getting started"
          tone="emerald"
          icon={<Rocket size={11} />}
        >
          <ol className="space-y-3">
            {[
              ["Sign up", "Create your account with Google or GitHub. No password to manage."],
              [
                "Connect your apps",
                "Link Gmail, Calendar, Drive and others from the dashboard with one click each.",
              ],
              [
                "Start chatting",
                "Ask Yomi from the web app or link Telegram to chat from your phone.",
              ],
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
        </Section>

        <Section id="web" eyebrow="Web" title="The web app" tone="sky" icon={<Globe size={11} />}>
          <p>
            Open Yomi in your browser from the dashboard. It connects to your apps and can read
            documents, search email, and act across your connected tools. Voice and vision work
            through your browser too.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<ImageIcon size={17} />} title="Image analysis" tone="sky">
              Upload a screenshot or photo and get grounded answers in context.
            </Feature>
            <Feature icon={<Keyboard size={17} />} title="Voice & text" tone="sky">
              Type or speak your question. A fast path replies in about two seconds.
            </Feature>
            <Feature icon={<ShieldCheck size={17} />} title="Visible actions" tone="sky">
              Actions that send or change things pause for your approval first.
            </Feature>
            <Feature icon={<Sparkles size={17} />} title="Two routing paths" tone="sky">
              Simple questions take the quick path; anything needing your apps runs the full agent.
            </Feature>
          </div>
        </Section>

        <Section
          id="telegram"
          eyebrow="Messaging"
          title="Telegram bot"
          tone="blue"
          icon={<Send size={11} />}
        >
          <p>
            Connect Telegram from the dashboard&apos;s secure link flow, then message Yomi like any
            chat. It handles text, <strong className="text-foreground">voice notes</strong>{" "}
            (transcribed automatically), and{" "}
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

        <Section
          id="connectors"
          eyebrow="Integrations"
          title="App connectors"
          tone="violet"
          icon={<Plug size={11} />}
        >
          <p>
            Connect the tools you already use. Yomi requests OAuth access (or an API key) and only
            acts when you ask. Connect and manage them from your dashboard —{" "}
            {CONNECTED_CATALOG.length} apps and counting.
          </p>
          <div className="space-y-6">
            {CONNECTORS_BY_CATEGORY.map((group) => (
              <div key={group.category}>
                <p className="mb-2.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {group.label}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {group.connectors.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-4"
                    >
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                        <ConnectorIcon id={c.id} size={20} />
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-foreground">
                          {c.name}
                        </span>
                        <span className="block text-sm text-muted-foreground">
                          {c.description}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="memory"
          eyebrow="Context"
          title="Memory & knowledge"
          tone="amber"
          icon={<Brain size={11} />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<Brain size={17} />} title="Long-term memory" tone="amber">
              Yomi remembers durable facts about you and your projects, so it doesn&apos;t ask the
              same thing twice. Starting a new chat clears the conversation, never your memory.
            </Feature>
            <Feature icon={<CircleDot size={17} />} title="Your documents (RAG)" tone="amber">
              Synced documents become searchable context, so answers can draw on your own material.
            </Feature>
          </div>
        </Section>

        <Section
          id="voice-vision"
          eyebrow="Multimodal"
          title="Voice & vision"
          tone="rose"
          icon={<Mic size={11} />}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Feature icon={<Mic size={17} />} title="Speak and listen" tone="rose">
              Voice notes are transcribed, and Yomi replies with a voice message back by default —
              or say &quot;reply in voice&quot; on a typed message to get one there too.
            </Feature>
            <Feature icon={<ImageIcon size={17} />} title="Image analysis" tone="rose">
              Send a screenshot or photo and Yomi describes, reads, or reasons about what&apos;s in
              it.
            </Feature>
          </div>
        </Section>

        <Section
          id="approvals"
          eyebrow="Control"
          title="Approvals & safety"
          tone="teal"
          icon={<ShieldCheck size={11} />}
        >
          <p>
            Actions that send or change things, like sending an email, pause for your approval
            first. Review the preview, then approve or deny (on Telegram, use{" "}
            <span className="font-mono text-primary">/approve</span> and{" "}
            <span className="font-mono text-primary">/deny</span>). Yomi never sends on your behalf
            without a confirmation.
          </p>
        </Section>

        <Section
          id="plans"
          eyebrow="Billing"
          title="Plans & credits"
          tone="yellow"
          icon={<Sparkles size={11} />}
        >
          <p>
            Every interaction draws from a single credit balance. Each plan includes a monthly
            credit allowance, and your dashboard shows remaining credits, recent activity, and the
            next reset date. When you run out, Explore upgrades to a paid plan and Pro/Max can top
            up with credit packs.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                name: "Explore",
                price: "Free",
                credits: "25 credits",
                note: "30-day trial to try everything.",
                icon: Sparkles,
              },
              {
                name: "Pro",
                price: "$14.99/mo",
                credits: "2,500 credits",
                note: "Higher limits + credit packs.",
                icon: Crown,
                featured: true,
              },
              {
                name: "Max",
                price: "$39.99/mo",
                credits: "10,000 credits",
                note: "Highest limits for heavy use.",
                icon: Cuboid,
              },
            ].map((p) => (
              <div
                key={p.name}
                className={
                  p.featured
                    ? "rounded-2xl border border-primary/40 bg-primary/5 p-5 shadow-lg shadow-primary/10"
                    : "rounded-2xl border border-border bg-card/60 p-5"
                }
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <p.icon size={15} className="text-primary" />
                    {p.name}
                  </span>
                  <span className="text-sm text-muted-foreground">{p.price}</span>
                </div>
                <p className="mt-2 font-serif text-xl text-foreground">{p.credits}</p>
                <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>
              </div>
            ))}
          </div>
          <p className="text-sm">
            Credits abstract away the underlying model, voice, vision, memory, and connector costs
            so Yomi can improve routing without changing the dashboard experience.
          </p>
        </Section>

        <Section
          id="privacy"
          eyebrow="Trust"
          title="Privacy"
          tone="cyan"
          icon={<Lock size={11} />}
        >
          <ul className="space-y-2.5">
            {[
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

        <div className="relative mt-12 overflow-hidden rounded-2xl border border-primary/20 bg-card/60 p-6 sm:p-8">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 140% at 15% 0%, hsl(var(--primary) / 0.14), transparent 60%)",
            }}
          />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="flex items-center gap-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Send size={18} />
              </div>
              <p className="text-sm text-muted-foreground">
                Ready to try it? Create your account or open the dashboard to get started.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Link
                href="/dashboard"
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
              >
                Open the dashboard
              </Link>
              <Link
                href="/signup"
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Create your account
              </Link>
            </div>
          </div>
        </div>
      </DocsShell>

      <Footer />
    </div>
  )
}
