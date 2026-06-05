import React from "react"
import { AnimatePresence, motion } from "framer-motion"
import type { AutomationRun, AutomationTimelineItem } from "@yomi/shared"
import type { AutomationProviderHealth, AutomationWorkflowReplay } from "../../preload"
import { useYomiStore } from "../store"
import { ThemeCtx, UI_FONT, glassBar } from "../theme"

const PANEL_WIDTH = 360

function runGlyph(state: AutomationRun["state"]): string {
  if (state === "completed") return "✓"
  if (state === "failed") return "✗"
  if (state === "recovering") return "↻"
  return "▶"
}

function ApprovalCard() {
  const { theme: t } = React.useContext(ThemeCtx)
  const pendingAct = useYomiStore((s) => s.pendingAct)
  const clearPendingAct = useYomiStore((s) => s.clearPendingAct)
  if (!pendingAct) return null

  const resolve = (approved: boolean) => {
    window.yomi.confirmAct(pendingAct.id, approved)
    clearPendingAct()
  }
  const btn = (color: string, bg: string, border: string): React.CSSProperties => ({
    flex: 1,
    fontFamily: UI_FONT,
    fontSize: 11,
    borderRadius: 6,
    padding: "5px 0",
    color,
    background: bg,
    border: `1px solid ${border}`,
  })

  return (
    <div
      style={{
        background: t.upgradeBg,
        border: `1px solid ${t.upgradeBorder}`,
        borderRadius: 8,
        padding: "9px 10px",
        marginBottom: 10,
      }}
    >
      <div style={{ fontSize: 11, color: t.text, marginBottom: 8, lineHeight: 1.4 }}>
        <span style={{ color: t.accent }}>⚠</span> Approve action:{" "}
        <strong>{pendingAct.label}</strong>?
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => resolve(true)} style={btn(t.accent, t.accentD, t.borderHi)}>
          ✓ Approve
        </button>
        <button onClick={() => resolve(false)} style={btn(t.error, t.errorD, t.error)}>
          ✗ Deny
        </button>
      </div>
    </div>
  )
}

function Timeline({ items }: { items: AutomationTimelineItem[] }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const color = (status: AutomationTimelineItem["status"]) =>
    status === "done"
      ? t.str
      : status === "failed"
        ? t.error
        : status === "running"
          ? t.accent
          : t.dim
  const glyph = (status: AutomationTimelineItem["status"]) =>
    status === "done"
      ? "✓"
      : status === "failed"
        ? "✗"
        : status === "running"
          ? "▶"
          : status === "waiting"
            ? "⋯"
            : "•"

  return (
    <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 6 }}>
      {items.map((item) => (
        <div
          key={item.id}
          style={{ display: "flex", gap: 7, fontSize: 10.5, lineHeight: 1.5, padding: "2px 0" }}
        >
          <span style={{ flexShrink: 0, color: color(item.status) }}>{glyph(item.status)}</span>
          <span style={{ color: t.dim }}>
            {item.label}
            {item.detail ? ` - ${item.detail}` : ""}
          </span>
        </div>
      ))}
    </div>
  )
}

function ActiveMission({ run }: { run: AutomationRun }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const knowledge = useYomiStore((s) => s.knowledgePreview)
  const knowledgeGoal = useYomiStore((s) => s.knowledgePreviewGoal)
  const knowledgeStatus = useYomiStore((s) => s.knowledgePreviewStatus)
  const knowledgeError = useYomiStore((s) => s.knowledgePreviewError)
  const pct = typeof run.confidence === "number" ? Math.round(run.confidence * 100) : null
  const progress = run.step && run.maxSteps ? Math.min(1, run.step / run.maxSteps) : null
  const showKnowledge = knowledgeGoal === run.task
  const workflow = showKnowledge ? knowledge?.workflows[0] : null
  const recovery = showKnowledge ? knowledge?.recoveries[0] : null
  const meta = [
    run.step && run.maxSteps ? `step ${run.step}/${run.maxSteps}` : null,
    pct !== null ? `${pct}%` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div
      style={{
        background: t.accentD,
        border: `1px solid ${t.borderHi}`,
        borderRadius: 8,
        padding: "9px 10px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: t.accent }}>{run.owner.label}</span>
        {meta && <span style={{ fontSize: 9.5, color: t.dim }}>{meta}</span>}
      </div>
      <div style={{ fontSize: 10, color: t.text, marginTop: 3 }}>{run.currentStep || run.task}</div>
      {progress !== null && (
        <div
          style={{
            height: 3,
            borderRadius: 2,
            background: t.border,
            marginTop: 7,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress * 100}%`,
              background: t.accent,
              borderRadius: 2,
              transition: "width .3s",
            }}
          />
        </div>
      )}
      {showKnowledge && (workflow || recovery || knowledgeStatus === "loading" || knowledgeError) && (
        <div
          style={{
            marginTop: 8,
            padding: "7px 8px",
            borderRadius: 7,
            background: t.chipBgCold,
            border: `1px solid ${t.chipBorderCold}`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              alignItems: "center",
              marginBottom: 3,
            }}
          >
            <span style={{ color: t.sectionLabel, fontSize: 8.5, fontWeight: 700 }}>
              PRIOR EXPERIENCE
            </span>
            {knowledgeStatus === "loading" && <span style={{ color: t.dim, fontSize: 9 }}>checking</span>}
          </div>
          {knowledgeError ? (
            <div style={{ color: t.error, fontSize: 9.5, lineHeight: 1.35 }}>{knowledgeError}</div>
          ) : (
            <>
              {workflow && (
                <div style={{ color: t.dim, fontSize: 9.5, lineHeight: 1.35 }}>
                  Similar: {workflow.summary || workflow.goal} · {workflow.stepCount} step
                  {workflow.stepCount === 1 ? "" : "s"}
                </div>
              )}
              {recovery && (
                <div style={{ color: t.dim, fontSize: 9.5, lineHeight: 1.35, marginTop: 2 }}>
                  Fix: {recovery.strategy}
                </div>
              )}
            </>
          )}
        </div>
      )}
      {run.timeline.length > 0 && <Timeline items={run.timeline} />}
    </div>
  )
}

function RunRow({ run }: { run: AutomationRun }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const replay = useYomiStore((s) => s.replayAutomation)
  const done = run.state === "completed"
  const failed = run.state === "failed"
  const statusColor = done ? t.str : failed ? t.error : t.dim
  const statusText = done ? "done" : failed ? "failed" : run.state

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        fontSize: 10,
        padding: "7px 9px",
        borderRadius: 6,
        background: t.chipBgCold,
        border: `1px solid ${t.chipBorderCold}`,
        marginTop: 5,
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: t.chipTextCold,
        }}
      >
        {run.task}
      </span>
      <span style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
        <span style={{ color: statusColor }}>
          {runGlyph(run.state)} {statusText}
        </span>
        {run.replayId && (done || failed) && (
          <button
            onClick={() => replay(run.replayId!)}
            style={{
              fontFamily: UI_FONT,
              fontSize: 9,
              color: t.hambColor,
              background: t.hambBg,
              border: `1px solid ${t.hambBorder}`,
              borderRadius: 5,
              padding: "1px 6px",
            }}
          >
            ↺ replay
          </button>
        )}
      </span>
    </div>
  )
}

function ProviderHealthRow({ provider }: { provider: AutomationProviderHealth }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const repair = useYomiStore((s) => s.repairProvider)
  const repairingProviderId = useYomiStore((s) => s.repairingProviderId)
  const repairing = repairingProviderId === provider.id
  const diagnostics = provider.diagnostics ?? {}
  const details = [
    provider.detail,
    typeof diagnostics.platform === "string" ? diagnostics.platform : null,
    typeof diagnostics.count === "number" ? `${diagnostics.count} tools` : null,
    typeof diagnostics.total === "number" ? `${diagnostics.total} workflows` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "8px minmax(0, 1fr)",
        gap: 8,
        alignItems: "start",
        padding: "6px 7px",
        borderRadius: 6,
        background: provider.ok ? t.chipBgCold : t.errorD,
        border: `1px solid ${provider.ok ? t.chipBorderCold : t.error}`,
        marginTop: 5,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: provider.ok ? t.str : t.error,
          marginTop: 4,
          boxShadow: provider.ok ? `0 0 8px ${t.str}` : `0 0 8px ${t.error}`,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: provider.ok ? t.chipTextCold : t.error,
              fontSize: 10.5,
              fontWeight: 600,
            }}
          >
            {provider.label}
          </span>
          <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
            <span
              style={{
                color: provider.ok ? t.str : t.error,
                fontSize: 9,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {provider.ok ? "ready" : "down"}
            </span>
            {!provider.ok && (
              <button
                onClick={() => void repair(provider.id)}
                disabled={repairing}
                title="Repair provider"
                style={{
                  width: 22,
                  height: 18,
                  borderRadius: 5,
                  color: repairing ? t.dim : t.hambColor,
                  background: t.hambBg,
                  border: `1px solid ${t.hambBorder}`,
                  fontFamily: UI_FONT,
                  fontSize: 11,
                  lineHeight: 1,
                  opacity: repairing ? 0.65 : 1,
                }}
              >
                {repairing ? "…" : "↻"}
              </button>
            )}
          </div>
        </div>
        {details && (
          <div
            style={{
              color: t.dim,
              fontSize: 9.5,
              lineHeight: 1.35,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {details}
          </div>
        )}
      </div>
    </div>
  )
}

function ProviderHealth() {
  const { theme: t } = React.useContext(ThemeCtx)
  const providers = useYomiStore((s) => s.providerHealth)
  const status = useYomiStore((s) => s.providerHealthStatus)
  const error = useYomiStore((s) => s.providerHealthError)
  const updatedAt = useYomiStore((s) => s.providerHealthUpdatedAt)
  const load = useYomiStore((s) => s.loadProviderHealth)

  const updated = updatedAt
    ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null
  const label =
    status === "loading"
      ? "checking"
      : status === "error"
        ? "offline"
        : providers.some((provider) => !provider.ok)
          ? "degraded"
          : providers.length > 0
            ? "ready"
            : "unknown"

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ color: t.dim, fontSize: 10 }}>
          {label}
          {updated ? ` · ${updated}` : ""}
        </span>
        <button
          onClick={() => void load()}
          disabled={status === "loading"}
          title="Refresh provider health"
          style={{
            width: 24,
            height: 20,
            borderRadius: 5,
            color: status === "loading" ? t.dim : t.hambColor,
            background: t.hambBg,
            border: `1px solid ${t.hambBorder}`,
            fontFamily: UI_FONT,
            fontSize: 12,
            lineHeight: 1,
            opacity: status === "loading" ? 0.65 : 1,
          }}
        >
          ↻
        </button>
      </div>
      {status === "error" && error && (
        <div
          style={{
            marginTop: 5,
            color: t.error,
            background: t.errorD,
            border: `1px solid ${t.error}`,
            borderRadius: 6,
            padding: "6px 7px",
            fontSize: 10,
            lineHeight: 1.35,
          }}
        >
          {error}
        </div>
      )}
      {providers.map((provider) => (
        <ProviderHealthRow key={provider.id} provider={provider} />
      ))}
    </div>
  )
}

function WorkflowRow({ workflow }: { workflow: AutomationWorkflowReplay }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const replay = useYomiStore((s) => s.replayAutomation)
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 24px",
        gap: 7,
        alignItems: "center",
        padding: "6px 7px",
        borderRadius: 6,
        background: t.chipBgCold,
        border: `1px solid ${t.chipBorderCold}`,
        marginTop: 5,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: t.chipTextCold,
            fontSize: 10,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {workflow.task}
        </div>
        <div
          style={{
            color: t.dim,
            fontSize: 9,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginTop: 1,
          }}
        >
          {workflow.ownerLabel}
          {workflow.summary ? ` - ${workflow.summary}` : ""}
        </div>
      </div>
      <button
        onClick={() => replay(workflow.replayId)}
        title="Replay workflow"
        style={{
          width: 24,
          height: 20,
          borderRadius: 5,
          color: t.hambColor,
          background: t.hambBg,
          border: `1px solid ${t.hambBorder}`,
          fontFamily: UI_FONT,
          fontSize: 11,
          lineHeight: 1,
        }}
      >
        ↺
      </button>
    </div>
  )
}

function WorkflowCatalog() {
  const { theme: t } = React.useContext(ThemeCtx)
  const workflows = useYomiStore((s) => s.workflowCatalog)
  const status = useYomiStore((s) => s.workflowCatalogStatus)
  const error = useYomiStore((s) => s.workflowCatalogError)
  const load = useYomiStore((s) => s.loadWorkflowCatalog)
  if (status === "ready" && workflows.length === 0) return null

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ color: t.dim, fontSize: 10 }}>
          {status === "loading" ? "loading" : `${workflows.length} replayable`}
        </span>
        <button
          onClick={() => void load()}
          disabled={status === "loading"}
          title="Refresh workflows"
          style={{
            width: 24,
            height: 20,
            borderRadius: 5,
            color: status === "loading" ? t.dim : t.hambColor,
            background: t.hambBg,
            border: `1px solid ${t.hambBorder}`,
            fontFamily: UI_FONT,
            fontSize: 12,
            lineHeight: 1,
            opacity: status === "loading" ? 0.65 : 1,
          }}
        >
          ↻
        </button>
      </div>
      {status === "error" && error && (
        <div
          style={{
            marginTop: 5,
            color: t.error,
            background: t.errorD,
            border: `1px solid ${t.error}`,
            borderRadius: 6,
            padding: "6px 7px",
            fontSize: 10,
            lineHeight: 1.35,
          }}
        >
          {error}
        </div>
      )}
      {workflows.slice(0, 4).map((workflow) => (
        <WorkflowRow key={workflow.replayId} workflow={workflow} />
      ))}
    </div>
  )
}

export function MissionControl() {
  const { theme: t } = React.useContext(ThemeCtx)
  const open = useYomiStore((s) => s.missionsOpen)
  const runs = useYomiStore((s) => s.automationRuns)
  const activeId = useYomiStore((s) => s.activeAutomationRunId)
  const setOpen = useYomiStore((s) => s.setMissionsOpen)
  const loadProviderHealth = useYomiStore((s) => s.loadProviderHealth)
  const loadKnowledgePreview = useYomiStore((s) => s.loadKnowledgePreview)
  const loadWorkflowCatalog = useYomiStore((s) => s.loadWorkflowCatalog)

  const active = runs.find((run) => run.id === activeId) ?? null
  const recent = runs.filter((run) => run.id !== active?.id)

  React.useEffect(() => {
    if (open) void loadProviderHealth()
  }, [loadProviderHealth, open])

  React.useEffect(() => {
    if (open) void loadWorkflowCatalog()
  }, [loadWorkflowCatalog, open])

  React.useEffect(() => {
    if (open && active?.task) void loadKnowledgePreview(active.task)
  }, [active?.task, loadKnowledgePreview, open])

  const sectionLabel = (text: string) => (
    <div
      style={{
        fontSize: 8.5,
        letterSpacing: "0.14em",
        fontWeight: 700,
        color: t.sectionLabel,
        margin: "10px 0 6px",
      }}
    >
      {text}
    </div>
  )

  return (
    <AnimatePresence>
      {open && runs.length > 0 && (
        <motion.div
          key="mission-control"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className="yomi-hit-area no-drag"
          style={{
            marginTop: 8,
            width: PANEL_WIDTH,
            maxWidth: "calc(100vw - 40px)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              background: glassBar(t.menuBg),
              backdropFilter: "blur(28px) saturate(160%)",
              WebkitBackdropFilter: "blur(28px) saturate(160%)",
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              boxShadow: t.appShadow,
              overflow: "hidden",
              maxHeight: 460,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "9px 12px",
                borderBottom: `1px solid ${t.menuSep}`,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: UI_FONT,
                  color: t.text,
                  letterSpacing: "0.02em",
                }}
              >
                Mission Control
              </span>
              <button
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: t.dim, fontSize: 13, lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "10px 12px 12px", overflowY: "auto", fontFamily: UI_FONT }}>
              <ApprovalCard />
              {sectionLabel("PROVIDERS")}
              <ProviderHealth />
              {active && (
                <>
                  {sectionLabel("ACTIVE MISSION")}
                  <ActiveMission run={active} />
                </>
              )}
              {sectionLabel("WORKFLOWS")}
              <WorkflowCatalog />
              {recent.length > 0 && (
                <>
                  {sectionLabel("RECENT")}
                  {recent.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
