import Link from "next/link"
import { CharacterAvatar } from "@/components/characters/CharacterAvatar"
import { ShareCharacter } from "@/components/characters/ShareCharacter"
import { TelegramIcon } from "@/components/TelegramIcon"
import { cn } from "@/lib/utils"
import { characterTelegramLink, seriesOf, type GalleryCharacter } from "@/lib/characters"

// Just what a card needs, so the client gallery doesn't ship every bio and first line.
export type CardCharacter = Pick<
  GalleryCharacter,
  "slug" | "name" | "emoji" | "color" | "tagline" | "basedOn" | "tags" | "featured" | "imageUrl"
> & { starter?: string }

export function toCard(c: GalleryCharacter): CardCharacter {
  return {
    slug: c.slug,
    name: c.name,
    emoji: c.emoji,
    color: c.color,
    tagline: c.tagline,
    basedOn: c.basedOn,
    tags: c.tags,
    featured: c.featured,
    imageUrl: c.imageUrl,
    starter: c.starters[0],
  }
}

export { CharacterAvatar }

export function CharacterCard({
  character,
  compact = false,
}: {
  character: CardCharacter
  compact?: boolean
}) {
  return (
    <div className="group/card relative">
      <Link
        href={`/characters/${character.slug}`}
        className="surface group relative flex gap-4 p-3 transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_rgba(16,40,80,0.25)]"
      >
        <CharacterAvatar character={character} size={compact ? 84 : 112} />
        <span className="flex min-w-0 flex-1 flex-col py-1">
          <span className="truncate text-[15px] font-semibold text-foreground">
            {character.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">{seriesOf(character)}</span>
          <span className="mt-2 line-clamp-2 text-[13px] leading-snug text-foreground/80">
            {character.tagline}
          </span>
          {!compact && (
            <span className="mt-auto flex flex-wrap gap-1 pt-2">
              {character.tags.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </span>
          )}
        </span>
      </Link>
      {/* A sibling of the link, not inside it: a button can't live in an anchor. Always
          shown on touch screens, on hover elsewhere. */}
      <ShareCharacter
        slug={character.slug}
        name={character.name}
        variant="icon"
        className="absolute right-2 top-2 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/card:opacity-100"
      />
    </div>
  )
}

export function TextOnTelegram({
  character,
  label,
  className,
}: {
  character: Pick<CardCharacter, "slug" | "name">
  label?: string
  className?: string
}) {
  return (
    <a
      href={characterTelegramLink(character.slug)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("btn-telegram px-5 py-2.5 text-sm font-semibold", className)}
    >
      <TelegramIcon size={18} />
      {label ?? `text ${character.name} on telegram`}
    </a>
  )
}

export function HowCharactersWork({ name }: { name?: string }) {
  return (
    <div className="surface p-6 sm:p-8">
      <p className="eyebrow">how it works</p>
      <div className="mt-3 max-w-2xl space-y-3 text-[15px] leading-relaxed text-muted-foreground">
        <p>
          Yomi is an AI assistant that lives in your Telegram. A character is a voice you put on top
          of it: pick {name ?? "one"} and every message you send Yomi is answered in{" "}
          {name ? "their" : "that"} voice.
        </p>
        <p>
          Characters keep all of Yomi&apos;s tools and rules. They can still check your calendar,
          set a routine or look something up, and anything that sends, books, pays or deletes still
          waits for your approval. Switch back to plain Yomi any time.
        </p>
        <p>
          Every gallery character is an unofficial, fan-made take on a fictional character. You can
          also make your own from a name and a line.
        </p>
      </div>
    </div>
  )
}
