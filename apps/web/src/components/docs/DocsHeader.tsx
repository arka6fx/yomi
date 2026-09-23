"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Menu, Search, X } from "lucide-react"
import { BrandMark } from "@/components/BrandMark"
import { authClient } from "@/lib/auth-client"
import { DOCS_INDEX, matchesQuery } from "./docs-search"

export function DocsHeader({
  query,
  onQueryChange,
  menuOpen,
  onMenuToggle,
}: {
  query: string
  onQueryChange: (value: string) => void
  menuOpen: boolean
  onMenuToggle: () => void
}) {
  const { data: session } = authClient.useSession()
  const inputRef = useRef<HTMLInputElement>(null)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setMobileSearchOpen(true)
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  // Enter jumps to the first matching section via a plain anchor hash, same
  // convention as the sidebar/toc links — no router involved.
  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return
    const match = DOCS_INDEX.find((entry) => matchesQuery(entry, query))
    if (match) {
      window.location.hash = match.id
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
        <BrandMark size="sm" />

        <div className="relative hidden max-w-md flex-1 sm:block">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search docs..."
            aria-label="Search docs"
            className="w-full rounded-xl border border-border bg-muted/40 py-1.5 pl-9 pr-14 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Ctrl K
          </kbd>
        </div>

        <button
          type="button"
          onClick={() => setMobileSearchOpen((v) => !v)}
          aria-label="Search docs"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground sm:hidden"
        >
          {mobileSearchOpen ? <X size={18} /> : <Search size={18} />}
        </button>

        <div className="ml-auto hidden items-center gap-4 sm:flex">
          <Link
            href="/support"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Support
          </Link>
          <Link
            href={session ? "/dashboard" : "/signup"}
            className="rounded-xl bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {session ? "Dashboard" : "Get started"}
          </Link>
        </div>

        <button
          type="button"
          onClick={onMenuToggle}
          aria-label="Toggle docs navigation"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted/50 hover:text-foreground lg:hidden"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {mobileSearchOpen && (
        <div className="border-t border-border px-4 py-3 sm:hidden">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search docs..."
              aria-label="Search docs"
              autoFocus
              className="w-full rounded-xl border border-border bg-muted/40 py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>
      )}
    </header>
  )
}
