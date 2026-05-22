import { create } from "zustand"
import type { GuideStep, SseEvent } from "@yomi/shared"

export type HotkeyState = "idle" | "listening" | "processing"

export interface ChatEntry {
  id: number
  transcript: string
  text: string
  error: string | null
  isStreaming: boolean
}

interface YomiState {
  hotkeyState: HotkeyState
  entries: ChatEntry[]
  activeId: number | null
  audioQueue: string[]
  guideSteps: GuideStep[]
  guideCurrentStep: number
  guideTotalSteps: number

  setHotkeyState: (state: HotkeyState) => void
  handleSseEvent: (event: SseEvent) => void
  dismissEntry: (id: number) => void
}

let nextId = 1

export const useYomiStore = create<YomiState>((set) => ({
  hotkeyState: "idle",
  entries: [],
  activeId: null,
  audioQueue: [],
  guideSteps: [],
  guideCurrentStep: 0,
  guideTotalSteps: 0,

  setHotkeyState: (hotkeyState) => set({ hotkeyState }),

  handleSseEvent: (event) => {
    switch (event.type) {
      case "transcript":
        set((s) => {
          const id = nextId++
          return {
            entries: [...s.entries, { id, transcript: event.text, text: "", error: null, isStreaming: true }],
            activeId: id,
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
        set((s) => ({
          hotkeyState: "idle",
          entries: s.entries.map((e) =>
            e.id === s.activeId ? { ...e, error: event.message, isStreaming: false } : e
          ),
          activeId: null,
        }))
        break
    }
  },

  dismissEntry: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
}))

export const dismissGuide = () =>
  useYomiStore.setState({ guideSteps: [], guideCurrentStep: 0, guideTotalSteps: 0 })
