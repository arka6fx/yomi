"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Loader2, Plus, Trash2, Upload } from "lucide-react"
import { cn } from "@/lib/utils"

type Picture = { url: string; credit: string; source: string }

// "What do they look like?": pictures of the character they're based on (AniList,
// TVMaze and the series' Fandom wiki, via /api/characters/pictures), a photo upload,
// and the face they have now.
export function CharacterPicturePicker({
  token,
  basedOn,
  imageUrl,
  onPick,
}: {
  token: string
  basedOn: string
  imageUrl: string
  onPick: (url: string, credit: string) => void
}) {
  const [pictures, setPictures] = useState<Picture[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState<"first" | "more" | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const file = useRef<HTMLInputElement>(null)
  const auth = { Authorization: `Bearer ${token}` }
  const query = basedOn.trim()

  useEffect(() => {
    setPictures([])
    setNext(null)
    setBroken(new Set())
    if (query.length < 2) return
    let cancelled = false
    // Wait for typing to settle before asking three sources.
    const timer = setTimeout(async () => {
      setLoading("first")
      try {
        const res = await fetch(`/api/characters/pictures?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = res.ok
          ? ((await res.json()) as { pictures: Picture[]; next: string | null })
          : null
        if (!cancelled && data) {
          setPictures(data.pictures)
          setNext(data.next)
        }
      } finally {
        if (!cancelled) setLoading(null)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, token])

  async function more() {
    if (!next) return
    setLoading("more")
    try {
      const res = await fetch(
        `/api/characters/pictures?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(next)}`,
        { headers: auth },
      )
      const data = res.ok
        ? ((await res.json()) as { pictures: Picture[]; next: string | null })
        : null
      if (data) {
        setPictures((current) => {
          const seen = new Set(current.map((p) => p.url))
          return [...current, ...data.pictures.filter((p) => !seen.has(p.url))]
        })
        setNext(data.next)
      }
    } finally {
      setLoading(null)
    }
  }

  async function upload(picked: File) {
    setError("")
    if (picked.size > 2 * 1024 * 1024) {
      setError("that photo is over 2 MB")
      return
    }
    setUploading(true)
    try {
      const res = await fetch("/api/characters/photo", {
        method: "POST",
        headers: auth,
        body: picked,
      })
      const data = (await res.json().catch(() => ({}))) as { imageUrl?: string; error?: string }
      if (!res.ok || !data.imageUrl) throw new Error(data.error || "couldn’t upload that photo")
      onPick(data.imageUrl, "your upload")
    } catch (e) {
      setError(e instanceof Error ? e.message : "couldn’t upload that photo")
    } finally {
      setUploading(false)
      if (file.current) file.current.value = ""
    }
  }

  const visible = pictures.filter((p) => !broken.has(p.url))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {imageUrl ? (
          <img
            key={imageUrl}
            src={imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-24 shrink-0 rounded-3xl bg-muted object-cover object-top ring-4 ring-muted"
          />
        ) : (
          <span className="grid size-24 shrink-0 place-items-center rounded-3xl bg-muted text-xs text-muted-foreground">
            no picture
          </span>
        )}
        <div className="min-w-0">
          <p className="font-semibold">
            {imageUrl ? "that’s their face." : "pick a face for them."}
          </p>
          <p className="text-sm text-muted-foreground">
            {imageUrl ? "pick another below to swap it." : "choose a picture below or upload one."}
          </p>
          {imageUrl && (
            <button
              type="button"
              onClick={() => onPick("", "")}
              className="mt-1.5 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              <Trash2 size={13} /> remove
            </button>
          )}
        </div>
      </div>

      {query.length >= 2 && (
        <div>
          <p className="mb-2 text-sm font-semibold">pictures of {query}</p>
          {loading === "first" ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="shimmer aspect-square rounded-2xl" />
              ))}
            </div>
          ) : visible.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {visible.map((p) => {
                const chosen = p.url === imageUrl
                return (
                  <button
                    key={p.url}
                    type="button"
                    onClick={() => onPick(p.url, p.credit)}
                    aria-label={`use this picture (${p.credit})`}
                    aria-pressed={chosen}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-2xl bg-muted ring-offset-2 ring-offset-card transition hover:opacity-90",
                      chosen && "ring-2 ring-[#2b8fff]",
                    )}
                  >
                    <img
                      src={p.url}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() => setBroken((b) => new Set(b).add(p.url))}
                      className="size-full object-cover object-top"
                    />
                    {chosen && (
                      <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-[#2b8fff] text-white">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              no pictures found for that. upload one instead.
            </p>
          )}
          {next && loading !== "first" && (
            <button
              type="button"
              onClick={() => void more()}
              disabled={loading === "more"}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold disabled:opacity-60"
            >
              {loading === "more" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plus size={14} />
              )}
              more pictures
            </button>
          )}
        </div>
      )}

      <div>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            if (picked) void upload(picked)
          }}
        />
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold shadow-sm hover:bg-muted disabled:opacity-60"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          upload a photo
        </button>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
