"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  Settings,
  Plug,
  Brain,
  User,
  PenLine,
  Code2,
  WalletCards,
  Shield,
  BookOpen,
} from "lucide-react"

export type DashboardTab =
  | "home"
  | "integrations"
  | "memory"
  | "schedules"
  | "conversation"
  | "status"
  | "billing"
  | "profile"
  | "writing-style"
  | "privacy"

interface MenuItem {
  label: string
  icon: typeof Plug
  onClick: () => void
}

export function SettingsMenu({ onNavigate }: { onNavigate: (tab: DashboardTab) => void }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [open])

  function navigate(tab: DashboardTab) {
    onNavigate(tab)
    setOpen(false)
  }

  const topItems: MenuItem[] = [
    { label: "Connections", icon: Plug, onClick: () => navigate("integrations") },
    { label: "Memory", icon: Brain, onClick: () => navigate("memory") },
    { label: "Profile", icon: User, onClick: () => navigate("profile") },
    { label: "Writing style", icon: PenLine, onClick: () => navigate("writing-style") },
  ]

  const accountItems: MenuItem[] = [
    { label: "Billing", icon: WalletCards, onClick: () => navigate("billing") },
    { label: "Privacy", icon: Shield, onClick: () => navigate("privacy") },
  ]

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Settings"
      >
        <Settings size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-card shadow-lg py-1.5 z-50">
          {topItems.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors text-left"
            >
              <item.icon size={14} className="text-muted-foreground" />
              {item.label}
            </button>
          ))}
          <Link
            href="/dashboard/developer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <Code2 size={14} className="text-muted-foreground" />
            Developer
          </Link>

          <div className="my-1.5 border-t border-border" />
          <p className="px-3.5 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Account
          </p>
          {accountItems.map((item) => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors text-left"
            >
              <item.icon size={14} className="text-muted-foreground" />
              {item.label}
            </button>
          ))}
          <Link
            href="/docs"
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <BookOpen size={14} className="text-muted-foreground" />
            Docs
          </Link>
        </div>
      )}
    </div>
  )
}
