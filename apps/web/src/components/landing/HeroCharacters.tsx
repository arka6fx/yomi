"use client"

import Link from "next/link"
import { CharacterAvatar } from "@/components/characters/CharacterAvatar"
import { useShuffled } from "@/lib/shuffle"

export type HeroCharacter = { slug: string; name: string; color: string; imageUrl: string }

// Spots around the phone that stay clear of the side bubbles: one of each side is used.
const LEFT_SPOTS = ["left-[13%] top-0", "left-[18%] top-[520px]"]
const RIGHT_SPOTS = ["right-[12%] top-[340px]", "right-[19%] top-[560px]"]

// Two characters floating beside the phone, different on every visit.
export function HeroCharacters({ pool }: { pool: HeroCharacter[] }) {
  const { items, ready } = useShuffled(pool)
  const { items: lefts } = useShuffled(LEFT_SPOTS)
  const { items: rights } = useShuffled(RIGHT_SPOTS)
  if (!ready) return null
  const spots = [lefts[0]!, rights[0]!]
  return (
    <>
      {items.slice(0, 2).map((character, i) => (
        <Link
          key={character.slug}
          href={`/characters/${character.slug}`}
          className={`absolute hidden animate-float flex-col items-center motion-reduce:animate-none lg:flex ${spots[i]}`}
          style={{ animationDelay: `${i * 1.8}s` }}
        >
          <CharacterAvatar
            character={character}
            size={104}
            className="rounded-full shadow-[0_18px_36px_-12px_rgba(16,40,80,0.45)] ring-4 ring-white"
          />
          <span className="-mt-3 rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-foreground shadow-[0_4px_12px_-4px_rgba(16,24,40,0.3)]">
            text {character.name}
          </span>
        </Link>
      ))}
    </>
  )
}
