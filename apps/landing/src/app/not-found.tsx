import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import Nav from "@/components/Nav"
import LandingFooter from "@/components/landing/LandingFooter"

// Unknown URLs used to be soft-redirected to "/" by the asset binding; the worker now
// answers them with a real 404, so this is what a bad link actually lands on. Without it
// that is next's stock dark 404 — unbranded, no nav, no way back.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
}

const LINKS = [
  { label: "Home", href: "/" },
  { label: "Docs", href: "/docs" },
  { label: "Support", href: "/support" },
]

export default function NotFound() {
  return (
    <div className="landing-light site-texture-bg-light min-h-screen text-foreground">
      <Nav />
      <main className="pt-16">
        <section className="mx-auto max-w-5xl px-6 py-24 sm:py-32">
          <p className="mb-3 font-mono text-xs font-medium uppercase tracking-widest text-muted-foreground">
            404
          </p>
          <h1 className="font-accent text-5xl text-foreground sm:text-6xl">
            This page doesn&apos;t exist.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-8 text-muted-foreground">
            The link may be out of date, or the page may have moved. Yomi itself lives on Telegram —
            the site is just the dashboard and the docs.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="group inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Back to home
              <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-foreground text-primary transition group-hover:translate-x-0.5">
                <ArrowRight size={14} />
              </span>
            </Link>
            {LINKS.slice(1).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-border bg-card/60 px-5 text-sm font-semibold text-foreground backdrop-blur-md transition hover:bg-card/80"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  )
}
