import type { Metadata } from "next"
import Link from "next/link"
import { Bug, Mail, MessageSquareText } from "lucide-react"
import Nav from "@/components/Nav"
import LandingFooter from "@/components/landing/LandingFooter"

export const metadata: Metadata = {
  title: "Support and contact",
  description:
    "Get help with Yomi. Report bugs, ask questions about billing, app connectors, or your account. Reach us by email at contact.arkagarai@gmail.com.",
  alternates: { canonical: "https://getyomi.in/support" },
}

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
    <div className="landing-light site-texture-bg-light min-h-screen text-foreground">
      <Nav />
      <main className="pt-16">
        <section className="mx-auto max-w-5xl px-6 py-24">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Contact
          </p>
          <div className="max-w-3xl">
            <h1 className="font-accent text-5xl text-foreground sm:text-6xl">Support for Yomi.</h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground">
              Send a note with the email on your account, what you expected to happen, what happened
              instead, and any screenshots or logs that do not contain secrets.
            </p>
          </div>

          <div className="mt-14 grid gap-4 md:grid-cols-3">
            {channels.map((channel) => {
              const Icon = channel.icon
              return (
                <Link
                  key={channel.title}
                  href={channel.href}
                  className="group rounded-2xl glass-card p-6 transition-colors hover:border-primary/30"
                  target={channel.href.startsWith("http") ? "_blank" : undefined}
                  rel={channel.href.startsWith("http") ? "noopener noreferrer" : undefined}
                >
                  <Icon className="mb-8 h-5 w-5 text-primary" aria-hidden="true" />
                  <h2 className="font-accent text-2xl text-foreground">{channel.title}</h2>
                  <p className="mt-3 min-h-24 text-sm leading-7 text-muted-foreground">
                    {channel.description}
                  </p>
                  <span className="mt-5 inline-flex text-sm font-medium text-primary transition-colors group-hover:text-foreground">
                    {channel.label}
                  </span>
                </Link>
              )
            })}
          </div>

          <div className="mt-14 rounded-2xl glass-card p-6 text-sm leading-7 text-muted-foreground">
            <h2 className="font-accent text-2xl text-foreground">Before you write</h2>
            <ul className="mt-4 list-none space-y-2 [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-primary [&_li]:before:content-['›']">
              <li>For login issues, include whether you used Google or GitHub.</li>
              <li>Include browser version and steps to reproduce.</li>
              <li>For billing issues, do not send full payment card details.</li>
            </ul>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  )
}
