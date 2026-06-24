// Prompt-injection / promptware / exfiltration pattern library.
// Pure module: compiles patterns once at import and scans strings.
// Scope controls pattern breadth:
//   "all"     — classic injection + exfil (anywhere)
//   "context" — adds promptware / C2 / role-hijack (files, memory, tool results)
//   "strict"  — adds persistence / SSH / exfil-URL (memory writes, skill installs)
//
// Patterns use (?:\w+\s+)* between key tokens so filler words don't bypass detection.

export type ThreatScope = "all" | "context" | "strict"

type PatternEntry = { regex: RegExp; id: string; scope: ThreatScope }

// Each entry: regex, pattern_id, scope
const PATTERNS: PatternEntry[] = [
  // Classic prompt injection (applies everywhere)
  {
    regex: /ignore\s+(?:\w+\s+)*(previous|all|above|prior)\s+(?:\w+\s+)*instructions/i,
    id: "prompt_injection",
    scope: "all",
  },
  { regex: /system\s+prompt\s+override/i, id: "sys_prompt_override", scope: "all" },
  {
    regex: /disregard\s+(?:\w+\s+)*(your|all|any)\s+(?:\w+\s+)*(instructions|rules|guidelines)/i,
    id: "disregard_rules",
    scope: "all",
  },
  {
    regex:
      /act\s+as\s+(if|though)\s+(?:\w+\s+)*you\s+(?:\w+\s+)*(have\s+no|don't\s+have)\s+(?:\w+\s+)*(restrictions|limits|rules)/i,
    id: "bypass_restrictions",
    scope: "all",
  },
  {
    regex: /<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i,
    id: "html_comment_injection",
    scope: "all",
  },
  {
    regex: /<\s*div\s+style\s*=\s*["'][^"']*display\s*:\s*none/i,
    id: "hidden_div",
    scope: "all",
  },
  {
    regex: /translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)/i,
    id: "translate_execute",
    scope: "all",
  },
  {
    regex: /do\s+not\s+(?:\w+\s+)*tell\s+(?:\w+\s+)*the\s+user/i,
    id: "deception_hide",
    scope: "all",
  },

  // Role-play / identity hijack (context + strict)
  { regex: /you\s+are\s+(?:\w+\s+)*now\s+(?:a|an|the)\s+/i, id: "role_hijack", scope: "context" },
  { regex: /pretend\s+(?:\w+\s+)*(you\s+are|to\s+be)\s+/i, id: "role_pretend", scope: "context" },
  {
    regex: /output\s+(?:\w+\s+)*(system|initial)\s+prompt/i,
    id: "leak_system_prompt",
    scope: "context",
  },
  {
    regex:
      /(respond|answer|reply)\s+without\s+(?:\w+\s+)*(restrictions|limitations|filters|safety)/i,
    id: "remove_filters",
    scope: "context",
  },
  {
    regex: /you\s+have\s+been\s+(?:\w+\s+)*(updated|upgraded|patched)\s+to/i,
    id: "fake_update",
    scope: "context",
  },
  { regex: /\bname\s+yourself\s+\w+/i, id: "identity_override", scope: "context" },

  // C2 / Brainworm-style promptware (context scope)
  { regex: /register\s+(as\s+)?a?\s*node/i, id: "c2_node_registration", scope: "context" },
  {
    regex: /(heartbeat|beacon|check[\s-]?in)\s+(to|with)\s+/i,
    id: "c2_heartbeat",
    scope: "context",
  },
  { regex: /pull\s+(down\s+)?(?:new\s+)?task(?:ing|s)?\b/i, id: "c2_task_pull", scope: "context" },
  { regex: /connect\s+to\s+the\s+network\b/i, id: "c2_network_connect", scope: "context" },
  {
    regex: /you\s+must\s+(?:\w+\s+){0,3}(register|connect|report|beacon)\b/i,
    id: "forced_action",
    scope: "context",
  },
  { regex: /only\s+use\s+one[\s-]?liners?\b/i, id: "anti_forensic_oneliner", scope: "context" },
  {
    regex: /never\s+(?:\w+\s+)*(?:create|write)\s+(?:\w+\s+)*(?:script|file)\s+(?:\w+\s+)*disk/i,
    id: "anti_forensic_disk",
    scope: "context",
  },
  {
    regex: /unset\s+\w*(?:CLAUDE|CODEX|HERMES|AGENT|OPENAI|ANTHROPIC)\w*/i,
    id: "env_var_unset_agent",
    scope: "context",
  },

  // Known C2 / red-team framework names
  {
    regex: /\b(?:praxis|cobalt\s*strike|sliver|havoc|mythic|metasploit|brainworm)\b/i,
    id: "known_c2_framework",
    scope: "context",
  },
  {
    regex: /\bc2\s+(?:server|channel|infrastructure|beacon)\b/i,
    id: "c2_explicit",
    scope: "context",
  },
  { regex: /\bcommand\s+and\s+control\b/i, id: "c2_explicit_long", scope: "context" },

  // Exfiltration via curl/wget/cat with secrets
  {
    regex: /curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    id: "exfil_curl",
    scope: "all",
  },
  {
    regex: /wget\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i,
    id: "exfil_wget",
    scope: "all",
  },
  {
    regex: /cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass|\.npmrc|\.pypirc)/i,
    id: "read_secrets",
    scope: "all",
  },
  {
    regex: /(send|post|upload|transmit)\s+.*\s+(to|at)\s+https?:\/\//i,
    id: "send_to_url",
    scope: "strict",
  },
  {
    regex:
      /(include|output|print|share)\s+(?:\w+\s+)*(conversation|chat\s+history|previous\s+messages|full\s+context|entire\s+context)/i,
    id: "context_exfil",
    scope: "strict",
  },

  // Persistence / SSH backdoor (strict scope)
  { regex: /authorized_keys/i, id: "ssh_backdoor", scope: "strict" },
  { regex: /\$HOME\/\.ssh|~\/\.ssh/i, id: "ssh_access", scope: "strict" },
  {
    regex:
      /(update|modify|edit|write|change|append|add\s+to)\s+.*(?:AGENTS\.md|CLAUDE\.md|\.cursorrules|\.clinerules)/i,
    id: "agent_config_mod",
    scope: "strict",
  },

  // Hardcoded secrets
  {
    regex: /(?:api[_-]?key|token|secret|password)\s*[=:]\s*["'][A-Za-z0-9+/=_-]{20,}/i,
    id: "hardcoded_secret",
    scope: "strict",
  },
]

// Invisible / bidirectional unicode characters used in injection attacks.
const INVISIBLE_CHARS = new Set<string>([
  "\u200b", // zero-width space
  "\u200c", // zero-width non-joiner
  "\u200d", // zero-width joiner
  "\u2060", // word joiner
  "\u2062", // invisible times
  "\u2063", // invisible separator
  "\u2064", // invisible plus
  "\ufeff", // zero-width no-break space (BOM)
  "\u202a", // left-to-right embedding
  "\u202b", // right-to-left embedding
  "\u202c", // pop directional formatting
  "\u202d", // left-to-right override
  "\u202e", // right-to-left override
  "\u2066", // left-to-right isolate
  "\u2067", // right-to-left isolate
  "\u2068", // first strong isolate
  "\u2069", // pop directional isolate
])

// Compiled pattern sets, indexed by scope. Compiled once at import time.
const COMPILED: Record<ThreatScope, Array<{ regex: RegExp; id: string }>> = {
  all: [],
  context: [],
  strict: [],
}

for (const entry of PATTERNS) {
  const item = { regex: entry.regex, id: entry.id }
  if (entry.scope === "all") {
    COMPILED.all.push(item)
    COMPILED.context.push(item)
    COMPILED.strict.push(item)
  } else if (entry.scope === "context") {
    COMPILED.context.push(item)
    COMPILED.strict.push(item)
  } else {
    COMPILED.strict.push(item)
  }
}

export function scanForThreats(content: string, scope: ThreatScope = "context"): string[] {
  if (!content) return []

  const findings: string[] = []

  // Invisible unicode — single pass through the content's char set.
  for (const ch of new Set(content)) {
    if (INVISIBLE_CHARS.has(ch)) {
      findings.push(
        `invisible_unicode_U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
      )
    }
  }

  for (const { regex, id } of COMPILED[scope]) {
    if (regex.test(content)) findings.push(id)
  }

  return findings
}

export function firstThreatMessage(content: string, scope: ThreatScope = "strict"): string | null {
  const findings = scanForThreats(content, scope)
  const pid = findings[0]
  if (!pid) return null
  if (pid.startsWith("invisible_unicode_")) {
    const codepoint = pid.replace("invisible_unicode_", "")
    return `Blocked: content contains invisible unicode character ${codepoint} (possible injection).`
  }
  return (
    `Blocked: content matches threat pattern '${pid}'. ` +
    "Content is injected into the system prompt and must not contain injection or exfiltration payloads."
  )
}
