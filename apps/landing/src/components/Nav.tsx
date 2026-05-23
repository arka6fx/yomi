"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"

const NAV_LINKS = [
  { label: "Features", href: "/features" },
  { label: "Pricing",  href: "/pricing"  },
  { label: "Download", href: "/download" },
  { label: "Privacy",  href: "/privacy" },
  { label: "Terms",    href: "/terms" },
]

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="sticky top-3 z-50 px-4">
      <motion.header
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="max-w-5xl mx-auto rounded-2xl border border-border bg-card/80 backdrop-blur-xl shadow-sm"
      >
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <Link href="/" className="font-display text-2xl font-bold text-foreground select-none">
            Yomi
          </Link>

          <nav className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map(link => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            <Link
              href="/signin"
              className="hidden sm:block text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-xl hover:bg-muted/50"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="bg-primary text-primary-foreground text-sm font-medium px-4 py-1.5 rounded-xl hover:bg-primary/90 transition-colors"
            >
              Get started
            </Link>
            <button
              className="md:hidden ml-1 text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
              onClick={() => setMenuOpen(v => !v)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden border-t border-border"
            >
              <div className="px-4 py-3 flex flex-col gap-0.5">
                {NAV_LINKS.map(link => (
                  <Link
                    key={link.label}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="py-2.5 px-3 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    {link.label}
                  </Link>
                ))}
                <div className="flex gap-2 mt-2 pt-2 border-t border-border">
                  <Link
                    href="/signin"
                    onClick={() => setMenuOpen(false)}
                    className="flex-1 text-center py-2 rounded-xl text-sm text-muted-foreground border border-border hover:bg-muted/50 transition-colors"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/signup"
                    onClick={() => setMenuOpen(false)}
                    className="flex-1 text-center py-2 rounded-xl text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Sign up
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>
    </div>
  )
}
