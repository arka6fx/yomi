import { BaseSuite } from "../suite.js"
import type { Evidence } from "../types.js"

export class MediaControlsSuite extends BaseSuite {
  constructor() {
    super("media-controls", "media")
  }

  register(): void {
    // Each test runs 20 times to meet the 20-execution threshold
    const ITERATIONS = 20

    this.addTest(1, `Play/Pause (${ITERATIONS}x)`, 120_000, async () => {
      const ev: Evidence[] = []
      let passed = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await this.mediaKey("play_pause")
        if (r) passed++
        await this.sleep(200)
      }
      const rate = Math.round((passed / ITERATIONS) * 100)
      ev.push(this.customEvidence("audio_state", `play_pause ${passed}/${ITERATIONS}`, rate >= 95,
        `rate=${rate}%`))
      return ev
    }, ITERATIONS)

    this.addTest(2, `Next Track (${ITERATIONS}x)`, 120_000, async () => {
      const ev: Evidence[] = []
      let passed = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await this.mediaKey("next")
        if (r) passed++
        await this.sleep(200)
      }
      const rate = Math.round((passed / ITERATIONS) * 100)
      ev.push(this.customEvidence("audio_state", `next ${passed}/${ITERATIONS}`, rate >= 95,
        `rate=${rate}%`))
      return ev
    }, ITERATIONS)

    this.addTest(3, `Previous Track (${ITERATIONS}x)`, 120_000, async () => {
      const ev: Evidence[] = []
      let passed = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await this.mediaKey("previous")
        if (r) passed++
        await this.sleep(200)
      }
      const rate = Math.round((passed / ITERATIONS) * 100)
      ev.push(this.customEvidence("audio_state", `previous ${passed}/${ITERATIONS}`, rate >= 95,
        `rate=${rate}%`))
      return ev
    })

    this.addTest(4, `Volume Up (${ITERATIONS}x)`, 120_000, async () => {
      const ev: Evidence[] = []
      let passed = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await this.mediaKey("volume_up")
        if (r) passed++
        await this.sleep(200)
      }
      const rate = Math.round((passed / ITERATIONS) * 100)
      ev.push(this.customEvidence("audio_state", `volume_up ${passed}/${ITERATIONS}`, rate >= 95,
        `rate=${rate}%`))
      return ev
    }, ITERATIONS)

    this.addTest(5, `Volume Down (${ITERATIONS}x)`, 120_000, async () => {
      const ev: Evidence[] = []
      let passed = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await this.mediaKey("volume_down")
        if (r) passed++
        await this.sleep(200)
      }
      const rate = Math.round((passed / ITERATIONS) * 100)
      ev.push(this.customEvidence("audio_state", `volume_down ${passed}/${ITERATIONS}`, rate >= 95,
        `rate=${rate}%`))
      return ev
    }, ITERATIONS)

    this.addTest(6, `Mute (${ITERATIONS}x)`, 120_000, async () => {
      const ev: Evidence[] = []
      let passed = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const r = await this.mediaKey("volume_mute")
        if (r) passed++
        await this.sleep(200)
      }
      const rate = Math.round((passed / ITERATIONS) * 100)
      ev.push(this.customEvidence("audio_state", `mute ${passed}/${ITERATIONS}`, rate >= 95,
        `rate=${rate}%`))
      return ev
    }, ITERATIONS)
  }
}
