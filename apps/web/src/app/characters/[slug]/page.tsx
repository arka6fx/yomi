import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, ChevronRight } from "lucide-react"
import { SitePage } from "@/components/SitePage"
import {
  CharacterAvatar,
  CharacterCard,
  HowCharactersWork,
  TextOnTelegram,
  toCard,
} from "@/components/characters/CharacterParts"
import {
  CHARACTERS,
  characterTelegramLink,
  getCharacter,
  relatedCharacters,
  seriesOf,
  tagForName,
} from "@/lib/characters"
import { pageMetadata } from "@/lib/site"
import { Mascot } from "@/components/Mascot"

export const dynamicParams = false

export function generateStaticParams() {
  return CHARACTERS.map((c) => ({ slug: c.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const character = getCharacter((await params).slug)
  if (!character) return {}
  return pageMetadata({
    title: `Text ${character.name} on Telegram`,
    description: `${character.tagline} ${character.description}`.slice(0, 158),
    path: `/characters/${character.slug}`,
  })
}

export default async function CharacterPage({ params }: { params: Promise<{ slug: string }> }) {
  const character = getCharacter((await params).slug)
  if (!character) notFound()

  const series = seriesOf(character)
  const firstTag = character.tags[0] ? tagForName(character.tags[0]) : undefined
  const related = relatedCharacters(character)
  const faqs = [
    {
      q: `Can I text ${character.name} on Telegram?`,
      a: `Yes. Tap the button on this page and Yomi answers you as ${character.name}. It's free to start.`,
    },
    {
      q: `Is this the real ${character.name}?`,
      a: `No. It's an unofficial, fan-made AI take on a fictional character${series && series !== character.name ? ` from ${series}` : ""}, not affiliated with any rights holder.`,
    },
    {
      q: `What can ${character.name} help me with?`,
      a: `Everything Yomi can do: reminders and routines, your calendar and email, research and planning. ${character.name} just does it in their own voice, and anything that sends, books, pays or deletes still asks you first.`,
    },
    {
      q: "Can I switch back?",
      a: "Any time, to plain Yomi or to another character, from the dashboard.",
    },
  ]
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  }

  return (
    <SitePage>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <article className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6 sm:pt-14">
        <nav
          aria-label="breadcrumb"
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
          <Link href="/characters" className="hover:text-foreground">
            characters
          </Link>
          {firstTag && (
            <>
              <ChevronRight size={14} />
              <Link href={`/characters/tags/${firstTag.slug}`} className="hover:text-foreground">
                {firstTag.label}
              </Link>
            </>
          )}
          <ChevronRight size={14} />
          <span className="text-foreground">{character.name}</span>
        </nav>

        <header className="mt-6 flex items-center gap-5">
          <CharacterAvatar character={character} size={120} className="rounded-3xl shadow-md" />
          <div className="min-w-0">
            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              {character.name}
            </h1>
            <p className="mt-2 text-lg text-foreground/80">{character.tagline}</p>
            {series && series !== character.name && (
              <p className="mt-1 text-sm text-muted-foreground">{series} · fan-made</p>
            )}
          </div>
        </header>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <TextOnTelegram character={character} />
          <Link
            href="/signup"
            className="text-sm font-semibold text-foreground/70 hover:text-foreground"
          >
            new to yomi? sign up free
          </Link>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Free to start. {character.name} says hi first, then answers in their own voice with
          everything Yomi can do.
        </p>

        <blockquote className="mt-10 border-l-2 border-foreground/70 pl-5 text-lg leading-relaxed">
          {character.description}
        </blockquote>

        {character.firstLines[0] && (
          <section className="mt-10">
            <p className="eyebrow">their first text</p>
            <p className="mt-3 max-w-lg rounded-3xl rounded-bl-md bg-card px-4 py-3 text-[15px] shadow-sm">
              {character.firstLines[0]}
            </p>
          </section>
        )}

        {character.starters.length > 0 && (
          <section className="mt-12">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              Things to text {character.name}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {character.starters.map((s) => (
                <a
                  key={s}
                  href={characterTelegramLink(character.slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chip px-4 py-2 text-sm font-medium hover:bg-card"
                >
                  {s}
                </a>
              ))}
            </div>
          </section>
        )}

        <div className="surface mt-12 flex items-center gap-4 p-5">
          <Mascot pose="waving" className="w-16 shrink-0" />
          <p className="text-[15px] text-muted-foreground">
            <span className="font-semibold text-foreground">yomi is still underneath.</span>{" "}
            {character.name} keeps yomi&apos;s memory, apps and approvals. send{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">/yomi</code> any time to
            switch back.
          </p>
        </div>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            Questions about {character.name}
          </h2>
          <dl className="mt-5 space-y-6">
            {faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-1.5 text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {character.tags.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-2">
            {character.tags.map((t) => {
              const tag = tagForName(t)
              return tag ? (
                <Link
                  key={t}
                  href={`/characters/tags/${tag.slug}`}
                  className="chip px-3 py-1 text-sm font-semibold"
                >
                  {tag.label}
                </Link>
              ) : null
            })}
          </div>
        )}

        <div className="mt-10">
          <HowCharactersWork name={character.name} />
        </div>

        {related.length > 0 && (
          <section className="mt-14 border-t border-border pt-10">
            <p className="eyebrow">more characters like {character.name}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((c) => (
                <CharacterCard key={c.slug} character={toCard(c)} compact />
              ))}
            </div>
            <Link
              href="/characters"
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
            >
              browse every character <ArrowRight size={14} />
            </Link>
          </section>
        )}

        <footer className="mt-12 space-y-2 text-xs text-muted-foreground">
          <p>
            Gallery characters are unofficial, fan-made AI personas that speak as fiction. Not
            affiliated with any rights holder.
          </p>
          {character.imageCredit && character.imageUrl && (
            <p>
              picture:{" "}
              <a
                href={character.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="underline underline-offset-2"
              >
                {character.imageCredit}
              </a>
            </p>
          )}
          <p className="flex flex-wrap gap-4">
            <Link href="/characters/guidelines" className="underline underline-offset-2">
              guidelines
            </Link>
            <Link href="/copyright" className="underline underline-offset-2">
              copyright
            </Link>
            <Link href="/support" className="underline underline-offset-2">
              report
            </Link>
          </p>
        </footer>
      </article>
    </SitePage>
  )
}
