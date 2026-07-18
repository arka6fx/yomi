// Per-connector backend selection (native vs Composio). This is the phasing and
// rollback switch: a connector id listed in COMPOSIO_CONNECTORS is served by its
// Composio-backed def; every other connector keeps its hand-rolled implementation.
// Flipping a connector back to native is an env change — no redeploy of new code.
//
// Example: COMPOSIO_CONNECTORS=linear

export function composioBackedConnectors(): Set<string> {
  const raw = (typeof process !== "undefined" && process.env["COMPOSIO_CONNECTORS"]) || ""
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isComposioBacked(connectorId: string): boolean {
  return composioBackedConnectors().has(connectorId.toLowerCase())
}
