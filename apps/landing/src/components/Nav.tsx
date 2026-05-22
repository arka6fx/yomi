import Link from "next/link"

export default function Nav() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-canvas/80 backdrop-blur-md border-b border-edge/60">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          y<span className="text-accent">o</span>mi
        </Link>

        <div className="flex items-center gap-6 sm:gap-8">
          <Link
            href="/pricing"
            className="text-sm text-caption hover:text-label transition-colors hidden sm:block"
          >
            Pricing
          </Link>
          <Link
            href="/download"
            className="text-sm text-caption hover:text-label transition-colors hidden sm:block"
          >
            Download
          </Link>
          <Link
            href="/#waitlist"
            className="text-sm font-medium px-4 py-2 rounded-lg bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-all"
          >
            Get early access
          </Link>
        </div>
      </div>
    </nav>
  )
}
