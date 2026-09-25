"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Check,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  X,
} from "lucide-react"
import { SURFACE } from "@/components/dashboard/shell/ui"
import { TELEGRAM_BOT_URL } from "@/lib/site"
import { cn } from "@/lib/utils"

type Character = {
  id: string
  name: string
  emoji: string
  color: string
  appearance: string
  personality: string
  tagline: string
  description: string
  firstLines: string[]
  tags: string[]
  relationship: string
  basedOn: string
  featured: boolean
  starters: string[]
  imageUrl: string
  imageCredit: string
  source: "mine" | "gallery"
  mine: boolean
}

type Data = {
  mine: Character[]
  saved: Character[]
  gallery: Character[]
  active: Character | null
  tags: string[]
  templates: string[]
}

type Draft = {
  name: string
  emoji: string
  color: string
  appearance: string
  personality: string
  tagline: string
  description: string
  firstLines: string[]
  tags: string[]
  basedOn: string
  relationship: string
  imageUrl: string
  imageCredit: string
}

const EMPTY_DRAFT: Draft = {
  name: "",
  emoji: "",
  color: "#2b8fff",
  appearance: "",
  personality: "",
  tagline: "",
  description: "",
  firstLines: [""],
  tags: [],
  basedOn: "",
  relationship: "",
  imageUrl: "",
  imageCredit: "",
}
const COLORS = [
  "#2b8fff",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#10b981",
  "#0ea5e9",
  "#475569",
]
const EMOJIS = ["🙂", "😎", "🕶️", "🦊", "🐉", "🌙", "🔥", "🌸", "🎧", "🧙", "🤖", "👑"]
const STEPS = [
  "who are they?",
  "what do they look like?",
  "how do they talk?",
  "the details",
  "ready?",
]

function Avatar({
  character,
  size = 56,
}: {
  character: Pick<Character, "emoji" | "color" | "imageUrl" | "name">
  size?: number
}) {
  const [broken, setBroken] = useState(false)
  if (character.imageUrl && !broken) {
    return (
      <img
        src={character.imageUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-[28%] bg-muted object-cover object-top"
      />
    )
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        background: `${character.color}22`,
        fontSize: size * 0.45,
      }}
      className="grid shrink-0 place-items-center rounded-[28%]"
      aria-hidden
    >
      {character.emoji || character.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function CharactersView({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState("")
  const [view, setView] = useState<"mine" | "discover">("mine")
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState("")
  const [query, setQuery] = useState("")
  const [tag, setTag] = useState("all")
  const [wizard, setWizard] = useState<{
    step: number
    draft: Draft
    editId: string | null
  } | null>(null)

  const call = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`/api/characters${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      }),
    [token],
  )

  const load = useCallback(async () => {
    try {
      const res = await call("")
      if (!res.ok) throw new Error()
      setData((await res.json()) as Data)
    } catch {
      setError("Couldn’t load characters")
    }
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  const all = useMemo(() => {
    const map = new Map<string, Character>()
    for (const c of [...(data?.mine ?? []), ...(data?.gallery ?? [])]) map.set(c.id, c)
    return map
  }, [data])
  const opened = openId ? all.get(openId) : undefined
  const savedIds = new Set((data?.saved ?? []).map((c) => c.id))

  async function act(key: string, fn: () => Promise<Response>, done?: string) {
    setBusy(key)
    setError("")
    setNotice("")
    try {
      const res = await fn()
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string }
        throw new Error(body.detail ?? "Something went wrong")
      }
      if (done) setNotice(done)
      await load()
      return res
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      return null
    } finally {
      setBusy(null)
    }
  }

  async function talk(character: Character) {
    const res = await act(`talk:${character.id}`, () =>
      call(`/${encodeURIComponent(character.id)}/activate`, { method: "POST" }),
    )
    if (!res) return
    const body = (await res.json().catch(() => ({}))) as { textedYou?: boolean }
    setNotice(
      body.textedYou
        ? `${character.name} just texted you on Telegram.`
        : `${character.name} is on. Link Telegram so they can text you first.`,
    )
    window.open(TELEGRAM_BOT_URL, "_blank", "noopener")
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.gallery ?? []).filter(
      (c) =>
        (tag === "all" || c.tags.includes(tag)) &&
        (!q || `${c.name} ${c.tagline} ${c.basedOn}`.toLowerCase().includes(q)),
    )
  }, [data, query, tag])

  if (!data) {
    return (
      <div className="flex items-center gap-2 pt-16 text-sm text-muted-foreground">
        {error || (
          <>
            <Loader2 size={15} className="animate-spin" /> loading characters…
          </>
        )}
      </div>
    )
  }

  const card = cn(SURFACE, "flex flex-col p-5 text-left transition hover:-translate-y-0.5")
  const pillButton = "rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-sm hover:bg-muted"
  const primary =
    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_rgba(34,158,217,0.3)] disabled:opacity-60"
  const blue = { background: "linear-gradient(180deg, #37aee2 0%, #1e96c8 100%)" }

  const CharacterCard = ({ c, from }: { c: Character; from: string }) => (
    <button onClick={() => setOpenId(c.id)} className={card}>
      <div className="flex items-start justify-between">
        <Avatar character={c} />
        {c.featured && (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-500">
            <Star size={11} className="fill-current" /> featured
          </span>
        )}
      </div>
      <p className="mt-4 text-lg font-bold tracking-tight">{c.name}</p>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{c.tagline}</p>
      <p className="mt-4 text-xs text-muted-foreground">{from}</p>
    </button>
  )

  // ── character page ──────────────────────────────────────────────
  if (opened) {
    const inMine = opened.mine || savedIds.has(opened.id)
    const isActive = data.active?.id === opened.id
    return (
      <div className="mx-auto max-w-3xl space-y-6 pt-6">
        <button
          onClick={() => setOpenId(null)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> {view === "discover" ? "discover" : "your characters"}
        </button>
        <div className="flex flex-wrap items-start gap-5">
          <Avatar character={opened} size={140} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-4xl font-bold tracking-tight">{opened.name}</h1>
              {opened.featured && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-500">
                  <Star size={11} className="fill-current" /> featured
                </span>
              )}
            </div>
            <p className="mt-2 text-muted-foreground">{opened.tagline}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {opened.mine ? "made by you" : "from the yomi gallery"}
              {opened.basedOn ? ` · based on ${opened.basedOn}` : ""}
            </p>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-emerald-500">{notice}</p>}

        <div className="flex flex-wrap gap-2">
          {isActive ? (
            <button
              onClick={() =>
                void act(
                  "back",
                  () => call("/active/clear", { method: "POST" }),
                  "back to plain yomi",
                )
              }
              className={pillButton}
            >
              {busy === "back" ? <Loader2 size={14} className="animate-spin" /> : "back to yomi"}
            </button>
          ) : (
            <button
              onClick={() => void talk(opened)}
              disabled={busy !== null}
              className={primary}
              style={blue}
            >
              {busy === `talk:${opened.id}` ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <MessageCircle size={15} />
              )}
              talk to them on telegram
            </button>
          )}
          {!opened.mine && (
            <button
              onClick={() =>
                void act("save", () =>
                  call(`/${encodeURIComponent(opened.id)}/save`, {
                    method: "POST",
                    body: JSON.stringify({ saved: !inMine }),
                  }),
                )
              }
              className={cn(pillButton, "inline-flex items-center gap-1.5")}
            >
              {inMine ? <Check size={14} /> : <Plus size={14} />}{" "}
              {inMine ? "in your characters" : "add to your characters"}
            </button>
          )}
          {opened.mine && (
            <>
              <button
                onClick={() =>
                  setWizard({
                    step: 0,
                    editId: opened.id,
                    draft: {
                      ...EMPTY_DRAFT,
                      ...opened,
                      firstLines: opened.firstLines.length ? opened.firstLines : [""],
                    },
                  })
                }
                className={pillButton}
              >
                edit
              </button>
              <button
                onClick={async () => {
                  if (await act("delete", () => call(`/${opened.id}`, { method: "DELETE" })))
                    setOpenId(null)
                }}
                className={cn(pillButton, "inline-flex items-center gap-1 text-destructive")}
              >
                <Trash2 size={14} /> delete
              </button>
            </>
          )}
        </div>

        {opened.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {opened.tags.map((t) => (
              <span key={t} className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
                {t}
              </span>
            ))}
          </div>
        )}
        {opened.description && (
          <p className="leading-relaxed text-foreground/90">{opened.description}</p>
        )}

        <div>
          <p className="mb-2 text-sm font-semibold">their first text</p>
          <p className="max-w-md rounded-[1.25rem] rounded-bl-md bg-foreground px-4 py-3 text-sm font-medium text-background">
            {opened.firstLines[0]}
          </p>
        </div>

        {opened.starters.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">things to text {opened.name}</p>
            <div className="flex flex-wrap gap-2">
              {opened.starters.map((s) => (
                <span key={s} className="rounded-full bg-card px-3.5 py-1.5 text-sm shadow-sm">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="flex items-start gap-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          <span>
            everything they say is made up.{" "}
            {opened.basedOn &&
              "fan-made AI character, not affiliated with or endorsed by any rights holder. "}
            {opened.imageCredit && `picture: ${opened.imageCredit}. `}
            <a
              href={`mailto:contact.arkagarai@gmail.com?subject=report%20character%20${encodeURIComponent(opened.name)}`}
              className="underline underline-offset-2"
            >
              report
            </a>{" "}
            ·{" "}
            <Link href="/characters/guidelines" className="underline underline-offset-2">
              guidelines
            </Link>{" "}
            ·{" "}
            <Link href="/copyright" className="underline underline-offset-2">
              copyright
            </Link>
          </span>
        </p>
        {wizard && renderWizard()}
      </div>
    )
  }

  // ── wizard (called as a function so inputs keep focus) ──────────────────────────────────────────────────────
  function renderWizard() {
    if (!wizard || !data) return null
    const { step, draft } = wizard
    const set = (patch: Partial<Draft>) =>
      setWizard((w) => (w ? { ...w, draft: { ...w.draft, ...patch } } : w))
    const go = (n: number) => setWizard((w) => (w ? { ...w, step: n } : w))
    const firstOk = draft.firstLines.some((l) => l.trim())
    const canNext = [draft.name.trim(), true, draft.personality.trim(), firstOk, true][step]

    async function writeForMe(template?: string) {
      setBusy("draft")
      setError("")
      try {
        const res = await call("/draft", {
          method: "POST",
          body: JSON.stringify({
            name: draft.name,
            appearance: draft.appearance,
            personality: draft.personality,
            template,
          }),
        })
        const body = (await res.json()) as {
          personality?: string
          tagline?: string
          description?: string
          firstLine?: string
          detail?: string
        }
        if (!res.ok) throw new Error(body.detail ?? "Couldn’t write that")
        set({
          personality: body.personality || draft.personality,
          tagline: draft.tagline || body.tagline || "",
          description: draft.description || body.description || "",
          firstLines: firstOk ? draft.firstLines : [body.firstLine || ""],
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn’t write that")
      } finally {
        setBusy(null)
      }
    }

    async function save(thenTalk: boolean) {
      const payload = { ...draft, firstLines: draft.firstLines.filter((l) => l.trim()) }
      const res = await act("save-character", () =>
        wizard?.editId
          ? call(`/${wizard.editId}`, { method: "PUT", body: JSON.stringify(payload) })
          : call("", { method: "POST", body: JSON.stringify(payload) }),
      )
      if (!res) return
      const body = (await res.json()) as { character: Character }
      setWizard(null)
      setOpenId(body.character.id)
      if (thenTalk) await talk(body.character)
    }

    const input =
      "w-full rounded-2xl bg-muted px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[#2b8fff]"
    const label = "mb-1.5 flex items-center justify-between text-sm font-semibold"

    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-label="Make a character"
      >
        <button
          aria-label="Close"
          className="absolute inset-0 bg-black/30 backdrop-blur-sm"
          onClick={() => setWizard(null)}
        />
        <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-[2rem] bg-card shadow-2xl sm:rounded-[2rem]">
          <div className="flex items-center justify-between px-6 pt-5">
            {step > 0 ? (
              <button
                onClick={() => go(step - 1)}
                aria-label="Back"
                className="rounded-full p-2 hover:bg-muted"
              >
                <ArrowLeft size={16} />
              </button>
            ) : (
              <span className="size-8" />
            )}
            <div className="text-center">
              <p className="text-xs font-semibold text-muted-foreground">{step + 1} / 5</p>
              <p className="text-lg font-bold">{STEPS[step]}</p>
            </div>
            <button
              onClick={() => setWizard(null)}
              aria-label="Close"
              className="rounded-full p-2 hover:bg-muted"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {step === 0 && (
              <>
                <label className="block">
                  <span className={label}>
                    their name{" "}
                    <span className="text-xs text-muted-foreground">{draft.name.length}/30</span>
                  </span>
                  <input
                    autoFocus
                    maxLength={30}
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value })}
                    placeholder="a grumpy barista, a space pirate, a study buddy…"
                    className={cn(input, "text-lg")}
                  />
                </label>
                <label className="block">
                  <span className={label}>based on (optional)</span>
                  <input
                    maxLength={120}
                    value={draft.basedOn}
                    onChange={(e) => set({ basedOn: e.target.value })}
                    placeholder="e.g. a character from a show you love"
                    className={input}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  fan-made characters are fine. real private people, minors in any sexual context,
                  and pretending to be Yomi are not.{" "}
                  <Link href="/characters/guidelines" className="underline">
                    guidelines
                  </Link>
                </p>
              </>
            )}
            {step === 1 && (
              <>
                <div className="flex items-center gap-4">
                  <Avatar character={{ ...draft, name: draft.name || "?" }} size={88} />
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {EMOJIS.map((e) => (
                        <button
                          key={e}
                          onClick={() => set({ emoji: e })}
                          className={cn(
                            "grid size-8 place-items-center rounded-lg text-lg",
                            draft.emoji === e
                              ? "bg-foreground/10 ring-2 ring-[#2b8fff]"
                              : "hover:bg-muted",
                          )}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          onClick={() => set({ color: c })}
                          aria-label={`colour ${c}`}
                          style={{ background: c }}
                          className={cn(
                            "size-6 rounded-full",
                            draft.color === c &&
                              "ring-2 ring-foreground ring-offset-2 ring-offset-card",
                          )}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <label className="block">
                  <span className={label}>describe how they look</span>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={draft.appearance}
                    onChange={(e) => set({ appearance: e.target.value })}
                    placeholder="silver hair, round glasses, a cardigan two sizes too big…"
                    className={cn(input, "resize-none")}
                  />
                </label>
                <label className="block">
                  <span className={label}>picture link (optional)</span>
                  <input
                    value={draft.imageUrl}
                    onChange={(e) => set({ imageUrl: e.target.value })}
                    placeholder="https://… (only pictures you have the right to use)"
                    className={input}
                  />
                </label>
                {draft.imageUrl && (
                  <input
                    value={draft.imageCredit}
                    onChange={(e) => set({ imageCredit: e.target.value })}
                    maxLength={60}
                    placeholder="picture credit, e.g. the site it’s from"
                    className={input}
                  />
                )}
              </>
            )}
            {step === 2 && (
              <>
                <label className="block">
                  <span className={label}>
                    how they think, talk and behave
                    <button
                      onClick={() => void writeForMe()}
                      disabled={busy === "draft" || !draft.name.trim()}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#2b8fff] disabled:opacity-50"
                    >
                      {busy === "draft" ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Wand2 size={12} />
                      )}{" "}
                      write for me
                    </button>
                  </span>
                  <textarea
                    rows={7}
                    maxLength={4000}
                    value={draft.personality}
                    onChange={(e) => set({ personality: e.target.value })}
                    placeholder="their personality, how they text, what they care about, what they’d never say…"
                    className={cn(input, "resize-none")}
                  />
                </label>
                <div>
                  <p className="mb-1.5 text-sm font-semibold">start from a template</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.templates.map((t) => (
                      <button
                        key={t}
                        onClick={() => void writeForMe(t)}
                        disabled={busy === "draft" || !draft.name.trim()}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/70 disabled:opacity-50"
                      >
                        <Sparkles size={11} /> {t}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    write for me drafts it with AI; edit anything after.
                  </p>
                </div>
              </>
            )}
            {step === 3 && (
              <>
                <label className="block">
                  <span className={label}>
                    tagline{" "}
                    <span className="text-xs text-muted-foreground">{draft.tagline.length}/60</span>
                  </span>
                  <input
                    maxLength={60}
                    value={draft.tagline}
                    onChange={(e) => set({ tagline: e.target.value })}
                    placeholder="one line under their name"
                    className={input}
                  />
                </label>
                <label className="block">
                  <span className={label}>description</span>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                    placeholder="what someone sees before they start talking to them"
                    className={cn(input, "resize-none")}
                  />
                </label>
                <div>
                  <p className={label}>
                    first lines{" "}
                    <span className="text-xs text-muted-foreground">
                      {draft.firstLines.filter((l) => l.trim()).length}/5
                    </span>
                  </p>
                  <div className="space-y-2">
                    {draft.firstLines.map((line, i) => (
                      <div key={i} className="flex gap-2">
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={line}
                          onChange={(e) =>
                            set({
                              firstLines: draft.firstLines.map((l, j) =>
                                j === i ? e.target.value : l,
                              ),
                            })
                          }
                          placeholder="the first thing they say"
                          className={cn(input, "resize-none")}
                        />
                        {draft.firstLines.length > 1 && (
                          <button
                            onClick={() =>
                              set({ firstLines: draft.firstLines.filter((_, j) => j !== i) })
                            }
                            aria-label="Remove line"
                            className="self-start rounded-full p-2 text-muted-foreground hover:bg-muted"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {draft.firstLines.length < 5 && (
                    <button
                      onClick={() => set({ firstLines: [...draft.firstLines, ""] })}
                      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold"
                    >
                      <Plus size={13} /> add another
                    </button>
                  )}
                </div>
                <div>
                  <p className={label}>
                    tags{" "}
                    <span className="text-xs text-muted-foreground">{draft.tags.length}/5</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((t) => {
                      const on = draft.tags.includes(t)
                      return (
                        <button
                          key={t}
                          aria-pressed={on}
                          onClick={() =>
                            set({
                              tags: on
                                ? draft.tags.filter((x) => x !== t)
                                : draft.tags.length < 5
                                  ? [...draft.tags, t]
                                  : draft.tags,
                            })
                          }
                          className={cn(
                            "rounded-full px-3 py-1.5 text-xs font-semibold",
                            on ? "bg-foreground text-background" : "bg-muted",
                          )}
                        >
                          {t}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <label className="block">
                  <span className={label}>who you are to them (optional)</span>
                  <input
                    maxLength={200}
                    value={draft.relationship}
                    onChange={(e) => set({ relationship: e.target.value })}
                    placeholder="their student, their crewmate, an old friend…"
                    className={input}
                  />
                </label>
              </>
            )}
            {step === 4 && (
              <div className="space-y-4 text-center">
                <div className="flex justify-center">
                  <Avatar character={{ ...draft, name: draft.name }} size={96} />
                </div>
                <p className="text-2xl font-bold">{draft.name}</p>
                <p className="text-sm text-muted-foreground">{draft.tagline}</p>
                <p className="mx-auto max-w-sm rounded-[1.25rem] rounded-bl-md bg-foreground px-4 py-3 text-left text-sm text-background">
                  {draft.firstLines.find((l) => l.trim())}
                </p>
                <p className="text-xs text-muted-foreground">
                  only you can see this character. they take over your telegram chat until you say
                  “back to yomi”.
                </p>
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <div className="flex gap-1.5" aria-hidden>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 w-6 rounded-full",
                    i < step ? "bg-foreground" : i === step ? "bg-[#2b8fff]" : "bg-muted",
                  )}
                />
              ))}
            </div>
            {step < 4 ? (
              <div className="flex items-center gap-3">
                {step === 3 && !firstOk && (
                  <span className="text-xs text-destructive">
                    give them at least one first line.
                  </span>
                )}
                <button
                  onClick={() => go(step + 1)}
                  disabled={!canNext}
                  className={primary}
                  style={blue}
                >
                  next
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => void save(false)}
                  disabled={busy !== null}
                  className={pillButton}
                >
                  save
                </button>
                <button
                  onClick={() => void save(true)}
                  disabled={busy !== null}
                  className={primary}
                  style={blue}
                >
                  {busy === "save-character" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <MessageCircle size={14} />
                  )}{" "}
                  save & talk
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── lists ───────────────────────────────────────────────────────
  const mineList = [...data.mine, ...data.saved]
  return (
    <div className="space-y-8 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
            {view === "mine" ? "your characters" : "discover"}
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            {view === "mine"
              ? "make someone to text with. they take over your telegram chat until you say “back to yomi”."
              : "ready-made characters. open one and they text you first."}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView(view === "mine" ? "discover" : "mine")}
            className={pillButton}
          >
            {view === "mine" ? "discover" : "your characters"}
          </button>
          <button
            onClick={() => setWizard({ step: 0, draft: EMPTY_DRAFT, editId: null })}
            className={primary}
            style={blue}
          >
            <Plus size={15} /> make one
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-emerald-500">{notice}</p>}

      {view === "mine" ? (
        <>
          <div className={cn(SURFACE, "flex flex-wrap items-center gap-4 p-5")}>
            {data.active ? (
              <Avatar character={data.active} size={56} />
            ) : (
              <img
                src="/brand-mark-128.png"
                alt=""
                width={56}
                height={56}
                className="size-14 rounded-[28%]"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-muted-foreground">who yomi is right now</p>
              <p className="text-xl font-bold">
                {data.active ? data.active.name : "yomi, being yomi"}
              </p>
              <p className="text-sm text-muted-foreground">
                {data.active
                  ? "they answer your telegram messages. say “back to yomi” or send /yomi anytime."
                  : "open a character and tap talk to them. they take over your chat; come back any time."}
              </p>
            </div>
            {data.active && (
              <button
                onClick={() =>
                  void act(
                    "back",
                    () => call("/active/clear", { method: "POST" }),
                    "back to plain yomi",
                  )
                }
                className={pillButton}
              >
                back to yomi
              </button>
            )}
          </div>

          {mineList.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-2xl font-bold">no characters yet.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                make one, or find someone in discover.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mineList.map((c) => (
                <CharacterCard
                  key={c.id}
                  c={c}
                  from={c.mine ? "made by you" : "from the gallery"}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <label className={cn(SURFACE, "flex items-center gap-3 px-5 py-3.5")}>
            <Search size={16} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search names and taglines"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tags">
            {["all", ...data.tags.filter((t) => data.gallery.some((c) => c.tags.includes(t)))].map(
              (t) => (
                <button
                  key={t}
                  aria-pressed={tag === t}
                  onClick={() => setTag(t)}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-semibold",
                    tag === t
                      ? "bg-foreground text-background"
                      : "bg-card shadow-sm hover:bg-muted",
                  )}
                >
                  {t}
                </button>
              ),
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((c) => (
              <CharacterCard
                key={c.id}
                c={c}
                from={c.basedOn ? `fan-made · based on ${c.basedOn}` : "by yomi"}
              />
            ))}
          </div>
        </>
      )}
      {wizard && renderWizard()}
    </div>
  )
}
