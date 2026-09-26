"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

type AvatarCharacter = { name: string; color: string; imageUrl: string }

// Portrait in a rounded square. Falls back to the first letter on the character's colour
// when there is no picture or it fails to load. Fandom and AniList refuse hotlinks that
// carry another site's referrer, hence no-referrer.
export function CharacterAvatar({
  character,
  size = 112,
  className,
}: {
  character: AvatarCharacter
  size?: number
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const img = useRef<HTMLImageElement>(null)
  // A server-rendered <img> can fail before React attaches onError; catch that on mount.
  useEffect(() => {
    const el = img.current
    if (el?.complete && el.naturalWidth === 0) setFailed(true)
  }, [])
  const style = { width: size, height: size, background: `${character.color}22` }
  if (!character.imageUrl || failed) {
    return (
      <span
        aria-hidden
        style={{ ...style, fontSize: size * 0.36 }}
        className={cn(
          "grid shrink-0 place-items-center rounded-2xl font-semibold text-foreground",
          className,
        )}
      >
        {character.name.slice(0, 1)}
      </span>
    )
  }
  return (
    <img
      ref={img}
      src={character.imageUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={style}
      className={cn("shrink-0 rounded-2xl object-cover object-top", className)}
    />
  )
}
