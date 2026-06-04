import { SpringValue, type Vec2 } from "./animation-engine"
import { AgentStateMachine, type AgentState } from "./agent-state-machine"

export interface YomiAgentSnapshot {
  id: string
  task: string
  detail?: string
  state: AgentState
  position: Vec2
  dockIndex: number
  selected: boolean
}

class YomiAgent {
  readonly id: string
  task: string
  detail?: string
  readonly machine: AgentStateMachine
  readonly spring: SpringValue
  dockIndex: number
  selected = false

  constructor(id: string, task: string, from: Vec2, dockIndex: number) {
    this.id = id
    this.task = task
    this.dockIndex = dockIndex
    this.machine = new AgentStateMachine("thinking")
    this.spring = new SpringValue(from, { stiffness: 190, damping: 23, mass: 1 })
  }

  step(dt: number, target: Vec2): YomiAgentSnapshot {
    this.spring.setTarget(target)
    const position = this.spring.step(dt)
    return {
      id: this.id,
      task: this.task,
      detail: this.detail,
      state: this.machine.state,
      position: { ...position },
      dockIndex: this.dockIndex,
      selected: this.selected,
    }
  }
}

export class AgentManager {
  private agents: YomiAgent[] = []
  private nextId = 1

  spawn(task: string, from: Vec2): string {
    const id = `agent-${this.nextId++}`
    const agent = new YomiAgent(id, task, from, this.agents.length)
    this.agents.push(agent)
    window.setTimeout(() => agent.machine.transition("working"), 950)
    return id
  }

  updateTask(id: string, task: string, detail?: string): void {
    const agent = this.agents.find((item) => item.id === id)
    if (agent) {
      agent.task = task
      agent.detail = detail
    }
  }

  setState(id: string, state: AgentState): void {
    this.agents.find((agent) => agent.id === id)?.machine.transition(state)
  }

  select(id: string | null): void {
    for (const agent of this.agents) agent.selected = agent.id === id
  }

  step(dt: number, dockOrigin: Vec2): YomiAgentSnapshot[] {
    return this.agents.map((agent, index) => {
      agent.dockIndex = index
      return agent.step(dt, {
        x: dockOrigin.x,
        y: dockOrigin.y + index * 62,
      })
    })
  }

  get count(): number {
    return this.agents.length
  }
}
