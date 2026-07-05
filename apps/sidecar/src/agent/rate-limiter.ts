// Cross-session rate limiter and circuit breaker for LLM API calls.
// Uses a shared JSON file so sidecar + cron + subagents all respect
// a 429 cooldown instead of retry-storming.

import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { RateLimitError, BillingError } from "@yomi/agent-core"
export { RateLimitError, BillingError }

const RATE_LIMIT_PATH = join(homedir(), ".yomi", "rate-limit.json")
const DEFAULT_COOLDOWN_MS = 60_000 // 60s default cooldown
const MAX_RETRY_AFTER_MS = 600_000 // 10 min cap on Retry-After
const MAX_BACKOFF_MS = 120_000 // 2 min cap on exponential backoff

interface ProviderState {
  cooldownUntil: number | null // timestamp (ms) when circuit re-closes
  lastRateLimitAt: number | null // timestamp of most recent 429
  retryAfterUsed: number | null // seconds from Retry-After header
}

interface RateLimitData {
  providers: Record<string, ProviderState>
}

function defaultState(): ProviderState {
  return { cooldownUntil: null, lastRateLimitAt: null, retryAfterUsed: null }
}

function defaultData(): RateLimitData {
  return { providers: {} }
}

function ensureDir(): Promise<void> {
  return mkdir(join(homedir(), ".yomi"), { recursive: true }) as unknown as Promise<void>
}

async function readState(): Promise<RateLimitData> {
  try {
    const raw = await readFile(RATE_LIMIT_PATH, "utf-8")
    return JSON.parse(raw) as RateLimitData
  } catch {
    return defaultData()
  }
}

async function writeState(data: RateLimitData): Promise<void> {
  await ensureDir()
  const tmp = RATE_LIMIT_PATH + ".tmp"
  await writeFile(tmp, JSON.stringify(data))
  try {
    await Bun.write(Bun.file(tmp), Bun.file(RATE_LIMIT_PATH))
  } catch {
    await writeFile(RATE_LIMIT_PATH, JSON.stringify(data))
  }
}

/** Check whether the circuit is closed for a provider. */
export async function canProceed(provider = "ai-credits"): Promise<boolean> {
  const data = await readState()
  const state = data.providers[provider]
  if (!state?.cooldownUntil) return true
  if (Date.now() >= state.cooldownUntil) return true
  return false
}

/** Return seconds remaining until cooldown expires, or 0. */
export async function cooldownRemaining(provider = "ai-credits"): Promise<number> {
  const data = await readState()
  const state = data.providers[provider]
  if (!state?.cooldownUntil) return 0
  return Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000))
}

/** Record a rate limit event and open the circuit. */
export async function recordRateLimit(
  retryAfterSeconds?: number,
  provider = "ai-credits",
): Promise<void> {
  const data = await readState()
  const state = (data.providers[provider] ??= defaultState())
  state.lastRateLimitAt = Date.now()

  if (retryAfterSeconds && retryAfterSeconds > 0) {
    const capped = Math.min(retryAfterSeconds, MAX_RETRY_AFTER_MS / 1000)
    state.retryAfterUsed = capped
    state.cooldownUntil = Date.now() + capped * 1000
  } else {
    state.cooldownUntil = Date.now() + DEFAULT_COOLDOWN_MS
  }

  await writeState(data)
}

/** Record a successful API call (close the circuit). */
export async function recordSuccess(provider = "ai-credits"): Promise<void> {
  const data = await readState()
  const state = data.providers[provider]
  if (state) {
    state.cooldownUntil = null
  } else {
    data.providers[provider] = defaultState()
  }
  await writeState(data)
}

// ── Error classification ──────────────────────────────────────────────

/** Check if an error is a rate limit (429) vs billing/transient. */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true

  const err = error as { status?: number; statusCode?: number; message?: string } | null
  if (!err) return false

  const status = err.status ?? err.statusCode
  if (status === 429) return true

  const msg = (err.message ?? "").toLowerCase()
  if (status === 429) return true
  if (msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests"))
    return true
  if (msg.includes("retry after") || msg.includes("retry-after") || msg.includes("try again later"))
    return true

  return false
}

/** Check if an error is a billing/quota error (not retryable). */
export function isBillingError(error: unknown): boolean {
  const err = error as { status?: number; message?: string } | null
  if (!err) return false
  const status = err.status
  if (status === 402 || status === 403) return true
  const msg = (err.message ?? "").toLowerCase()
  if (
    msg.includes("insufficient") ||
    msg.includes("billing") ||
    msg.includes("quota") ||
    msg.includes("credits")
  )
    return true
  return false
}

// ── Backoff ───────────────────────────────────────────────────────────

/** Jittered exponential backoff delay in ms. */
export function jitteredBackoff(
  attempt: number,
  baseDelayMs = 2_000,
  maxDelayMs = MAX_BACKOFF_MS,
): number {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
  const jitter = exponential * 0.5 * Math.random()
  return Math.floor(exponential + jitter)
}

/** Sleep for `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Rate limit header parsing ─────────────────────────────────────────

/** Parse Retry-After header value (seconds or HTTP-date). */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const seconds = parseInt(value, 10)
  if (!isNaN(seconds) && seconds >= 0) return seconds
  const ts = Date.parse(value)
  if (!isNaN(ts)) return Math.max(1, Math.ceil((ts - Date.now()) / 1000))
  return undefined
}

/** Check if response headers indicate a rate limit. Returns retry-after seconds. */
export function getRetryAfterFromHeaders(
  headers: Headers | Record<string, string> | null | undefined,
): number | undefined {
  if (!headers) return undefined
  const get =
    typeof (headers as Headers).get === "function"
      ? (k: string) => (headers as Headers).get(k)
      : (k: string) => (headers as Record<string, string>)[k]

  return parseRetryAfter(get("retry-after") ?? get("Retry-After") ?? get("x-ratelimit-reset"))
}

// ── Rate limit enforcement wrapper for agent loops ────────────────────

export interface RetryConfig {
  maxRetries: number
  provider: string
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: parseInt(process.env["AGENT_RATE_LIMIT_RETRIES"] || "3", 10),
  provider: "ai-credits",
}

/**
 * Wrap streamText consumption with rate-limit-aware retry logic.
 * On 429: records circuit breaker, applies jittered backoff, retries.
 * On billing error: surfaces immediately (no retry).
 */
export async function* withRateLimitRetry<T>(
  streamFactory: () => AsyncGenerator<T>,
  config: Partial<RetryConfig> = {},
): AsyncGenerator<
  T | { type: "rate_limit_wait"; seconds: number } | { type: "rate_limit_exhausted" }
> {
  const { maxRetries, provider } = { ...DEFAULT_RETRY_CONFIG, ...config }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (!(await canProceed(provider))) {
      const remaining = await cooldownRemaining(provider)
      yield { type: "rate_limit_wait" as const, seconds: remaining }
      await sleep(remaining * 1000)
    }

    try {
      for await (const event of streamFactory()) {
        yield event as T
      }
      // Success - close circuit
      await recordSuccess(provider)
      return
    } catch (err) {
      if (isBillingError(err)) {
        throw err
      }
      if (!isRateLimitError(err)) {
        throw err
      }

      // Rate limit hit
      const retryAfter = err instanceof RateLimitError ? err.retryAfterSeconds : undefined
      await recordRateLimit(retryAfter, provider)

      if (attempt < maxRetries) {
        const wait = jitteredBackoff(attempt)
        yield { type: "rate_limit_wait" as const, seconds: Math.ceil(wait / 1000) } as const
        await sleep(wait)
      } else {
        yield { type: "rate_limit_exhausted" as const } as const
        return
      }
    }
  }
}
