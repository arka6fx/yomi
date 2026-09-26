"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowRight, Plus, Search } from "lucide-react"
import { Reveal } from "@/components/dashboard/shell/motion"
import { cn } from "@/lib/utils"
import {
  CharacterAvatar,
  CharacterCard,
  HowCharactersWork,
  TextOnTelegram,
  type CardCharacter,
} from "@/components/characters/CharacterParts"

type Tag = { tag: string; slug: string; label: string; title: string; hook: string; count: number }

const PAGE = 24

function matches(query: string, c: CardCharacter): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [c.name, c.tagline, c.basedOn, c.tags.join(" ")].some((f) => f.toLowerCase().includes(q))
}

function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <h2 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{children}</h2>
      {aside}
    </div>
  )
}

function Grid({ characters }: { characters: CardCharacter[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {characters.map((c) => (
        <CharacterCard key={c.slug} character={c} />
      ))}
    </div>
  )
}

export function CharacterBrowser({
  characters,
  tags,
}: {
  characters: CardCharacter[]
  tags: Tag[]
}) {
  const [tag, setTag] = useState("all")
  const [query, setQuery] = useState("")
  const [shown, setShown] = useState(PAGE)

  const active = tags.find((t) => t.tag === tag)
  const filtered = useMemo(
    () => characters.filter((c) => (tag === "all" || c.tags.includes(tag)) && matches(query, c)),
    [characters, tag, query],
  )
  const featured = characters.filter((c) => c.featured)
  const browsing = tag === "all" && !query.trim()

  function pick(next: string) {
    setTag(next)
    setShown(PAGE)
  }

  const rail = (
    <nav aria-label="character categories" className="space-y-1">
      <p className="eyebrow mb-2 px-3">categories</p>
      {[{ tag: "all", label: "all", count: characters.length }, ...tags].map((t) => (
        <button
          key={t.tag}
          type="button"
          onClick={() => pick(t.tag)}
          aria-pressed={tag === t.tag}
          className={cn(
            "flex w-full items-center justify-between rounded-xl px-3 py-1.5 text-left text-sm font-medium transition-colors",
            tag === t.tag
              ? "bg-brand text-white shadow-[0_6px_16px_-8px_hsl(var(--brand))]"
              : "text-foreground/80 hover:bg-card",
          )}
        >
          {t.label}
          <span className={tag === t.tag ? "text-white/80" : "text-muted-foreground"}>
            {t.count}
          </span>
        </button>
      ))}
    </nav>
  )

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <Link
          href="/dashboard?tab=characters"
          className="btn-telegram w-full whitespace-nowrap px-4 py-3 text-[13px] font-semibold"
        >
          <Plus size={15} /> make your own character
        </Link>
        <label className="relative mt-3 block">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShown(PAGE)
            }}
            placeholder="search characters"
            aria-label="search characters"
            className="w-full rounded-full border border-border bg-card py-2.5 pl-10 pr-4 text-sm outline-none transition-shadow focus:shadow-[0_0_0_3px_hsl(var(--brand)/0.2)]"
          />
        </label>
        {/* phones: a scrolling chip row; desktop: the full rail */}
        <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
          {[{ tag: "all", label: "all", count: characters.length }, ...tags].map((t) => (
            <button
              key={t.tag}
              type="button"
              onClick={() => pick(t.tag)}
              aria-pressed={tag === t.tag}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium",
                tag === t.tag
                  ? "border-brand bg-brand text-white"
                  : "border-border bg-card text-foreground/80",
              )}
            >
              {t.label} <span className="opacity-60">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 hidden lg:block">{rail}</div>
      </aside>

      <div className="min-w-0 space-y-14">
        {!browsing ? (
          <Reveal key={`${tag}:${query}`}>
            <SectionTitle
              aside={
                active && (
                  <Link
                    href={`/characters/tags/${active.slug}`}
                    className="hidden shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
                  >
                    {active.count} characters · open the {active.label} page{" "}
                    <ArrowRight size={14} />
                  </Link>
                )
              }
            >
              {query.trim() ? `results for “${query.trim()}”` : active?.title}
            </SectionTitle>
            {active && !query.trim() && (
              <p className="-mt-2 mb-5 max-w-2xl text-[15px] text-muted-foreground">
                {active.hook}
              </p>
            )}
            {filtered.length ? (
              <Grid characters={filtered.slice(0, shown)} />
            ) : (
              <p className="surface p-6 text-sm text-muted-foreground">
                no one here yet. make your own from a name and a line.
              </p>
            )}
            {filtered.length > shown && (
              <ShowMore left={filtered.length - shown} onClick={() => setShown(shown + PAGE)} />
            )}
          </Reveal>
        ) : (
          <>
            <Reveal i={0}>
              <SectionTitle>featured</SectionTitle>
              <Grid characters={featured.slice(0, 6)} />
            </Reveal>

            <Reveal i={1}>
              <SectionTitle>try these</SectionTitle>
              <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
                {featured.slice(0, 10).map((c) => (
                  <Link
                    key={c.slug}
                    href={`/characters/${c.slug}`}
                    className="surface flex w-72 shrink-0 snap-start items-center gap-3 p-3 transition-transform hover:-translate-y-0.5"
                  >
                    <CharacterAvatar character={c} size={48} className="rounded-full" />
                    <span className="min-w-0">
                      <span className="line-clamp-1 text-sm font-semibold">
                        {c.starter ?? c.tagline}
                      </span>
                      <span className="text-xs text-muted-foreground">with {c.name}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Reveal>

            <Reveal i={2}>
              <SectionTitle
                aside={<span className="text-sm text-muted-foreground">{characters.length}</span>}
              >
                all characters
              </SectionTitle>
              <Grid characters={characters.slice(0, shown)} />
              {characters.length > shown && (
                <ShowMore left={characters.length - shown} onClick={() => setShown(shown + PAGE)} />
              )}
            </Reveal>

            <Reveal i={3}>
              <SectionTitle>try texting</SectionTitle>
              <div className="grid gap-3 md:grid-cols-3">
                {featured.slice(0, 3).map((c) => (
                  <div key={c.slug} className="surface flex flex-col p-4">
                    <Link href={`/characters/${c.slug}`} className="flex items-center gap-3">
                      <CharacterAvatar character={c} size={44} className="rounded-full" />
                      <span className="text-[15px] font-semibold">{c.name}</span>
                    </Link>
                    <p className="mt-3 rounded-2xl bg-muted px-3.5 py-2.5 text-sm">
                      {c.starter ?? c.tagline}
                    </p>
                    <TextOnTelegram character={c} label="send it on telegram" className="mt-4" />
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal i={4}>
              <HowCharactersWork />
            </Reveal>
          </>
        )}
      </div>
    </div>
  )
}

function ShowMore({ left, onClick }: { left: number; onClick: () => void }) {
  return (
    <div className="mt-6 text-center">
      <button type="button" onClick={onClick} className="chip px-5 py-2 text-sm font-semibold">
        show {Math.min(left, PAGE)} more
      </button>
    </div>
  )
}
