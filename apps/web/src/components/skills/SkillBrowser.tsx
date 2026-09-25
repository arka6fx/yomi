"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Search } from "lucide-react"
import { SKILL_CATALOG, SKILL_CATEGORIES } from "@/lib/skills-catalog"
import { SkillRowCard, SkillTile } from "@/components/skills/SkillCard"
import { cn } from "@/lib/utils"

function useFilter(initial: string) {
  const [category, setCategory] = useState(initial)
  const [query, setQuery] = useState("")
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SKILL_CATALOG.filter(
      (skill) =>
        (category === "all" || category === "for you" || skill.category === category) &&
        (!q || `${skill.name} ${skill.description} ${skill.category}`.toLowerCase().includes(q)),
    )
  }, [category, query])
  return { category, setCategory, query, setQuery, results }
}

function SearchBox({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2.5 rounded-full border border-white/80 bg-card/80 px-4 text-muted-foreground shadow-sm",
        className,
      )}
    >
      <Search size={16} aria-hidden />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="search skills"
        aria-label="Search skills"
        className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  )
}

// Landing-page version: segmented tabs, a search box and one row of four cards.
export function LandingSkillTabs() {
  const tabs = ["for you", ...SKILL_CATEGORIES.slice(0, 5)]
  const { category, setCategory, query, setQuery, results } = useFilter("for you")
  const shown = results.slice(0, 4)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div
          role="tablist"
          aria-label="Skill categories"
          className="no-scrollbar flex max-w-full overflow-x-auto rounded-full bg-muted p-1"
        >
          {tabs.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={category === tab}
              onClick={() => setCategory(tab)}
              className={cn(
                "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition",
                category === tab
                  ? "bg-card text-foreground shadow-sm"
                  : "text-foreground/55 hover:text-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <SearchBox value={query} onChange={setQuery} className="w-full sm:w-52" />
      </div>

      <div className="mb-4 mt-10 flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{category}</h3>
        <Link
          href="/skills"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          browse all <ArrowRight size={14} />
        </Link>
      </div>
      {shown.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((skill) => (
            <SkillRowCard key={skill.id} skill={skill} />
          ))}
        </div>
      ) : (
        <p className="surface p-6 text-center text-sm text-muted-foreground">
          no skills match that yet. just ask yomi, most things don&apos;t need a skill.
        </p>
      )}
    </div>
  )
}

// Full gallery page: search, category chips and every skill as a tile.
export function SkillGallery() {
  const { category, setCategory, query, setQuery, results } = useFilter("all")

  return (
    <div>
      <SearchBox value={query} onChange={setQuery} className="py-1.5" />
      <div className="mt-4 flex flex-wrap gap-2">
        {["all", ...SKILL_CATEGORIES].map((tab) => (
          <button
            key={tab}
            onClick={() => setCategory(tab)}
            aria-pressed={category === tab}
            className={cn(
              "chip transition",
              category === tab
                ? "!border-primary !bg-primary !text-primary-foreground"
                : "hover:bg-card",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {results.length > 0 ? (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {results.map((skill) => (
            <SkillTile key={skill.id} skill={skill} />
          ))}
        </div>
      ) : (
        <p className="surface mt-8 p-8 text-center text-sm text-muted-foreground">
          no skills match “{query}”. you can still just ask yomi on telegram.
        </p>
      )}
    </div>
  )
}
