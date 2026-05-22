"use client"

import { useEffect, useState } from "react"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import Link from "next/link"

type Platform = "mac" | "windows" | "linux" | "unknown"

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("mac")) return "mac"
  if (ua.includes("win")) return "windows"
  if (ua.includes("linux")) return "linux"
  return "unknown"
}

interface DownloadOption {
  label: string
  arch: string
  href: string
  note?: string
}

const platforms: Record<
  Exclude<Platform, "unknown">,
  { title: string; icon: string; options: DownloadOption[]; instructions: string[] }
> = {
  mac: {
    title: "macOS",
    icon: "⌘",
    options: [
      {
        label: "Apple Silicon",
        arch: ".dmg",
        href: "https://github.com/arka6fx/yomi/releases/latest",
        note: "M1 / M2 / M3",
      },
      {
        label: "Intel",
        arch: ".dmg",
        href: "https://github.com/arka6fx/yomi/releases/latest",
        note: "x86_64",
      },
    ],
    instructions: [
      "Open the downloaded .dmg file",
      'Drag Yomi to your Applications folder',
      "Open Yomi from Applications",
      "Grant screen recording permission when prompted",
      "Yomi appears in your menu bar",
    ],
  },
  windows: {
    title: "Windows",
    icon: "⊞",
    options: [
      {
        label: "Installer",
        arch: ".exe",
        href: "https://github.com/arka6fx/yomi/releases/latest",
      },
      {
        label: "MSI package",
        arch: ".msi",
        href: "https://github.com/arka6fx/yomi/releases/latest",
      },
    ],
    instructions: [
      "Run the installer and follow the prompts",
      "Yomi will start automatically after install",
      "Find the Yomi icon in your system tray",
      "Grant microphone and screen permissions when prompted",
      "Press the hotkey to start",
    ],
  },
  linux: {
    title: "Linux",
    icon: "◈",
    options: [
      {
        label: "AppImage",
        arch: ".AppImage",
        href: "https://github.com/arka6fx/yomi/releases/latest",
        note: "Universal",
      },
      {
        label: "Debian / Ubuntu",
        arch: ".deb",
        href: "https://github.com/arka6fx/yomi/releases/latest",
      },
      {
        label: "Fedora / RHEL",
        arch: ".rpm",
        href: "https://github.com/arka6fx/yomi/releases/latest",
      },
    ],
    instructions: [
      "AppImage: chmod +x Yomi.AppImage && ./Yomi.AppImage",
      "Debian: sudo dpkg -i yomi.deb",
      "Fedora: sudo rpm -i yomi.rpm",
      "Add Yomi to your Waybar config for the tray icon",
      "Set your hotkey via Yomi settings",
    ],
  },
}

const allPlatforms: Exclude<Platform, "unknown">[] = ["mac", "windows", "linux"]

export default function DownloadPage() {
  const [detected, setDetected] = useState<Platform>("unknown")
  const [active, setActive] = useState<Exclude<Platform, "unknown">>("mac")

  useEffect(() => {
    const p = detectPlatform()
    setDetected(p)
    if (p !== "unknown") setActive(p)
  }, [])

  const current = platforms[active]

  return (
    <>
      <Nav />
      <main className="pt-16">
        {/* Header */}
        <section
          className="py-24 text-center"
          style={{
            background:
              "radial-gradient(ellipse 800px 500px at 50% 0%, rgba(45,212,191,0.06) 0%, transparent 70%)",
          }}
        >
          <p className="font-mono text-xs text-caption uppercase tracking-widest mb-3">
            Download
          </p>
          <h1 className="font-display text-5xl sm:text-6xl font-extrabold mb-4">
            Get Yomi.
          </h1>
          <p className="text-caption max-w-sm mx-auto px-6">
            {detected !== "unknown"
              ? `We detected ${platforms[detected as Exclude<Platform, "unknown">]?.title}. Ready to download.`
              : "Choose your platform below."}
          </p>
        </section>

        <section className="max-w-3xl mx-auto px-6 pb-24 space-y-10">
          {/* Platform tabs */}
          <div className="flex gap-2 p-1 rounded-xl bg-panel border border-edge w-fit mx-auto">
            {allPlatforms.map((p) => (
              <button
                key={p}
                onClick={() => setActive(p)}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active === p
                    ? "bg-panel-2 text-label border border-edge"
                    : "text-caption hover:text-label"
                }`}
              >
                {platforms[p].icon} {platforms[p].title}
                {detected === p && (
                  <span className="ml-2 text-[10px] text-accent font-mono">(detected)</span>
                )}
              </button>
            ))}
          </div>

          {/* Download options */}
          <div className="space-y-3">
            <h2 className="font-display text-xl font-bold">{current.title} downloads</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {current.options.map((opt) => (
                <a
                  key={opt.label}
                  href={opt.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-4 rounded-xl bg-panel border border-edge hover:border-accent/30 hover:bg-panel/80 transition-all group"
                >
                  <div>
                    <p className="font-medium text-sm text-label">{opt.label}</p>
                    {opt.note && (
                      <p className="text-xs text-caption mt-0.5">{opt.note}</p>
                    )}
                  </div>
                  <span className="font-mono text-xs text-caption group-hover:text-accent transition-colors border border-edge group-hover:border-accent/30 px-2 py-1 rounded">
                    {opt.arch}
                  </span>
                </a>
              ))}
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-3">
            <h2 className="font-display text-xl font-bold">Install instructions</h2>
            <ol className="space-y-2.5">
              {current.instructions.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="font-mono text-xs text-accent bg-accent/10 border border-accent/20 w-6 h-6 flex items-center justify-center rounded flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-sm text-caption leading-relaxed font-mono">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* GitHub note */}
          <div className="rounded-xl border border-edge p-4 bg-panel flex items-start gap-3">
            <span className="text-caption text-lg">ℹ</span>
            <div className="text-sm text-caption leading-relaxed">
              Downloads come directly from{" "}
              <a
                href="https://github.com/arka6fx/yomi/releases"
                className="text-accent hover:text-accent/80 transition-colors"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Releases
              </a>
              . Yomi is pre-release — join the{" "}
              <Link href="/#waitlist" className="text-accent hover:text-accent/80 transition-colors">
                waitlist
              </Link>{" "}
              for early access.
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
