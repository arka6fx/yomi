import type { Metadata } from "next"
import Link from "next/link"
import { Mascot } from "@/components/Mascot"
import { SitePage } from "@/components/SitePage"
import { CharacterBrowser } from "@/components/characters/CharacterBrowser"
import { toCard } from "@/components/characters/CharacterParts"
import { CHARACTERS, CHARACTER_TAGS } from "@/lib/characters"
import { pageMetadata } from "@/lib/site"

export const dynamic = "force-static"

export const metadata: Metadata = pageMetadata({
  title: "AI characters you can text on Telegram",
  description: `Pick one of ${CHARACTERS.length} fan-made characters and Yomi texts you as them on Telegram, with Yomi's memory and tools underneath. Switch any time.`,
  path: "/characters",
})

export default function CharactersPage() {
  return (
    <SitePage>
      <section className="mx-auto max-w-7xl px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
        <div className="mb-10 flex flex-col-reverse gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8 lg:ml-[280px]">
          <div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-5xl">
              AI characters you can text on Telegram
            </h1>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">
              Pick one and Yomi texts you as them, with its memory and tools underneath. Switch any
              time.
            </p>
            <Link
              href="/dashboard?tab=characters"
              className="mt-3 inline-block text-[15px] font-semibold underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground"
            >
              already on yomi? open your characters
            </Link>
          </div>
          <Mascot pose="cool" float className="w-20 shrink-0 sm:w-28 lg:w-32" />
        </div>
        <CharacterBrowser characters={CHARACTERS.map(toCard)} tags={CHARACTER_TAGS} />
      </section>
    </SitePage>
  )
}
