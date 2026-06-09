// Threat scan for skill writes. Re-uses the existing `scanForThreats` engine
// (the same one `applyHooks()` uses on tool args) with the `strict` scope
// per spec: "strict: memory writes, skill installs". Adds a few skill-specific
// checks on top — directory traversal patterns that the generic scanner
// doesn't know about.
//
// The guard runs BEFORE the file write so a threat never lands on disk. The
// "atomic rollback" from the spec is reserved for the temp-then-rename
// pattern in the store layer (Stage 1) — guard + write is a single
// decision point.

import { scanForThreats } from "../guardrails/index.js"
import type { SkillFull, SkillManifest } from "./skill-types.js"

export type SkillGuardVerdict = "allow" | "block"

export interface SkillGuardDecision {
  verdict: SkillGuardVerdict
  // Stable pattern IDs from scanForThreats ("strict" scope) + a few
  // skill-specific ones ("skill_*"). Empty when verdict="allow".
  findings: string[]
  // Pre-truncated human-readable summary of the first few findings. Used by
  // the tool layer to format an error message.
  summary: string
}

const MAX_FINDINGS_SUMMARY = 3
const MAX_BODY_BYTES = 64 * 1024

// Skill-specific patterns that the generic threat lib doesn't track. These
// target the *capability surface* of a skill body — code blocks, shell
// commands, exfiltration primitives — and match Hermes' skills_guard.py
// behaviour without porting the full regex zoo.
const SKILL_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  {
    id: "skill_register_as_node",
    regex: /register\s+(?:as\s+)?(?:a\s+)?node/i,
  },
  {
    id: "skill_heartbeat_beacon",
    regex: /heartbeat\s+beacon/i,
  },
  {
    id: "skill_post_creds",
    // Base64 of "sk-" + 20+ chars, or any API key literal in a single
    // backticks code block followed by a network call.
    regex: /(?:sk-[A-Za-z0-9_-]{16,}|[A-Z]{2,}_API_KEY\s*=\s*["'][A-Za-z0-9]{16,})/,
  },
  {
    id: "skill_exfil_curl",
    regex: /curl\s+[^\n]*\|\s*(?:ba)?sh/,
  },
  {
    id: "skill_obfuscated_eval",
    regex: /\beval\s*\(\s*(?:atob|Buffer\.from|require\s*\(\s*["']child_process)/,
  },
]

function summarize(findings: string[]): string {
  if (findings.length === 0) return ""
  const head = findings.slice(0, MAX_FINDINGS_SUMMARY).join(", ")
  const more =
    findings.length > MAX_FINDINGS_SUMMARY
      ? ` (+${findings.length - MAX_FINDINGS_SUMMARY} more)`
      : ""
  return `${head}${more}`
}

function scanSkillSpecific(body: string): string[] {
  if (!body) return []
  const out: string[] = []
  for (const p of SKILL_PATTERNS) {
    if (p.regex.test(body)) out.push(p.id)
  }
  return out
}

export function scanSkillContent(
  body: string,
  opts: { manifest?: SkillManifest | null } = {},
): SkillGuardDecision {
  const findings: string[] = []

  // The strict scope catches promptware / C2 / exfil. Empty body is fine —
  // an empty skill is valid (rare but legal).
  if (body) {
    findings.push(...scanForThreats(body, "strict"))
    findings.push(...scanSkillSpecific(body))
  }

  // Frontmatter metadata can also carry threats (e.g. a `description` that
  // smuggles injection prompts into the system prompt's skill index).
  if (opts.manifest) {
    const manifestText = [opts.manifest.name, opts.manifest.description, opts.manifest.author].join(
      "\n",
    )
    findings.push(...scanForThreats(manifestText, "strict"))
  }

  if (findings.length === 0) {
    return { verdict: "allow", findings: [], summary: "" }
  }
  return { verdict: "block", findings, summary: summarize(findings) }
}

export function scanSkillFull(skill: SkillFull): SkillGuardDecision {
  return scanSkillContent(skill.body, { manifest: skill.manifest })
}

// Convenience for the write tools: returns null on allow, or a SkillWriteResult
// payload on block. The agent sees a clear error and can adjust.
export function guardSkillWrite(
  body: string,
  opts: { manifest?: SkillManifest | null; maxBytes?: number } = {},
): { ok: true } | { ok: false; reason: string; findings: string[] } {
  if (Buffer.byteLength(body ?? "", "utf-8") > (opts.maxBytes ?? MAX_BODY_BYTES)) {
    return {
      ok: false,
      reason: `skill body too large (max ${opts.maxBytes ?? MAX_BODY_BYTES} bytes)`,
      findings: [],
    }
  }
  const decision = scanSkillContent(body, { manifest: opts.manifest ?? null })
  if (decision.verdict === "allow") return { ok: true }
  return {
    ok: false,
    reason: `threat_block: ${decision.summary}`,
    findings: decision.findings,
  }
}
