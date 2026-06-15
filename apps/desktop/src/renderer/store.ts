import { create } from "zustand"
import type { AutomationRun, SseEvent } from "@yomi/shared"
import type {
  AutomationKnowledgeResponse,
  AutomationProviderHealth,
  AutomationWorkflowReplay,
} from "../preload"

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
  // Soft, non-alarming notice (STT couldn't hear you, mic/audio capture hiccup).
  // Rendered in the warm accent style instead of the red error style.
  notice: string | null
  ttsError: string | null
  // Shown when a plan feature quota is hit — distinct amber style with upgrade link.
  limitWarning: LimitWarning | null
  isStreaming: boolean
}

// STT / audio-capture hiccups are expected, recoverable, and the user's fault as
// often as ours — show them as a gentle hint, not a red error.
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
export type ProviderHealthStatus = "idle" | "loading" | "ready" | "error"
export type KnowledgePreviewStatus = "idle" | "loading" | "ready" | "error"
export type WorkflowCatalogStatus = "idle" | "loading" | "ready" | "error"

interface YomiState {
  authState: AuthState
  authError: string
  hotkeyState: HotkeyState
  entries: ChatEntry[]
  activeId: number | null
  // Reserved chat ID allocated when voice listening starts — consumed by the
  // first `transcript` event so the turn has a stable ID from the moment
  // the user begins speaking.
  listeningId: number | null
  ttsEnabled: boolean
  pendingAct: { id: string; label: string } | null
  automationRuns: AutomationRun[]
  activeAutomationRunId: string | null
  missionsOpen: boolean
  providerHealth: AutomationProviderHealth[]
  providerHealthStatus: ProviderHealthStatus
  providerHealthError: string | null
  providerHealthUpdatedAt: string | null
  repairingProviderId: string | null
  knowledgePreview: AutomationKnowledgeResponse | null
  knowledgePreviewGoal: string | null
  knowledgePreviewStatus: KnowledgePreviewStatus
  knowledgePreviewError: string | null
  workflowCatalog: AutomationWorkflowReplay[]
  workflowCatalogStatus: WorkflowCatalogStatus
  workflowCatalogError: string | null
  subscription: SubscriptionInfo | null
  subscriptionLoading: boolean

  setAuthState: (s: AuthState, error?: string) => void
  setHotkeyState: (state: HotkeyState) => void
  handleSseEvent: (event: SseEvent) => void
  stopActivePlayback: () => void
  dismissEntry: (id: number) => void
  toggleTts: () => void
  clearPendingAct: () => void
  replayAutomation: (replayId: string) => void
  toggleMissions: () => void
  setMissionsOpen: (open: boolean) => void
  loadProviderHealth: () => Promise<void>
  repairProvider: (providerId: string) => Promise<void>
  loadKnowledgePreview: (goal: string) => Promise<void>
  loadWorkflowCatalog: () => Promise<void>
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
  listeningId: null,
  ttsEnabled: true,
  pendingAct: null,
  automationRuns: [],
  activeAutomationRunId: null,
  missionsOpen: false,
  providerHealth: [],
  providerHealthStatus: "idle",
  providerHealthError: null,
  providerHealthUpdatedAt: null,
  repairingProviderId: null,
  knowledgePreview: null,
  knowledgePreviewGoal: null,
  knowledgePreviewStatus: "idle",
  knowledgePreviewError: null,
  workflowCatalog: [],
  workflowCatalogStatus: "idle",
  workflowCatalogError: null,
  subscription: null,
  subscriptionLoading: false,

  setAuthState: (authState, error = "") => set({ authState, authError: error }),
  setHotkeyState: (next) =>
    set((s) => {
      const patch: Partial<YomiState> = { hotkeyState: next }
      if (next === "listening") {
        patch.listeningId = nextId++ // reserve an ID so this voice turn is trackable from first mic open
      } else if (next === "idle") {
        patch.listeningId = null // discard if the turn was abandoned before a transcript arrived
      }
      return patch
    }),

  handleSseEvent: (event) => {
    switch (event.type) {
      case "transcript":
        set((s) => {
          const id = s.listeningId !== null ? s.listeningId : nextId++
          return {
            listeningId: null,
            entries: [
              ...s.entries,
              {
                id,
                transcript: event.text,
                text: "",
                error: null,
                notice: null,
                ttsError: null,
                limitWarning: null,
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
        // Risky actions wait for the user's go-ahead (Spec 16); surface them in Mission Control.
        if (event.risky)
          set({ pendingAct: { id: event.id, label: event.label }, missionsOpen: true })
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
      case "automation_started":
        set((s) => ({
          activeAutomationRunId: event.run.id,
          automationRuns: [event.run, ...s.automationRuns.filter((run) => run.id !== event.run.id)].slice(
            0,
            12,
          ),
        }))
        break
      case "automation_preview":
        set((s) => ({
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? {
                  ...run,
                  estimatedSeconds: event.preview.estimatedSeconds,
                  confidence: event.preview.confidence,
                }
              : run,
          ),
        }))
        break
      case "automation_step":
        set((s) => ({
          activeAutomationRunId: event.runId,
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? {
                  ...run,
                  state: event.state,
                  currentStep: event.currentStep,
                  nextStep: event.nextStep,
                  step: event.step,
                  maxSteps: event.maxSteps,
                  estimatedSeconds: event.estimatedSeconds ?? run.estimatedSeconds,
                  confidence: event.confidence ?? run.confidence,
                }
              : run,
          ),
        }))
        break
      case "automation_timeline":
        set((s) => ({
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? { ...run, timeline: [...run.timeline, event.item].slice(-40) }
              : run,
          ),
        }))
        break
      case "automation_waiting":
        set((s) => ({
          activeAutomationRunId: event.runId,
          missionsOpen: event.risk === "dangerous" ? true : s.missionsOpen,
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? { ...run, state: event.risk === "dangerous" ? "needs_approval" : "waiting", currentStep: event.reason }
              : run,
          ),
        }))
        break
      case "automation_completed":
        set((s) => ({
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? {
                  ...run,
                  state: "completed",
                  currentStep: event.summary,
                  endedAt: new Date().toISOString(),
                  replayId: event.replayId ?? run.replayId,
                }
              : run,
          ),
        }))
        break
      case "automation_failed":
        set((s) => ({
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? {
                  ...run,
                  state: "failed",
                  currentStep: event.error,
                  endedAt: new Date().toISOString(),
                  replayId: event.replayId ?? run.replayId,
                }
              : run,
          ),
        }))
        break
      case "automation_recovering":
        set((s) => ({
          activeAutomationRunId: event.runId,
          automationRuns: s.automationRuns.map((run) =>
            run.id === event.runId
              ? { ...run, state: "recovering", currentStep: event.reason }
              : run,
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
          const id = nextId++
          return {
            hotkeyState: "idle",
            entries: [
              ...s.entries,
              { id, transcript: "", text: "", error: null, notice: null, ttsError: null, limitWarning: warning, isStreaming: false },
            ],
            activeId: null,
          }
        })
        break
      }
      case "error":
        set((s) => {
          const soft = isSoftNotice(event.message)
          // A barge-in (talk-to-interrupt) or Escape supersedes the run — never a real failure,
          // so stop streaming silently instead of showing a red "terminated/aborted" error.
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
          const id = nextId++
          return {
            hotkeyState: "idle",
            entries: [
              ...s.entries,
              {
                id,
                transcript: "",
                text: "",
                error: soft ? null : event.message,
                notice: soft ? event.message : null,
                ttsError: null,
                limitWarning: null,
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

  toggleTts: () =>
    set((s) => {
      const next = !s.ttsEnabled
      window.yomi.setTts(next)
      return { ttsEnabled: next }
    }),
  clearPendingAct: () => set({ pendingAct: null }),
  replayAutomation: (replayId) => window.yomi.replayAutomation(replayId),
  toggleMissions: () => set((s) => ({ missionsOpen: !s.missionsOpen })),
  setMissionsOpen: (missionsOpen) => set({ missionsOpen }),
  loadProviderHealth: async () => {
    set({ providerHealthStatus: "loading", providerHealthError: null })
    try {
      const health = await window.yomi.getAutomationHealth()
      set({
        providerHealth: health.providers,
        providerHealthStatus: "ready",
        providerHealthError: health.ok ? null : "One or more providers need attention",
        providerHealthUpdatedAt: new Date().toISOString(),
      })
    } catch (err) {
      set({
        providerHealthStatus: "error",
        providerHealthError: err instanceof Error ? err.message : "Provider health unavailable",
      })
    }
  },
  repairProvider: async (providerId) => {
    set({ repairingProviderId: providerId, providerHealthError: null })
    try {
      const repaired = await window.yomi.repairAutomationProvider(providerId)
      set((s) => {
        const providers = s.providerHealth.map((provider) =>
          provider.id === repaired.provider.id ? repaired.provider : provider,
        )
        const nextProviders = providers.some((provider) => provider.id === repaired.provider.id)
          ? providers
          : [...providers, repaired.provider]
        return {
          providerHealth: nextProviders,
          providerHealthStatus: "ready",
          providerHealthError: nextProviders.some((provider) => !provider.ok)
            ? "One or more providers need attention"
            : null,
          providerHealthUpdatedAt: new Date().toISOString(),
          repairingProviderId: null,
        }
      })
    } catch (err) {
      set({
        providerHealthStatus: "error",
        providerHealthError: err instanceof Error ? err.message : "Provider repair failed",
        repairingProviderId: null,
      })
    }
  },
  loadKnowledgePreview: async (goal) => {
    const trimmed = goal.trim()
    if (!trimmed) {
      set({
        knowledgePreview: null,
        knowledgePreviewGoal: null,
        knowledgePreviewStatus: "idle",
        knowledgePreviewError: null,
      })
      return
    }
    set({
      knowledgePreviewGoal: trimmed,
      knowledgePreviewStatus: "loading",
      knowledgePreviewError: null,
    })
    try {
      const preview = await window.yomi.getAutomationKnowledge(trimmed)
      set((s) =>
        s.knowledgePreviewGoal === trimmed
          ? {
              knowledgePreview: preview,
              knowledgePreviewStatus: "ready",
              knowledgePreviewError: null,
            }
          : {},
      )
    } catch (err) {
      set((s) =>
        s.knowledgePreviewGoal === trimmed
          ? {
              knowledgePreviewStatus: "error",
              knowledgePreviewError:
                err instanceof Error ? err.message : "Knowledge preview unavailable",
            }
          : {},
      )
    }
  },
  loadWorkflowCatalog: async () => {
    set({ workflowCatalogStatus: "loading", workflowCatalogError: null })
    try {
      const res = await window.yomi.getAutomationWorkflows()
      set({
        workflowCatalog: res.workflows,
        workflowCatalogStatus: "ready",
        workflowCatalogError: null,
      })
    } catch (err) {
      set({
        workflowCatalogStatus: "error",
        workflowCatalogError: err instanceof Error ? err.message : "Workflow catalog unavailable",
      })
    }
  },

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
              (next.requestsLimit === null
                ? null
                : Math.max(next.requestsLimit - next.requestsUsed, 0)),
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
