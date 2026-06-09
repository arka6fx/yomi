// Path-traversal and URL-safety checks for file/MCP tools. Pure module.

import { homedir } from "node:os"
import { isAbsolute, resolve, sep, normalize } from "node:path"

const YOMI_ROOT = resolve(homedir(), ".yomi")

export type PathCheck = { ok: true; absolute: string } | { ok: false; reason: string }

// Resolve a user-supplied path (relative or absolute) and verify it stays inside ~/.yomi/.
// On Windows, case-insensitive comparison is applied at the segment level.
export function checkYomiPath(input: string): PathCheck {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "empty path" }
  }
  // Reject NUL bytes up front — they truncate paths on POSIX and are never legitimate.
  if (input.includes("\0")) {
    return { ok: false, reason: "NUL byte in path" }
  }

  const absolute = isAbsolute(input) ? normalize(input) : resolve(YOMI_ROOT, input)
  const root = YOMI_ROOT

  // Case-insensitive prefix check on Windows; case-sensitive elsewhere.
  const startsWithRoot = isWindows()
    ? absolute.toLowerCase().startsWith(root.toLowerCase() + sep) ||
      absolute.toLowerCase() === root.toLowerCase()
    : absolute === root || absolute.startsWith(root + sep)

  if (!startsWithRoot) {
    return { ok: false, reason: `path escapes ~/.yomi/: "${input}"` }
  }

  // After normalization, ".." must not appear as a path segment.
  const segments = absolute.split(sep)
  if (segments.includes("..")) {
    return { ok: false, reason: `path traversal detected: "${input}"` }
  }

  return { ok: true, absolute }
}

const BLOCKED_URL_PATTERNS: RegExp[] = [
  // Loopback / private — never let the agent exfiltrate to a local listener.
  /^https?:\/\/(?:localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.)/i,
  // file:// scheme via http is meaningless but worth blocking.
  /^https?:\/\/[^/]*file:/i,
]

export function isBlockedUrl(url: string): boolean {
  if (typeof url !== "string") return false
  return BLOCKED_URL_PATTERNS.some((p) => p.test(url.trim()))
}

const BINARY_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".rar",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".ico",
  ".pdf",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".flac",
  ".mov",
  ".avi",
  ".mkv",
  ".iso",
  ".dmg",
  ".pkg",
  ".msi",
  ".deb",
  ".rpm",
  ".apk",
  ".ipa",
])

export function isBinaryExtension(path: string): boolean {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return false
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

function isWindows(): boolean {
  return process.platform === "win32"
}
