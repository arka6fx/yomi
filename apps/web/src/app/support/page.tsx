import type { Metadata } from "next"
import { pageMetadata } from "@/lib/site"
import Link from "next/link"
import { ArrowRight, Bug, Check, Mail, MessageSquareText } from "lucide-react"
import { PageIntro, SitePage } from "@/components/SitePage"

export const metadata: Metadata = pageMetadata({
  title: "Support",
  description:
    "Get help with Yomi. Report bugs, ask questions about billing, app connectors, or your account. Reach us by email at contact.arkagarai@gmail.com.",
  path: "/support",
})

const channels = [
  {
    title: "Account and billing",
    description: "Questions about sign-in, plan access, invoices, or subscription changes.",
    href: "mailto:contact.arkagarai@gmail.com",
    label: "Email support",
    icon: Mail,
  },
  {
    title: "Bugs and product issues",
    description: "Report reproducible app issues or broken pages.",
    href: "https://github.com/arka6fx/yomi-feedback/issues",
    label: "Open GitHub issues",
    icon: Bug,
  },
  {
    title: "Security and privacy",
    description: "Report sensitive privacy, OAuth, data-handling, or account safety concerns.",
    href: "mailto:contact.arkagarai@gmail.com",
    label: "Email privacy",
    icon: MessageSquareText,
  },
]

export default function SupportPage() {
  return (
    <SitePage>
      <section className="mx-auto max-w-5xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
        <PageIntro eyebrow="contact" title="how can we help?" mascot="heart">
          <p className="max-w-2xl">
            Send a note with the email on your account, what you expected to happen, what happened
            instead, and any screenshots or logs that do not contain secrets.
          </p>
        </PageIntro>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {channels.map((channel) => {
            const Icon = channel.icon
            return (
              <Link
                key={channel.title}
                href={channel.href}
                className="surface group flex flex-col p-7 transition-transform hover:-translate-y-0.5"
                target={channel.href.startsWith("http") ? "_blank" : undefined}
                rel={channel.href.startsWith("http") ? "noopener noreferrer" : undefined}
              >
                <span className="orb size-12">
                  <Icon className="size-5 text-foreground" aria-hidden="true" />
                </span>
                <h2 className="mt-6 text-xl font-semibold">{channel.title}</h2>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted-foreground">
                  {channel.description}
                </p>
                <span className="mt-6 inline-flex items-center gap-1 text-sm font-semibold">
                  {channel.label}
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </Link>
            )
          })}
        </div>

        <div className="surface mt-5 p-7">
          <h2 className="text-xl font-semibold">before you write</h2>
          <ul className="mt-4 space-y-2.5 text-[15px] text-muted-foreground">
            {[
              "For login issues, include whether you used Telegram, Google or GitHub.",
              "Include browser version and steps to reproduce.",
              "For billing issues, do not send full payment card details.",
            ].map((tip) => (
              <li key={tip} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-foreground text-white">
                  <Check size={11} strokeWidth={3} />
                </span>
                {tip}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-10 text-center text-[15px] text-muted-foreground">
          looking for a quick answer? try the{" "}
          <Link href="/faq" className="font-semibold text-foreground underline">
            faq
          </Link>{" "}
          or the{" "}
          <Link href="/docs" className="font-semibold text-foreground underline">
            docs
          </Link>
          .
        </p>
      </section>
    </SitePage>
  )
}
