import { describe, expect, it } from "bun:test"
import { scoreHeuristic } from "./heuristic.js"

type Case = { text: string; path: "fast" | "agent"; minConf?: number; label?: string }

const cases: Case[] = [
  // Fast path — question words
  { text: "what does this code do?", path: "fast", minConf: 0.5 },
  { text: "how do I open a file?", path: "fast", minConf: 0.5 },
  { text: "why is this failing?", path: "fast", minConf: 0.5 },

  // Fast path — short + fast verbs
  { text: "translate this", path: "fast", minConf: 0.5 },
  { text: "summarize this paragraph", path: "fast", minConf: 0.5 },
  { text: "explain the error message", path: "fast", minConf: 0.5 },

  // Fast path — question + short + fast verb (high confidence; use 0.89 to avoid float comparison issues)
  {
    text: "what does summarize mean?",
    path: "fast",
    minConf: 0.89,
    label: "all three fast signals",
  },

  // Agent path — action verbs
  { text: "send an email to my boss", path: "agent", minConf: 0.3 },
  { text: "research the best JavaScript frameworks", path: "agent", minConf: 0.3 },
  { text: "draft a reply to this message", path: "agent", minConf: 0.3 },
  { text: "schedule a meeting for tomorrow", path: "agent", minConf: 0.3 },
  { text: "create a new Python file in my project", path: "agent", minConf: 0.3 },
  { text: "open my calendar", path: "agent", minConf: 0.3 },
  { text: "commit and push my changes", path: "agent", minConf: 0.3 },
  { text: "write buy milk in notepad", path: "agent", minConf: 0.7 },
  { text: "save this in Windows Notepad", path: "agent", minConf: 0.7 },
  { text: "wright thingsyou knoe about me in the notepad", path: "agent", minConf: 0.7 },

  // Agent path — multi-step connective (needs an action verb + connective to hit 0.8)
  { text: "research best laptops and then draft a comparison doc", path: "agent", minConf: 0.8 },
  { text: "research the bug and after that create a ticket", path: "agent", minConf: 0.8 },

  // Agent path — explicit trigger (immediate)
  { text: "yomi, agent, book a flight to London", path: "agent", minConf: 0.9 },
  { text: "Yomi agent book me a table", path: "agent", minConf: 0.9 },

  // Agent path — long request (>30 words)
  {
    text: "I want you to go through all my emails from the last week, find any ones that mention the project deadline, and create a summary document with the key dates mentioned in each",
    path: "agent",
    minConf: 0.3,
  },

  // Default — short text fires "short request" (+0.3 fast), nothing else → fast conf 0.3
  { text: "hello", path: "fast", minConf: 0.3 },
  { text: "ok", path: "fast" },

  // Ambiguous — question contains action verb ("how do I create")
  // fast wins because question word + short outweighs single action verb
  {
    text: "how do I create a Python function?",
    path: "fast",
    label: "question about creating, not create request",
  },

  // Connector queries (Notion, Drive, Gmail, GitHub, etc.) — always agent path
  { text: "what's in my Notion?", path: "agent", minConf: 0.85, label: "notion question" },
  { text: "find my notion tasks", path: "agent", minConf: 0.85, label: "notion task search" },
  { text: "search my google drive for the report", path: "agent", minConf: 0.85, label: "drive search" },
  { text: "show me files from drive", path: "agent", minConf: 0.85, label: "drive list files" },
  { text: "check my gmail for invoices", path: "agent", minConf: 0.85, label: "gmail search" },
  { text: "any new email from amazon?", path: "agent", minConf: 0.85, label: "email check" },
  { text: "what meeting do I have today?", path: "agent", minConf: 0.85, label: "calendar query" },
  { text: "create a github issue", path: "agent", minConf: 0.85, label: "github action" },
  { text: "check my slack messages", path: "agent", minConf: 0.85, label: "slack query" },
  { text: "what's on my linear board?", path: "agent", minConf: 0.85, label: "linear query" },
  { text: "show my todo list", path: "agent", minConf: 0.85, label: "todo query" },

  // Even short connector queries (question word + connector) must go to agent
  // This is the specific bug that was fixed — short connector questions were
  // going to fast path because fast signals (+0.6) outweighed connector (+0.5).
  { text: "what in notion", path: "agent", minConf: 0.85, label: "short notion question" },
  { text: "my drive", path: "agent", minConf: 0.85, label: "short drive mention" },
]

describe("scoreHeuristic", () => {
  for (const c of cases) {
    it(c.label ?? c.text, () => {
      const result = scoreHeuristic({ text: c.text })
      expect(result.path).toBe(c.path)
      expect(result.source).toBe("heuristic")
      if (c.minConf !== undefined) {
        expect(result.confidence).toBeGreaterThanOrEqual(c.minConf)
      }
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
      expect(typeof result.reason).toBe("string")
    })
  }

  it("confidence is capped at 1 even when multiple agent signals fire", () => {
    const text =
      "research competitors and then draft a report and schedule a review meeting with my team and send it"
    const result = scoreHeuristic({ text })
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.path).toBe("agent")
  })

  it("explicit trigger takes precedence over fast signals", () => {
    // Even though this starts with 'what', the trigger prefix wins
    const result = scoreHeuristic({ text: "yomi, agent, what time is the next available slot?" })
    expect(result.path).toBe("agent")
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })
})
