"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  Activity,
  BadgeCheck,
  Brain,
  ChevronRight,
  CreditCard,
  Flame,
  Gift,
  History,
  Home,
  LayoutGrid,
  Lock,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  PenLine,
  Plug,
  Puzzle,
  Shield,
  Sparkles,
  Drama,
  User,
  Users,
  X,
  Zap,
} from "lucide-react"
import type { DashboardTab } from "@/components/dashboard/tabs"
import { TELEGRAM_BOT_URL } from "@/lib/site"
import { cn } from "@/lib/utils"

const PILLS: { tab: DashboardTab; label: string; icon: typeof Home }[] = [
  { tab: "home", label: "home", icon: Home },
  { tab: "skills", label: "skills", icon: Puzzle },
  { tab: "characters", label: "characters", icon: Drama },
  { tab: "schedules", label: "routines", icon: Zap },
  { tab: "vault", label: "vault", icon: Lock },
]

const TILES: { tab: DashboardTab; label: string; icon: typeof Home }[] = [
  { tab: "vault", label: "vault", icon: Lock },
  { tab: "trusted", label: "trusted people", icon: Users },
  { tab: "email", label: "email", icon: Mail },
  { tab: "memory", label: "memory", icon: Brain },
  { tab: "integrations", label: "apps", icon: Plug },
  { tab: "activity", label: "activity", icon: Activity },
]

const SETTINGS: { tab: DashboardTab; label: string; hint: string; icon: typeof Home }[] = [
  { tab: "approvals", label: "approvals", hint: "actions waiting for your ok", icon: BadgeCheck },
  {
    tab: "writing-style",
    label: "personality",
    hint: "teach yomi how to talk to you",
    icon: PenLine,
  },
  { tab: "profile", label: "profile", hint: "name, timezone and what yomi knows", icon: User },
  {
    tab: "command-center",
    label: "command center",
    hint: "quick actions and shortcuts",
    icon: Sparkles,
  },
  { tab: "conversation", label: "conversation", hint: "your chat with yomi", icon: MessageCircle },
  { tab: "history", label: "history", hint: "past runs and results", icon: History },
  { tab: "privacy", label: "privacy", hint: "export or delete your data", icon: Shield },
]

const ACCOUNT: { tab: DashboardTab; label: string; icon: typeof Home }[] = [
  { tab: "billing", label: "plan & billing", icon: CreditCard },
  { tab: "referrals", label: "invite a friend", icon: Gift },
  { tab: "streaks", label: "streaks", icon: Flame },
  { tab: "status", label: "system status", icon: LayoutGrid },
]

type ShellUser = { name?: string | null; email?: string | null; image?: string | null }

export function AppShell({
  activeTab,
  onNavigate,
  user,
  onSignOut,
  children,
}: {
  activeTab: DashboardTab
  onNavigate: (tab: DashboardTab) => void
  user: ShellUser
  onSignOut: () => void
  children: React.ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false)
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [menuOpen])

  function go(tab: DashboardTab) {
    onNavigate(tab)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Telegram-only accounts carry a placeholder address; don't show it as an email.
  const email = user.email?.endsWith("@users.getyomi.in") ? null : user.email
  const pill =
    "bg-card/85 shadow-[0_1px_2px_rgba(0,0,0,0.06),0_6px_20px_rgba(20,60,120,0.08)] backdrop-blur-xl"

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-sky-300/70 via-sky-200/40 to-transparent dark:from-sky-900/40 dark:via-sky-950/20"
      />

      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2">
          <Link
            href="/"
            className={cn("flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5", pill)}
          >
            <img
              src="/brand-mark-128.png"
              alt=""
              width={30}
              height={30}
              className="size-[30px] rounded-full"
            />
            <span className="text-base font-bold tracking-[-0.04em]">yomi</span>
          </Link>

          <nav
            aria-label="Main"
            className={cn("hidden items-center gap-0.5 rounded-full p-1 md:flex", pill)}
          >
            {PILLS.map(({ tab, label, icon: Icon }) => (
              <button
                key={tab}
                onClick={() => go(tab)}
                aria-current={activeTab === tab ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                  activeTab === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={TELEGRAM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_rgba(34,158,217,0.35)] sm:flex"
              style={{ background: "linear-gradient(180deg, #37aee2 0%, #1e96c8 100%)" }}
            >
              <MessageCircle size={15} /> text yomi
            </a>
            <button
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className={cn(
                "flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3.5 text-sm font-medium",
                pill,
              )}
            >
              {user.image ? (
                <img src={user.image} alt="" className="size-7 rounded-full" />
              ) : (
                <span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-semibold">
                  {(user.name || "Y").slice(0, 1).toUpperCase()}
                </span>
              )}
              menu <Menu size={15} />
            </button>
          </div>
        </div>

        <nav
          aria-label="Main"
          className={cn(
            "mx-auto mt-2 flex max-w-sm items-center justify-between rounded-full p-1 md:hidden",
            pill,
          )}
        >
          {PILLS.map(({ tab, label, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => go(tab)}
              aria-current={activeTab === tab ? "page" : undefined}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-full py-1.5 text-xs font-medium",
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        {children}
      </main>

      {menuOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="absolute inset-y-2 right-2 w-[min(420px,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-[2rem] bg-muted p-4 shadow-2xl">
            <div className="flex justify-end">
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="rounded-full p-2 text-muted-foreground hover:bg-background"
              >
                <X size={16} />
              </button>
            </div>

            <button
              onClick={() => go("profile")}
              className="flex items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-background/60"
            >
              {user.image ? (
                <img src={user.image} alt="" className="size-11 rounded-full" />
              ) : (
                <span className="grid size-11 place-items-center rounded-full bg-background text-base font-semibold">
                  {(user.name || "Y").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{user.name || "your account"}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {email ?? "signed in with telegram"}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">edit profile</span>
              <ChevronRight size={14} className="text-muted-foreground" />
            </button>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {TILES.map(({ tab, label, icon: Icon }) => (
                <button
                  key={tab}
                  onClick={() => go(tab)}
                  className="flex flex-col gap-3 rounded-2xl bg-background/70 p-3 text-left text-sm font-medium hover:bg-background"
                >
                  <span className="grid size-8 place-items-center rounded-xl bg-muted">
                    <Icon size={15} />
                  </span>
                  {label}
                </button>
              ))}
            </div>

            <p className="mt-5 px-2 text-xs font-medium text-muted-foreground">settings</p>
            <div className="mt-1.5 divide-y divide-border overflow-hidden rounded-2xl bg-background/70">
              {SETTINGS.map(({ tab, label, hint, icon: Icon }) => (
                <button
                  key={tab}
                  onClick={() => go(tab)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-background"
                >
                  <span className="grid size-8 place-items-center rounded-xl bg-muted">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{hint}</span>
                  </span>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </button>
              ))}
            </div>

            <p className="mt-5 px-2 text-xs font-medium text-muted-foreground">account</p>
            <div className="mt-1.5 divide-y divide-border overflow-hidden rounded-2xl bg-background/70">
              {ACCOUNT.map(({ tab, label, icon: Icon }) => (
                <button
                  key={tab}
                  onClick={() => go(tab)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-background"
                >
                  <span className="grid size-8 place-items-center rounded-xl bg-muted">
                    <Icon size={15} />
                  </span>
                  <span className="flex-1 text-sm font-medium">{label}</span>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </button>
              ))}
              <button
                onClick={onSignOut}
                className="flex w-full items-center gap-3 px-3 py-3 text-left text-destructive hover:bg-background"
              >
                <span className="grid size-8 place-items-center rounded-xl bg-muted">
                  <LogOut size={15} />
                </span>
                <span className="flex-1 text-sm font-medium">log out</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
