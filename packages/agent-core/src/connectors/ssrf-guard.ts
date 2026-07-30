import { isIPv4, isIPv6 } from "node:net"

// RFC1918 private ranges, loopback, link-local (includes cloud metadata endpoints
// like 169.254.169.254), CGNAT, and other reserved ranges a user-supplied server
// URL must never resolve to. The backend makes a real outbound request to
// whatever host this resolves to (mcp-connector.ts's MCP client), so an
// unchecked URL is a direct SSRF vector into internal infrastructure.
const IPV4_BLOCKED_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata (e.g. EC2 IMDS)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
]

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0
}

export function isBlockedIPv4(ip: string): boolean {
  const target = ipv4ToInt(ip)
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return (target & mask) === (ipv4ToInt(base) & mask)
  })
}

export function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === "::1") return true // loopback
  if (["fe8", "fe9", "fea", "feb"].some((p) => lower.startsWith(p))) return true // fe80::/10 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true // fc00::/7 unique-local
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) // IPv4-mapped IPv6
  if (mapped?.[1]) return isBlockedIPv4(mapped[1])
  return false
}

// Resolves a hostname (or passes a literal IP straight through) and checks every
// returned address against the blocked ranges above. Fails closed: a DNS lookup
// error is treated as disallowed rather than silently letting an unresolvable
// host through.
export async function resolvesToDisallowedAddress(hostname: string): Promise<boolean> {
  if (isIPv4(hostname)) return isBlockedIPv4(hostname)
  if (isIPv6(hostname)) return isBlockedIPv6(hostname)

  try {
    // Dynamic import (not a static top-level one) so tests can mock "node:dns"
    // per-case via mock.module before this actually runs.
    const { promises: dns } = await import("node:dns")
    const addresses = await dns.lookup(hostname, { all: true })
    return addresses.some((a) =>
      a.family === 4 ? isBlockedIPv4(a.address) : isBlockedIPv6(a.address),
    )
  } catch {
    return true
  }
}
