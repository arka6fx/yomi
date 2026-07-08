import type { Metadata } from "next"
import Link from "next/link"
import { Bug, Mail, MessageSquareText } from "lucide-react"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

export const metadata: Metadata = {
  title: "Support",
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
    description: "Report reproducible app issues, broken pages, or desktop install problems.",
    href: "https://github.com/arka6fx/yomi/issues",
    label: "Open GitHub issues",
    icon: Bug,
  },
  {
    title: "Security and privacy",
    description: "Report sensitive privacy, OAuth, capture, or account safety concerns.",
    href: "mailto:contact.arkagarai@gmail.com",
    label: "Email privacy",
    icon: MessageSquareText,
  },
]

export default function SupportPage() {
  return (
    <div className="site-texture-bg min-h-screen text-foreground">
      <Nav />
      <main className="pt-16">
        <section className="mx-auto max-w-5xl px-6 py-24">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-sky-100/50">
            Contact
          </p>
          <div className="max-w-3xl">
            <h1 className="font-accent text-5xl text-[#eaf4ff] sm:text-6xl">Support for Yomi.</h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-white/55">
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
                  className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-sky-100/30 hover:bg-white/[0.06]"
                  target={channel.href.startsWith("http") ? "_blank" : undefined}
                  rel={channel.href.startsWith("http") ? "noopener noreferrer" : undefined}
                >
                  <Icon className="mb-8 h-5 w-5 text-sky-100/70" aria-hidden="true" />
                  <h2 className="font-accent text-2xl text-[#eaf4ff]">{channel.title}</h2>
                  <p className="mt-3 min-h-24 text-sm leading-7 text-white/50">
                    {channel.description}
                  </p>
                  <span className="mt-5 inline-flex text-sm font-medium text-sky-100 transition-colors group-hover:text-white">
                    {channel.label}
                  </span>
                </Link>
              )
            })}
          </div>

          <div className="mt-14 rounded-2xl border border-white/10 bg-[#08111f] p-6 text-sm leading-7 text-white/55">
            <h2 className="font-accent text-2xl text-[#eaf4ff]">Before you write</h2>
            <ul className="mt-4 list-none space-y-2 [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-sky-100 [&_li]:before:content-['›']">
              <li>For login issues, include whether you used Google or GitHub.</li>
              <li>For desktop issues, include Windows version and Yomi app version.</li>
              <li>For billing issues, do not send full payment card details.</li>
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
