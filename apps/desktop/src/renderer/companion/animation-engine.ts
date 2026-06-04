export interface Vec2 {
  x: number
  y: number
}

export interface SpringConfig {
  stiffness: number
  damping: number
  mass: number
}

export class SpringValue {
  value: Vec2
  velocity: Vec2
  target: Vec2
  config: SpringConfig

  constructor(value: Vec2, config: SpringConfig) {
    this.value = { ...value }
    this.velocity = { x: 0, y: 0 }
    this.target = { ...value }
    this.config = config
  }

  setTarget(target: Vec2): void {
    this.target = { ...target }
  }

  snap(value: Vec2): void {
    this.value = { ...value }
    this.target = { ...value }
    this.velocity = { x: 0, y: 0 }
  }

  step(dt: number): Vec2 {
    const clampedDt = Math.min(dt, 1 / 30)
    const { stiffness, damping, mass } = this.config
    const ax = (-stiffness * (this.value.x - this.target.x) - damping * this.velocity.x) / mass
    const ay = (-stiffness * (this.value.y - this.target.y) - damping * this.velocity.y) / mass

    this.velocity.x += ax * clampedDt
    this.velocity.y += ay * clampedDt
    this.value.x += this.velocity.x * clampedDt
    this.value.y += this.velocity.y * clampedDt

    return this.value
  }
}

export class AnimationEngine {
  private frame: number | null = null
  private last = performance.now()
  private listeners = new Set<(dt: number, now: number) => void>()

  subscribe(listener: (dt: number, now: number) => void): () => void {
    this.listeners.add(listener)
    this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  private start(): void {
    if (this.frame !== null) return
    this.last = performance.now()
    const tick = (now: number) => {
      const dt = (now - this.last) / 1000
      this.last = now
      for (const listener of this.listeners) listener(dt, now)
      this.frame = this.listeners.size > 0 ? requestAnimationFrame(tick) : null
    }
    this.frame = requestAnimationFrame(tick)
  }

  private stop(): void {
    if (this.frame === null) return
    cancelAnimationFrame(this.frame)
    this.frame = null
  }
}
