import Link from "next/link"
import { BrandMark } from "@/components/BrandMark"
import { Mascot } from "@/components/Mascot"

type FooterLink = { label: string; href: string; external?: boolean }

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "What it does", href: "/#how-it-works" },
      { label: "Skills", href: "/skills" },
      { label: "Characters", href: "/characters" },
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <BrandMark size="sm" />
            <p className="mt-4 text-[15px] font-medium text-foreground">
              an assistant that lives in your telegram.
            </p>
            <p className="mt-1 max-w-[30ch] text-sm text-muted-foreground">
              text, voice notes and photos. works across Gmail, Calendar, Drive, GitHub, Slack,
              Notion and more.
            </p>
            <p className="mt-6 flex items-center gap-2 text-[13px] font-medium text-foreground/70">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60 motion-reduce:animate-none" />
                <span className="relative size-2 rounded-full bg-emerald-500" />
              </span>
              yomi is online
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="mb-4 text-[13px] font-medium text-muted-foreground">{column.title}</p>
              <ul className="space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      className="text-[15px] text-foreground/85 transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Contact / developer info — required for Google OAuth verification.
            Content must not change: product name, developer identity, support
            email, and website link all need to stay present and accurate. */}
        <div className="mt-14 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-dashed border-foreground/15 pt-6 text-[13px] md:grid-cols-4">
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
              href="mailto:support@getyomi.in"
              className="break-all text-foreground transition-colors hover:text-brand"
            >
              support@getyomi.in
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

        {/* decorative: the mascot beside a glassy wordmark */}
        <div aria-hidden className="mt-12 flex items-end justify-center gap-[2vw] sm:mt-16">
          <Mascot
            pose="waving"
            float
            className="w-[22vw] max-w-[280px] drop-shadow-[0_30px_40px_rgba(31,147,221,0.35)]"
          />
          <span className="wordmark text-[26vw] lg:text-[340px]">yomi</span>
        </div>

        <p className="mt-10 text-center text-[15px] font-medium text-foreground/80">
          © {year} yomi by Arka Garai. made for getting life done.
        </p>
      </div>
    </footer>
  )
}
