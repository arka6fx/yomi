import type { Metadata } from "next"
import Link from "next/link"
import { Plus } from "lucide-react"
import { PageIntro, SitePage } from "@/components/SitePage"
import { pageMetadata } from "@/lib/site"

export const dynamic = "force-static"

export const metadata: Metadata = pageMetadata({
  title: "FAQ",
  description:
    "Answers about Yomi: how it works on Telegram, which apps it connects to, how your data is handled, and how the free and Pro plans work.",
  path: "/faq",
})

type QA = { q: string; a: React.ReactNode }

const SECTIONS: { title: string; items: QA[] }[] = [
  {
    title: "the basics",
    items: [
      {
        q: "what is yomi?",
        a: "Yomi is an AI productivity assistant you talk to on Telegram with text, voice notes, or photos. It connects to Gmail, Google Calendar, Google Drive, Google Classroom, GitHub, Slack, Notion, and Linear so you can ask about your work in plain language and have Yomi act across your apps.",
      },
      {
        q: "do i need to download an app?",
        a: "No. Yomi works anywhere Telegram does: phone, tablet, or computer. The website is only for the boring parts, like linking apps, schedules, memory and billing.",
      },
      {
        q: "how do i start?",
        a: (
          <>
            <Link href="/signup" className="font-medium text-foreground underline">
              Sign up with Telegram
            </Link>{" "}
            and approve the login in the Yomi bot. No password and no card. Then just send it a
            message.
          </>
        ),
      },
      {
        q: "can i send voice notes and photos?",
        a: "Yes. Voice notes are transcribed and handled like a typed message, and photos of receipts, whiteboards or screenshots are read and acted on. Yomi always replies in text.",
      },
      {
        q: "what are skills?",
        a: (
          <>
            Ready-made jobs for Yomi. Routines, like a morning brief or a Sunday reset, run on a
            schedule and report back on Telegram; the rest are things you just ask for.{" "}
            <Link href="/skills" className="font-medium text-foreground underline">
              Browse skills
            </Link>
            .
          </>
        ),
      },
    ],
  },
  {
    title: "apps & privacy",
    items: [
      {
        q: "which apps does yomi connect to?",
        a: "Gmail, Google Calendar, Google Drive, Google Classroom, Google Tasks, Google Meet, GitHub, Slack, Notion and Linear, plus add-on apps like Google Docs, Sheets and Slides. Connectors are unlimited on every plan, including the free one.",
      },
      {
        q: "will yomi do things without asking?",
        a: "No. Every action that changes something, like sending an email, creating an event or saving a file, is shown to you for approval first.",
      },
      {
        q: "how does yomi access my google data?",
        a: "Only after you grant permission through Google's OAuth consent screen, and only to answer the request you just made. Data is never sold, used for advertising, or used to train AI models, and you can disconnect at any time.",
      },
      {
        q: "can i see and delete what yomi remembers?",
        a: (
          <>
            Yes. The dashboard shows Yomi&apos;s memory, and you can export or delete your data from
            it. The{" "}
            <Link href="/privacy" className="font-medium text-foreground underline">
              privacy policy
            </Link>{" "}
            has the details.
          </>
        ),
      },
    ],
  },
  {
    title: "plans",
    items: [
      {
        q: "is yomi free?",
        a: "Yes, free forever: unlimited chatting, every feature and unlimited app connectors, with 3 routines running in the background. Pro is $5/month for the smarter engine and unlimited routines.",
      },
      {
        q: "is there a message limit?",
        a: (
          <>
            No. There are no credits and no message cap on either plan. Pro adds the smarter engine
            and unlimited routines. See{" "}
            <Link href="/pricing" className="font-medium text-foreground underline">
              pricing
            </Link>{" "}
            for the comparison.
          </>
        ),
      },
      {
        q: "how do i get pro for free?",
        a: "Invite a friend from your dashboard. When they join through your link, you both get a month of Pro.",
      },
      {
        q: "how do i cancel?",
        a: "Anytime, from the plan section of your dashboard.",
      },
    ],
  },
]

export default function FaqPage() {
  return (
    <SitePage>
      <section className="mx-auto max-w-5xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
        <PageIntro title="frequently asked" mascot="thinking">
          <p>
            can&apos;t find what you&apos;re looking for?{" "}
            <Link href="/support" className="font-medium text-foreground underline">
              get in touch
            </Link>{" "}
            and a human gets back to you.
          </p>
        </PageIntro>

        {SECTIONS.map((section) => (
          <div key={section.title} className="mt-16">
            <h2 className="text-3xl font-semibold sm:text-4xl">{section.title}</h2>
            <div className="mt-6 divide-y divide-foreground/10 border-y border-foreground/10">
              {section.items.map((item) => (
                <details key={item.q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <Plus
                      size={18}
                      className="shrink-0 text-muted-foreground transition-transform group-open:rotate-45"
                    />
                  </summary>
                  <div className="max-w-3xl pb-6 text-[15px] leading-relaxed text-muted-foreground">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </section>
    </SitePage>
  )
}
