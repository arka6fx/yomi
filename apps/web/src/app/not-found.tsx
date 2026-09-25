import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { SitePage } from "@/components/SitePage"

// Unknown URLs used to be soft-redirected to "/" by the asset binding; the worker now
// answers them with a real 404, so this is what a bad link actually lands on. Without it
// that is next's stock dark 404 — unbranded, no nav, no way back.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
}

const LINKS = [
  { label: "Skills", href: "/skills" },
  { label: "Docs", href: "/docs" },
  { label: "Support", href: "/support" },
]

export default function NotFound() {
  return (
    <SitePage>
      <section className="mx-auto max-w-3xl px-4 py-24 text-center sm:py-32">
        <img
          src="/android-chrome-192x192.png"
          alt=""
          width={112}
          height={112}
          className="mx-auto size-28 rounded-full shadow-[0_20px_40px_-16px_rgba(16,24,40,0.5)] ring-8 ring-white"
        />
        <p className="eyebrow mt-8">404</p>
        <h1 className="mt-3 text-5xl font-semibold tracking-[-0.04em] sm:text-6xl">
          this page doesn&apos;t exist.
        </h1>
        <p className="mx-auto mt-5 max-w-md text-[17px] leading-relaxed text-muted-foreground">
          The link may be out of date, or the page may have moved. Yomi itself lives on Telegram —
          the site is just the dashboard and the docs.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="btn-ink px-5 py-3 text-sm">
            back to home <ArrowRight size={15} />
          </Link>
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="btn-key px-5 py-3 text-sm">
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </SitePage>
  )
}
