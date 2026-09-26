"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Gift,
  LifeBuoy,
  MessageSquareText,
  Send,
  ShieldCheck,
  Trophy,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

function InstagramGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  )
}

type Resource = {
  label: string
  hint: string
  href: string
  icon: LucideIcon | typeof InstagramGlyph
  external?: boolean
}

export const RESOURCES: Resource[] = [
  { label: "Docs", hint: "Guides and references", href: "/docs", icon: BookOpen },
  { label: "FAQ", hint: "Frequently asked questions", href: "/faq", icon: CircleHelp },
  { label: "Privacy", hint: "Never shared, never trained on", href: "/privacy", icon: ShieldCheck },
  { label: "Support", hint: "Talk to a human", href: "/support", icon: LifeBuoy },
  {
    label: "Referrals",
    hint: "3 free days of Pro per friend",
    href: "/dashboard?tab=referrals",
    icon: Gift,
  },
  {
    label: "Leaderboard",
    hint: "Who keeps the longest streak",
    href: "/dashboard?tab=streaks",
    icon: Trophy,
  },
  {
    label: "Telegram",
    hint: "@yomi_assistant_bot",
    href: "https://t.me/yomi_assistant_bot",
    icon: Send,
    external: true,
  },
  {
    label: "Instagram",
    hint: "@getyomi.in",
    href: "https://www.instagram.com/getyomi.in/",
    icon: InstagramGlyph,
    external: true,
  },
  {
    label: "Feedback",
    hint: "Ideas and bug reports",
    href: "https://github.com/arka6fx/yomi-feedback",
    icon: MessageSquareText,
    external: true,
  },
]

export function ResourceRow({ item, onPick }: { item: Resource; onPick?: () => void }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onPick}
      role="menuitem"
      {...(item.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="group flex items-center gap-3.5 rounded-2xl px-3 py-2.5 transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground/75 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition-colors group-hover:text-foreground">
        <Icon size={16} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 text-[15px] font-semibold text-foreground">
          {item.label}
          {item.external && <ArrowUpRight size={13} className="text-muted-foreground" />}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">{item.hint}</span>
      </span>
    </Link>
  )
}

// "Resources ▾" in the desktop pill nav. Opens on hover or click; closes on outside
// click, Escape, or navigation.
export function ResourcesMenu() {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathname = usePathname()

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // Hover opens for mouse users; a click right after that must not toggle it shut.
  const hoverOpened = useRef(false)
  const enter = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (!open) hoverOpened.current = true
    setOpen(true)
  }
  const leave = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return
    closeTimer.current = setTimeout(() => setOpen(false), 140)
  }
  useEffect(() => {
    if (!open) hoverOpened.current = false
  }, [open])
  const toggle = () => {
    if (open && !hoverOpened.current) setOpen(false)
    else setOpen(true)
    hoverOpened.current = false
  }

  return (
    <div ref={root} className="relative" onPointerEnter={enter} onPointerLeave={leave}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "flex items-center gap-1 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors",
          open ? "text-foreground" : "text-foreground/65 hover:text-foreground",
        )}
      >
        Resources
        <ChevronDown
          size={14}
          className={cn("transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Resources"
          className="animate-menu-in absolute right-0 top-full z-50 w-[300px] pt-3"
        >
          <div className="rounded-3xl border border-white/80 bg-card/95 p-2 shadow-[0_24px_60px_-20px_rgba(16,24,40,0.35),0_2px_6px_rgba(16,24,40,0.06)] backdrop-blur-xl">
            {RESOURCES.map((item) => (
              <ResourceRow key={item.label} item={item} onPick={() => setOpen(false)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
