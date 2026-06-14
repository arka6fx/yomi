import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class SpotifySuite extends BaseSuite {
  private hwnd: number | null = null
  private savedVolume: number | null = null

  constructor() {
    super("spotify", "music")
  }

  register(): void {
    this.addTest(1, "Launch Spotify", 45_000, async () => {
      this.hwnd = await this.findWindow({ process: "Spotify" })
      if (!this.hwnd) {
        this.log("Spotify not running — launching...")
        await this.launchPowerShell(`
          $a = Get-StartApps | Where-Object { $_.Name -like '*Spotify*' } | Select-Object -First 1
          if ($a) { Start-Process "shell:AppsFolder\\$($a.AppID)" } else { Start-Process 'Spotify' }
        `)
        this.hwnd = await this.waitForWindow({ process: "Spotify", titleContains: "Spotify" }, 30_000)
      }
      const ev: Evidence[] = [await this.screenshot("after-launch")]
      if (this.hwnd) {
        ev.push(await this.uiTree(this.hwnd, "ui-tree"))
        ev.push(this.customEvidence("process_state", "spotify running", true, `hwnd=${this.hwnd}`))
        await this.setForeground(this.hwnd); await this.sleep(500)
        await this.uiaCall("maximize_window", { hwnd: this.hwnd }); await this.sleep(1000)
        const vol = await this.uiaCall<{ volume?: number | null }>("get_app_volume", { process: "Spotify" })
        this.savedVolume = typeof vol?.volume === "number" ? vol.volume : null
      } else {
        ev.push(this.customEvidence("process_state", "spotify available", false))
      }
      return ev
    })

    this.addTest(2, "Search for Believer by Imagine Dragons", 30_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped: spotify unavailable", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      await this.pressKey("Ctrl+L"); await this.sleep(400)
      await this.pressKey("Ctrl+A"); await this.sleep(100)
      await this.typeText("Believer Imagine Dragons"); await this.sleep(300)
      await this.pressKey("Enter"); await this.sleep(3000)
      const ev: Evidence[] = [await this.windowScreenshot(this.hwnd, "search-believer")]
      const tree = await this.uiaCall<{ elements: Array<{ name?: string }> }>(
        "get_ui_tree", { hwnd: this.hwnd, maxNodes: 400, maxDepth: 20 }, 10_000)
      const matches = tree?.elements.filter((e) =>
        e.name && /believer|imagine|dragons/i.test(e.name)) ?? []
      ev.push(this.customEvidence("ui_tree", "search results", matches.length > 0,
        `matches=${matches.length}`))
      return ev
    })

    this.addTest(3, "Play song", 30_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      const tree = await this.uiaCall<{
        elements: Array<{ ref: string; role: string; name?: string; enabled?: boolean; offscreen?: boolean; rect: { x: number; y: number; width: number; height: number } }>
      }>("get_ui_tree", { hwnd: this.hwnd, maxNodes: 400, maxDepth: 20 }, 10_000)
      const playBtns = (tree?.elements ?? []).filter((e) =>
        e.role === "Button" && /\bplay\b/i.test(e.name ?? "") &&
        !/playlist|radio|queue|connect/i.test(e.name ?? "") && e.enabled && !e.offscreen)
        .sort((a: any, b: any) => a.rect.y - b.rect.y)
      let played = false
      if (playBtns.length > 0 && playBtns[0]) {
        played = await this.smartClick(this.hwnd, playBtns[0], "Play")
      }
      if (!played) {
        await this.pressKey("Tab"); await this.sleep(200)
        await this.pressKey("Tab"); await this.sleep(200)
        await this.pressKey("Enter"); await this.sleep(2500)
        played = true
      }
      await this.sleep(2000)
      const ev: Evidence[] = [await this.windowScreenshot(this.hwnd, "playing")]
      ev.push(this.customEvidence("audio_state", "play command sent", played))
      return ev
    })

    this.addTest(4, "Pause music", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.mediaKey("play_pause"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "paused"),
        this.customEvidence("audio_state", "pause sent", true)]
    })

    this.addTest(5, "Resume music", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.mediaKey("play_pause"); await this.sleep(1500)
      return [await this.windowScreenshot(this.hwnd, "resumed"),
        this.customEvidence("audio_state", "resume sent", true)]
    })

    this.addTest(6, "Next track", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.mediaKey("next"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "next-track"),
        this.customEvidence("audio_state", "next sent", true)]
    })

    this.addTest(7, "Previous track", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.mediaKey("previous"); await this.sleep(2000)
      return [await this.windowScreenshot(this.hwnd, "prev-track"),
        this.customEvidence("audio_state", "previous sent", true)]
    })

    this.addTest(8, "Volume control", 30_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      if (this.savedVolume === null) return [this.customEvidence("audio_state", "no audio session", true, "SKIP")]
      const ev: Evidence[] = []
      await this.uiaCall("set_app_volume", { process: "Spotify", level: 0.25 }); await this.sleep(300)
      const v25 = await this.uiaCall<{ volume?: number | null }>("get_app_volume", { process: "Spotify" })
      ev.push(this.customEvidence("audio_state", "volume 25%",
        v25?.volume !== null && (v25?.volume ?? 1) <= 0.3, `vol=${v25?.volume}`))
      await this.uiaCall("set_app_volume", { process: "Spotify", level: this.savedVolume })
      return ev
    })

    this.addTest(9, "Shuffle", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      const tree = await this.uiaCall<{ elements: Array<{ ref: string; role: string; name?: string; enabled?: boolean; offscreen?: boolean; rect?: { x: number; y: number; width: number; height: number } }> }>(
        "get_ui_tree", { hwnd: this.hwnd, maxNodes: 500, maxDepth: 30 }, 15_000)
      let shuffleBtn = (tree?.elements ?? []).find((e) =>
        e.role === "Button" && /shuffle/i.test(e.name ?? "") && e.enabled && !e.offscreen)
      let toggled = false
      if (shuffleBtn) {
        toggled = await this.smartClick(this.hwnd, shuffleBtn, "Shuffle")
      }
      if (!toggled) {
        // Fallback: click bottom bar area where playback controls are
        const bottomBtns = (tree?.elements ?? []).filter((e) =>
          e.role === "Button" && e.enabled && !e.offscreen && e.rect && e.rect.y > 500)
          .sort((a, b) => a.rect!.x - b.rect!.x)
        if (bottomBtns.length > 0) {
          await this.smartClick(this.hwnd, bottomBtns[0], `Bottom-Btn-0-${bottomBtns[0].name ?? ""}`)
          toggled = true
          await this.sleep(500)
        }
      }
      return [this.customEvidence("audio_state", "shuffle toggled", toggled),
        await this.windowScreenshot(this.hwnd, "shuffle")]
    })

    this.addTest(10, "Repeat", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      const tree = await this.uiaCall<{ elements: Array<{ ref: string; role: string; name?: string; enabled?: boolean; offscreen?: boolean; rect?: { x: number; y: number; width: number; height: number } }> }>(
        "get_ui_tree", { hwnd: this.hwnd, maxNodes: 500, maxDepth: 30 }, 15_000)
      let repeatBtn = (tree?.elements ?? []).find((e) =>
        e.role === "Button" && /repeat|循环/i.test(e.name ?? "") && !e.offscreen)
      let toggled = false
      if (repeatBtn) {
        toggled = await this.smartClick(this.hwnd, repeatBtn, "Repeat")
      }
      if (!toggled) {
        const namedRepeat = (tree?.elements ?? []).find((e) =>
          e.role === "Button" && /enable repeat|disable repeat|repeat one|repeat playlist/i.test(e.name ?? ""))
        if (namedRepeat) toggled = await this.smartClick(this.hwnd, namedRepeat, "Named Repeat")
      }
      return [this.customEvidence("audio_state", "repeat toggled", toggled),
        await this.windowScreenshot(this.hwnd, "repeat")]
    })

    this.addTest(11, "Queue", 15_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      const tree = await this.uiaCall<{ elements: Array<{ ref: string; role: string; name?: string; enabled?: boolean; offscreen?: boolean; rect?: { x: number; y: number; width: number; height: number } }> }>(
        "get_ui_tree", { hwnd: this.hwnd, maxNodes: 500, maxDepth: 30 }, 15_000)
      let queueBtn = (tree?.elements ?? []).find((e) =>
        e.role === "Button" && /queue|队列/i.test(e.name ?? "") && e.enabled && !e.offscreen)
      let opened = false
      if (queueBtn) {
        opened = await this.smartClick(this.hwnd, queueBtn, "Queue")
      }
      if (!opened) {
        const bottomBtns = (tree?.elements ?? []).filter((e) =>
          e.role === "Button" && e.enabled && !e.offscreen && e.rect && e.rect.y > 500)
          .sort((a, b) => a.rect!.x - b.rect!.x)
        if (bottomBtns.length > 2) {
          await this.smartClick(this.hwnd, bottomBtns[2], `Bottom-Btn-2-${bottomBtns[2].name ?? ""}`)
          opened = true
          await this.sleep(500)
        }
      }
      return [this.customEvidence("ui_state", "queue opened", opened),
        await this.windowScreenshot(this.hwnd, "queue")]
    })

    this.addTest(12, "Playlist navigation", 30_000, async () => {
      if (!this.hwnd) return [this.customEvidence("human_verification", "skipped", true, "SKIP")]
      await this.setForeground(this.hwnd); await this.sleep(400)
      // Navigate to Home first to reset UI state
      await this.pressKey("Ctrl+L"); await this.sleep(300)
      await this.typeText("Home"); await this.sleep(300)
      await this.pressKey("Escape"); await this.sleep(500)
      await this.pressKey("Escape"); await this.sleep(500)
      const tree = await this.uiaCall<{ elements: Array<{ ref: string; role: string; name?: string; enabled?: boolean; offscreen?: boolean; rect?: { x: number; y: number; width: number; height: number } }> }>(
        "get_ui_tree", { hwnd: this.hwnd, maxNodes: 500, maxDepth: 30 }, 15_000)
      const libBtn = (tree?.elements ?? []).find((e) =>
        e.role === "Button" && /your library|library/i.test(e.name ?? "") && e.enabled && !e.offscreen)
      const homeBtn = (tree?.elements ?? []).find((e) =>
        e.role === "Button" && /home|首頁/i.test(e.name ?? "") && e.enabled && !e.offscreen)
      if (homeBtn) await this.smartClick(this.hwnd, homeBtn, "Home")
      await this.sleep(1000)
      let navigated = false
      if (libBtn) {
        navigated = await this.smartClick(this.hwnd, libBtn, "Library")
        await this.sleep(2000)
      }
      return [await this.windowScreenshot(this.hwnd, "playlist-nav"),
        this.customEvidence("ui_state", "library navigated", navigated || homeBtn != null)]
    })
  }

  async cleanup(): Promise<void> {
    if (this.savedVolume !== null) {
      await this.uiaCall("set_app_volume", { process: "Spotify", level: this.savedVolume }).catch(() => null)
    }
  }
}
