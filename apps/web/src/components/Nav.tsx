"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Menu, X } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { BrandMark } from "@/components/BrandMark"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { label: "Skills", href: "/skills" },
  { label: "Characters", href: "/characters" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/docs" },
  { label: "FAQ", href: "/faq" },
  { label: "Support", href: "/support" },
]

// Not sticky: the bar scrolls away with the hero, and a lone "start now" button stays
// pinned to the corner once it has.
export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { data: session } = authClient.useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 420)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const cta = session
    ? { label: "Dashboard", href: "/dashboard" }
    : { label: "Start now", href: "/signup" }

  return (
    <>
      <header className="animate-nav-in relative z-50 mx-auto flex max-w-6xl items-center justify-between px-4 pt-5 sm:px-6">
        <BrandMark />

        <nav
          aria-label="Main"
          className="hidden items-center gap-0.5 rounded-2xl border border-white/80 bg-card/85 p-1.5 shadow-[0_1px_2px_rgba(16,24,40,0.05),0_8px_24px_-10px_rgba(16,24,40,0.2)] backdrop-blur-xl md:flex"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className={cn(
                "rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
                pathname === link.href
                  ? "text-foreground"
                  : "text-foreground/65 hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
          {!session && (
            <Link
              href="/signin"
              className="rounded-xl px-3.5 py-2 text-sm font-medium text-foreground/65 transition-colors hover:text-foreground"
            >
              Log in
            </Link>
          )}
          <Link href={cta.href} className="btn-ink ml-1 px-4 py-2 text-sm">
            {cta.label}
          </Link>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <Link href={cta.href} className="btn-ink px-4 py-2 text-sm">
            {cta.label}
          </Link>
          <button
            className="grid size-10 place-items-center rounded-xl border border-white/80 bg-card/85 text-foreground shadow-sm backdrop-blur"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {menuOpen && (
          <div className="surface animate-menu-in absolute inset-x-4 top-full mt-2 p-2 md:hidden">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-[15px] font-medium text-foreground/80 hover:bg-muted"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-1 border-t border-border pt-1">
              {session ? (
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    authClient.signOut().then(() => router.push("/"))
                  }}
                  className="block w-full rounded-xl px-3 py-2.5 text-left text-[15px] font-medium text-foreground/80 hover:bg-muted"
                >
                  Sign out
                </button>
              ) : (
                <Link
                  href="/signin"
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-xl px-3 py-2.5 text-[15px] font-medium text-foreground/80 hover:bg-muted"
                >
                  Log in
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      <Link
        href={cta.href}
        aria-hidden={!scrolled}
        tabIndex={scrolled ? 0 : -1}
        className={cn(
          "btn-ink fixed right-4 top-4 z-50 hidden px-5 py-2.5 text-sm transition-all duration-300 md:inline-flex",
          scrolled ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0",
        )}
      >
        {cta.label}
      </Link>
    </>
  )
}
