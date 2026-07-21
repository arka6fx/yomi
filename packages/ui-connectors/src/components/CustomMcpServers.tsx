"use client"

import { useState } from "react"
import type { ConnectorTheme } from "../types"

export interface CustomMcpServerInfo {
  id: string
  name: string
  url: string
}

export function CustomMcpServers({
  servers,
  theme: t,
  onAdd,
  onDelete,
  adding,
  addError,
}: {
  servers: CustomMcpServerInfo[]
  theme: ConnectorTheme
  onAdd: (input: { name: string; url: string; apiKey: string }) => void
  onDelete: (id: string) => void
  adding?: boolean
  addError?: string
}) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [apiKey, setApiKey] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !url.trim()) return
    onAdd({ name: name.trim(), url: url.trim(), apiKey: apiKey.trim() })
    setName("")
    setUrl("")
    setApiKey("")
  }

  const inputStyle = {
    width: "100%",
    background: t.btnBg,
    border: `1px solid ${t.border}`,
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 12,
    color: t.text,
    fontFamily: t.font,
    boxSizing: "border-box" as const,
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          fontWeight: 700,
          color: t.dim,
          textTransform: "uppercase" as const,
          fontFamily: t.font,
          marginBottom: 12,
        }}
      >
        Custom MCP Servers
      </div>

      {servers.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {servers.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 8px",
                borderBottom: `1px solid ${t.border}`,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text, fontFamily: t.font }}>
                  {s.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.dim,
                    fontFamily: t.font,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  {s.url}
                </div>
              </div>
              <button
                onClick={() => onDelete(s.id)}
                style={{
                  fontFamily: t.font,
                  fontSize: 11,
                  fontWeight: 600,
                  color: t.dim,
                  background: "transparent",
                  border: `1px solid ${t.border}`,
                  borderRadius: 6,
                  padding: "4px 10px",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Integration name"
          style={inputStyle}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mcp.example.com/mcp"
          style={inputStyle}
        />
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="API key (optional)"
          type="password"
          style={inputStyle}
        />
        <p style={{ fontSize: 10, color: t.dim, fontFamily: t.font, margin: 0 }}>
          Leave the API key empty if the server doesn't require auth.
        </p>
        {addError && (
          <p style={{ fontSize: 11, color: t.error, fontFamily: t.font, margin: 0 }}>
            {addError}
          </p>
        )}
        <button
          type="submit"
          disabled={adding}
          style={{
            alignSelf: "flex-start",
            fontFamily: t.font,
            fontSize: 11,
            fontWeight: 600,
            color: t.btnText,
            background: t.btnBg,
            border: `1px solid ${t.border}`,
            borderRadius: 6,
            padding: "6px 14px",
            cursor: "pointer",
          }}
        >
          {adding ? "Adding..." : "Connect"}
        </button>
      </form>
    </div>
  )
}
