import { SpringValue, type Vec2 } from "./animation-engine"

export interface CursorSnapshot {
  hotspot: Vec2
  body: Vec2
  bodyRotation: number
  speed: number
}

export class YomiCursorSystem {
  private hotspot: Vec2
  private bodySpring: SpringValue
  private lastBody: Vec2
  private bodyOffset: Vec2
  private speed = 0

  constructor(initial: Vec2) {
    this.hotspot = { ...initial }
    // Mascot rides on the pointer itself (it *is* the cursor) — no trailing offset.
    this.bodyOffset = { x: 0, y: 0 }
    this.bodySpring = new SpringValue({ ...initial }, { stiffness: 280, damping: 30, mass: 1 })
    this.lastBody = { ...this.bodySpring.value }
  }

  moveHotspot(point: Vec2): void {
    this.hotspot = { ...point }
    // Spring lag toward the pointer gives a soft follow without a tail.
    this.bodySpring.setTarget({ ...point })
  }

  step(dt: number): CursorSnapshot {
    const previous = { ...this.lastBody }
    const body = this.bodySpring.step(dt)
    const dx = body.x - previous.x
    const dy = body.y - previous.y
    this.speed = Math.hypot(dx, dy) / Math.max(dt, 0.001)
    this.lastBody = { ...body }

    const toHotspot = {
      x: this.hotspot.x - body.x,
      y: this.hotspot.y - body.y,
    }
    const rotation = Math.max(-10, Math.min(10, toHotspot.x * 0.035))
    return {
      hotspot: { ...this.hotspot },
      body: { ...body },
      bodyRotation: rotation,
      speed: this.speed,
    }
  }

  snap(point: Vec2): CursorSnapshot {
    this.hotspot = { ...point }
    const body = { x: point.x + this.bodyOffset.x, y: point.y + this.bodyOffset.y }
    this.bodySpring.snap(body)
    this.lastBody = { ...body }
    return this.step(1 / 60)
  }
}
