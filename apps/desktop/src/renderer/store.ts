import { create } from "zustand"
import type { GuideStep, SseEvent } from "@yomi/shared"

export type HotkeyState = "idle" | "listening" | "processing"

interface YomiState {
  // Hotkey / pipeline state
  hotkeyState: HotkeyState

  // Current response
  transcript: string
  responseText: string
  isStreaming: boolean

  // Guide mode
  guideSteps: GuideStep[]
  guideCurrentStep: number
  guideTotalSteps: number

  // Error
  error: string | null

  // Actions
  setHotkeyState: (state: HotkeyState) => void
  handleSseEvent: (event: SseEvent) => void
  reset: () => void
  dismissGuide: () => void
}

const initialState = {
  hotkeyState: "idle" as HotkeyState,
  transcript: "",
  responseText: "",
  isStreaming: false,
  guideSteps: [],
  guideCurrentStep: 0,
  guideTotalSteps: 0,
  error: null,
}

export const useYomiStore = create<YomiState>((set) => ({
  ...initialState,

  setHotkeyState: (hotkeyState) => set({ hotkeyState }),

  handleSseEvent: (event) => {
    switch (event.type) {
      case "transcript":
        set({ transcript: event.text })
        break
      case "llm_chunk":
        set((s) => ({ responseText: s.responseText + event.text, isStreaming: true }))
        break
      case "audio_chunk":
        // audio playback handled in ipc.ts — no UI state needed
        break
      case "visual_guide":
        set((s) => ({
          guideSteps: [...s.guideSteps, { instruction: event.instruction, elements: event.elements }],
          guideTotalSteps: event.total_steps,
          guideCurrentStep: event.step,
        }))
        break
      case "done":
        set({ isStreaming: false, hotkeyState: "idle" })
        break
      case "error":
        set({ error: event.message, isStreaming: false, hotkeyState: "idle" })
        break
    }
  },

  reset: () => set(initialState),

  dismissGuide: () =>
    set({ guideSteps: [], guideCurrentStep: 0, guideTotalSteps: 0 }),
}))
