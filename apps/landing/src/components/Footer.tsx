import Link from "next/link"

const links = [
  { label: "Pricing", href: "/#pricing", external: false },
  { label: "Download", href: "/#download", external: false },
  { label: "Support", href: "/support", external: false },
  { label: "Privacy", href: "/privacy", external: false },
  { label: "Terms", href: "/terms", external: false },
  { label: "GitHub", href: "https://github.com/arka6fx/yomi", external: true },
]

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-white/10 bg-[#050914]">
      {/* Contact / developer info — required for Google OAuth verification */}
      <div className="mx-auto max-w-6xl px-6 pt-10 pb-6">
        <div className="grid gap-6 text-xs text-white/40 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="mb-1 font-medium text-white/60">Product</p>
            <p>Yomi: AI Productivity Assistant</p>
          </div>
          <div>
            <p className="mb-1 font-medium text-white/60">Developer</p>
            <p>Arka Garai</p>
            <p className="mt-0.5 text-white/30">Independent software developer</p>
          </div>
          <div>
            <p className="mb-1 font-medium text-white/60">Support</p>
            <a
              href="mailto:contact.arkagarai@gmail.com"
              className="transition-colors hover:text-white/70"
            >
              contact.arkagarai@gmail.com
            </a>
          </div>
          <div>
            <p className="mb-1 font-medium text-white/60">Website</p>
            <a href="https://getyomi.in" className="transition-colors hover:text-white/70">
              getyomi.in
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 border-t border-white/5 px-6 py-6 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-6 sm:justify-start">
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="text-sm text-white/50 transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <p className="text-xs text-white/40">© {year} Yomi. All rights reserved.</p>
      </div>
    </footer>
  )
}
