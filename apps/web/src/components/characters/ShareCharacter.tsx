"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Link2, Share2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Target = { label: string; href: (url: string, text: string) => string }

// Where the desktop menu can send the link; phones use their own share sheet instead.
const TARGETS: Target[] = [
  {
    label: "WhatsApp",
    href: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    label: "Telegram",
    href: (url, text) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    label: "X",
    href: (url, text) =>
      `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
]

/** Share a character's public page. No account needed: phones get the native share
 * sheet, everything else a small menu with copy link and a few apps. */
export function ShareCharacter({
  slug,
  name,
  variant = "button",
  className,
}: {
  slug: string
  name: string
  variant?: "button" | "icon"
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const text = `text ${name} on telegram with yomi`

  const url = () => `${window.location.origin}/characters/${slug}`

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", close)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerdown", close)
      document.removeEventListener("keydown", esc)
    }
  }, [open])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url())
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt("copy this link", url())
    }
  }

  async function share(e: React.MouseEvent) {
    // Cards are links; sharing must not open the character.
    e.preventDefault()
    e.stopPropagation()
    const data = { title: `${name} on yomi`, text, url: url() }
    const touch = window.matchMedia("(pointer: coarse)").matches
    if (touch && navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data)
      } catch {
        // dismissed the share sheet
      }
      return
    }
    setOpen((o) => !o)
  }

  return (
    <div ref={root} className={cn("relative", className)}>
      <motion.button
        type="button"
        onClick={(e) => void share(e)}
        aria-label={`share ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        whileTap={{ scale: 0.9 }}
        className={cn(
          variant === "icon"
            ? "grid size-8 place-items-center rounded-full bg-card/90 text-foreground/70 shadow-sm ring-1 ring-black/5 backdrop-blur hover:text-foreground"
            : "inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:bg-muted",
        )}
      >
        <Share2 size={variant === "icon" ? 14 : 15} />
        {variant === "button" && "share"}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-full z-30 mt-2 w-52 origin-top-right rounded-2xl border border-border bg-card p-1.5 shadow-[0_18px_40px_-14px_rgba(16,24,40,0.35)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.preventDefault()
                void copy()
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-muted"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={copied ? "done" : "copy"}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="grid size-4 place-items-center"
                >
                  {copied ? <Check size={15} className="text-emerald-500" /> : <Link2 size={15} />}
                </motion.span>
              </AnimatePresence>
              {copied ? "link copied" : "copy link"}
            </button>
            {TARGETS.map((t) => (
              <a
                key={t.label}
                role="menuitem"
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  window.open(t.href(url(), text), "_blank", "noopener,noreferrer")
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <span
                  aria-hidden
                  className="grid size-4 place-items-center text-[11px] font-bold text-muted-foreground"
                >
                  {t.label[0]}
                </span>
                {t.label}
              </a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
