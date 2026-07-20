"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { DOCS_INDEX } from "./docs-search"
import { DocsHeader } from "./DocsHeader"
import { DocsSidebar } from "./DocsSidebar"
import { DocsToc } from "./DocsToc"

export function DocsShell({
  banner,
  children,
}: {
  banner?: React.ReactNode
  children: React.ReactNode
}) {
  const [activeId, setActiveId] = useState<string>(DOCS_INDEX[0]!.id)
  const [query, setQuery] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)

  // Scroll-spy: track which Section is nearest the top of the viewport so both
  // rails can highlight it. Ids come from DOCS_INDEX, which must match the
  // `Section` ids rendered in docs/page.tsx.
  useEffect(() => {
    const sections = DOCS_INDEX.map((entry) => document.getElementById(entry.id)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible.length > 0) {
          setActiveId(visible[0]!.target.id)
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    )

    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [])

  return (
    <div>
      <DocsHeader
        query={query}
        onQueryChange={setQuery}
        menuOpen={menuOpen}
        onMenuToggle={() => setMenuOpen((v) => !v)}
      />

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden border-b border-border bg-card/95 px-6 py-4 lg:hidden"
          >
            <DocsSidebar activeId={activeId} query={query} onNavigate={() => setMenuOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {banner}

      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-14 lg:grid-cols-[220px_1fr] xl:grid-cols-[220px_1fr_200px]">
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <DocsSidebar activeId={activeId} query={query} />
          </div>
        </aside>

        <main className="min-w-0">{children}</main>

        <aside className="hidden xl:block">
          <div className="sticky top-24">
            <DocsToc activeId={activeId} />
          </div>
        </aside>
      </div>
    </div>
  )
}
