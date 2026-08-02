// Opt-in eval for contradiction detection inside memory extraction (ADR 0006). Deliberately
// not a *.test.ts: it calls a real model, so CI and `bun run test` must never run it.
//
//   OPENAI_API_KEY=... bun apps/backend/scripts/eval-memory-contradiction.ts [--runs 3]
//
// Each fixture hands the extractor a candidate set and a turn, then checks which stored memory
// it names. Superseding an elaboration or a duplicate is the false-positive this exists to
// catch; missing a paraphrased correction is the false-negative.

import { generateText } from "ai"
import { createModel } from "@yomi/agent-core"
import {
  buildExtractionPrompt,
  parseExtractedMemories,
  pickReplacesId,
  type TurnCandidate,
} from "../src/services/memory/contradiction.js"

type Fixture = {
  name: string
  candidates: TurnCandidate[]
  input: string
  output: string
  // The id the extractor must name, or null when nothing may be superseded.
  expected: string | null
}

function candidate(
  id: string,
  kind: string,
  topic: string,
  content: string,
  summary: string | null = null,
): TurnCandidate {
  return { id, kind, topic, summary, content }
}

const EDITOR = candidate("mem-editor", "preference", "editor", "Uses vim as their editor")
const STANDUP = candidate("mem-standup", "fact", "standup", "Team standup is at 9:30am")
const COFFEE = candidate("mem-coffee", "preference", "coffee order", "Drinks oat flat whites")
const GYM = candidate("mem-gym", "fact", "gym", "Goes to the gym on Tuesday and Thursday evenings")

const FIXTURES: Fixture[] = [
  {
    name: "paraphrased correction supersedes",
    candidates: [EDITOR, STANDUP, COFFEE],
    input: "actually I've moved over to VS Code, vim wasn't sticking",
    output: "Got it — I'll assume VS Code from now on instead of vim.",
    expected: EDITOR.id,
  },
  {
    name: "correction with no shared wording supersedes",
    candidates: [STANDUP, EDITOR, GYM],
    input: "we pushed the morning sync to 10",
    output: "Noted — your team's daily standup now starts at 10:00am rather than 9:30am.",
    expected: STANDUP.id,
  },
  // Deliberately unlike the worked examples in the prompt — an elaboration the model has to
  // reason about rather than pattern-match.
  {
    name: "compatible elaboration does not supersede",
    candidates: [GYM, EDITOR, COFFEE],
    input: "the gym I go to is the climbing place on Latimer Road",
    output: "Got it — your Tuesday and Thursday sessions are at the Latimer Road climbing gym.",
    expected: null,
  },
  {
    name: "reworded duplicate does not supersede",
    candidates: [COFFEE, EDITOR, GYM],
    input: "just so you know, I'm an oat milk flat white person",
    output: "Understood — oat flat white is your usual coffee order.",
    expected: null,
  },
  {
    name: "unrelated new fact does not supersede",
    candidates: [EDITOR, STANDUP, COFFEE],
    input: "book me a dentist appointment for next Friday",
    output: "Booked — dentist next Friday at 3pm.",
    expected: null,
  },
]

const runsArg = process.argv.indexOf("--runs")
const requestedRuns = runsArg === -1 ? 1 : Number.parseInt(process.argv[runsArg + 1] ?? "", 10)
const runs = Number.isFinite(requestedRuns) ? Math.max(1, requestedRuns) : 1

if (!process.env["OPENAI_API_KEY"]) {
  console.error("OPENAI_API_KEY is required — this eval calls a real model")
  process.exit(1)
}

const model = createModel(
  process.env["MEMORY_EXTRACTION_MODEL"] || process.env["OPENAI_FAST_MODEL"] || "gpt-5.4-mini",
)

const verbose = process.argv.includes("--verbose")

async function namedId(fixture: Fixture): Promise<string | null> {
  const { text } = await generateText({
    model,
    messages: [
      {
        role: "user",
        content: buildExtractionPrompt(fixture.input, fixture.output, fixture.candidates),
      },
    ],
  })
  if (verbose) console.log(`\n--- ${fixture.name}\n${text}`)
  for (const memory of parseExtractedMemories(text)) {
    const id = pickReplacesId(memory.replaces_id, fixture.candidates)
    if (id) return id
  }
  return null
}

let failures = 0
for (const fixture of FIXTURES) {
  const results: (string | null)[] = []
  for (let run = 0; run < runs; run++) results.push(await namedId(fixture))
  const passed = results.filter((id) => id === fixture.expected).length
  const ok = passed === runs
  if (!ok) failures++
  console.log(
    `${ok ? "PASS" : "FAIL"} ${fixture.name} — ${passed}/${runs} named ${fixture.expected ?? "nothing"}` +
      (ok ? "" : ` (got ${results.map((id) => id ?? "nothing").join(", ")})`),
  )
}

console.log(`\n${FIXTURES.length - failures}/${FIXTURES.length} fixtures passed`)
process.exit(failures ? 1 : 0)
