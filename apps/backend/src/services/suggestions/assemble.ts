import { validateScheduleInput } from "../schedule-parser.js"
import type { SuggestionEntry } from "./catalog.js"
import type { EarnedPattern, TimeBucket } from "./earned-patterns.js"

// Untrusted per-pattern phrasing from the fast model. Matched to a pattern by its
// echoed (connector, timeBucket); only the prose + schedule spec is consumed —
// identity is always recomputed from the pattern, never from anything here (ADR-0001).
export interface ModelSuggestionSlot {
  connector: string
  timeBucket: TimeBucket
  title: string
  description: string
  schedule: string
  prompt: string
  deliverTo: string[]
}

// A schedule the user already has, reduced by the caller to the coarse
// (connector, timeBucket) signature. Derivation is best-effort — hand-created
// schedules carry no dedupKey, so false-negatives are accepted for v1 (ADR-0001).
export interface ExistingScheduleSignature {
  connector: string
  timeBucket: TimeBucket
  enabled: boolean
}

// Everything the assembly needs that lives outside the pure computation — the
// caller fetches it, keeping this function I/O-free and deterministic.
export interface AssemblyContext {
  connectedConnectors: string[]
  latchedKeys: string[]
  existingSchedules: ExistingScheduleSignature[]
}

const MAX_GENERATED = 3

// The coarse (connector, time bucket) identity every guard keys on.
function sigFor(x: { connector: string; timeBucket: TimeBucket }): string {
  return `${x.connector}:${x.timeBucket}`
}

// Code-owned identity: at most one suggestion per (connector, time bucket),
// immune to model wording/topic drift so a dismissal latches for good.
export function dedupKeyFor(pattern: { connector: string; timeBucket: TimeBucket }): string {
  return `gen:${sigFor(pattern)}`
}

// Pure: qualifying patterns + untrusted model output -> validated, ranked, capped
// generated suggestions. Code computes identity and applies every structural guard;
// the model only supplies the prose and the (untrusted) schedule spec.
export function assembleGeneratedSuggestions(
  patterns: EarnedPattern[],
  context: AssemblyContext,
  modelOutput: ModelSuggestionSlot[],
): SuggestionEntry[] {
  const connected = new Set(context.connectedConnectors)
  const latched = new Set(context.latchedKeys)
  const occupied = new Set(context.existingSchedules.filter((s) => s.enabled).map(sigFor))
  const slotsBySig = new Map<string, ModelSuggestionSlot[]>()
  for (const slot of modelOutput) {
    const sig = sigFor(slot)
    const arr = slotsBySig.get(sig)
    if (arr) arr.push(slot)
    else slotsBySig.set(sig, [slot])
  }

  const survivors: Array<{ entry: SuggestionEntry; distinctDays: number }> = []
  for (const pattern of patterns) {
    const sig = sigFor(pattern)
    // (a) untrusted schedule: take the first slot the model phrased whose schedule
    // validates — a malformed sibling never suppresses a valid one.
    const slot = slotsBySig.get(sig)?.find((s) => validateScheduleInput(s.schedule).ok)
    if (!slot) continue // model phrased nothing usable for this pattern
    if (!connected.has(pattern.connector)) continue // (b) connector not connected
    const dedupKey = dedupKeyFor(pattern)
    if (latched.has(dedupKey)) continue // (c) already decided
    if (occupied.has(sig)) continue // (d) equivalent enabled schedule already exists

    const deliverTo = slot.deliverTo
    const entry: SuggestionEntry = {
      dedupKey,
      provider: pattern.connector,
      title: slot.title,
      description: slot.description,
      spec: { schedule: slot.schedule, prompt: slot.prompt, deliverTo },
    }
    if (deliverTo.includes("telegram")) entry.requires = { telegram: true }
    survivors.push({ entry, distinctDays: pattern.distinctDays })
  }

  survivors.sort(
    (a, b) => b.distinctDays - a.distinctDays || a.entry.dedupKey.localeCompare(b.entry.dedupKey),
  )
  return survivors.slice(0, MAX_GENERATED).map((s) => s.entry)
}
