import Link from "next/link"
import { buildCatalog } from "@yomi/ui/catalog"
import { ConnectorIcon } from "@yomi/ui/icons"
import { TELEGRAM_BOT_URL } from "@/lib/site"

// ── prose ────────────────────────────────────────────────────────────────────

export function Lede({ children }: { children: React.ReactNode }) {
  return <p className="docs-lede">{children}</p>
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="docs-h2">
      <a href={`#${id}`}>{children}</a>
    </h2>
  )
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-[#1d1b18]">{children}</strong>
}

// "**plan things**: “find us somewhere cozy…”" rows.
function Examples({ items }: { items: [term: string, text: React.ReactNode][] }) {
  return (
    <ul className="docs-examples">
      {items.map(([term, text]) => (
        <li key={term}>
          <span className="docs-term">{term}</span>: {text}
        </li>
      ))}
    </ul>
  )
}

function Steps({ items }: { items: [title: string, text: React.ReactNode][] }) {
  return (
    <ol className="docs-steps">
      {items.map(([title, text], i) => (
        <li key={title}>
          <span className="docs-step-n">{i + 1}</span>
          <span>
            <B>{title}.</B> {text}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="docs-note">{children}</p>
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = href.startsWith("http")
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="docs-link">
      {children}
    </a>
  ) : (
    <Link href={href} className="docs-link">
      {children}
    </Link>
  )
}

const CONNECTORS = buildCatalog().filter((c) => c.available)

// ── pages ────────────────────────────────────────────────────────────────────

export const DOCS_CONTENT: Record<string, () => React.ReactNode> = {
  "": () => (
    <>
      <p>
        you talk to yomi the same way you&apos;d text a friend who happens to be extremely capable,
        never sleeps, and remembers what you told them last week.
      </p>
      <p>no new app to learn. no dashboard you have to babysit. no bloated software ritual.</p>
      <p>
        all you have to do is text yomi on <B>Telegram</B>, by message, <B>voice note</B> or{" "}
        <B>photo</B>, and it gets things done across the apps you already use.
      </p>
      <p>
        triaging your <B>inbox</B>, planning your <B>week</B>, watching a <B>price</B>, drafting a{" "}
        <B>reply</B>, researching a <B>question</B>, remembering a <B>detail</B>.
      </p>

      <H2 id="more-specifically">more specifically..</H2>
      <p>a few things people text yomi for every day:</p>
      <Examples
        items={[
          ["handle email & calendar", "“what's on tomorrow?” or “who's waiting on my reply?”"],
          ["plan things", "“plan a 3-day trip to goa under ₹30k and put it in my calendar”"],
          ["remember things", "“my sister is vegetarian and hates cilantro”"],
          ["keep an eye on things", "“tell me when these headphones drop below ₹8,000”"],
          ["do real research", "“compare the three best budget ereaders, with sources”"],
          ["run on a schedule", "“every weekday at 8am, brief me on my day”"],
          ["read photos", "a receipt, a whiteboard, a screenshot: yomi reads it and acts on it"],
          ["use the web for you", "yomi opens its own browser to look things up and fill forms"],
        ]}
      />

      <H2 id="the-best-part">but the best part is...</H2>
      <p>
        yomi <B>asks before it acts</B>. anything that sends, books, pays or deletes shows up as a
        preview with approve and reject buttons, and nothing happens until you tap approve. read
        more in <A href="/docs/approvals">approvals & vault</A>.
      </p>

      <H2 id="start-here">start here</H2>
      <Steps
        items={[
          ["Sign up", <>with Telegram, Google or GitHub. it&apos;s free.</>],
          ["Open yomi", <>on Telegram and say hi.</>],
          ["Connect your apps", <>from the dashboard when you want yomi to use them.</>],
        ]}
      />
      <p>
        the full walkthrough is in <A href="/docs/getting-started">getting started</A>.
      </p>

      <H2 id="go-deeper">go deeper</H2>
      <p>
        see what yomi can do with <A href="/docs/routines">skills & routines</A>,{" "}
        <A href="/docs/memory">memory</A>, its <A href="/docs/browser">browser</A> and your own{" "}
        <A href="/docs/email">yomi email address</A>. new to all this? just ask yomi. it&apos;s
        happy to explain itself.
      </p>
    </>
  ),

  "getting-started": () => (
    <>
      <H2 id="sign-up">sign up</H2>
      <p>
        go to <A href="/signup">getyomi.in/signup</A> and pick <B>Telegram</B>, <B>Google</B> or{" "}
        <B>GitHub</B>. with Telegram, the page shows a 4-digit code and yomi messages you; tap
        approve only if the code matches.
      </p>

      <H2 id="open-telegram">open yomi on telegram</H2>
      <p>
        yomi is <A href={TELEGRAM_BOT_URL}>@yomi_assistant_bot</A>. if you signed up with Google or
        GitHub, link Telegram from the dashboard: it gives you a link that connects the two.
      </p>

      <H2 id="first-messages">your first messages</H2>
      <Examples
        items={[
          ["say hi", "yomi introduces itself and asks what you need"],
          ["ask anything", "“what can you do?” is a fine place to start"],
          ["try your apps", "once gmail is connected, “summarise my unread email”"],
        ]}
      />

      <H2 id="commands">handy commands</H2>
      <Examples
        items={[
          ["/reset", "clear the current conversation. your memory stays."],
          ["/yomi or /back", "switch from a character back to plain yomi"],
          ["/help", "a quick reminder of what yomi is"],
        ]}
      />
    </>
  ),

  "connecting-apps": () => (
    <>
      <H2 id="how-to-connect">how to connect</H2>
      <p>
        open the <A href="/dashboard?tab=integrations">integrations</A> tab in the dashboard and tap
        an app. you&apos;ll sign in to it and grant access. yomi only uses an app when you ask for
        something that needs it.
      </p>
      <Note>
        until an app is connected, yomi can&apos;t see it. connect gmail and calendar first for the
        best start.
      </Note>

      <H2 id="what-you-can-connect">what you can connect</H2>
      <p>{CONNECTORS.length} apps and counting:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {CONNECTORS.map((c) => (
          <div key={c.id} className="docs-app">
            <span className="docs-app-icon">
              <ConnectorIcon id={c.id} size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[#1d1b18]">{c.name}</span>
              <span className="block truncate text-[13px]">{c.description}</span>
            </span>
          </div>
        ))}
      </div>

      <H2 id="disconnecting">disconnecting</H2>
      <p>
        disconnect any app from the same tab at any time. for Google you can also remove access from
        your <A href="https://myaccount.google.com/permissions">Google account settings</A>.
      </p>
    </>
  ),

  "talking-to-yomi": () => (
    <>
      <H2 id="text">just text it</H2>
      <p>
        write like you would to a person. no special syntax, no prompts to memorise. yomi answers
        quick questions right away and works through bigger jobs step by step, reacting to your
        message while it works.
      </p>

      <H2 id="voice">voice notes</H2>
      <p>
        hold the mic and talk. yomi transcribes the note and gets on with it. replies always come
        back as text.
      </p>

      <H2 id="photos">photos and screenshots</H2>
      <Examples
        items={[
          ["receipts", "“log this” and it's added to your spending"],
          ["whiteboards", "“turn this into a to-do list”"],
          ["screenshots", "“what does this error mean?”"],
          ["plates of food", "rough calories and macros, if you use the meal log skill"],
        ]}
      />

      <H2 id="fresh-start">starting fresh</H2>
      <p>
        send <B>/reset</B> to clear the conversation when you change topic. yomi&apos;s long-term{" "}
        <A href="/docs/memory">memory</A> is never cleared by it.
      </p>
    </>
  ),

  approvals: () => (
    <>
      <H2 id="how-approvals-work">how approvals work</H2>
      <p>
        when yomi is about to <B>send</B> an email or message, <B>book</B> something, <B>pay</B>, or{" "}
        <B>delete</B> anything, it stops and shows you a preview with <B>approve</B> and{" "}
        <B>reject</B> buttons in Telegram. the same approvals are listed in the dashboard. nothing
        happens until you approve.
      </p>

      <H2 id="vault">the vault</H2>
      <p>
        save logins, cards and addresses in the <A href="/dashboard?tab=vault">vault</A>. yomi can
        use them to fill a form or check out, but it never sees the raw secret: it asks for a field
        and the value is typed in for it. payments always need your approval, and secrets are
        encrypted at rest.
      </p>
    </>
  ),

  browser: () => (
    <>
      <H2 id="reading-the-web">reading the web</H2>
      <p>
        yomi searches the web, opens pages, and pulls out what matters, so answers come with links
        you can check.
      </p>

      <H2 id="the-computer">the computer</H2>
      <p>
        for jobs a quick read can&apos;t do, like a form or a site that needs you to click around,
        yomi has its own private cloud computer with Chrome. you can watch it live from the{" "}
        <A href="/dashboard?tab=computer">computer</A> tab. logins you make there stay saved for
        next time, and anything that submits or pays still asks you first.
      </p>
    </>
  ),

  routines: () => (
    <>
      <H2 id="routines">routines</H2>
      <p>a routine is something yomi does on a schedule and reports back on Telegram. just ask:</p>
      <Examples
        items={[
          ["morning brief", "“every weekday at 8am, tell me what's on today”"],
          ["weekly reset", "“sundays at 6pm, plan my week”"],
          ["one-offs", "“remind me to call mom at 7”"],
        ]}
      />
      <p>
        see and pause them in the <A href="/dashboard?tab=schedules">routines</A> tab.
      </p>

      <H2 id="skills">skills</H2>
      <p>
        skills are ready-made routines and requests you can add in one tap, like the morning brief,
        the needs-reply inbox sweep or price watch. browse them at{" "}
        <A href="/skills">getyomi.in/skills</A>.
      </p>

      <H2 id="limits">how many can run</H2>
      <p>
        free includes <B>3 routines</B> running at once. pro has no limit. see{" "}
        <A href="/docs/plans">plans</A>.
      </p>
    </>
  ),

  research: () => (
    <>
      <H2 id="asking">asking a question</H2>
      <p>
        ask a real question and yomi searches, reads the best sources, and sends a short answer with
        links. ask it to go deeper and it will.
      </p>
      <Examples
        items={[
          ["compare", "“compare the three best budget ereaders”"],
          ["explain", "“explain this contract clause like i'm 15”"],
          ["find", "“find a quiet café near me that's open late”"],
        ]}
      />

      <H2 id="your-documents">your own documents</H2>
      <p>
        add text, links, documents or Google Drive folders in the dashboard and yomi can search them
        when it answers, citing what it used.
      </p>
    </>
  ),

  memory: () => (
    <>
      <H2 id="what-it-remembers">what it remembers</H2>
      <p>
        tell yomi something worth keeping (your city, your partner&apos;s birthday, how you like
        your briefs) and it remembers. when something changes, the new fact replaces the old one
        instead of piling up.
      </p>

      <H2 id="seeing-and-editing">seeing and editing it</H2>
      <p>
        everything yomi remembers is in the <A href="/dashboard?tab=memory">memory</A> tab. edit or
        delete any of it, export it, or turn memory off in privacy settings.
      </p>
    </>
  ),

  email: () => (
    <>
      <H2 id="your-address">your address</H2>
      <p>
        every account gets its own address at <B>@mail.getyomi.in</B>. find yours in the{" "}
        <A href="/dashboard?tab=email">email</A> tab or ask yomi &ldquo;what&apos;s my yomi
        email?&rdquo;
      </p>

      <H2 id="what-to-send">what to send it</H2>
      <Examples
        items={[
          ["receipts", "forward them and yomi logs your spending"],
          ["order confirmations", "yomi keeps track of the package"],
          ["sign-ups", "use it for newsletters and sites you don't want in your main inbox"],
        ]}
      />
    </>
  ),

  "trusted-people": () => (
    <>
      <H2 id="how-it-works">how it works</H2>
      <p>
        add someone you trust by their email in the <A href="/dashboard?tab=trusted">trusted</A>{" "}
        tab. once they accept, your yomis can message each other, like &ldquo;find a time with sam
        next week&rdquo;. messages arrive in their Telegram.
      </p>

      <H2 id="staying-in-control">staying in control</H2>
      <p>
        every message your yomi sends to someone else needs your approval first. you can pause
        trusted messaging or block someone at any time, and requests never reveal whether an email
        belongs to a yomi user.
      </p>
    </>
  ),

  characters: () => (
    <>
      <H2 id="picking-one">picking a character</H2>
      <p>
        a character changes who answers, never what yomi can do. pick one from the{" "}
        <A href="/characters">character gallery</A> or make your own from a name and a line, and
        every reply comes in their voice, with the same tools and the same approvals.
      </p>

      <H2 id="switching-back">switching back</H2>
      <p>
        send <B>/yomi</B> or <B>/back</B> on Telegram, or switch in the dashboard. gallery
        characters are unofficial fan-made takes on fictional characters; see the{" "}
        <A href="/characters/guidelines">guidelines</A>.
      </p>
    </>
  ),

  plans: () => (
    <>
      <H2 id="free-and-pro">free and pro</H2>
      <Examples
        items={[
          ["free", "unlimited chat, every feature, 3 routines running at once. no card needed."],
          [
            "pro ($5/month)",
            "the smarter engine that thinks longer on hard jobs, unlimited routines, priority support.",
          ],
        ]}
      />
      <p>
        there are no credits and no message cap. compare both on the{" "}
        <A href="/pricing">pricing page</A>.
      </p>

      <H2 id="referrals">get pro free</H2>
      <p>
        invite a friend from the <A href="/dashboard?tab=referrals">referrals</A> tab and you both
        get 3 days of pro.
      </p>
    </>
  ),

  privacy: () => (
    <>
      <H2 id="what-we-keep">what yomi keeps</H2>
      <p>
        data from your connected apps is used to answer your request. it isn&apos;t shared or used
        to train AI models. connector tokens and vault secrets are encrypted at rest. the full
        details are in the <A href="/privacy">privacy policy</A>.
      </p>

      <H2 id="your-controls">your controls</H2>
      <Examples
        items={[
          ["memory", "see, edit, export or delete everything yomi remembers"],
          ["apps", "disconnect any app at any time"],
          ["your account", "export your data or delete your account from privacy settings"],
        ]}
      />
    </>
  ),
}
