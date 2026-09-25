// Deliberately NOT "use client". This page is almost entirely static marketing copy; the
// things that genuinely need the browser are client islands (ChatDemo, LandingSkillTabs,
// OauthErrorRedirect, Nav) and the decorative motion is CSS.
import Link from "next/link"
import { ArrowRight, Check, Lock, Shield } from "lucide-react"

import LandingFooter from "@/components/landing/LandingFooter"
import { ChatDemo } from "@/components/landing/ChatDemo"
import { OauthErrorRedirect } from "@/components/landing/OauthErrorRedirect"
import Nav from "@/components/Nav"
import { LandingSkillTabs } from "@/components/skills/SkillBrowser"
import { Byline, SkillAskPill, SkillOrb } from "@/components/skills/SkillCard"
import { SKILL_CATALOG, getCatalogSkill } from "@/lib/skills-catalog"
// Deliberately the /icons subpath, not the package root. The root barrel also re-exports
// three "use client" components, so importing anything from it makes those client entry
// points and ships all ~50 connector SVGs (116 KiB) to the browser for a server-only page.
import { ConnectorIcon } from "@yomi/ui/icons"

const CONNECTORS: { id: string; name: string; description: string }[] = [
  { id: "google", name: "Gmail", description: "Read, send, and organize email" },
  { id: "google-calendar", name: "Google Calendar", description: "Create and manage events" },
  { id: "google-drive", name: "Google Drive", description: "Find, read, and edit files" },
  { id: "google-docs", name: "Google Docs", description: "Create and edit docs from Markdown" },
  { id: "google-sheets", name: "Google Sheets", description: "Read, edit, and chart spreadsheets" },
  { id: "google-slides", name: "Google Slides", description: "Build decks from Markdown" },
  {
    id: "google-classroom",
    name: "Google Classroom",
    description: "Assignments, due dates, grades",
  },
  { id: "google-tasks", name: "Google Tasks", description: "Capture and complete to-dos" },
  { id: "google-meet", name: "Google Meet", description: "Create links, recap past calls" },
  { id: "google-maps", name: "Google Maps", description: "Search for places near a location" },
  { id: "github", name: "GitHub", description: "Repos, issues, and pull requests" },
  { id: "notion", name: "Notion", description: "Search pages and databases" },
  { id: "slack", name: "Slack", description: "Read context, send approved messages" },
  { id: "linear", name: "Linear", description: "Issues and project tracking" },
]

const STEPS = [
  {
    emoji: "💬",
    label: "type a message",
    description:
      "“summarize my unread email” or “what’s on tomorrow?” Yomi replies fast, pulling context from your connected apps.",
  },
  {
    emoji: "🎙️",
    label: "send a voice note",
    description:
      "Tap and hold to record. Yomi transcribes it and gets on with the job, so you can ask on the go.",
  },
  {
    emoji: "📷",
    label: "snap a photo",
    description:
      "A receipt, a whiteboard, a screenshot. Yomi reads what’s in the image and acts on it across your apps.",
  },
]

// Emoji stickers scattered around the hero. Positions are percentages of the hero box.
const STICKERS: { emoji: string; className: string; tilt: string; delay: string }[] = [
  { emoji: "📬", className: "left-[9%] top-[16%] text-7xl", tilt: "-12deg", delay: "0s" },
  { emoji: "💬", className: "right-[10%] top-[14%] text-7xl", tilt: "8deg", delay: "1.2s" },
  { emoji: "😊", className: "-left-4 top-[40%] text-8xl", tilt: "-6deg", delay: "0.6s" },
  { emoji: "📅", className: "right-[6%] top-[40%] text-7xl", tilt: "10deg", delay: "2s" },
  { emoji: "🧾", className: "left-[20%] top-[52%] text-6xl", tilt: "14deg", delay: "1.6s" },
  { emoji: "✈️", className: "right-[20%] top-[58%] text-6xl", tilt: "-8deg", delay: "0.9s" },
  { emoji: "🔒", className: "right-[9%] top-[80%] text-7xl", tilt: "12deg", delay: "2.4s" },
  { emoji: "🎯", className: "left-[6%] top-[84%] text-7xl", tilt: "-10deg", delay: "1.4s" },
]

const TRY_THESE = SKILL_CATALOG.slice(0, 8)
const FEATURED = ["morning-brief", "meal-log", "deadline-watch"].map((id) => getCatalogSkill(id)!)

function CardLabel({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[15px] font-semibold text-foreground/75">
      <span aria-hidden>{emoji}</span> {children}
    </p>
  )
}

export function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-clip text-foreground">
      <OauthErrorRedirect />

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section id="hero" className="sky relative overflow-hidden pb-24">
          <Nav />

          <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
            {STICKERS.map((sticker) => (
              <span
                key={sticker.emoji}
                className={`sticker absolute ${sticker.className}`}
                style={
                  {
                    "--tilt": sticker.tilt,
                    animationDelay: sticker.delay,
                  } as React.CSSProperties
                }
              >
                {sticker.emoji}
              </span>
            ))}
          </div>

          <div className="relative z-10 mx-auto max-w-4xl px-4 pt-14 text-center sm:pt-20">
            <h1 className="text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.04em] text-white drop-shadow-[0_2px_12px_rgba(10,60,120,0.25)] sm:text-7xl">
              the <span className="text-white/60">assistant</span>{" "}
              <img
                src="/brand-mark-128.png"
                alt=""
                width={72}
                height={72}
                className="mx-1 inline-block size-14 -translate-y-1 rounded-full align-middle ring-4 ring-white/80 sm:size-[72px]"
              />{" "}
              that actually gets your stuff done.
            </h1>

            <div className="mt-10 flex flex-col items-center gap-3">
              <Link href="/signup" className="btn-key px-7 py-3 text-[15px]">
                text yomi
              </Link>
              <Link
                href="/signin"
                className="text-[13px] font-semibold text-white/85 hover:text-white"
              >
                already a member? log in
              </Link>
            </div>
          </div>

          <div className="relative z-10 mx-auto mt-14 flex max-w-5xl justify-center px-4">
            {/* decorative texts either side of the phone */}
            <div
              aria-hidden
              className="absolute left-4 top-24 hidden w-64 flex-col gap-3 lg:flex xl:left-0"
            >
              <p className="bubble-in -rotate-2 px-4 py-2.5 text-[15px]">
                u said you’d reply to sarah today 👀
              </p>
              <p className="bubble-out ml-auto w-fit rotate-1 px-4 py-2 text-[15px] font-medium">
                ugh. draft it for me
              </p>
              <p className="bubble-in -rotate-1 px-4 py-2.5 text-[15px]">
                done. tap approve and it’s sent ✅
              </p>
            </div>
            <div
              aria-hidden
              className="absolute right-4 top-40 hidden w-60 flex-col gap-3 lg:flex xl:right-0"
            >
              <p className="bubble-out ml-auto w-fit -rotate-1 px-4 py-2 text-[15px] font-medium">
                what’s due this week?
              </p>
              <p className="bubble-in rotate-2 px-4 py-2.5 text-[15px]">
                psych essay friday, 2 PRs to review. want a plan?
              </p>
            </div>

            <ChatDemo />
          </div>
        </section>

        {/* ── Skills ───────────────────────────────────────────────────────── */}
        <section id="skills" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="text-center">
            <p className="eyebrow">skills</p>
            <h2 className="mt-3 text-3xl font-semibold sm:text-[2.6rem]">
              add a skill. yomi gets to work today.
            </h2>
          </div>

          <div className="mt-10">
            <LandingSkillTabs />
          </div>

          <div className="mb-4 mt-14 flex items-baseline justify-between">
            <h3 className="text-lg font-semibold">try these</h3>
            <Link
              href="/skills"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              see more <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TRY_THESE.map((skill) => (
              <SkillAskPill key={skill.id} skill={skill} />
            ))}
          </div>
        </section>

        {/* ── Statement ────────────────────────────────────────────────────── */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <p className="mx-auto max-w-5xl text-center text-4xl font-semibold leading-[1.15] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
            meet yomi, an assistant that lives in your telegram{" "}
            <span className="inline-flex -space-x-3 align-middle" aria-hidden>
              {STEPS.map((step) => (
                <span
                  key={step.emoji}
                  className="orb size-14 text-3xl ring-4 ring-background sm:size-20 sm:text-5xl"
                >
                  {step.emoji}
                </span>
              ))}
            </span>{" "}
            <span className="text-foreground/25">and gets things done around the clock.</span>
          </p>

          <div className="mx-auto mt-16 grid max-w-5xl gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.label} className="surface p-6">
                <div className="flex items-center gap-3">
                  <SkillOrb emoji={step.emoji} size={44} />
                  <span className="text-xs font-semibold text-muted-foreground">
                    way {index + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{step.label}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bento ────────────────────────────────────────────────────────── */}
        <section id="features" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <h2 className="text-center text-4xl font-semibold sm:text-5xl">
            yomi does more for you.
          </h2>

          <div className="mt-12 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
            {/* what it does */}
            <div className="surface wash-lilac relative flex min-h-[420px] flex-col justify-between overflow-hidden p-8 sm:p-10">
              <CardLabel emoji="🗓️">what it does</CardLabel>
              <div
                aria-hidden
                className="pointer-events-none absolute right-6 top-8 hidden w-[330px] rotate-[-4deg] space-y-3 sm:block"
              >
                <div className="rounded-2xl bg-white/90 p-4 shadow-lg">
                  <p className="text-xs font-semibold text-muted-foreground">
                    ☀️ morning brief · 8:00
                  </p>
                  <p className="mt-2 text-sm font-semibold">3 meetings, 2 emails that matter</p>
                  <p className="text-xs text-muted-foreground">first one in 45 min · standup</p>
                </div>
                <div className="ml-10 rounded-2xl bg-white/90 p-4 shadow-lg">
                  <p className="text-sm font-semibold">send reply to sarah?</p>
                  <p className="text-xs text-muted-foreground">“thursday works, see you at 4”</p>
                  <div className="mt-3 flex gap-2 text-xs font-semibold">
                    <span className="flex-1 rounded-full bg-muted py-1.5 text-center">not now</span>
                    <span className="flex-1 rounded-full bg-foreground py-1.5 text-center text-white">
                      approve
                    </span>
                  </div>
                </div>
              </div>
              <h3 className="relative mt-48 text-4xl font-semibold leading-[1.05] sm:mt-40 sm:text-5xl">
                the <span className="text-foreground/45">assistant</span> that
                <br />
                keeps you on track.
              </h3>
            </div>

            {/* money */}
            <div className="surface wash-mint relative flex min-h-[420px] flex-col justify-between overflow-hidden p-8 sm:p-10">
              <CardLabel emoji="💳">money</CardLabel>
              <div aria-hidden className="mt-6 space-y-2.5">
                <p className="bubble-in w-fit max-w-[85%] px-4 py-2 text-sm">
                  you spent $182 this week. food delivery was half of it 👀
                </p>
                <p className="bubble-out ml-auto w-fit px-4 py-2 text-sm font-medium">
                  WAIT what 😭
                </p>
                <p className="bubble-in w-fit max-w-[85%] px-4 py-2 text-sm">
                  every payment still needs your ok. want a weekly recap?
                </p>
              </div>
              <h3 className="mt-8 text-4xl font-semibold leading-[1.05] sm:text-5xl">
                it watches
                <br />
                your money.
              </h3>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            {/* privacy */}
            <div className="surface wash-sky relative flex min-h-[420px] flex-col justify-between overflow-hidden p-8 sm:p-10">
              <CardLabel emoji="🛡️">privacy</CardLabel>
              <div aria-hidden className="relative my-8 flex flex-wrap justify-center gap-2">
                {["check my inbox", "book the 4pm", "log this receipt", "what did priya say?"].map(
                  (text) => (
                    <span
                      key={text}
                      className="bubble-in px-3.5 py-1.5 text-sm opacity-70 blur-[1.5px]"
                    >
                      {text}
                    </span>
                  ),
                )}
                <span className="absolute inset-0 grid place-items-center">
                  <span className="grid size-24 place-items-center rounded-[1.75rem] bg-foreground text-white shadow-2xl">
                    <Lock size={40} />
                  </span>
                </span>
              </div>
              <h3 className="text-4xl font-semibold leading-[1.05] sm:text-5xl">
                your data
                <br />
                stays yours.
              </h3>
            </div>

            {/* memory */}
            <div className="surface wash-peach relative flex min-h-[420px] flex-col justify-between overflow-hidden p-8 sm:p-10">
              <CardLabel emoji="🧠">memory</CardLabel>
              <div
                aria-hidden
                className="absolute -right-6 top-10 hidden w-[300px] rotate-[6deg] rounded-[2.2rem] bg-[#16181d] p-2 shadow-2xl sm:block"
              >
                <div className="space-y-2 rounded-[1.8rem] bg-[#f7f8fa] px-3 pb-10 pt-6">
                  <p className="bubble-out ml-auto w-fit max-w-[90%] px-3 py-1.5 text-[13px] font-medium">
                    find a dinner spot for me and priya fri
                  </p>
                  <p className="bubble-in w-fit max-w-[90%] px-3 py-1.5 text-[13px]">
                    she’s vegetarian, right? looking for veg places near you
                  </p>
                  <p className="bubble-out ml-auto w-fit max-w-[90%] px-3 py-1.5 text-[13px] font-medium">
                    wait u remembered that?? 🥹
                  </p>
                  <p className="bubble-in w-fit max-w-[90%] px-3 py-1.5 text-[13px]">
                    you told me in march. i don’t forget
                  </p>
                </div>
              </div>
              <h3 className="relative mt-56 text-4xl font-semibold leading-[1.05] sm:mt-40 sm:text-5xl">
                it remembers
                <br />
                what matters.
              </h3>
            </div>
          </div>

          {/* skills */}
          <div className="surface wash-sky mt-5 grid items-center gap-10 overflow-hidden p-8 sm:p-10 lg:grid-cols-2">
            <div>
              <CardLabel emoji="✨">skills</CardLabel>
              <h3 className="mt-16 text-4xl font-semibold leading-[1.05] sm:text-5xl">
                skills for
                <br />
                whatever you need.
              </h3>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                one-job helpers you add in a tap. routines run on a schedule and report back on
                telegram; the rest are there whenever you ask.
              </p>
              <Link
                href="/skills"
                className="mt-6 inline-flex items-center gap-1 border-b border-foreground/40 text-sm font-semibold"
              >
                browse skills <ArrowRight size={14} />
              </Link>
            </div>
            <div aria-hidden className="relative flex justify-center gap-3">
              {FEATURED.map((skill, index) => (
                <div
                  key={skill.id}
                  className={`flex w-40 flex-col items-center rounded-2xl bg-white/90 p-4 text-center shadow-lg ${
                    index === 1 ? "z-10 -translate-y-4 scale-110" : "opacity-80"
                  }`}
                >
                  <SkillOrb emoji={skill.emoji} size={56} />
                  <p className="mt-3 text-sm font-semibold">{skill.name.toLowerCase()}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                    {skill.description}
                  </p>
                  <span className="mt-2 scale-90">
                    <Byline />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Connectors ───────────────────────────────────────────────────── */}
        <section id="connectors" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="text-center">
            <p className="eyebrow">integrations</p>
            <h2 className="mt-3 text-4xl font-semibold sm:text-5xl">
              works with the apps you use.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] text-muted-foreground">
              Connect your apps once. Ask Yomi from Telegram, even with your laptop closed.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTORS.map((c) => (
              <div key={c.id} className="surface flex items-center gap-3 p-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-black/5">
                  <ConnectorIcon id={c.id} size={26} />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{c.name}</span>
                  <span className="block text-[13px] text-muted-foreground">{c.description}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── What is Yomi? ────────────────────────────────────────────────── */}
        <section id="about" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <p className="eyebrow">about</p>
          <h2 className="mt-3 text-4xl font-semibold sm:text-5xl">what is yomi?</h2>
          <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
            <p>
              Yomi is an AI productivity assistant that connects to the apps you already use so you
              can query, analyze, and act on your work using natural language, without switching
              apps or copy-pasting context.
            </p>
            <p>
              Ask Yomi to find a file, summarize a document, or pull context from your workspace,
              all from a single interface or via Telegram. Yomi only accesses your data when you ask
              a question, and for no other purpose.
            </p>
          </div>
        </section>

        {/* ── How Yomi Uses Google Data ─────────────────────────────────────── */}
        <section id="google-data" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <p className="eyebrow">Google Sign-In &amp; Data Policy</p>
            <h2 className="mt-3 text-4xl font-semibold sm:text-5xl">
              why yomi needs google sign-in
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              Yomi uses Google Sign-In to authenticate your identity and to request permission to
              access your Drive data. Below you will find exactly why sign-in is required and how
              your data is handled.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-3xl space-y-5">
            <div className="surface p-7 text-[15px] leading-relaxed text-muted-foreground">
              <p className="eyebrow mb-4">app purpose</p>
              <p>
                Yomi is a personal AI assistant. It accesses your Google Drive, with your explicit
                permission, to answer questions you ask in natural language. For example:
                &ldquo;Find the Q3 report in my Drive.&rdquo; or &ldquo;What does the product spec
                say about pricing?&rdquo; Yomi reads data on-demand per request and never stores it.
              </p>
              <p className="mt-3 text-sm">
                Yomi&apos;s use of Google API data complies with the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
            </div>

            <div className="surface p-7 text-[15px] leading-relaxed text-muted-foreground">
              <p className="eyebrow mb-5">why google sign-in is required</p>
              <div className="space-y-5">
                <p>
                  <strong className="font-semibold text-foreground">
                    To verify your identity.
                  </strong>{" "}
                  Yomi uses Google&apos;s authentication system to confirm who you are, so it can
                  securely associate your connected apps, settings, and preferences with your
                  account. Anonymous access is not possible because Yomi operates on your personal
                  file data, so it cannot function without knowing which Google account to query.
                </p>
                <p>
                  <strong className="font-semibold text-foreground">
                    To request permission to access your Drive.
                  </strong>{" "}
                  Google&apos;s OAuth consent screen lets you choose exactly which services Yomi may
                  access. Yomi cannot retrieve your Drive files without your explicit authorization.
                  Each permission is granted individually and can be revoked at any time from your
                  Yomi dashboard or from{" "}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Google Account settings
                  </a>
                  .
                </p>
                <p>
                  <strong className="font-semibold text-foreground">
                    Your data is never stored, sold, or shared.
                  </strong>{" "}
                  When you ask a question, Yomi fetches only the data needed to answer it and
                  discards it immediately after responding. No Drive files are retained on
                  Yomi&apos;s servers between requests. Your Google data is never sold, never used
                  to train AI models, and is not shared with third parties except the providers
                  required to deliver the features you use: our AI inference provider, and — for
                  connected apps routed through Composio — Composio, which manages those
                  integrations on our behalf.
                </p>
              </div>
            </div>

            <div className="surface p-7 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                Yomi only accesses Google data after you explicitly authorize access through
                Google&apos;s OAuth consent flow. You may revoke access at any time.
              </p>
              <p className="mt-4 font-semibold text-foreground">
                Depending on the integrations you enable, Yomi may request:
              </p>
              <div className="mt-3 flex items-start gap-3">
                <Check size={16} className="mt-1 shrink-0 text-brand" />
                <div>
                  <p className="font-semibold text-foreground">Google Drive</p>
                  <p className="font-mono text-xs">drive.file</p>
                  <p className="mt-1">
                    <strong className="font-semibold text-foreground">Purpose:</strong> To search,
                    read, and navigate files you choose to share with Yomi. For example: &ldquo;Find
                    the Q3 budget spreadsheet&rdquo; or &ldquo;What does the product spec say about
                    pricing?&rdquo;
                  </p>
                </div>
              </div>
              <p className="mt-4">
                Yomi does not sell user data. Google API data is used only to respond to your
                current request and is discarded immediately after.
              </p>
            </div>
          </div>
        </section>

        {/* ── Data & Integrations transparency ─────────────────────────────── */}
        <section id="data-use" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <p className="eyebrow">Transparency</p>
            <h2 className="mt-3 text-4xl font-semibold sm:text-5xl">what yomi accesses, and why</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              Yomi only reads data when you ask a question. Nothing is stored between queries. You
              can revoke any integration at any time.
            </p>
          </div>

          <div className="surface mx-auto mt-10 max-w-3xl overflow-hidden !p-0">
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
                className={`flex flex-col gap-1 px-7 py-5 text-[15px] sm:flex-row sm:gap-4 ${
                  i < 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="w-44 shrink-0 font-semibold">{row.provider}</div>
                <div className="flex flex-1 flex-col gap-1">
                  <p className="font-mono text-xs text-muted-foreground">{row.scopes}</p>
                  <p className="text-muted-foreground">{row.why}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="surface mx-auto mt-5 max-w-3xl p-7 text-[15px] leading-relaxed text-muted-foreground">
            <p className="mb-3 font-semibold text-foreground">How your data is protected</p>
            <p className="mb-3">
              Data from integrations is used only to answer your current query and is never stored
              after the request completes. OAuth tokens are encrypted at rest using AES-256-GCM and
              are never shared with third parties.
            </p>
            <p className="mb-3">
              Yomi&apos;s use of Google API data complies with the{" "}
              <Link
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="font-medium text-foreground underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </Link>
              , including the Limited Use requirements. You can disconnect any integration instantly
              from your dashboard or from{" "}
              <Link
                href="https://myaccount.google.com/permissions"
                className="font-medium text-foreground underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Account settings
              </Link>
              .
            </p>
            <p>
              Read our full{" "}
              <Link
                href="/privacy"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Privacy Policy
              </Link>{" "}
              for details on data handling and your rights.
            </p>
          </div>

          <div className="mx-auto mt-6 flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/privacy" className="btn-key px-5 py-2.5 text-sm">
              <Shield size={14} />
              View Privacy Policy
            </Link>
            <Link href="/terms" className="btn-key px-5 py-2.5 text-sm">
              View Terms of Service
            </Link>
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────────────── */}
        <section className="relative mt-16 pb-8 pt-10">
          <div
            aria-hidden
            className="absolute left-1/2 top-40 h-[1100px] w-[1600px] -translate-x-1/2 rounded-[50%] bg-gradient-to-b from-[#d4e8f6] via-[#e3eef7]/70 to-transparent"
          />
          <div className="relative mx-auto max-w-4xl px-4 text-center">
            <img
              src="/android-chrome-192x192.png"
              alt=""
              width={160}
              height={160}
              loading="lazy"
              className="mx-auto size-32 animate-float rounded-full shadow-[0_24px_40px_-16px_rgba(16,24,40,0.5)] ring-8 ring-white sm:size-40"
            />
            <h2 className="mt-8 text-5xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-7xl">
              meet the assistant that keeps your life on track.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              yomi lives in your telegram, remembers what you tell it, and checks in so things
              actually get done. free every month, forever.
            </p>
            <Link href="/signup" className="btn-ink mt-8 px-6 py-3 text-[15px]">
              text yomi <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      <LandingFooter />
    </div>
  )
}
