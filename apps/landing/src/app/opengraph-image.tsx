import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "Yomi: AI assistant for your screen, voice, and apps"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#050914",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          padding: "72px 80px",
          position: "relative",
        }}
      >
        {/* Subtle radial glow */}
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -80,
            width: 700,
            height: 500,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(56,189,248,0.12) 0%, transparent 65%)",
          }}
        />

        {/* Badge */}
        <div
          style={{
            display: "flex",
            marginBottom: 28,
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 99,
            padding: "6px 18px",
            fontSize: 15,
            color: "rgba(255,255,255,0.55)",
            fontFamily: "sans-serif",
          }}
        >
          Early access · Windows
        </div>

        {/* Wordmark */}
        <div
          style={{
            fontSize: 130,
            fontWeight: 500,
            color: "#eaf4ff",
            lineHeight: 0.85,
            marginBottom: 36,
            fontFamily: "Georgia, serif",
            letterSpacing: "-2px",
          }}
        >
          Yomi
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 26,
            color: "rgba(255,255,255,0.55)",
            maxWidth: 720,
            lineHeight: 1.45,
            fontFamily: "sans-serif",
            fontWeight: 400,
          }}
        >
          AI assistant that sees your screen, hears your voice, and connects to Gmail, Calendar,
          Drive, GitHub, Slack &amp; more.
        </div>

        {/* Domain */}
        <div
          style={{
            marginTop: 44,
            fontSize: 16,
            color: "rgba(255,255,255,0.28)",
            fontFamily: "sans-serif",
            letterSpacing: "0.04em",
          }}
        >
          yomi.arka6fx.com
        </div>
      </div>
    ),
    size,
  )
}
