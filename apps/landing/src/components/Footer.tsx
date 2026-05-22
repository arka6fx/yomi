import Link from "next/link"

export default function Footer() {
  return (
    <footer className="border-t border-edge/60 mt-32">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-6">
          <Link href="/" className="font-display text-lg font-bold">
            y<span className="text-accent">o</span>mi
          </Link>
          <Link
            href="/pricing"
            className="text-sm text-caption hover:text-label transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/download"
            className="text-sm text-caption hover:text-label transition-colors"
          >
            Download
          </Link>
          <Link
            href="/privacy"
            className="text-sm text-caption hover:text-label transition-colors"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="text-sm text-caption hover:text-label transition-colors"
          >
            Terms
          </Link>
          <a
            href="https://github.com/arka6fx/yomi"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-caption hover:text-label transition-colors"
          >
            GitHub
          </a>
          <a
            href="#"
            className="text-sm text-caption hover:text-label transition-colors"
          >
            Discord
          </a>
        </div>
        <p className="text-xs text-caption">© 2025 Yomi. All rights reserved.</p>
      </div>
    </footer>
  )
}
