import Link from "next/link"
import { BrandMark } from "@/components/BrandMark"

type FooterLink = { label: string; href: string; external?: boolean }

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "What it does", href: "/#how-it-works" },
      { label: "Skills", href: "/skills" },
      { label: "Pricing", href: "/pricing" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: "/docs" },
      { label: "FAQ", href: "/faq" },
      { label: "Support", href: "/support" },
      { label: "GitHub", href: "https://github.com/arka6fx/yomi-feedback", external: true },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "Telegram", href: "https://t.me/yomi_assistant_bot", external: true },
      { label: "Instagram", href: "https://www.instagram.com/getyomi.in/", external: true },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms of service", href: "/terms" },
      { label: "Copyright", href: "/copyright" },
    ],
  },
]

export default function LandingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="relative overflow-hidden bg-gradient-to-b from-transparent to-[#e3eef7]">
      <div className="relative z-10 mx-auto max-w-6xl px-6 pb-8 pt-16 sm:pt-24">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1.3fr]">
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <BrandMark size="sm" />
            <p className="mt-4 text-[15px] font-medium text-foreground">
              an assistant that lives in your telegram.
            </p>
            <p className="mt-1 max-w-[30ch] text-sm text-muted-foreground">
              text, voice notes and photos. works across Gmail, Calendar, Drive, GitHub, Slack,
              Notion and more.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="mb-4 text-[15px] font-semibold text-foreground">{column.title}</p>
              <ul className="space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="text-[15px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Contact / developer info — required for Google OAuth verification.
              Content must not change: product name, developer identity, support
              email, and website link all need to stay present and accurate. */}
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <p className="mb-4 text-[15px] font-semibold text-foreground">Company</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm lg:block lg:space-y-3">
              <div>
                <p className="text-muted-foreground">Product</p>
                <p className="text-foreground">Yomi: AI Productivity Assistant</p>
              </div>
              <div>
                <p className="text-muted-foreground">Developer</p>
                <p className="text-foreground">Arka Garai</p>
                <p className="text-xs text-muted-foreground">Independent software developer</p>
              </div>
              <div>
                {/* one unbreakable token — force-wrap it or it overflows its grid cell */}
                <p className="text-muted-foreground">Support</p>
                <a
                  href="mailto:contact.arkagarai@gmail.com"
                  className="break-all text-foreground transition-colors hover:text-brand"
                >
                  contact.arkagarai@gmail.com
                </a>
              </div>
              <div>
                <p className="text-muted-foreground">Website</p>
                <a
                  href="https://getyomi.in"
                  className="text-foreground transition-colors hover:text-brand"
                >
                  getyomi.in
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* decorative: glassy mascot + wordmark */}
        <div aria-hidden className="mt-16 flex items-center justify-center gap-[3vw] sm:mt-20">
          <img
            src="/android-chrome-512x512.png"
            alt=""
            width={512}
            height={512}
            loading="lazy"
            className="w-[20vw] max-w-[260px] rounded-full shadow-[0_24px_60px_-20px_rgba(31,147,221,0.6)] ring-8 ring-white/70"
          />
          <span className="wordmark text-[26vw] lg:text-[340px]">yomi</span>
        </div>

        <p className="mt-10 text-center text-[15px] font-medium text-foreground/80">
          © {year} Yomi. All rights reserved. made for getting life done.
        </p>
      </div>
    </footer>
  )
}
