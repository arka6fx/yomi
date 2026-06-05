import React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { YomiController, type YomiCompanionFrame } from "./yomi-controller"
import type { AgentState } from "./agent-state-machine"

const idleMascot = new URL("../assets/yomi-idle.png", import.meta.url).href
const thinkingMascot = new URL("../assets/yomi-thinking.png", import.meta.url).href
const workingMascot = new URL("../assets/yomi-working.png", import.meta.url).href
const errorMascot = new URL("../assets/yomi-error.png", import.meta.url).href

const stateAsset: Record<AgentState, string> = {
  idle: idleMascot,
  thinking: thinkingMascot,
  working: workingMascot,
  waiting: idleMascot,
  error: errorMascot,
}

const stateTask: Record<AgentState, string> = {
  idle: "Idle",
  thinking: "Thinking",
  working: "Working",
  waiting: "Waiting",
  error: "Needs attention",
}

interface YomiCompanionProps {
  enabled: boolean
  hotkeyState: "idle" | "listening" | "processing" | "text-input"
  backgroundAgentSignal?: BackgroundAgentSignal | null
}

export interface BackgroundAgentSignal {
  seq: number
  runId: string // one detached background run; multiple can coexist
  state: AgentState
  task: string
  owner?: string
  detail?: string
  step?: number
  max?: number
  done?: boolean
}

export function YomiCompanion({ enabled, hotkeyState, backgroundAgentSignal }: YomiCompanionProps) {
  const controllerRef = React.useRef<YomiController | null>(null)
  // Maps a detached background run (runId) to its spawned dock agent, so several can run at once.
  const runAgentsRef = React.useRef<Map<string, string>>(new Map())
  const lastSignalSeqRef = React.useRef(0)
  const [frame, setFrame] = React.useState<YomiCompanionFrame | null>(null)
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null)

  if (!controllerRef.current && typeof window !== "undefined") {
    controllerRef.current = new YomiController({
      x: window.innerWidth * 0.28,
      y: window.innerHeight * 0.72,
    })
  }

  React.useEffect(() => {
    if (!enabled || !controllerRef.current) return
    return controllerRef.current.subscribe(setFrame)
  }, [enabled])

  React.useEffect(() => {
    if (!enabled || !controllerRef.current) return
    const controller = controllerRef.current
    const onMove = (event: PointerEvent) =>
      controller.movePointer({ x: event.clientX, y: event.clientY })
    const onDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".yomi-companion-control")) return
      controller.movePointer({ x: event.clientX, y: event.clientY })
      controller.setPointerDown(true)
    }
    const onUp = () => controller.setPointerDown(false)

    window.addEventListener("pointermove", onMove, { passive: true })
    window.addEventListener("pointerdown", onDown, { passive: true })
    window.addEventListener("pointerup", onUp, { passive: true })
    window.addEventListener("blur", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerdown", onDown)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("blur", onUp)
    }
  }, [enabled])

  React.useEffect(() => {
    if (!enabled || !controllerRef.current) return
    if (!backgroundAgentSignal || backgroundAgentSignal.seq === lastSignalSeqRef.current) return
    lastSignalSeqRef.current = backgroundAgentSignal.seq

    const controller = controllerRef.current
    const { runId, task, state, step, max, done, owner, detail: signalDetail } = backgroundAgentSignal
    const runs = runAgentsRef.current

    let id = runs.get(runId) ?? null
    if (!id && !done) {
      id = controller.spawnAgent(task)
      runs.set(runId, id)
    }
    if (!id) return

    const detail = signalDetail ?? (step ? `Step ${step}${max ? `/${max}` : ""}` : undefined)
    controller.updateAgentTask(id, owner ?? task, detail ?? task)
    controller.setAgentState(id, state)
    if (done) {
      const finishedId = id
      window.setTimeout(() => {
        runs.delete(runId)
        controller.setAgentState(finishedId, "idle")
      }, 900)
    }
  }, [enabled, backgroundAgentSignal])

  const selectAgent = React.useCallback((id: string | null) => {
    setSelectedAgent(id)
    controllerRef.current?.selectAgent(id)
  }, [])

  if (!enabled || !frame) return null

  const activeMascot =
    hotkeyState === "processing"
      ? workingMascot
      : hotkeyState === "listening" || hotkeyState === "text-input"
        ? thinkingMascot
        : idleMascot

  return (
    <div className="yomi-companion-layer" aria-hidden={false}>
      <style>{companionCss}</style>

      {frame.clickFeedback.map((feedback) => (
        <span
          key={feedback.id}
          className="yomi-click-ripple"
          style={{ left: feedback.x, top: feedback.y }}
        />
      ))}

      {/* The mascot itself is the cursor — anchored near the pointer, no tail, no arrow tip. */}
      <motion.div
        className="yomi-body"
        animate={{
          x: frame.cursor.body.x - 18,
          y: frame.cursor.body.y - 14,
          rotate: frame.cursor.bodyRotation,
          scaleX: frame.isPointerDown ? 1.06 : 1,
          scaleY: frame.isPointerDown ? 0.94 : 1,
        }}
        transition={{ type: "spring", stiffness: 360, damping: 30, mass: 0.8 }}
      >
        <img src={activeMascot} alt="" draggable={false} />
        {hotkeyState === "listening" || hotkeyState === "text-input" ? <ThinkingDots /> : null}
        {hotkeyState === "processing" ? <span className="yomi-working-aura" /> : null}
      </motion.div>

      <AgentDock agents={frame.agents} selectedAgent={selectedAgent} onSelect={selectAgent} />
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="yomi-thinking-dots">
      <span />
      <span />
      <span />
    </div>
  )
}

function AgentDock({
  agents,
  selectedAgent,
  onSelect,
}: {
  agents: YomiCompanionFrame["agents"]
  selectedAgent: string | null
  onSelect: (id: string | null) => void
}) {
  const selected = agents.find((agent) => agent.id === selectedAgent) ?? null

  if (agents.length === 0) return null

  return (
    <div className="yomi-companion-control yomi-hit-area yomi-agent-dock">
      <div className="yomi-agent-dock-label">Agents</div>
      <div className="yomi-agent-row">
        {agents.map((agent) => (
          <button
            key={agent.id}
            className={`yomi-agent-chip is-${agent.state}${agent.selected ? " is-selected" : ""}`}
            title={`${stateTask[agent.state]}: ${agent.task}`}
            onClick={() => onSelect(agent.id === selectedAgent ? null : agent.id)}
          >
            <img src={stateAsset[agent.state]} alt="" draggable={false} />
            <AgentIndicator state={agent.state} />
          </button>
        ))}
      </div>
      <AnimatePresence>
        {selected && (
          <motion.div
            className="yomi-agent-detail"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            <strong>
              {stateTask[selected.state]}
              {selected.detail ? ` · ${selected.detail}` : ""}
            </strong>
            <span>{selected.task}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AgentIndicator({ state }: { state: AgentState }) {
  if (state === "thinking")
    return (
      <span className="agent-thinking">
        <i />
        <i />
        <i />
      </span>
    )
  if (state === "working") return <span className="agent-working" />
  if (state === "waiting") return <span className="agent-waiting" />
  if (state === "error") return <span className="agent-error">!</span>
  return <span className="agent-idle" />
}

const companionCss = `
.yomi-companion-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 10;
}
.yomi-body {
  position: absolute;
  width: 126px;
  height: 146px;
  pointer-events: none;
  transform-origin: 28% 22%;
  will-change: transform;
}
.yomi-body img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  filter: drop-shadow(0 16px 32px rgba(39, 79, 140, 0.18));
  animation: yomiIdleFloat 3.6s ease-in-out infinite;
}
.yomi-click-ripple {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  pointer-events: none;
  border: 2px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 0 1px rgba(91, 154, 224, 0.38), 0 0 26px rgba(110, 176, 244, 0.42);
  transform: translate(-50%, -50%);
  animation: yomiRipple 620ms cubic-bezier(.2, .8, .2, 1) forwards;
}
.yomi-thinking-dots {
  position: absolute;
  left: 44px;
  top: 0;
  display: flex;
  gap: 5px;
}
.yomi-thinking-dots span {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #244061;
  animation: yomiDot 900ms ease-in-out infinite;
}
.yomi-thinking-dots span:nth-child(2) { animation-delay: 120ms; }
.yomi-thinking-dots span:nth-child(3) { animation-delay: 240ms; }
.yomi-working-aura {
  position: absolute;
  inset: 28px 32px 22px;
  border-radius: 48% 48% 44% 44%;
  border: 1px solid rgba(94, 163, 239, 0.45);
  animation: yomiPulse 1.5s ease-in-out infinite;
}
.yomi-agent-dock {
  position: fixed;
  top: 92px;
  left: 18px;
  pointer-events: auto;
  z-index: 20;
}
.yomi-agent-dock-label {
  margin: 0 0 8px 6px;
  color: rgba(255,255,255,.74);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .12em;
  text-transform: uppercase;
  text-shadow: 0 1px 8px rgba(22, 39, 74, .28);
}
.yomi-agent-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 68px;
  padding: 9px;
  border: 1px solid rgba(255,255,255,.34);
  border-radius: 22px;
  background: rgba(80, 112, 169, .28);
  box-shadow: 0 18px 48px rgba(36, 67, 124, .22), inset 0 1px 0 rgba(255,255,255,.42);
  backdrop-filter: blur(24px) saturate(150%);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
}
.yomi-agent-chip {
  position: relative;
  width: 52px;
  height: 52px;
  border: 0;
  border-radius: 18px;
  background: rgba(255,255,255,.16);
  color: white;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: transform 180ms ease, background 180ms ease, box-shadow 180ms ease;
}
.yomi-agent-chip:hover {
  transform: translateX(2px);
  background: rgba(255,255,255,.26);
}
.yomi-agent-chip.is-selected {
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.68), 0 0 0 4px rgba(255,255,255,.16);
}
.yomi-agent-chip img {
  width: 50px;
  height: 50px;
  object-fit: contain;
  pointer-events: none;
}
.yomi-agent-detail {
  position: absolute;
  top: 32px;
  left: 84px;
  width: 226px;
  padding: 14px 16px;
  border-radius: 16px;
  color: rgba(255,255,255,.95);
  background: rgba(29, 45, 78, .86);
  box-shadow: 0 18px 38px rgba(18, 30, 58, .28);
}
.yomi-agent-detail::before {
  content: "";
  position: absolute;
  top: 22px;
  left: -9px;
  border-top: 10px solid transparent;
  border-bottom: 10px solid transparent;
  border-right: 10px solid rgba(29, 45, 78, .86);
}
.yomi-agent-detail strong,
.yomi-agent-detail span {
  display: block;
  line-height: 1.35;
}
.yomi-agent-detail strong {
  font-size: 13px;
  letter-spacing: .03em;
  text-transform: uppercase;
  opacity: .78;
  margin-bottom: 4px;
}
.yomi-agent-detail span {
  font-size: 14px;
}
.agent-idle,
.agent-working,
.agent-waiting,
.agent-error,
.agent-thinking {
  position: absolute;
  right: 7px;
  bottom: 7px;
}
.agent-idle,
.agent-working,
.agent-waiting {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}
.agent-idle { background: #9dc6ff; }
.agent-working {
  background: #74f2b0;
  box-shadow: 0 0 0 0 rgba(116,242,176,.55);
  animation: agentPulse 1.2s ease-in-out infinite;
}
.agent-waiting {
  background: #ffd36e;
  animation: agentBounce 1.4s ease-in-out infinite;
}
.agent-error {
  width: 17px;
  height: 17px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: #ff4e5f;
  color: white;
  font-size: 12px;
  font-weight: 800;
}
.agent-thinking {
  display: flex;
  gap: 2px;
}
.agent-thinking i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #233d64;
  animation: yomiDot 900ms ease-in-out infinite;
}
.agent-thinking i:nth-child(2) { animation-delay: 110ms; }
.agent-thinking i:nth-child(3) { animation-delay: 220ms; }
@keyframes yomiIdleFloat {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-5px) scale(1.012); }
}
@keyframes yomiRipple {
  0% { opacity: .9; width: 12px; height: 12px; }
  100% { opacity: 0; width: 92px; height: 92px; }
}
@keyframes yomiDot {
  0%, 80%, 100% { transform: translateY(0); opacity: .35; }
  40% { transform: translateY(-7px); opacity: 1; }
}
@keyframes yomiPulse {
  0%, 100% { opacity: .28; transform: scale(.94); }
  50% { opacity: .75; transform: scale(1.08); }
}
@keyframes agentPulse {
  0% { box-shadow: 0 0 0 0 rgba(116,242,176,.55); }
  100% { box-shadow: 0 0 0 9px rgba(116,242,176,0); }
}
@keyframes agentBounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
`
