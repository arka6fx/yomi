"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Menu, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { authClient } from "@/lib/auth-client"
import { BrandMark } from "@/components/BrandMark"

const NAV_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Integrations", href: "/#connectors" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Docs", href: "/docs" },
  { label: "Support", href: "/support" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
]

export default function Nav({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { data: session } = authClient.useSession()
  const router = useRouter()
  const light = variant === "light"

  const pillClass = light
    ? "border-black/[0.07] bg-[#FBF7EF]/85 shadow-[0_1px_2px_rgba(23,19,14,0.04),0_10px_30px_-14px_rgba(23,19,14,0.22)]"
    : "border-border bg-card/80 shadow-sm"
  const linkClass = light
    ? "text-[#6B5F52] hover:text-[#17130E] transition-colors"
    : "text-muted-foreground hover:text-foreground transition-colors"
  const ghostBtnClass = light
    ? "text-[#6B5F52] hover:text-[#17130E] hover:bg-black/[0.04] transition-colors"
    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
  const primaryBtnClass = light
    ? "bg-[#17130E] text-[#F3EEE4] hover:bg-[#2b241c] transition-colors"
    : "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
  const menuPanelClass = light
    ? "border-black/[0.07] bg-[#FBF7EF] shadow-lg"
    : "border-border bg-card shadow-lg"
  const menuBorderClass = light ? "border-black/[0.07]" : "border-border"

  return (
    <div className="sticky top-3 z-50 px-4">
      <motion.header
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className={`relative max-w-5xl mx-auto rounded-2xl border backdrop-blur-xl ${pillClass}`}
      >
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <BrandMark size="md" className={light ? "[&_span]:text-[#17130E]" : ""} />

          <nav className="hidden md:flex items-center gap-7">
            {NAV_LINKS.map((link) => (
              <Link key={link.label} href={link.href} className={`text-sm ${linkClass}`}>
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            {session ? (
              <>
                <Link
                  href="/dashboard"
                  className={`hidden sm:block text-sm px-3 py-1.5 rounded-xl ${ghostBtnClass}`}
                >
                  Dashboard
                </Link>
                <button
                  onClick={async () => {
                    await authClient.revokeSessions().catch(() => {})
                    await authClient.signOut()
                    router.push("/")
                  }}
                  className={`text-sm font-medium px-4 py-1.5 rounded-full ${primaryBtnClass}`}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/signin"
                  className={`hidden sm:block text-sm px-3 py-1.5 rounded-xl ${ghostBtnClass}`}
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className={`text-sm font-medium px-4 py-1.5 rounded-full ${primaryBtnClass}`}
                >
                  Get started
                </Link>
              </>
            )}
            <button
              className={`md:hidden ml-1 p-1.5 rounded-lg ${ghostBtnClass}`}
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={`absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-2xl border ${menuPanelClass}`}
            >
              <div className="px-4 py-3 flex flex-col gap-0.5">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={`py-2.5 px-3 rounded-xl text-sm ${ghostBtnClass}`}
                  >
                    {link.label}
                  </Link>
                ))}
                <div className={`flex gap-2 mt-2 pt-2 border-t ${menuBorderClass}`}>
                  {session ? (
                    <>
                      <Link
                        href="/dashboard"
                        onClick={() => setMenuOpen(false)}
                        className={`flex-1 text-center py-2 rounded-xl text-sm border ${menuBorderClass} ${ghostBtnClass}`}
                      >
                        Dashboard
                      </Link>
                      <button
                        onClick={() => {
                          setMenuOpen(false)
                          authClient.signOut().then(() => router.push("/"))
                        }}
                        className={`flex-1 text-center py-2 rounded-xl text-sm ${primaryBtnClass}`}
                      >
                        Sign out
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/signin"
                        onClick={() => setMenuOpen(false)}
                        className={`flex-1 text-center py-2 rounded-xl text-sm border ${menuBorderClass} ${ghostBtnClass}`}
                      >
                        Sign in
                      </Link>
                      <Link
                        href="/signup"
                        onClick={() => setMenuOpen(false)}
                        className={`flex-1 text-center py-2 rounded-xl text-sm ${primaryBtnClass}`}
                      >
                        Sign up
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>
    </div>
  )
}
