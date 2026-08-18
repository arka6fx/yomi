"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Check, Loader2, User } from "lucide-react"
import { PLANS } from "@/lib/plans"

type ProfileData = {
  name: string
  email: string
  plan: string
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

export function ProfileManager({ token }: { token: string }) {
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
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  async function uploadAvatar(file: File) {
    setUploadingAvatar(true)
    setAvatarError("")
    try {
      const res = await fetch("/api/user/avatar", {
        method: "POST",
        headers: { ...auth, "Content-Type": file.type },
        body: file,
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; avatarUrl?: string }
      if (!res.ok) throw new Error(data.error ?? "Couldn't upload that image")
      setStreakFields((prev) =>
        prev ? { ...prev, avatarUrl: data.avatarUrl ?? prev.avatarUrl } : prev,
      )
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Couldn't upload that image")
    } finally {
      setUploadingAvatar(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !profile || !streakFields) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-sm text-destructive">{error || "Couldn't load profile"}</p>
      </div>
    )
  }

  const currentPlan = PLANS.find((p) => p.key === profile.plan)
  const PlanIcon = currentPlan?.icon

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="relative shrink-0 rounded-full disabled:opacity-50"
            aria-label="Upload profile photo"
          >
            <Avatar url={streakFields.avatarUrl} size={64} />
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
              {uploadingAvatar ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Camera size={12} />
              )}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadAvatar(file)
              e.target.value = ""
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{profile.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{profile.email}</p>
          </div>
        </div>
        {avatarError && <p className="mt-2 text-xs text-destructive">{avatarError}</p>}

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

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
          Your plan
        </p>
        <div className="flex items-center gap-3">
          {PlanIcon && <PlanIcon size={20} className="text-primary" />}
          <div>
            <p className="text-sm font-medium text-foreground">{currentPlan?.name ?? profile.plan}</p>
            <p className="text-xs text-muted-foreground">{currentPlan?.desc}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
