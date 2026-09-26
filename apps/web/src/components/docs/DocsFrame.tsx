"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import {
  AlignLeft,
  ArrowUpRight,
  Brain,
  CreditCard,
  Globe,
  Hand,
  Lock,
  Mail,
  Menu,
  MessageCircle,
  PanelLeft,
  Plug,
  Repeat,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react"
import { Mascot, type MascotPose } from "@/components/Mascot"
import { cn } from "@/lib/utils"
import {
  DOCS_GROUPS,
  DOCS_PAGES,
  docsHref,
  matchesQuery,
  type DocsIcon,
  type DocsPage,
} from "./docs-pages"

// Which mascot pose sits beside each page's title.
const POSES: Record<DocsIcon, MascotPose> = {
  hand: "waving",
  rocket: "astronaut",
  plug: "laptop",
  message: "waving",
  globe: "astronaut",
  shield: "cool",
  repeat: "celebrate",
  search: "reading",
  brain: "thinking",
  mail: "laptop",
  users: "heart",
  sparkles: "cool",
  card: "celebrate",
  lock: "cool",
}

const ICONS: Record<DocsIcon, LucideIcon> = {
  hand: Hand,
  rocket: Rocket,
  plug: Plug,
  message: MessageCircle,
  globe: Globe,
  shield: ShieldCheck,
  repeat: Repeat,
  search: Search,
  brain: Brain,
  mail: Mail,
  users: Users,
  sparkles: Sparkles,
  card: CreditCard,
  lock: Lock,
}

function currentPage(pathname: string): DocsPage {
  const slug = pathname.replace(/^\/docs\/?/, "").replace(/\/$/, "")
  return DOCS_PAGES.find((p) => p.slug === slug) ?? DOCS_PAGES[0]!
}

function Sidebar({
  page,
  onSearch,
  onNavigate,
  onCollapse,
}: {
  page: DocsPage
  onSearch: () => void
  onNavigate?: () => void
  onCollapse?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-2">
        <Link href="/" className="text-xl font-medium tracking-[-0.02em] text-[#1d1b18]">
          yomi
        </Link>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide sidebar"
            className="rounded-lg p-1.5 text-[#1d1b18]/70 hover:bg-black/5 hover:text-[#1d1b18]"
          >
            <PanelLeft size={18} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onSearch}
        className="mt-4 flex w-full items-center gap-2.5 rounded-xl border border-black/[0.07] bg-white/70 px-3 py-2 text-sm text-[#1d1b18]/70 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-white"
      >
        <Search size={15} />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded-md border border-black/10 bg-black/[0.03] px-1.5 font-mono text-[11px]">
          Ctrl
        </kbd>
        <kbd className="rounded-md border border-black/10 bg-black/[0.03] px-1.5 font-mono text-[11px]">
          K
        </kbd>
      </button>

      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="mt-5 flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-[#1d1b18]/85 hover:bg-black/5"
      >
        go to app <ArrowUpRight size={13} className="opacity-50" />
      </Link>

      <nav aria-label="Docs" className="mt-6 space-y-7 pb-10">
        {DOCS_GROUPS.map((group) => (
          <div key={group}>
            <p className="px-2 text-sm text-[#1d1b18]/60">{group}</p>
            <div className="mt-2 space-y-0.5">
              {DOCS_PAGES.filter((p) => p.group === group).map((p) => {
                const Icon = ICONS[p.icon]
                const active = p.slug === page.slug
                return (
                  <Link
                    key={p.slug}
                    href={docsHref(p)}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
                      active ? "text-[#1d1b18]" : "text-[#1d1b18]/75 hover:text-[#1d1b18]",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="docs-active-page"
                        className="absolute inset-0 rounded-xl bg-black/[0.07]"
                        transition={{ type: "spring", stiffness: 420, damping: 36 }}
                      />
                    )}
                    <Icon size={15} className="relative shrink-0 opacity-80" />
                    <span className="relative">{p.title}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </div>
  )
}

function OnThisPage({ page }: { page: DocsPage }) {
  const [activeId, setActiveId] = useState(page.sections[0]?.id ?? "")

  useEffect(() => {
    setActiveId(page.sections[0]?.id ?? "")
    const headings = page.sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null)
    if (!headings.length) return
    // The active section is the last heading that has scrolled past the top third.
    const onScroll = () => {
      const line = window.innerHeight * 0.33
      let current = headings[0]!.id
      for (const h of headings) if (h.getBoundingClientRect().top <= line) current = h.id
      setActiveId(current)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [page])

  if (!page.sections.length) return null
  return (
    <nav aria-label="On this page">
      <p className="flex items-center gap-2 text-sm font-medium text-[#1d1b18]/80">
        <AlignLeft size={15} /> On this page
      </p>
      <div className="relative mt-3 border-l border-black/10">
        {page.sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={cn(
              "relative block py-1.5 pl-3 text-sm transition-colors",
              activeId === s.id ? "text-[#1d1b18]" : "text-[#1d1b18]/60 hover:text-[#1d1b18]",
            )}
          >
            {activeId === s.id && (
              <motion.span
                layoutId="docs-toc-marker"
                className="absolute -left-px top-1.5 h-5 w-[2px] rounded-full bg-[#1d1b18]"
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              />
            )}
            {s.title}
          </a>
        ))}
      </div>
    </nav>
  )
}

function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const results = useMemo(() => DOCS_PAGES.filter((p) => matchesQuery(p, query)), [query])

  useEffect(() => {
    if (open) {
      setQuery("")
      setIndex(0)
      setTimeout(() => input.current?.focus(), 0)
    }
  }, [open])

  function go(p: DocsPage | undefined) {
    if (!p) return
    onClose()
    router.push(docsHref(p))
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/20 px-4 pt-[14vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-label="Search docs"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-black/10 bg-[#f7f5f1] shadow-2xl"
          >
            <label className="flex items-center gap-3 border-b border-black/10 px-4">
              <Search size={17} className="text-[#1d1b18]/60" />
              <input
                ref={input}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setIndex(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault()
                    setIndex((i) => Math.min(i + 1, results.length - 1))
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault()
                    setIndex((i) => Math.max(i - 1, 0))
                  } else if (e.key === "Enter") go(results[index])
                  else if (e.key === "Escape") onClose()
                }}
                placeholder="search the docs"
                className="w-full bg-transparent py-3.5 text-[15px] text-[#1d1b18] outline-none placeholder:text-[#1d1b18]/45"
              />
            </label>
            <div className="max-h-80 overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-[#1d1b18]/60">
                  nothing matches &ldquo;{query}&rdquo;. try asking yomi.
                </p>
              ) : (
                results.map((p, i) => {
                  const Icon = ICONS[p.icon]
                  return (
                    <button
                      key={p.slug}
                      type="button"
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => go(p)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                        i === index && "bg-black/[0.06]",
                      )}
                    >
                      <Icon size={16} className="shrink-0 text-[#1d1b18]/70" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[#1d1b18]">{p.title}</span>
                        <span className="block truncate text-[13px] text-[#1d1b18]/60">
                          {p.summary}
                        </span>
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function DocsFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const page = currentPage(pathname)
  const reduce = useReducedMotion()
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => setDrawer(false), [pathname])

  return (
    <div className="docs min-h-dvh bg-[#e7e3dc] text-[#3a3631]">
      {/* phones: a slim top bar with a drawer */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-black/10 bg-[#ecebe9]/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="text-lg font-medium text-[#1d1b18]">
          yomi
        </Link>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSearching(true)}
            aria-label="Search docs"
            className="rounded-lg p-2 text-[#1d1b18]/75 hover:bg-black/5"
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            onClick={() => setDrawer((v) => !v)}
            aria-label="Docs menu"
            aria-expanded={drawer}
            className="rounded-lg p-2 text-[#1d1b18]/75 hover:bg-black/5"
          >
            {drawer ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>
      <AnimatePresence>
        {drawer && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed inset-x-0 top-[57px] z-30 max-h-[calc(100dvh-57px)] overflow-y-auto border-b border-black/10 bg-[#ecebe9] px-4 pt-4 lg:hidden"
          >
            <Sidebar
              page={page}
              onSearch={() => setSearching(true)}
              onNavigate={() => setDrawer(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex">
        {/* desktop sidebar on its own, lighter panel */}
        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.aside
              key="sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.25, ease: [0.32, 0.72, 0, 1] }}
              className="hidden shrink-0 overflow-hidden bg-[#ecebe9] lg:block"
            >
              {/* the grey panel reaches the screen edge; its contents stay a 300px column */}
              <div className="sticky top-0 h-dvh w-[300px] overflow-y-auto 2xl:w-[calc((100vw-1440px)/2+300px)]">
                <div className="ml-auto w-[300px] px-6 py-6">
                  <Sidebar
                    page={page}
                    onSearch={() => setSearching(true)}
                    onCollapse={() => setCollapsed(true)}
                  />
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <div className="relative min-w-0 flex-1">
          {collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Show sidebar"
              className="absolute left-4 top-6 z-10 hidden rounded-lg p-1.5 text-[#1d1b18]/70 hover:bg-black/5 lg:block"
            >
              <PanelLeft size={18} />
            </button>
          )}
          <div className="mx-auto flex max-w-[1140px] gap-12 px-5 pb-24 pt-8 sm:px-8 lg:pt-7">
            <AnimatePresence mode="wait" initial={false}>
              <motion.article
                key={page.slug}
                initial={reduce ? false : { opacity: 0, y: 10, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduce ? undefined : { opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                className="docs-prose min-w-0 max-w-[660px] flex-1"
              >
                <h1 className="flex items-end gap-2 text-[15px] font-semibold text-[#1d1b18]">
                  <Mascot pose={POSES[page.icon]} float className="w-12 sm:w-14" />
                  <span className="pb-1">{page.title}</span>
                </h1>
                {children}
              </motion.article>
            </AnimatePresence>
            <aside className="hidden w-52 shrink-0 xl:block">
              <div className="sticky top-8">
                <OnThisPage page={page} />
                <Link
                  href="/support"
                  className="mt-8 flex items-center gap-3 rounded-2xl border border-black/10 bg-white/60 p-3 text-sm text-[#1d1b18]/80 transition-colors hover:bg-white"
                >
                  <Mascot pose="thinking" className="w-12 shrink-0" />
                  <span>
                    <span className="block font-medium text-[#1d1b18]">stuck?</span>
                    ask a human
                  </span>
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </div>

      <SearchPalette open={searching} onClose={() => setSearching(false)} />
    </div>
  )
}
