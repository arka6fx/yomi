"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Menu } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { BrandMark } from "@/components/BrandMark"
import { MobileMenu } from "@/components/MobileMenu"
import { ResourcesMenu } from "@/components/ResourcesMenu"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { label: "Skills", href: "/skills" },
  { label: "Characters", href: "/characters" },
  { label: "Pricing", href: "/pricing" },
]

function NavLink({ link, pathname }: { link: { label: string; href: string }; pathname: string }) {
  const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
        active ? "text-foreground" : "text-foreground/65 hover:text-foreground",
      )}
    >
      {link.label}
    </Link>
  )
}

// Not sticky: the bar scrolls away with the hero, and a lone "start now" button stays
// pinned to the corner once it has.
export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { data: session } = authClient.useSession()
  const router = useRouter()
  const pathname = usePathname()
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  useEffect(() => setMenuOpen(false), [pathname])

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
          {NAV_LINKS.slice(0, 2).map((link) => (
            <NavLink key={link.label} link={link} pathname={pathname} />
          ))}
          <ResourcesMenu />
          {NAV_LINKS.slice(2).map((link) => (
            <NavLink key={link.label} link={link} pathname={pathname} />
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

        <div className="flex items-center md:hidden">
          <button
            className="grid size-11 place-items-center rounded-2xl border border-white/90 bg-white text-foreground shadow-[0_4px_14px_-6px_rgba(16,24,40,0.35)]"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
          >
            <Menu size={22} />
          </button>
        </div>
      </header>

      <MobileMenu
        open={menuOpen}
        onClose={closeMenu}
        links={NAV_LINKS}
        cta={cta}
        signedIn={Boolean(session)}
        onSignOut={() => {
          closeMenu()
          authClient.signOut().then(() => router.push("/"))
        }}
      />

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
