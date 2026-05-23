"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"
import Link from "next/link"
import { Download, ArrowRight } from "lucide-react"

type Platform = "mac" | "windows" | "unknown"

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("mac")) return "mac"
  if (ua.includes("win")) return "windows"
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
      "Drag Yomi to your Applications folder",
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
}

const allPlatforms: Exclude<Platform, "unknown">[] = ["mac", "windows"]

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
      <main className="pt-6">
        {/* Header */}
        <section className="py-20 text-center px-6">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3"
          >
            Download
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="text-5xl sm:text-6xl font-light text-foreground mb-4"
            style={{ letterSpacing: "-0.04em" }}
          >
            Get Yomi.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="text-muted-foreground max-w-sm mx-auto text-sm leading-relaxed"
          >
            {detected !== "unknown"
              ? `We detected ${platforms[detected as Exclude<Platform, "unknown">]?.title}. Ready to download.`
              : "Choose your platform below."}
          </motion.p>
        </section>

        <section className="max-w-2xl mx-auto px-6 pb-24 space-y-10">
          {/* Platform tabs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="flex gap-1 p-1 rounded-xl bg-muted border border-border w-fit mx-auto"
          >
            {allPlatforms.map((p) => (
              <button
                key={p}
                onClick={() => setActive(p)}
                className={`relative px-5 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                  active === p
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active === p && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-0 rounded-lg bg-card border border-border shadow-sm"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">
                  {platforms[p].icon} {platforms[p].title}
                  {detected === p && (
                    <span className="ml-2 text-[10px] text-primary font-mono">(detected)</span>
                  )}
                </span>
              </button>
            ))}
          </motion.div>

          {/* Download options */}
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <h2
                className="text-xl font-light text-foreground"
                style={{ letterSpacing: "-0.03em" }}
              >
                {current.title} downloads
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {current.options.map((opt) => (
                  <a
                    key={opt.label}
                    href={opt.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-4 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors group"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <Download size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                        <p className="font-medium text-sm text-foreground">{opt.label}</p>
                      </div>
                      {opt.note && (
                        <p className="text-xs text-muted-foreground pl-5">{opt.note}</p>
                      )}
                    </div>
                    <span className="font-mono text-xs text-muted-foreground group-hover:text-primary transition-colors border border-border group-hover:border-primary/40 px-2 py-1 rounded-lg">
                      {opt.arch}
                    </span>
                  </a>
                ))}
              </div>

              {/* Instructions */}
              <div className="pt-4 space-y-3">
                <h2
                  className="text-xl font-light text-foreground"
                  style={{ letterSpacing: "-0.03em" }}
                >
                  Install instructions
                </h2>
                <ol className="space-y-3">
                  {current.instructions.map((step, i) => (
                    <motion.li
                      key={step}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: i * 0.06 }}
                      className="flex items-start gap-3"
                    >
                      <span className="text-xs font-mono text-primary bg-primary/10 w-6 h-6 flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-sm text-muted-foreground leading-relaxed">{step}</span>
                    </motion.li>
                  ))}
                </ol>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* GitHub note */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="rounded-xl border border-border bg-card p-4 flex items-start gap-3"
          >
            <span className="text-muted-foreground text-base leading-none mt-0.5 shrink-0">ℹ</span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Downloads come directly from{" "}
              <a
                href="https://github.com/arka6fx/yomi/releases"
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Releases
              </a>
              . Yomi is pre-release —{" "}
              <Link href="/signup" className="text-primary hover:underline">
                sign up for early access
                <ArrowRight size={12} className="inline ml-0.5" />
              </Link>
            </p>
          </motion.div>
        </section>
      </main>
      <Footer />
    </>
  )
}
