import Link from "next/link"
import { BrandMark } from "@/components/BrandMark"

const PRODUCT_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Integrations", href: "/#connectors" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Dashboard", href: "/dashboard" },
]

const RESOURCE_LINKS: { label: string; href: string; external?: boolean }[] = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Docs", href: "/docs" },
  { label: "Support", href: "/support" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "GitHub", href: "https://github.com/arka6fx/yomi-feedback", external: true },
]

export default function LandingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative overflow-hidden border-t border-border">
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-10 sm:py-16">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:gap-10 lg:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <BrandMark size="sm" />
            <p className="mt-4 max-w-[22ch] text-sm leading-relaxed text-muted-foreground">
              AI assistant for Gmail, Calendar, Drive, GitHub, Slack, Notion, and more — on
              Telegram.
            </p>
            <p className="mt-4 text-xs text-muted-foreground/70">
              © {year} Yomi. All rights reserved.
            </p>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Product
            </p>
            <ul className="space-y-2.5">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Resources
            </p>
            <ul className="space-y-2.5">
              {RESOURCE_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact / developer info — required for Google OAuth verification.
              Content must not change: product name, developer identity, support
              email, and website link all need to stay present and accurate. */}
          <div className="col-span-2 sm:col-span-1">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Company
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:block sm:space-y-3">
              {/* Support email is one unbreakable token — force-wrap it or it
                  overflows its grid cell into the adjacent Website column. */}
              <div>
                <p className="text-muted-foreground/70">Product</p>
                <p className="text-foreground">Yomi: AI Productivity Assistant</p>
              </div>
              <div>
                <p className="text-muted-foreground/70">Developer</p>
                <p className="text-foreground">Arka Garai</p>
                <p className="text-xs text-muted-foreground/70">Independent software developer</p>
              </div>
              <div>
                <p className="text-muted-foreground/70">Support</p>
                <a
                  href="mailto:contact.arkagarai@gmail.com"
                  className="break-all text-foreground transition-colors hover:text-primary"
                >
                  contact.arkagarai@gmail.com
                </a>
              </div>
              <div>
                <p className="text-muted-foreground/70">Website</p>
                <a
                  href="https://getyomi.in"
                  className="text-foreground transition-colors hover:text-primary"
                >
                  getyomi.in
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* decorative ghost wordmark — non-interactive, no fabricated stat */}
      <p
        aria-hidden="true"
        className="pointer-events-none select-none overflow-hidden whitespace-nowrap pb-4 text-center font-accent text-[18vw] italic leading-none text-foreground/[0.05] sm:text-[14vw]"
      >
        Yomi
      </p>
    </footer>
  )
}
