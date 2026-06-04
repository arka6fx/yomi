import { AnimationEngine, type Vec2 } from "./animation-engine"
import { AgentManager, type YomiAgentSnapshot } from "./agent-manager"
import { YomiCursorSystem, type CursorSnapshot } from "./yomi-cursor-system"

export interface ClickFeedback {
  id: number
  x: number
  y: number
}

export interface YomiCompanionFrame {
  cursor: CursorSnapshot
  agents: YomiAgentSnapshot[]
  clickFeedback: ClickFeedback[]
  isPointerDown: boolean
}

export class YomiController {
  readonly animationEngine = new AnimationEngine()
  readonly cursorSystem: YomiCursorSystem
  readonly agentManager = new AgentManager()
  private frame: YomiCompanionFrame
  private listeners = new Set<(frame: YomiCompanionFrame) => void>()
  private unsubscribeEngine: (() => void) | null = null
  private clickFeedback: ClickFeedback[] = []
  private feedbackId = 1
  private isPointerDown = false

  constructor(initial: Vec2) {
    const cursor = new YomiCursorSystem(initial)
    this.cursorSystem = cursor
    const snapshot = cursor.snap(initial)
    this.frame = {
      cursor: snapshot,
      agents: [],
      clickFeedback: [],
      isPointerDown: false,
    }
  }

  subscribe(listener: (frame: YomiCompanionFrame) => void): () => void {
    this.listeners.add(listener)
    listener(this.frame)
    this.ensureRunning()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  movePointer(point: Vec2): void {
    this.cursorSystem.moveHotspot(point)
  }

  tap(point = this.frame.cursor.hotspot): void {
    const feedback = { id: this.feedbackId++, x: point.x, y: point.y }
    this.clickFeedback = [...this.clickFeedback, feedback]
    window.setTimeout(() => {
      this.clickFeedback = this.clickFeedback.filter((item) => item.id !== feedback.id)
    }, 620)
  }

  setPointerDown(down: boolean): void {
    this.isPointerDown = down
    if (down) this.tap()
  }

  spawnAgent(task = "Independent task"): string {
    return this.agentManager.spawn(task, this.frame.cursor.body)
  }

  updateAgentTask(id: string, task: string, detail?: string): void {
    this.agentManager.updateTask(id, task, detail)
  }

  setAgentState(id: string, state: "idle" | "thinking" | "working" | "waiting" | "error"): void {
    this.agentManager.setState(id, state)
  }

  selectAgent(id: string | null): void {
    this.agentManager.select(id)
  }

  private ensureRunning(): void {
    if (this.unsubscribeEngine) return
    this.unsubscribeEngine = this.animationEngine.subscribe((dt) => this.step(dt))
  }

  private stop(): void {
    this.unsubscribeEngine?.()
    this.unsubscribeEngine = null
  }

  private step(dt: number): void {
    const cursor = this.cursorSystem.step(dt)
    this.frame = {
      cursor,
      agents: this.agentManager.step(dt, { x: 78, y: 92 }),
      clickFeedback: this.clickFeedback,
      isPointerDown: this.isPointerDown,
    }
    for (const listener of this.listeners) listener(this.frame)
  }
}
