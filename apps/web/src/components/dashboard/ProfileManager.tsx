"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Check, Loader2, Trash2, Upload, User } from "lucide-react"
import { PLANS } from "@/lib/plans"
import { CardSkeleton } from "@/components/dashboard/shell/motion"

type ProfileData = {
  name: string
  email: string
  plan: string
  image?: string | null
  bio?: string
}

const BIO_MAX = 280

// Square-crop and shrink to 512px before upload: small files, and re-encoding
// through a canvas drops EXIF data such as GPS location.
async function prepareAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That isn’t an image. Try a jpg or png.")
  const bitmap = await createImageBitmap(file).catch(() => {
    // e.g. iPhone HEIC photos, which most browsers can't open
    throw new Error("Couldn’t open that picture. Try a jpg or png (or take a screenshot of it).")
  })
  const side = Math.min(bitmap.width, bitmap.height)
  const size = Math.min(512, side)
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Couldn’t read that image")
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  )
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  )
  if (!blob) throw new Error("Couldn’t read that image")
  return blob
}

type StreakProfileFields = {
  leaderboardHandle: string | null
  leaderboardShowPhoto: boolean
  avatarUrl: string | null
}

function Avatar({ url, size = 64 }: { url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <User size={size * 0.5} />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
    />
  )
}

export function ProfileManager({ token, onChanged }: { token: string; onChanged?: () => void }) {
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [streakFields, setStreakFields] = useState<StreakProfileFields | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [nameInput, setNameInput] = useState("")
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)
  const [nameError, setNameError] = useState("")

  const [handleInput, setHandleInput] = useState("")
  const [savingHandle, setSavingHandle] = useState(false)
  const [handleSaved, setHandleSaved] = useState(false)
  const [handleError, setHandleError] = useState("")

  const [savingPhoto, setSavingPhoto] = useState(false)

  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState("")
  const [dragging, setDragging] = useState(false)

  const [bioInput, setBioInput] = useState("")
  const [savingBio, setSavingBio] = useState(false)
  const [bioSaved, setBioSaved] = useState(false)
  const [bioError, setBioError] = useState("")

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [profileRes, streaksRes] = await Promise.all([
        fetch("/api/user/me", { headers: auth }),
        fetch("/api/streaks/me", { headers: auth }),
      ])
      if (!profileRes.ok) throw new Error(`Couldn't load profile (${profileRes.status})`)
      if (!streaksRes.ok) throw new Error(`Couldn't load profile (${streaksRes.status})`)
      const profileData = (await profileRes.json()) as ProfileData
      const streaksData = (await streaksRes.json()) as StreakProfileFields
      setProfile(profileData)
      setStreakFields(streaksData)
      setNameInput(profileData.name)
      setBioInput(profileData.bio ?? "")
      setHandleInput(streaksData.leaderboardHandle ?? "")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load profile")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function saveName() {
    if (savingName || !nameInput.trim()) return
    setSavingName(true)
    setNameError("")
    setNameSaved(false)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; name?: string }
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that name")
      setProfile((prev) => (prev ? { ...prev, name: data.name ?? prev.name } : prev))
      setNameSaved(true)
      setTimeout(() => setNameSaved(false), 2000)
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Couldn't save that name")
    } finally {
      setSavingName(false)
    }
  }

  async function uploadPhoto(file: File) {
    setUploading(true)
    setPhotoError("")
    try {
      const blob = await prepareAvatar(file)
      const res = await fetch("/api/user/avatar", {
        method: "POST",
        headers: { ...auth, "Content-Type": blob.type || "application/octet-stream" },
        body: blob,
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; image?: string }
      if (!res.ok) throw new Error(data.error ?? "Couldn’t upload that picture")
      setProfile((prev) => (prev ? { ...prev, image: data.image ?? null } : prev))
      onChanged?.()
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Couldn’t upload that picture")
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  async function removePhoto() {
    setUploading(true)
    setPhotoError("")
    try {
      const res = await fetch("/api/user/avatar", { method: "DELETE", headers: auth })
      if (!res.ok) throw new Error("Couldn’t remove your picture")
      setProfile((prev) => (prev ? { ...prev, image: null } : prev))
      onChanged?.()
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Couldn’t remove your picture")
    } finally {
      setUploading(false)
    }
  }

  async function saveBio() {
    if (savingBio) return
    setSavingBio(true)
    setBioError("")
    setBioSaved(false)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ bio: bioInput }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; bio?: string }
      if (!res.ok) throw new Error(data.error ?? "Couldn’t save your bio")
      setBioInput(data.bio ?? bioInput)
      setProfile((prev) => (prev ? { ...prev, bio: data.bio ?? bioInput } : prev))
      setBioSaved(true)
      setTimeout(() => setBioSaved(false), 2000)
    } catch (err) {
      setBioError(err instanceof Error ? err.message : "Couldn’t save your bio")
    } finally {
      setSavingBio(false)
    }
  }

  async function saveHandle() {
    if (savingHandle || !handleInput.trim()) return
    setSavingHandle(true)
    setHandleError("")
    setHandleSaved(false)
    try {
      const res = await fetch("/api/user/handle", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ handle: handleInput }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        leaderboardHandle?: string
      }
      if (!res.ok) throw new Error(data.error ?? "Couldn't save that handle")
      setStreakFields((prev) =>
        prev
          ? { ...prev, leaderboardHandle: data.leaderboardHandle ?? prev.leaderboardHandle }
          : prev,
      )
      setHandleSaved(true)
      setTimeout(() => setHandleSaved(false), 2000)
    } catch (err) {
      setHandleError(err instanceof Error ? err.message : "Couldn't save that handle")
    } finally {
      setSavingHandle(false)
    }
  }

  async function toggleShowPhoto() {
    if (!streakFields || savingPhoto) return
    setSavingPhoto(true)
    try {
      const res = await fetch("/api/user/show-photo", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ showPhoto: !streakFields.leaderboardShowPhoto }),
      })
      if (!res.ok) throw new Error(`Couldn't update photo setting (${res.status})`)
      const result = (await res.json()) as { leaderboardShowPhoto: boolean }
      setStreakFields((prev) =>
        prev ? { ...prev, leaderboardShowPhoto: result.leaderboardShowPhoto } : prev,
      )
    } catch {
      // best-effort — matches the same toggle's error handling in StreaksManager
    } finally {
      setSavingPhoto(false)
    }
  }

  if (loading) {
    return <CardSkeleton label="loading your profile" />
  }

  if (error || !profile || !streakFields) {
    return (
      <div className="rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)] p-5 sm:p-6">
        <p className="text-sm text-destructive">{error || "Couldn't load profile"}</p>
      </div>
    )
  }

  const currentPlan = PLANS.find((p) => p.key === profile.plan)
  const PlanIcon = currentPlan?.icon

  return (
    <div className="space-y-4">
      <div className="rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)] p-5 sm:p-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{profile.name}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {profile.email?.endsWith("@users.getyomi.in")
              ? "signed in with telegram"
              : profile.email}
          </p>
        </div>

        {/* Profile picture: tap the picture, the button, or drop an image on the box. */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void uploadPhoto(file)
          }}
          className={`mt-4 flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-4 text-center transition-colors sm:flex-row sm:text-left ${
            dragging ? "border-primary bg-primary/5" : "border-border"
          }`}
        >
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            aria-label={profile.image ? "Change profile picture" : "Add a profile picture"}
            className="relative shrink-0 rounded-full disabled:opacity-60"
          >
            <Avatar
              key={profile.image ?? "none"}
              url={profile.image ?? streakFields.avatarUrl}
              size={88}
            />
            <span className="absolute -bottom-1 -right-1 grid size-8 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow">
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadPhoto(file)
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">profile picture</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {uploading
                ? "uploading your picture…"
                : profile.image
                  ? "this is the picture yomi and your trusted people see."
                  : "add a photo of you so your profile feels like yours. tap the picture, use the button, or drop an image here. we crop it to a square for you."}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                <Upload size={13} /> {profile.image ? "change photo" : "upload a photo"}
              </button>
              {profile.image && (
                <button
                  type="button"
                  onClick={() => void removePhoto()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 size={12} /> remove
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              jpg, png, webp or gif. any size works.
            </p>
            {photoError && <p className="mt-1 text-xs text-destructive">{photoError}</p>}
          </div>
        </div>

        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <div className="flex items-center gap-2">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your name"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60"
                maxLength={80}
              />
              <button
                onClick={saveName}
                disabled={savingName || !nameInput.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
              >
                {savingName ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : nameSaved ? (
                  <Check size={13} />
                ) : null}
                {nameSaved ? "Saved" : "Save"}
              </button>
            </div>
            {nameError && <p className="mt-1.5 text-xs text-destructive">{nameError}</p>}
          </div>

          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Bio</span>
              <span>
                {bioInput.length}/{BIO_MAX}
              </span>
            </label>
            <textarea
              value={bioInput}
              onChange={(e) => setBioInput(e.target.value)}
              placeholder="A line or two about you. Yomi reads this for context."
              rows={3}
              maxLength={BIO_MAX}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              {bioError ? <p className="text-xs text-destructive">{bioError}</p> : <span />}
              <button
                onClick={saveBio}
                disabled={savingBio || bioInput === (profile.bio ?? "")}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
              >
                {savingBio ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : bioSaved ? (
                  <Check size={13} />
                ) : null}
                {bioSaved ? "Saved" : "Save"}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Username
            </label>
            <div className="flex items-center gap-2">
              <input
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                placeholder="pick a username"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary/60"
                maxLength={24}
              />
              <button
                onClick={saveHandle}
                disabled={savingHandle || !handleInput.trim()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
              >
                {savingHandle ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : handleSaved ? (
                  <Check size={13} />
                ) : null}
                {handleSaved ? "Saved" : "Save"}
              </button>
            </div>
            {handleError && <p className="mt-1.5 text-xs text-destructive">{handleError}</p>}
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">
              Show my profile photo on the leaderboard
            </span>
            <button
              type="button"
              onClick={toggleShowPhoto}
              disabled={savingPhoto}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                streakFields.leaderboardShowPhoto ? "bg-primary" : "bg-muted"
              }`}
              aria-pressed={streakFields.leaderboardShowPhoto}
              aria-label="Toggle showing your profile photo on the leaderboard"
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background transition-transform ${
                  streakFields.leaderboardShowPhoto ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)] p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Your plan
        </p>
        <div className="flex items-center gap-3">
          {PlanIcon && <PlanIcon size={20} className="text-primary" />}
          <div>
            <p className="text-sm font-medium text-foreground">
              {currentPlan?.name ?? profile.plan}
            </p>
            <p className="text-xs text-muted-foreground">{currentPlan?.desc}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
