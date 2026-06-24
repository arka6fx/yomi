// URL-safety and binary-extension checks for fetch/tool outputs. Pure module.

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
