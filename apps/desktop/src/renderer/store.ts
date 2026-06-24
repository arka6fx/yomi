import { create } from "zustand"
import type { SseEvent } from "@yomi/shared"

export type HotkeyState = "idle" | "listening" | "processing" | "text-input"
export type AuthState = "checking" | "unauthenticated" | "waiting" | "authenticated"

export interface LimitWarning {
  feature: string
  message: string
  upgradeUrl?: string
}

export interface ChatEntry {
  id: number
  transcript: string
  text: string
  error: string | null
  notice: string | null
  ttsError: string | null
  limitWarning: LimitWarning | null
  isStreaming: boolean
}

export function isSoftNotice(message: string): boolean {
  return /didn'?t catch|microphone|mic permission|audio engine|\bstt\b/i.test(message)
}

export interface SubscriptionInfo {
  name: string
  email: string
  role: string
  plan: string
  status: string
  trialEndDate: string | null
  currentPeriodEnd: string | null
  requestsUsed: number
  requestsLimit: number | null
  requestsRemaining: number | null
  resetAt: string | null
  dailyChatUsed: number
  dailyVoiceUsed: number
  dailyImageUsed: number
  tokensUsedThisPeriod: number
}

export type SubscriptionUpdate = Partial<SubscriptionInfo>

interface YomiState {
  authState: AuthState
  authError: string
  hotkeyState: HotkeyState
  entries: ChatEntry[]
  activeId: number | null
  listeningId: number | null
  ttsEnabled: boolean
  subscription: SubscriptionInfo | null
  subscriptionLoading: boolean
  setAuthState: (s: AuthState, error?: string) => void
  setHotkeyState: (state: HotkeyState) => void
  handleSseEvent: (event: SseEvent) => void
  stopActivePlayback: () => void
  dismissEntry: (id: number) => void
  toggleTts: () => void
  setSubscription: (info: SubscriptionUpdate | null) => void
  setSubscriptionLoading: (loading: boolean) => void
}

let nextId = 1

function createEntry(partial: Partial<ChatEntry> = {}): ChatEntry {
  return {
    id: nextId++,
    transcript: "",
    text: "",
    error: null,
    notice: null,
    ttsError: null,
    limitWarning: null,
    isStreaming: false,
    ...partial,
  }
}

export const useYomiStore = create<YomiState>((set) => ({
  authState: "checking",
  authError: "",
  hotkeyState: "idle",
  entries: [],
  activeId: null,
  listeningId: null,
  ttsEnabled: true,
  subscription: null,
  subscriptionLoading: false,

  setAuthState: (authState, error = "") => set({ authState, authError: error }),
  setHotkeyState: (next) =>
    set((s) => {
      const patch: Partial<YomiState> = { hotkeyState: next }
      if (next === "listening") patch.listeningId = nextId++
      if (next === "idle") patch.listeningId = null
      return patch
    }),

  handleSseEvent: (event) => {
    switch (event.type) {
      case "transcript":
        set((s) => {
          const id = s.listeningId !== null ? s.listeningId : nextId++
          return {
            listeningId: null,
            entries: [...s.entries, createEntry({ id, transcript: event.text, isStreaming: true })],
            activeId: id,
          }
        })
        break
      case "llm_chunk":
      case "agent_text":
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === s.activeId ? { ...e, text: e.text + event.text, isStreaming: true } : e,
          ),
        }))
        break
      case "audio_chunk":
        break
      case "tts_error":
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === s.activeId ? { ...e, ttsError: event.message } : e,
          ),
        }))
        break
      case "done":
        set((s) => ({
          hotkeyState: "idle",
          entries: s.entries.map((e) => (e.id === s.activeId ? { ...e, isStreaming: false } : e)),
          activeId: null,
        }))
        break
      case "usage_limit": {
        const warning: LimitWarning = { feature: event.feature, message: event.message, upgradeUrl: event.upgradeUrl }
        set((s) => {
          if (s.activeId !== null) {
            return {
              hotkeyState: "idle",
              entries: s.entries.map((e) =>
                e.id === s.activeId ? { ...e, limitWarning: warning, isStreaming: false } : e,
              ),
              activeId: null,
            }
          }
          return {
            hotkeyState: "idle",
            entries: [...s.entries, createEntry({ limitWarning: warning })],
            activeId: null,
          }
        })
        break
      }
      case "error":
        set((s) => {
          const soft = isSoftNotice(event.message)
          const isAbortLike = /abort|cancel|terminat/i.test(event.message)
          if (isAbortLike) {
            return {
              hotkeyState: "idle",
              entries: s.entries.map((e) =>
                e.id === s.activeId ? { ...e, isStreaming: false } : e,
              ),
              activeId: null,
            }
          }
          if (s.activeId !== null) {
            return {
              hotkeyState: "idle",
              entries: s.entries.map((e) =>
                e.id === s.activeId
                  ? soft
                    ? { ...e, notice: event.message, isStreaming: false }
                    : { ...e, error: event.message, isStreaming: false }
                  : e,
              ),
              activeId: null,
            }
          }
          return {
            hotkeyState: "idle",
            entries: [
              ...s.entries,
              createEntry({ error: soft ? null : event.message, notice: soft ? event.message : null }),
            ],
            activeId: null,
          }
        })
        break
    }
  },

  stopActivePlayback: () =>
    set((s) => ({
      entries:
        s.activeId === null
          ? s.entries
          : s.entries.map((e) => (e.id === s.activeId ? { ...e, isStreaming: false } : e)),
      activeId: null,
    })),
  dismissEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  toggleTts: () =>
    set((s) => {
      const next = !s.ttsEnabled
      window.yomi.setTts(next)
      return { ttsEnabled: next }
    }),
  setSubscription: (subscription) =>
    set((s) => {
      if (subscription === null) return { subscription: null }
      const clean = Object.fromEntries(
        Object.entries(subscription).filter(([, value]) => value !== undefined),
      ) as SubscriptionUpdate
      if (s.subscription) {
        const next = { ...s.subscription, ...clean }
        return {
          subscription: {
            ...next,
            requestsRemaining:
              clean.requestsRemaining ??
              (next.requestsLimit === null ? null : Math.max(next.requestsLimit - next.requestsUsed, 0)),
          },
        }
      }
      return {
        subscription: {
          name: clean.name ?? "",
          email: clean.email ?? "",
          role: clean.role ?? "user",
          plan: clean.plan ?? "explore",
          status: clean.status ?? "inactive",
          trialEndDate: clean.trialEndDate ?? null,
          currentPeriodEnd: clean.currentPeriodEnd ?? null,
          requestsUsed: clean.requestsUsed ?? 0,
          requestsLimit: clean.requestsLimit ?? 100,
          requestsRemaining:
            clean.requestsRemaining ??
            (clean.requestsLimit === null
              ? null
              : Math.max((clean.requestsLimit ?? 100) - (clean.requestsUsed ?? 0), 0)),
          resetAt: clean.resetAt ?? null,
          dailyChatUsed: clean.dailyChatUsed ?? 0,
          dailyVoiceUsed: clean.dailyVoiceUsed ?? 0,
          dailyImageUsed: clean.dailyImageUsed ?? 0,
          tokensUsedThisPeriod: clean.tokensUsedThisPeriod ?? 0,
        },
      }
    }),
  setSubscriptionLoading: (subscriptionLoading) => set({ subscriptionLoading }),
}))
