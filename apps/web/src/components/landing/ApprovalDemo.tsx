"use client"

import { useEffect, useRef, useState } from "react"
import { CheckCheck, RotateCcw } from "lucide-react"
import { TG, WALLPAPER } from "@/components/landing/telegram-theme"

// Mirrors the bot's real approval prompt (gateway/telegram.py send_approval_prompt):
// "Approval needed", the action title, a preview, then Approve / Reject buttons.
// Afterwards the bot replies "Done: <title>" or "Cancelled: <title>".
const TITLE = "Email to Sarah Chen"
const PREVIEW = `to: sarah@northwind.co
subject: the deck, finally

hey sarah, sorry this is late. deck attached, the pricing slide is new. happy to walk through it thursday.`

type Stage = "waiting" | "working" | "done" | "cancelled"

export function ApprovalDemo() {
  const [stage, setStage] = useState<Stage>("waiting")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  function approve() {
    setStage("working")
    timer.current = setTimeout(() => setStage("done"), 1100)
  }

  const decided = stage !== "waiting"

  return (
    <div
      className="overflow-hidden rounded-[2rem] shadow-[0_40px_80px_-30px_rgba(10,20,40,0.55)] ring-8 ring-[#16181d]"
      style={{ backgroundColor: TG.bg, backgroundImage: WALLPAPER, color: TG.text }}
    >
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: TG.bar }}>
        <img
          src="/brand-mark-128.png"
          alt=""
          width={36}
          height={36}
          className="size-9 rounded-full bg-[#3fb0f0] object-contain p-0.5"
        />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold">yomi</p>
          <p className="text-[13px]" style={{ color: stage === "working" ? TG.accent : TG.muted }}>
            {stage === "working" ? "sending…" : "bot"}
          </p>
        </div>
      </div>

      <div className="space-y-2 px-3 py-4 text-[14.5px] leading-snug" aria-live="polite">
        <div className="flex justify-end">
          <p
            className="max-w-[82%] rounded-2xl rounded-br-[4px] px-3 py-1.5 shadow-[0_1px_1px_rgba(0,0,0,0.13)]"
            style={{ background: TG.outgoing }}
          >
            email sarah the deck, say sorry it&apos;s late
            <span
              className="float-right ml-2 mt-1.5 inline-flex translate-y-0.5 items-center gap-0.5 text-[11px]"
              style={{ color: TG.outMuted }}
            >
              9:41 AM <CheckCheck size={14} aria-hidden />
            </span>
          </p>
        </div>

        <div className="max-w-[88%]">
          <div
            className="rounded-2xl rounded-bl-[4px] px-3 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.13)]"
            style={{ background: TG.incoming }}
          >
            <p className="font-semibold">Approval needed</p>
            <p>{TITLE}</p>
            <p className="mt-2 whitespace-pre-line text-[13.5px] opacity-80">{PREVIEW}</p>
            <p className="mt-1 text-right text-[11px]" style={{ color: TG.muted }}>
              9:41 AM
            </p>
          </div>
          {/* the inline keyboard, exactly two buttons like the real bot */}
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={approve}
              disabled={decided}
              className="rounded-lg bg-[rgba(62,96,52,0.32)] py-2 text-[13px] font-semibold text-white transition-colors enabled:hover:bg-[rgba(62,96,52,0.45)] disabled:opacity-50"
            >
              ✅ Approve
            </button>
            <button
              type="button"
              onClick={() => setStage("cancelled")}
              disabled={decided}
              className="rounded-lg bg-[rgba(62,96,52,0.32)] py-2 text-[13px] font-semibold text-white transition-colors enabled:hover:bg-[rgba(62,96,52,0.45)] disabled:opacity-50"
            >
              ✖️ Reject
            </button>
          </div>
        </div>

        {stage === "working" && (
          <p className="flex justify-center pt-1">
            <span
              className="rounded-full px-3 py-1 text-[12px] text-white"
              style={{ background: TG.glass }}
            >
              Working on it…
            </span>
          </p>
        )}

        {(stage === "done" || stage === "cancelled") && (
          <div className="flex">
            <p
              className="max-w-[82%] rounded-2xl rounded-bl-[4px] px-3 py-1.5 shadow-[0_1px_1px_rgba(0,0,0,0.13)]"
              style={{ background: TG.incoming }}
            >
              {stage === "done" ? `Done: ${TITLE}` : `Cancelled: ${TITLE}`}
              <span
                className="float-right ml-2 mt-1.5 translate-y-0.5 text-[11px]"
                style={{ color: TG.muted }}
              >
                9:42 AM
              </span>
            </p>
          </div>
        )}

        {!decided ? (
          <p className="pt-1 text-center text-[12px] font-medium" style={{ color: "#4a6a3e" }}>
            tap a button, this one&apos;s yours to decide
          </p>
        ) : (
          stage !== "working" && (
            <p className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setStage("waiting")}
                className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-80"
                style={{ color: "#4a6a3e" }}
              >
                <RotateCcw size={12} /> try again
              </button>
            </p>
          )
        )}
      </div>
    </div>
  )
}
