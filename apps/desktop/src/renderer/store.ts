import { create } from "zustand"
import type { SseEvent } from "@yomi/shared"

export type HotkeyState = "idle" | "listening" | "processing" | "text-input"
export type AuthState = "checking" | "unauthenticated" | "waiting" | "authenticated"

export interface ChatEntry {
  id: number
  transcript: string
  text: string
  error: string | null
  ttsError: string | null
  isStreaming: boolean
}

export interface SubscriptionInfo {
  name: string
  email: string
  role: string
  plan: string
  status: string
  trialEndDate: string | null
  currentPeriodEnd: string | null
  trialInteractionUsed: number
  trialInteractionLimit: number
  trialInteractionsRemaining: number
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
  ttsEnabled: boolean
  pendingAct: { id: string; label: string } | null
  subscription: SubscriptionInfo | null
  subscriptionLoading: boolean

  setAuthState: (s: AuthState, error?: string) => void
  setHotkeyState: (state: HotkeyState) => void
  handleSseEvent: (event: SseEvent) => void
  stopActivePlayback: () => void
  dismissEntry: (id: number) => void
  toggleTts: () => void
  clearPendingAct: () => void
  setSubscription: (info: SubscriptionUpdate | null) => void
  setSubscriptionLoading: (loading: boolean) => void
}

let nextId = 1

export const useYomiStore = create<YomiState>((set) => ({
  authState: "checking",
  authError: "",
  hotkeyState: "idle",
  entries: [],
  activeId: null,
  ttsEnabled: true,
  pendingAct: null,
  subscription: null,
  subscriptionLoading: false,

  setAuthState: (authState, error = "") => set({ authState, authError: error }),
  setHotkeyState: (hotkeyState) => set({ hotkeyState }),

  handleSseEvent: (event) => {
    switch (event.type) {
      case "transcript":
        set((s) => {
          const id = nextId++
          return {
            entries: [
              ...s.entries,
              {
                id,
                transcript: event.text,
                text: "",
                error: null,
                ttsError: null,
                isStreaming: true,
              },
            ],
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
      case "act_proposed":
        // Risky actions wait for the user's go-ahead (Spec 16).
        if (event.risky) set({ pendingAct: { id: event.id, label: event.label } })
        break
      case "act_result":
        set((s) => ({
          pendingAct: null,
          entries: s.entries.map((e) =>
            e.id === s.activeId
              ? {
                  ...e,
                  text: `${e.text}${e.text ? "\n" : ""}${event.ok ? "✓" : "✗"} ${event.label}${event.detail ? ` — ${event.detail}` : ""}`,
                  isStreaming: true,
                }
              : e,
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
      case "error":
        set((s) => {
          if (s.activeId !== null) {
            const activeEntry = s.entries.find((e) => e.id === s.activeId)
            const isAbortLike = /abort|cancel|terminat/i.test(event.message)
            if (activeEntry?.text && isAbortLike) {
              return {
                hotkeyState: "idle",
                entries: s.entries.map((e) =>
                  e.id === s.activeId ? { ...e, isStreaming: false } : e,
                ),
                activeId: null,
              }
            }
            return {
              hotkeyState: "idle",
              entries: s.entries.map((e) =>
                e.id === s.activeId ? { ...e, error: event.message, isStreaming: false } : e,
              ),
              activeId: null,
            }
          }
          const id = nextId++
          return {
            hotkeyState: "idle",
            entries: [
              ...s.entries,
              {
                id,
                transcript: "",
                text: "",
                error: event.message,
                ttsError: null,
                isStreaming: false,
              },
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

  toggleTts: () => set((s) => ({ ttsEnabled: !s.ttsEnabled })),
  clearPendingAct: () => set({ pendingAct: null }),

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
            trialInteractionsRemaining:
              clean.trialInteractionsRemaining ??
              Math.max(next.trialInteractionLimit - next.trialInteractionUsed, 0),
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
          trialInteractionUsed: clean.trialInteractionUsed ?? 0,
          trialInteractionLimit: clean.trialInteractionLimit ?? 150,
          trialInteractionsRemaining:
            clean.trialInteractionsRemaining ??
            Math.max((clean.trialInteractionLimit ?? 150) - (clean.trialInteractionUsed ?? 0), 0),
          dailyChatUsed: clean.dailyChatUsed ?? 0,
          dailyVoiceUsed: clean.dailyVoiceUsed ?? 0,
          dailyImageUsed: clean.dailyImageUsed ?? 0,
          tokensUsedThisPeriod: clean.tokensUsedThisPeriod ?? 0,
        },
      }
    }),
  setSubscriptionLoading: (subscriptionLoading) => set({ subscriptionLoading }),
}))
