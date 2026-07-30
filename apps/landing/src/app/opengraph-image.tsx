import { ImageResponse } from "next/og"

export const alt = "Yomi: AI assistant on Telegram for your apps"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        background: "linear-gradient(180deg, #fdfbf5 0%, #faf7f0 45%, #f5f1e6 100%)",
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
      {/* Subtle blue wash, echoes the site-texture-bg-light glow */}
      <div
        style={{
          position: "absolute",
          top: -80,
          left: -80,
          width: 700,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 65%)",
        }}
      />

      {/* Brand mark + badge row */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
        <img
          src="https://getyomi.in/android-chrome-192x192.png"
          alt=""
          width={56}
          height={56}
          style={{ borderRadius: 14, marginRight: 20 }}
        />
        <div
          style={{
            display: "flex",
            background: "rgba(0,0,0,0.05)",
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 99,
            padding: "6px 18px",
            fontSize: 15,
            color: "rgba(0,0,0,0.5)",
            fontFamily: "sans-serif",
          }}
        >
          Early access · On Telegram
        </div>
      </div>

      {/* Wordmark */}
      <div
        style={{
          fontSize: 130,
          fontWeight: 500,
          color: "#212121",
          lineHeight: 0.85,
          marginBottom: 32,
          fontFamily: "serif",
          letterSpacing: "-2px",
        }}
      >
        Yomi
      </div>

      {/* Tagline */}
      <div
        style={{
          fontSize: 26,
          color: "rgba(0,0,0,0.55)",
          maxWidth: 760,
          lineHeight: 1.45,
          fontFamily: "sans-serif",
          fontWeight: 400,
        }}
      >
        AI assistant on Telegram that connects to Gmail, Calendar, Drive, GitHub, Slack &amp;
        Notion. Text, talk, or send a photo — Yomi asks before it changes anything.
      </div>

      {/* Domain */}
      <div
        style={{
          marginTop: 40,
          fontSize: 16,
          color: "rgba(0,0,0,0.32)",
          fontFamily: "sans-serif",
          letterSpacing: "0.04em",
        }}
      >
        getyomi.in
      </div>
    </div>,
    size,
  )
}
