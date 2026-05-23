import { create } from "zustand"
import type { GuideStep, SseEvent } from "@yomi/shared"

export type HotkeyState = "idle" | "listening" | "processing" | "text-input"
export type AuthState = "checking" | "unauthenticated" | "waiting" | "authenticated"

export interface ChatEntry {
  id: number
  transcript: string
  text: string
  error: string | null
  isStreaming: boolean
}

export interface SubscriptionInfo {
  role: string
  plan: string
  status: string
  trialEndDate: string | null
  currentPeriodEnd: string | null
  trialInteractionUsed: number
  trialInteractionLimit: number
  dailyChatUsed: number
  dailyVoiceUsed: number
  dailyImageUsed: number
  tokensUsedThisPeriod: number
}

interface YomiState {
  authState: AuthState
  authError: string
  hotkeyState: HotkeyState
  entries: ChatEntry[]
  activeId: number | null
  audioQueue: string[]
  guideSteps: GuideStep[]
  guideCurrentStep: number
  guideTotalSteps: number
  subscription: SubscriptionInfo | null
  subscriptionLoading: boolean

  setAuthState: (s: AuthState, error?: string) => void
  setHotkeyState: (state: HotkeyState) => void
  handleSseEvent: (event: SseEvent) => void
  dismissEntry: (id: number) => void
  setSubscription: (info: SubscriptionInfo | null) => void
  setSubscriptionLoading: (loading: boolean) => void
}

let nextId = 1

export const useYomiStore = create<YomiState>((set) => ({
  authState: "checking",
  authError: "",
  hotkeyState: "idle",
  entries: [],
  activeId: null,
  audioQueue: [],
  guideSteps: [],
  guideCurrentStep: 0,
  guideTotalSteps: 0,
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
            entries: [...s.entries, { id, transcript: event.text, text: "", error: null, isStreaming: true }],
            activeId: id,
            audioQueue: [],
          }
        })
        break
      case "llm_chunk":
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === s.activeId ? { ...e, text: e.text + event.text, isStreaming: true } : e
          ),
        }))
        break
      case "audio_chunk":
        set((s) => ({ audioQueue: [...s.audioQueue, event.base64] }))
        break
      case "visual_guide":
        set((s) => ({
          guideSteps: [...s.guideSteps, { instruction: event.instruction, elements: event.elements }],
          guideTotalSteps: event.total_steps,
          guideCurrentStep: event.step,
        }))
        break
      case "done":
        set((s) => ({
          hotkeyState: "idle",
          entries: s.entries.map((e) =>
            e.id === s.activeId ? { ...e, isStreaming: false } : e
          ),
          activeId: null,
        }))
        break
      case "error":
        set((s) => {
          if (s.activeId !== null) {
            return {
              hotkeyState: "idle",
              entries: s.entries.map((e) =>
                e.id === s.activeId ? { ...e, error: event.message, isStreaming: false } : e
              ),
              activeId: null,
            }
          }
          const id = nextId++
          return {
            hotkeyState: "idle",
            entries: [...s.entries, { id, transcript: "", text: "", error: event.message, isStreaming: false }],
            activeId: null,
          }
        })
        break
    }
  },

  dismissEntry: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

  setSubscription: (subscription) => set({ subscription }),
  setSubscriptionLoading: (subscriptionLoading) => set({ subscriptionLoading }),
}))

export const dismissGuide = () =>
  useYomiStore.setState({ guideSteps: [], guideCurrentStep: 0, guideTotalSteps: 0 })
