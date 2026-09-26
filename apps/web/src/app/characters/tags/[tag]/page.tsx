import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRight, Plus } from "lucide-react"
import { SitePage } from "@/components/SitePage"
import { Reveal } from "@/components/dashboard/shell/motion"
import { CharacterCard, toCard } from "@/components/characters/CharacterParts"
import { CHARACTERS, CHARACTER_TAGS, getTag } from "@/lib/characters"
import { pageMetadata } from "@/lib/site"
import { Mascot } from "@/components/Mascot"

export const dynamicParams = false

export function generateStaticParams() {
  return CHARACTER_TAGS.map((t) => ({ tag: t.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>
}): Promise<Metadata> {
  const tag = getTag((await params).tag)
  if (!tag) return {}
  return pageMetadata({
    title: tag.title,
    description: `${tag.hook} ${tag.count} fan-made characters you can text on Telegram with Yomi.`,
    path: `/characters/tags/${tag.slug}`,
  })
}

export default async function CharacterTagPage({ params }: { params: Promise<{ tag: string }> }) {
  const tag = getTag((await params).tag)
  if (!tag) notFound()
  const characters = CHARACTERS.filter((c) => c.tags.includes(tag.tag))

  return (
    <SitePage>
      <section className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <nav
          aria-label="breadcrumb"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <Link href="/characters" className="hover:text-foreground">
            characters
          </Link>
          <ChevronRight size={14} />
          <span className="text-foreground">{tag.label}</span>
        </nav>

        <Mascot pose="cool" float className="float-right ml-4 mt-4 w-20 sm:w-28" />
        <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-6xl">
          {tag.title}
        </h1>
        <p className="mt-5 text-xl text-foreground/80">{tag.hook}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {tag.count} characters. Every one is an unofficial, fan-made AI persona; tap one to read
          about them and text them on Telegram.
        </p>

        <Reveal className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {characters.map((c) => (
            <CharacterCard key={c.slug} character={toCard(c)} compact />
          ))}
        </Reveal>

        <div className="surface mt-12 p-6 sm:p-8">
          <p className="eyebrow">not here?</p>
          <p className="mt-3 text-[15px] text-foreground/80">
            Make your own in a minute: a name and one line about who they are is enough.
          </p>
          <Link
            href="/dashboard?tab=characters"
            className="btn-telegram mt-5 px-5 py-2.5 text-sm font-semibold"
          >
            <Plus size={16} /> make a character
          </Link>
        </div>

        <div className="mt-12">
          <p className="eyebrow">more</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHARACTER_TAGS.filter((t) => t.slug !== tag.slug).map((t) => (
              <Link
                key={t.slug}
                href={`/characters/tags/${t.slug}`}
                className="chip px-3.5 py-1.5 text-sm font-semibold hover:bg-card"
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </SitePage>
  )
}
