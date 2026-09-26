#!/usr/bin/env node
// Keeps commit subjects short and uniform, like `feat(web): add the docs palette`.
//
//   node scripts/commit-msg.mjs <file>     check a commit message file (git hook)
//   node scripts/commit-msg.mjs --title "…" check a PR title (CI; squash merges use it)
//
// Rules: a Conventional Commits type, an optional lowercase scope, a lowercase summary,
// no trailing period, at most 60 characters not counting a " (#123)" suffix.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

export const MAX_SUBJECT = 60
export const TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
]

const PATTERN = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9][a-z0-9-/]*\\))?!?: (.+)$`)

// Subjects git or GitHub write for us; never block these.
function generated(subject) {
  return /^(Merge |Revert "|fixup! |squash! |amend! )/.test(subject)
}

/** @returns {string[]} problems; empty when the subject is fine */
export function checkSubject(raw) {
  const subject = raw.trim()
  if (generated(subject)) return []
  const problems = []
  const match = subject.match(PATTERN)
  if (!match) {
    problems.push(
      `start with a type and a colon, e.g. "feat: …" or "fix(api): …" (types: ${TYPES.join(", ")})`,
    )
    return problems
  }
  const summary = match[3]
  if (/^[A-Z]/.test(summary) && !/^[A-Z0-9]{2,}\b/.test(summary)) {
    problems.push("start the summary lowercase")
  }
  if (/\.$/.test(summary)) problems.push("drop the trailing period")
  const length = subject.replace(/ \(#\d+\)$/, "").length
  if (length > MAX_SUBJECT) {
    problems.push(`keep it to ${MAX_SUBJECT} characters (it is ${length}); details go in the body`)
  }
  return problems
}

function firstLine(message) {
  return (
    message
      .split("\n")
      .find((line) => line.trim() && !line.startsWith("#"))
      ?.trim() ?? ""
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, value] = process.argv.slice(2)
  const subject = flag === "--title" ? (value ?? "") : firstLine(readFileSync(flag, "utf8"))
  const problems = checkSubject(subject)
  if (problems.length) {
    console.error(`✖ "${subject}"`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error(`\n  e.g. feat(web): add the docs search palette`)
    process.exit(1)
  }
}
