import Link from "next/link"

const links = [
  { label: "Pricing",  href: "/#pricing",  external: false },
  { label: "Download", href: "/#download", external: false },
  { label: "Privacy",  href: "/privacy",   external: false },
  { label: "Terms",    href: "/terms",     external: false },
  { label: "GitHub",   href: "https://github.com/arka6fx/yomi", external: true },
  { label: "Discord",  href: "#",          external: false },
]

export default function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-6">
          <Link href="/" className="select-none">
            <span className="font-display text-xl font-bold text-foreground">Yomi</span>
          </Link>
          {links.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">© 2025 Yomi. All rights reserved.</p>
      </div>
    </footer>
  )
}
