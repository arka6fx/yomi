import Link from "next/link"

const links = [
  { label: "Pricing", href: "/#pricing", external: false },
  { label: "Download", href: "/#download", external: false },
  { label: "Privacy", href: "/privacy", external: false },
  { label: "Terms", href: "/terms", external: false },
  { label: "GitHub", href: "https://github.com/arka6fx/yomi", external: true },
  { label: "Discord", href: "#", external: false },
]

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-white/10 bg-[#090a09]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 py-10 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-6 sm:justify-start">
          <Link href="/" className="select-none">
            <span className="font-display text-xl font-bold text-white">Yomi</span>
          </Link>
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
