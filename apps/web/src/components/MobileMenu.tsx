"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowRight, ArrowUpRight, X } from "lucide-react"
import { BrandMark } from "@/components/BrandMark"
import { RESOURCES } from "@/components/ResourcesMenu"
import { cn } from "@/lib/utils"

const ROW =
  "flex w-full items-center justify-between border-b border-dashed border-foreground/15 py-4 text-lg text-foreground"

// Full-screen menu for phones: big rows, resources expand inline, one primary button.
export function MobileMenu({
  open,
  onClose,
  links,
  cta,
  signedIn,
  onSignOut,
}: {
  open: boolean
  onClose: () => void
  links: { label: string; href: string }[]
  cta: { label: string; href: string }
  signedIn: boolean
  onSignOut: () => void
}) {
  const [resources, setResources] = useState(false)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!open) {
      setResources(false)
      return
    }
    const { overflow } = document.body.style
    document.body.style.overflow = "hidden"
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  // same order as the desktop pill: two links, resources, then the rest
  const before = links.slice(0, 2)
  const after = links.slice(2)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          className="fixed inset-0 z-[70] flex flex-col bg-[radial-gradient(90%_60%_at_70%_40%,#e3ebf5_0%,#f3f5f8_60%)] md:hidden"
        >
          <div className="flex items-center justify-between px-5 pt-5">
            <BrandMark />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="grid size-10 place-items-center rounded-xl text-foreground hover:bg-black/5"
            >
              <X size={24} />
            </button>
          </div>

          <nav aria-label="Main" className="mt-4 flex-1 overflow-y-auto px-5">
            <div className="border-t border-dashed border-foreground/15">
              {before.map((link) => (
                <Link key={link.href} href={link.href} onClick={onClose} className={ROW}>
                  {link.label}
                </Link>
              ))}

              <button
                type="button"
                onClick={() => setResources((v) => !v)}
                aria-expanded={resources}
                className={ROW}
              >
                Resources
                <ArrowRight
                  size={20}
                  className={cn("transition-transform duration-200", resources && "rotate-90")}
                />
              </button>
              <AnimatePresence initial={false}>
                {resources && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: reduce ? 0 : 0.25, ease: [0.32, 0.72, 0, 1] }}
                    className="overflow-hidden border-b border-dashed border-foreground/15"
                  >
                    <div className="py-2">
                      {RESOURCES.map((item) => (
                        <Link
                          key={item.label}
                          href={item.href}
                          onClick={onClose}
                          {...(item.external
                            ? { target: "_blank", rel: "noopener noreferrer" }
                            : {})}
                          className="block rounded-xl px-2 py-2.5 hover:bg-black/[0.03]"
                        >
                          <span className="flex items-center gap-1 text-[16px] font-medium text-foreground">
                            {item.label}
                            {item.external && (
                              <ArrowUpRight size={14} className="text-muted-foreground" />
                            )}
                          </span>
                          <span className="block text-[13px] text-muted-foreground">
                            {item.hint}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {after.map((link) => (
                <Link key={link.href} href={link.href} onClick={onClose} className={ROW}>
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>

          <div className="space-y-3 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
            {signedIn ? (
              <button
                type="button"
                onClick={onSignOut}
                className="block w-full text-center text-sm font-medium text-foreground/70"
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/signin"
                onClick={onClose}
                className="block text-center text-sm font-medium text-foreground/70"
              >
                already a member? log in
              </Link>
            )}
            <Link
              href={cta.href}
              onClick={onClose}
              className="btn-ink w-full rounded-2xl py-4 text-[15px]"
            >
              {cta.label}
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
