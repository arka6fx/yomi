export type MemoryRow = {
  id: string
  topic?: string | null
  kind?: string | null
  scope?: string | null
  content: string
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string | null
}

export const KINDS = ["fact", "preference", "project", "decision", "open_thread"] as const
export const SCOPES = ["global", "project", "app", "session"] as const
