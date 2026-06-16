import React, { useEffect, useRef, useMemo, useCallback, useState } from "react"
import { createRoot } from "react-dom/client"
// Bundle Caveat locally — CSP blocks the Google Fonts @import in the Electron renderer
import "@fontsource/caveat/latin-600.css"
import "@fontsource/caveat/latin-700.css"
import { AnimatePresence, motion } from "framer-motion"
import { useYomiStore } from "./store"
import type { HotkeyState, ChatEntry, SubscriptionInfo } from "./store"
import { EnergyVad } from "@yomi/shared"
import { ThemeCtx, type Theme, type ThemeId } from "./theme"
import { ConnectorIcon } from "@yomi/ui-connectors"
// import { MissionControl } from "./mission/MissionControl" // disabled — desktop automation hidden

// Hands-free voice loop tuning (renderer-side end-of-speech auto-stop).
const VAD_SILENCE_HANGOVER_MS = 800 // silence after speech before we auto-stop and process
const VAD_MAX_UTTERANCE_MS = 15000 // hard cap on a single utterance
const VAD_INACTIVITY_MS = 10000 // no speech at all → exit the loop back to idle
const TTS_PLAYBACK_GAIN = 1.45

type UpdateNotice =
  | { status: "available"; version: string; releaseDate: string }
  | { status: "downloading"; version: string }
  | { status: "downloaded"; version: string }
  | null

// Barge-in tuning — a mic-only VAD tap runs while Yomi processes/speaks so the
// user can talk over it. Thresholds are deliberately stricter than the listening
// ── Theme System ───────────────────────────────────────────────────────────────

const AMBER: Theme = {
  id: "amber",
  label: "Amber",
  bg: "rgb(0,0,0)",
  surface: "rgb(1,1,1)",
  border: "rgba(255,224,194,0.09)",
  borderHi: "rgba(255,224,194,0.18)",
  text: "rgba(238,233,224,1)",
  dim: "rgba(175,163,145,0.9)",
  accent: "#ffe0c2",
  accentD: "rgba(255,224,194,0.1)",
  accentG: "rgba(255,200,130,0.22)",
  error: "#ff8c65",
  errorD: "rgba(255,140,101,0.12)",
  codeBg: "rgba(9,8,6,1)",
  kw: "#ffd099",
  str: "#a3c9a8",
  num: "#ffb870",
  cmt: "rgba(145,128,95,0.65)",
  fn: "#ffe0c2",
  codeText: "rgba(208,196,178,1)",
  toolbarBg: "rgb(0,0,0)",
  menuBg: "rgb(0,0,0)",
  menuBorder: "rgba(255,224,194,0.1)",
  menuShadow: "0 12px 40px rgba(0,0,0,0.65), 0 0 0 0.5px rgba(255,224,194,0.04)",
  menuSep: "rgba(255,224,194,0.06)",
  sectionLabel: "rgba(255,200,130,0.6)",
  btnText: "rgba(220,210,195,0.88)",
  btnHoverBg: "rgba(255,224,194,0.09)",
  btnHoverText: "rgba(255,240,220,1)",
  dangerText: "rgba(255,120,90,0.85)",
  dangerHoverBg: "rgba(255,100,70,0.1)",
  upgradeText: "rgba(255,210,140,0.95)",
  upgradeBg: "rgba(255,200,130,0.07)",
  upgradeBgHover: "rgba(255,200,130,0.13)",
  upgradeBorder: "rgba(255,200,130,0.2)",
  dotIdle: "rgba(255,224,194,0.18)",
  dotPulse: "#ffe0c2",
  dotPulseGlow: "0 0 8px 2px rgba(255,200,130,0.6)",
  dotSpinFaint: "rgba(255,224,194,0.08)",
  dotSpinBright: "rgba(255,200,130,0.8)",
  lblIdle: "rgba(255,224,194,0.55)",
  lblActive: "rgba(255,220,180,0.92)",
  lblProcessing: "rgba(225,210,185,0.85)",
  planText: "rgba(200,185,155,0.65)",
  planBorder: "rgba(255,224,194,0.15)",
  ttsOn: "rgba(255,224,194,0.6)",
  ttsOff: "rgba(175,155,115,0.35)",
  ttsHoverBg: "rgba(255,224,194,0.07)",
  hambBg: "rgba(255,224,194,0.06)",
  hambBgActive: "rgba(255,224,194,0.12)",
  hambBorder: "rgba(255,224,194,0.18)",
  hambBorderActive: "rgba(255,224,194,0.28)",
  hambColor: "rgba(255,224,194,0.7)",
  hambColorActive: "rgba(255,224,194,1)",
  chipBgHot: "rgba(255,224,194,0.08)",
  chipBgCold: "rgba(255,224,194,0.03)",
  chipBorderHot: "rgba(255,200,130,0.28)",
  chipBorderCold: "rgba(255,224,194,0.07)",
  chipTextHot: "rgba(255,224,194,1)",
  chipTextCold: "rgba(220,210,195,0.8)",
  kbdBg: "rgba(255,224,194,0.08)",
  kbdBorder: "rgba(255,224,194,0.16)",
  kbdBorderB: "rgba(255,224,194,0.2)",
  kbdText: "rgba(255,224,194,0.8)",
  dragDot: "rgba(255,224,194,1)",
  appBorder: "1px solid rgba(255,224,194,0.09)",
  appBorderListen: "1px solid rgba(255,200,130,0.22)",
  appShadow: "0 2px 8px rgba(0,0,0,0.28), 0 0 0 0.5px rgba(255,224,194,0.04)",
  appShadowListen: "0 0 0 1px rgba(255,200,130,0.06), 0 2px 8px rgba(0,0,0,0.3)",
  scrollThumb: "rgba(255,224,194,0.18)",
  scrollThumbHover: "rgba(255,224,194,0.35)",
  sliderTrack: "rgba(255,224,194,0.1)",
  sliderThumb: "rgba(255,224,194,0.75)",
  sliderThumbBorder: "rgba(255,200,130,0.4)",
  sliderShadow: "0 0 4px rgba(255,200,130,0.3)",
  sliderHoverShadow: "0 0 8px rgba(255,200,130,0.55)",
  selectionBg: "rgba(255,224,194,0.2)",
  placeholder: "rgba(200,185,160,0.45)",
}

const BLUE: Theme = {
  id: "blue",
  label: "Blue",
  bg: "rgb(5,9,20)",
  surface: "rgb(8,14,30)",
  border: "rgba(59,130,246,0.14)",
  borderHi: "rgba(59,130,246,0.28)",
  text: "rgba(226,232,240,1)",
  dim: "rgba(148,163,184,0.9)",
  accent: "#93C5FD",
  accentD: "rgba(59,130,246,0.12)",
  accentG: "rgba(59,130,246,0.2)",
  error: "#f87171",
  errorD: "rgba(239,68,68,0.12)",
  codeBg: "rgba(3,7,18,1)",
  kw: "#7DD3FC",
  str: "#86EFAC",
  num: "#FCA5A5",
  cmt: "rgba(100,116,139,0.7)",
  fn: "#C4B5FD",
  codeText: "rgba(203,213,225,1)",
  toolbarBg: "rgb(5,9,22)",
  menuBg: "rgb(5,9,22)",
  menuBorder: "rgba(59,130,246,0.2)",
  menuShadow: "0 12px 40px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(59,130,246,0.06)",
  menuSep: "rgba(59,130,246,0.1)",
  sectionLabel: "rgba(96,165,250,0.7)",
  btnText: "rgba(203,213,225,0.88)",
  btnHoverBg: "rgba(59,130,246,0.1)",
  btnHoverText: "rgba(226,232,240,1)",
  dangerText: "rgba(252,165,165,0.85)",
  dangerHoverBg: "rgba(239,68,68,0.1)",
  upgradeText: "rgba(147,197,253,0.95)",
  upgradeBg: "rgba(59,130,246,0.08)",
  upgradeBgHover: "rgba(59,130,246,0.16)",
  upgradeBorder: "rgba(59,130,246,0.3)",
  dotIdle: "rgba(59,130,246,0.35)",
  dotPulse: "#60A5FA",
  dotPulseGlow: "0 0 8px 2px rgba(59,130,246,0.6)",
  dotSpinFaint: "rgba(59,130,246,0.1)",
  dotSpinBright: "rgba(96,165,250,0.85)",
  lblIdle: "rgba(96,165,250,0.6)",
  lblActive: "rgba(147,197,253,0.92)",
  lblProcessing: "rgba(186,200,220,0.85)",
  planText: "rgba(148,163,184,0.65)",
  planBorder: "rgba(59,130,246,0.2)",
  ttsOn: "rgba(96,165,250,0.7)",
  ttsOff: "rgba(71,85,105,0.5)",
  ttsHoverBg: "rgba(59,130,246,0.08)",
  hambBg: "rgba(59,130,246,0.07)",
  hambBgActive: "rgba(59,130,246,0.16)",
  hambBorder: "rgba(59,130,246,0.22)",
  hambBorderActive: "rgba(59,130,246,0.4)",
  hambColor: "rgba(96,165,250,0.75)",
  hambColorActive: "rgba(147,197,253,1)",
  chipBgHot: "rgba(59,130,246,0.14)",
  chipBgCold: "rgba(59,130,246,0.05)",
  chipBorderHot: "rgba(96,165,250,0.35)",
  chipBorderCold: "rgba(59,130,246,0.14)",
  chipTextHot: "rgba(147,197,253,1)",
  chipTextCold: "rgba(186,200,220,0.8)",
  kbdBg: "rgba(59,130,246,0.1)",
  kbdBorder: "rgba(59,130,246,0.22)",
  kbdBorderB: "rgba(59,130,246,0.32)",
  kbdText: "rgba(147,197,253,0.85)",
  dragDot: "rgba(96,165,250,1)",
  appBorder: "1px solid rgba(59,130,246,0.14)",
  appBorderListen: "1px solid rgba(96,165,250,0.32)",
  appShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(59,130,246,0.06)",
  appShadowListen: "0 0 0 1px rgba(96,165,250,0.1), 0 2px 8px rgba(0,0,0,0.3)",
  scrollThumb: "rgba(59,130,246,0.25)",
  scrollThumbHover: "rgba(96,165,250,0.45)",
  sliderTrack: "rgba(59,130,246,0.15)",
  sliderThumb: "rgba(96,165,250,0.85)",
  sliderThumbBorder: "rgba(59,130,246,0.5)",
  sliderShadow: "0 0 4px rgba(59,130,246,0.4)",
  sliderHoverShadow: "0 0 8px rgba(96,165,250,0.65)",
  selectionBg: "rgba(59,130,246,0.25)",
  placeholder: "rgba(148,163,184,0.45)",
}

const GREEN: Theme = {
  id: "green",
  label: "Green",
  bg: "rgb(2,10,4)",
  surface: "rgb(4,15,6)",
  border: "rgba(34,197,94,0.15)",
  borderHi: "rgba(34,197,94,0.3)",
  text: "rgba(220,252,231,1)",
  dim: "rgba(134,168,145,0.9)",
  accent: "#86efac",
  accentD: "rgba(34,197,94,0.12)",
  accentG: "rgba(34,197,94,0.22)",
  error: "#f87171",
  errorD: "rgba(239,68,68,0.12)",
  codeBg: "rgba(1,8,3,1)",
  kw: "#86efac",
  str: "#fde68a",
  num: "#fca5a5",
  cmt: "rgba(74,120,84,0.7)",
  fn: "#bbf7d0",
  codeText: "rgba(187,247,208,0.85)",
  toolbarBg: "rgb(2,12,4)",
  menuBg: "rgb(2,12,4)",
  menuBorder: "rgba(34,197,94,0.2)",
  menuShadow: "0 12px 40px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(34,197,94,0.06)",
  menuSep: "rgba(34,197,94,0.1)",
  sectionLabel: "rgba(74,222,128,0.7)",
  btnText: "rgba(187,247,208,0.88)",
  btnHoverBg: "rgba(34,197,94,0.1)",
  btnHoverText: "rgba(220,252,231,1)",
  dangerText: "rgba(252,165,165,0.85)",
  dangerHoverBg: "rgba(239,68,68,0.1)",
  upgradeText: "rgba(134,239,172,0.95)",
  upgradeBg: "rgba(34,197,94,0.08)",
  upgradeBgHover: "rgba(34,197,94,0.16)",
  upgradeBorder: "rgba(34,197,94,0.3)",
  dotIdle: "rgba(34,197,94,0.35)",
  dotPulse: "#4ade80",
  dotPulseGlow: "0 0 8px 2px rgba(34,197,94,0.6)",
  dotSpinFaint: "rgba(34,197,94,0.1)",
  dotSpinBright: "rgba(74,222,128,0.85)",
  lblIdle: "rgba(74,222,128,0.6)",
  lblActive: "rgba(134,239,172,0.92)",
  lblProcessing: "rgba(167,220,182,0.85)",
  planText: "rgba(134,168,145,0.65)",
  planBorder: "rgba(34,197,94,0.2)",
  ttsOn: "rgba(74,222,128,0.7)",
  ttsOff: "rgba(52,90,62,0.5)",
  ttsHoverBg: "rgba(34,197,94,0.08)",
  hambBg: "rgba(34,197,94,0.07)",
  hambBgActive: "rgba(34,197,94,0.16)",
  hambBorder: "rgba(34,197,94,0.22)",
  hambBorderActive: "rgba(34,197,94,0.4)",
  hambColor: "rgba(74,222,128,0.75)",
  hambColorActive: "rgba(134,239,172,1)",
  chipBgHot: "rgba(34,197,94,0.14)",
  chipBgCold: "rgba(34,197,94,0.05)",
  chipBorderHot: "rgba(74,222,128,0.35)",
  chipBorderCold: "rgba(34,197,94,0.14)",
  chipTextHot: "rgba(134,239,172,1)",
  chipTextCold: "rgba(187,247,208,0.8)",
  kbdBg: "rgba(34,197,94,0.1)",
  kbdBorder: "rgba(34,197,94,0.22)",
  kbdBorderB: "rgba(34,197,94,0.32)",
  kbdText: "rgba(134,239,172,0.85)",
  dragDot: "rgba(74,222,128,1)",
  appBorder: "1px solid rgba(34,197,94,0.15)",
  appBorderListen: "1px solid rgba(74,222,128,0.32)",
  appShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(34,197,94,0.06)",
  appShadowListen: "0 0 0 1px rgba(74,222,128,0.1), 0 2px 8px rgba(0,0,0,0.3)",
  scrollThumb: "rgba(34,197,94,0.25)",
  scrollThumbHover: "rgba(74,222,128,0.45)",
  sliderTrack: "rgba(34,197,94,0.15)",
  sliderThumb: "rgba(74,222,128,0.85)",
  sliderThumbBorder: "rgba(34,197,94,0.5)",
  sliderShadow: "0 0 4px rgba(34,197,94,0.4)",
  sliderHoverShadow: "0 0 8px rgba(74,222,128,0.65)",
  selectionBg: "rgba(34,197,94,0.25)",
  placeholder: "rgba(134,168,145,0.45)",
}

const VIOLET: Theme = {
  id: "violet",
  label: "Violet",
  bg: "rgb(6,3,14)",
  surface: "rgb(10,5,22)",
  border: "rgba(139,92,246,0.16)",
  borderHi: "rgba(139,92,246,0.32)",
  text: "rgba(237,233,254,1)",
  dim: "rgba(167,153,210,0.9)",
  accent: "#c4b5fd",
  accentD: "rgba(139,92,246,0.12)",
  accentG: "rgba(139,92,246,0.2)",
  error: "#f87171",
  errorD: "rgba(239,68,68,0.12)",
  codeBg: "rgba(4,2,10,1)",
  kw: "#c4b5fd",
  str: "#86efac",
  num: "#fca5a5",
  cmt: "rgba(100,80,150,0.7)",
  fn: "#ddd6fe",
  codeText: "rgba(221,214,254,0.85)",
  toolbarBg: "rgb(6,3,16)",
  menuBg: "rgb(6,3,16)",
  menuBorder: "rgba(139,92,246,0.22)",
  menuShadow: "0 12px 40px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(139,92,246,0.06)",
  menuSep: "rgba(139,92,246,0.1)",
  sectionLabel: "rgba(167,139,250,0.7)",
  btnText: "rgba(221,214,254,0.88)",
  btnHoverBg: "rgba(139,92,246,0.1)",
  btnHoverText: "rgba(237,233,254,1)",
  dangerText: "rgba(252,165,165,0.85)",
  dangerHoverBg: "rgba(239,68,68,0.1)",
  upgradeText: "rgba(196,181,253,0.95)",
  upgradeBg: "rgba(139,92,246,0.08)",
  upgradeBgHover: "rgba(139,92,246,0.16)",
  upgradeBorder: "rgba(139,92,246,0.3)",
  dotIdle: "rgba(139,92,246,0.35)",
  dotPulse: "#a78bfa",
  dotPulseGlow: "0 0 8px 2px rgba(139,92,246,0.6)",
  dotSpinFaint: "rgba(139,92,246,0.1)",
  dotSpinBright: "rgba(167,139,250,0.85)",
  lblIdle: "rgba(167,139,250,0.6)",
  lblActive: "rgba(196,181,253,0.92)",
  lblProcessing: "rgba(200,190,230,0.85)",
  planText: "rgba(167,153,210,0.65)",
  planBorder: "rgba(139,92,246,0.2)",
  ttsOn: "rgba(167,139,250,0.7)",
  ttsOff: "rgba(70,50,110,0.5)",
  ttsHoverBg: "rgba(139,92,246,0.08)",
  hambBg: "rgba(139,92,246,0.07)",
  hambBgActive: "rgba(139,92,246,0.16)",
  hambBorder: "rgba(139,92,246,0.22)",
  hambBorderActive: "rgba(139,92,246,0.4)",
  hambColor: "rgba(167,139,250,0.75)",
  hambColorActive: "rgba(196,181,253,1)",
  chipBgHot: "rgba(139,92,246,0.14)",
  chipBgCold: "rgba(139,92,246,0.05)",
  chipBorderHot: "rgba(167,139,250,0.35)",
  chipBorderCold: "rgba(139,92,246,0.14)",
  chipTextHot: "rgba(196,181,253,1)",
  chipTextCold: "rgba(221,214,254,0.8)",
  kbdBg: "rgba(139,92,246,0.1)",
  kbdBorder: "rgba(139,92,246,0.22)",
  kbdBorderB: "rgba(139,92,246,0.32)",
  kbdText: "rgba(196,181,253,0.85)",
  dragDot: "rgba(167,139,250,1)",
  appBorder: "1px solid rgba(139,92,246,0.16)",
  appBorderListen: "1px solid rgba(167,139,250,0.32)",
  appShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(139,92,246,0.06)",
  appShadowListen: "0 0 0 1px rgba(167,139,250,0.1), 0 2px 8px rgba(0,0,0,0.3)",
  scrollThumb: "rgba(139,92,246,0.25)",
  scrollThumbHover: "rgba(167,139,250,0.45)",
  sliderTrack: "rgba(139,92,246,0.15)",
  sliderThumb: "rgba(167,139,250,0.85)",
  sliderThumbBorder: "rgba(139,92,246,0.5)",
  sliderShadow: "0 0 4px rgba(139,92,246,0.4)",
  sliderHoverShadow: "0 0 8px rgba(167,139,250,0.65)",
  selectionBg: "rgba(139,92,246,0.25)",
  placeholder: "rgba(167,153,210,0.45)",
}

const HOTPINK: Theme = {
  id: "hotpink",
  label: "Hot Pink",
  bg: "rgb(14,2,8)",
  surface: "rgb(20,4,12)",
  border: "rgba(236,72,153,0.16)",
  borderHi: "rgba(236,72,153,0.32)",
  text: "rgba(253,242,248,1)",
  dim: "rgba(210,140,175,0.9)",
  accent: "#f9a8d4",
  accentD: "rgba(236,72,153,0.12)",
  accentG: "rgba(236,72,153,0.2)",
  error: "#f87171",
  errorD: "rgba(239,68,68,0.12)",
  codeBg: "rgba(10,2,6,1)",
  kw: "#f9a8d4",
  str: "#86efac",
  num: "#fca5a5",
  cmt: "rgba(150,70,110,0.7)",
  fn: "#fbcfe8",
  codeText: "rgba(251,207,232,0.85)",
  toolbarBg: "rgb(14,2,9)",
  menuBg: "rgb(14,2,9)",
  menuBorder: "rgba(236,72,153,0.22)",
  menuShadow: "0 12px 40px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(236,72,153,0.06)",
  menuSep: "rgba(236,72,153,0.1)",
  sectionLabel: "rgba(244,114,182,0.7)",
  btnText: "rgba(251,207,232,0.88)",
  btnHoverBg: "rgba(236,72,153,0.1)",
  btnHoverText: "rgba(253,242,248,1)",
  dangerText: "rgba(252,165,165,0.85)",
  dangerHoverBg: "rgba(239,68,68,0.1)",
  upgradeText: "rgba(249,168,212,0.95)",
  upgradeBg: "rgba(236,72,153,0.08)",
  upgradeBgHover: "rgba(236,72,153,0.16)",
  upgradeBorder: "rgba(236,72,153,0.3)",
  dotIdle: "rgba(236,72,153,0.35)",
  dotPulse: "#f472b6",
  dotPulseGlow: "0 0 8px 2px rgba(236,72,153,0.6)",
  dotSpinFaint: "rgba(236,72,153,0.1)",
  dotSpinBright: "rgba(244,114,182,0.85)",
  lblIdle: "rgba(244,114,182,0.6)",
  lblActive: "rgba(249,168,212,0.92)",
  lblProcessing: "rgba(230,180,210,0.85)",
  planText: "rgba(210,140,175,0.65)",
  planBorder: "rgba(236,72,153,0.2)",
  ttsOn: "rgba(244,114,182,0.7)",
  ttsOff: "rgba(110,40,75,0.5)",
  ttsHoverBg: "rgba(236,72,153,0.08)",
  hambBg: "rgba(236,72,153,0.07)",
  hambBgActive: "rgba(236,72,153,0.16)",
  hambBorder: "rgba(236,72,153,0.22)",
  hambBorderActive: "rgba(236,72,153,0.4)",
  hambColor: "rgba(244,114,182,0.75)",
  hambColorActive: "rgba(249,168,212,1)",
  chipBgHot: "rgba(236,72,153,0.14)",
  chipBgCold: "rgba(236,72,153,0.05)",
  chipBorderHot: "rgba(244,114,182,0.35)",
  chipBorderCold: "rgba(236,72,153,0.14)",
  chipTextHot: "rgba(249,168,212,1)",
  chipTextCold: "rgba(251,207,232,0.8)",
  kbdBg: "rgba(236,72,153,0.1)",
  kbdBorder: "rgba(236,72,153,0.22)",
  kbdBorderB: "rgba(236,72,153,0.32)",
  kbdText: "rgba(249,168,212,0.85)",
  dragDot: "rgba(244,114,182,1)",
  appBorder: "1px solid rgba(236,72,153,0.16)",
  appBorderListen: "1px solid rgba(244,114,182,0.32)",
  appShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(236,72,153,0.06)",
  appShadowListen: "0 0 0 1px rgba(244,114,182,0.1), 0 2px 8px rgba(0,0,0,0.3)",
  scrollThumb: "rgba(236,72,153,0.25)",
  scrollThumbHover: "rgba(244,114,182,0.45)",
  sliderTrack: "rgba(236,72,153,0.15)",
  sliderThumb: "rgba(244,114,182,0.85)",
  sliderThumbBorder: "rgba(236,72,153,0.5)",
  sliderShadow: "0 0 4px rgba(236,72,153,0.4)",
  sliderHoverShadow: "0 0 8px rgba(244,114,182,0.65)",
  selectionBg: "rgba(236,72,153,0.25)",
  placeholder: "rgba(210,140,175,0.45)",
}

const PURPLE: Theme = {
  id: "purple",
  label: "Purple",
  bg: "rgb(9,3,14)",
  surface: "rgb(14,5,21)",
  border: "rgba(168,85,247,0.16)",
  borderHi: "rgba(168,85,247,0.32)",
  text: "rgba(243,232,255,1)",
  dim: "rgba(192,150,230,0.9)",
  accent: "#d8b4fe",
  accentD: "rgba(168,85,247,0.12)",
  accentG: "rgba(168,85,247,0.2)",
  error: "#f87171",
  errorD: "rgba(239,68,68,0.12)",
  codeBg: "rgba(6,2,10,1)",
  kw: "#d8b4fe",
  str: "#86efac",
  num: "#fca5a5",
  cmt: "rgba(120,80,170,0.7)",
  fn: "#e9d5ff",
  codeText: "rgba(233,213,255,0.85)",
  toolbarBg: "rgb(9,3,15)",
  menuBg: "rgb(9,3,15)",
  menuBorder: "rgba(168,85,247,0.22)",
  menuShadow: "0 12px 40px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(168,85,247,0.06)",
  menuSep: "rgba(168,85,247,0.1)",
  sectionLabel: "rgba(192,132,252,0.7)",
  btnText: "rgba(233,213,255,0.88)",
  btnHoverBg: "rgba(168,85,247,0.1)",
  btnHoverText: "rgba(243,232,255,1)",
  dangerText: "rgba(252,165,165,0.85)",
  dangerHoverBg: "rgba(239,68,68,0.1)",
  upgradeText: "rgba(216,180,254,0.95)",
  upgradeBg: "rgba(168,85,247,0.08)",
  upgradeBgHover: "rgba(168,85,247,0.16)",
  upgradeBorder: "rgba(168,85,247,0.3)",
  dotIdle: "rgba(168,85,247,0.35)",
  dotPulse: "#c084fc",
  dotPulseGlow: "0 0 8px 2px rgba(168,85,247,0.6)",
  dotSpinFaint: "rgba(168,85,247,0.1)",
  dotSpinBright: "rgba(192,132,252,0.85)",
  lblIdle: "rgba(192,132,252,0.6)",
  lblActive: "rgba(216,180,254,0.92)",
  lblProcessing: "rgba(210,180,240,0.85)",
  planText: "rgba(192,150,230,0.65)",
  planBorder: "rgba(168,85,247,0.2)",
  ttsOn: "rgba(192,132,252,0.7)",
  ttsOff: "rgba(80,40,120,0.5)",
  ttsHoverBg: "rgba(168,85,247,0.08)",
  hambBg: "rgba(168,85,247,0.07)",
  hambBgActive: "rgba(168,85,247,0.16)",
  hambBorder: "rgba(168,85,247,0.22)",
  hambBorderActive: "rgba(168,85,247,0.4)",
  hambColor: "rgba(192,132,252,0.75)",
  hambColorActive: "rgba(216,180,254,1)",
  chipBgHot: "rgba(168,85,247,0.14)",
  chipBgCold: "rgba(168,85,247,0.05)",
  chipBorderHot: "rgba(192,132,252,0.35)",
  chipBorderCold: "rgba(168,85,247,0.14)",
  chipTextHot: "rgba(216,180,254,1)",
  chipTextCold: "rgba(233,213,255,0.8)",
  kbdBg: "rgba(168,85,247,0.1)",
  kbdBorder: "rgba(168,85,247,0.22)",
  kbdBorderB: "rgba(168,85,247,0.32)",
  kbdText: "rgba(216,180,254,0.85)",
  dragDot: "rgba(192,132,252,1)",
  appBorder: "1px solid rgba(168,85,247,0.16)",
  appBorderListen: "1px solid rgba(192,132,252,0.32)",
  appShadow: "0 2px 8px rgba(0,0,0,0.3), 0 0 0 0.5px rgba(168,85,247,0.06)",
  appShadowListen: "0 0 0 1px rgba(192,132,252,0.1), 0 2px 8px rgba(0,0,0,0.3)",
  scrollThumb: "rgba(168,85,247,0.25)",
  scrollThumbHover: "rgba(192,132,252,0.45)",
  sliderTrack: "rgba(168,85,247,0.15)",
  sliderThumb: "rgba(192,132,252,0.85)",
  sliderThumbBorder: "rgba(168,85,247,0.5)",
  sliderShadow: "0 0 4px rgba(168,85,247,0.4)",
  sliderHoverShadow: "0 0 8px rgba(192,132,252,0.65)",
  selectionBg: "rgba(168,85,247,0.25)",
  placeholder: "rgba(192,150,230,0.45)",
}

const BLACK: Theme = {
  id: "black",
  label: "Black",
  bg: "rgb(0,0,0)",
  surface: "rgb(1,1,1)",
  border: "rgba(255,255,255,0.1)",
  borderHi: "rgba(255,255,255,0.2)",
  text: "rgba(226,232,240,1)",
  dim: "rgba(148,163,184,0.9)",
  accent: "#e2e8f0",
  accentD: "rgba(255,255,255,0.08)",
  accentG: "rgba(255,255,255,0.12)",
  error: "#f87171",
  errorD: "rgba(239,68,68,0.12)",
  codeBg: "rgba(0,0,0,1)",
  kw: "#93c5fd",
  str: "#86efac",
  num: "#fca5a5",
  cmt: "rgba(100,116,139,0.7)",
  fn: "#c4b5fd",
  codeText: "rgba(203,213,225,1)",
  toolbarBg: "rgb(0,0,0)",
  menuBg: "rgb(0,0,0)",
  menuBorder: "rgba(255,255,255,0.12)",
  menuShadow: "0 12px 40px rgba(0,0,0,0.9), 0 0 0 0.5px rgba(255,255,255,0.06)",
  menuSep: "rgba(255,255,255,0.07)",
  sectionLabel: "rgba(200,200,200,0.6)",
  btnText: "rgba(200,200,200,0.88)",
  btnHoverBg: "rgba(255,255,255,0.08)",
  btnHoverText: "rgba(226,232,240,1)",
  dangerText: "rgba(252,165,165,0.85)",
  dangerHoverBg: "rgba(239,68,68,0.1)",
  upgradeText: "rgba(226,232,240,0.95)",
  upgradeBg: "rgba(255,255,255,0.06)",
  upgradeBgHover: "rgba(255,255,255,0.12)",
  upgradeBorder: "rgba(255,255,255,0.2)",
  dotIdle: "rgba(255,255,255,0.2)",
  dotPulse: "#cbd5e1",
  dotPulseGlow: "0 0 8px 2px rgba(255,255,255,0.3)",
  dotSpinFaint: "rgba(255,255,255,0.08)",
  dotSpinBright: "rgba(203,213,225,0.8)",
  lblIdle: "rgba(226,232,240,0.4)",
  lblActive: "rgba(226,232,240,0.85)",
  lblProcessing: "rgba(200,200,200,0.75)",
  planText: "rgba(148,163,184,0.65)",
  planBorder: "rgba(255,255,255,0.15)",
  ttsOn: "rgba(200,210,220,0.7)",
  ttsOff: "rgba(100,100,100,0.5)",
  ttsHoverBg: "rgba(255,255,255,0.07)",
  hambBg: "rgba(255,255,255,0.05)",
  hambBgActive: "rgba(255,255,255,0.12)",
  hambBorder: "rgba(255,255,255,0.14)",
  hambBorderActive: "rgba(255,255,255,0.28)",
  hambColor: "rgba(200,200,200,0.7)",
  hambColorActive: "rgba(226,232,240,1)",
  chipBgHot: "rgba(255,255,255,0.1)",
  chipBgCold: "rgba(255,255,255,0.04)",
  chipBorderHot: "rgba(255,255,255,0.25)",
  chipBorderCold: "rgba(255,255,255,0.1)",
  chipTextHot: "rgba(226,232,240,1)",
  chipTextCold: "rgba(200,200,200,0.8)",
  kbdBg: "rgba(255,255,255,0.08)",
  kbdBorder: "rgba(255,255,255,0.16)",
  kbdBorderB: "rgba(255,255,255,0.22)",
  kbdText: "rgba(203,213,225,0.85)",
  dragDot: "rgba(200,200,200,1)",
  appBorder: "1px solid rgba(255,255,255,0.1)",
  appBorderListen: "1px solid rgba(255,255,255,0.2)",
  appShadow: "0 2px 8px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(255,255,255,0.04)",
  appShadowListen: "0 0 0 1px rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.35)",
  scrollThumb: "rgba(255,255,255,0.15)",
  scrollThumbHover: "rgba(255,255,255,0.3)",
  sliderTrack: "rgba(255,255,255,0.1)",
  sliderThumb: "rgba(200,210,220,0.85)",
  sliderThumbBorder: "rgba(255,255,255,0.3)",
  sliderShadow: "0 0 4px rgba(255,255,255,0.2)",
  sliderHoverShadow: "0 0 8px rgba(255,255,255,0.35)",
  selectionBg: "rgba(255,255,255,0.15)",
  placeholder: "rgba(148,163,184,0.45)",
}

const THEMES: Record<ThemeId, Theme> = {
  amber: AMBER,
  blue: BLUE,
  green: GREEN,
  violet: VIOLET,
  hotpink: HOTPINK,
  purple: PURPLE,
  black: BLACK,
}

const themeStyleEl = document.createElement("style")
document.head.appendChild(themeStyleEl)

function opaqueColor(color: string): string {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  return m ? `rgb(${m[1]},${m[2]},${m[3]})` : color
}

function applyTheme(t: Theme) {
  const r = document.documentElement.style
  r.setProperty("--bg", t.bg)
  r.setProperty("--surface", t.surface)
  r.setProperty("--border", t.border)
  r.setProperty("--border-hi", t.borderHi)
  r.setProperty("--text", t.text)
  r.setProperty("--dim", t.dim)
  r.setProperty("--accent", t.accent)
  r.setProperty("--accent-d", t.accentD)
  r.setProperty("--accent-g", t.accentG)
  r.setProperty("--error", t.error)
  r.setProperty("--error-d", t.errorD)
  r.setProperty("--code-bg", t.codeBg)
  r.setProperty("--kw", t.kw)
  r.setProperty("--str", t.str)
  r.setProperty("--num", t.num)
  r.setProperty("--cmt", t.cmt)
  r.setProperty("--fn", t.fn)
  r.setProperty("--code-text", t.codeText)
  r.setProperty("--section-label", t.sectionLabel)
  r.setProperty("--menu-sep", t.menuSep)
  themeStyleEl.textContent = `
    ::-webkit-scrollbar-thumb { background:${t.scrollThumb}; border-radius:3px; }
    ::-webkit-scrollbar-thumb:hover { background:${t.scrollThumbHover}; }
    ::selection { background:${t.selectionBg}; color:#fff; }
    ::placeholder { color:${t.placeholder} !important; }
    input[type=range]::-webkit-slider-runnable-track { height:3px; border-radius:2px; background:${t.sliderTrack}; }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance:none; appearance:none;
      width:12px; height:12px; border-radius:50%; margin-top:-4.5px;
      background:${t.sliderThumb}; border:1.5px solid ${t.sliderThumbBorder};
      box-shadow:${t.sliderShadow}; transition:background .15s,box-shadow .15s;
    }
    input[type=range]:hover::-webkit-slider-thumb { box-shadow:${t.sliderHoverShadow}; }
  `
}

// ── Global styles ──────────────────────────────────────────────────────────────

const styleEl = document.createElement("style")
styleEl.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  @keyframes pulse  { 0%,100%{opacity:1;transform:scale(1)}   50%{opacity:.25;transform:scale(0.85)} }

  @keyframes spin   { to{transform:rotate(360deg)} }
  @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes wave   { 0%,100%{transform:scaleY(0.35)} 50%{transform:scaleY(1)} }
  @keyframes slideUp  { from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:translateY(0)} }
  @keyframes slideDown{ from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(6px)} }
  @keyframes fadeIn   { from{opacity:0} to{opacity:1} }
  @keyframes rippleOut { 0%{transform:scale(1);opacity:0.7} 100%{transform:scale(2.8);opacity:0} }

  * { box-sizing:border-box; margin:0; padding:0; }
  html, body { background: transparent; height:100%; margin:0; overflow:hidden; }
  #root { display:flex; flex-direction:column; }
  .drag    { -webkit-app-region:drag;    app-region:drag;    }
  .no-drag { -webkit-app-region:no-drag; app-region:no-drag; }
  ::-webkit-scrollbar { width:3px; }
  ::-webkit-scrollbar-track { background:transparent; }
  button { cursor:pointer; font-family:inherit; }
  kbd    { font-family:'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace; }
  input[type=range] { -webkit-appearance:none; appearance:none; background:transparent; cursor:pointer; }
`
document.head.appendChild(styleEl)

// ── Constants ──────────────────────────────────────────────────────────────────

const UI_FONT = "'Inter', 'Segoe UI Variable', 'Segoe UI', sans-serif"
const DISPLAY_FONT = "'Caveat', cursive"
const CODE_FONT = "'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace"

// ── Syntax Highlighting ────────────────────────────────────────────────────────

const KW = new Set([
  "def",
  "class",
  "return",
  "if",
  "else",
  "elif",
  "for",
  "while",
  "in",
  "not",
  "and",
  "or",
  "import",
  "from",
  "as",
  "with",
  "try",
  "except",
  "finally",
  "pass",
  "break",
  "continue",
  "lambda",
  "yield",
  "async",
  "await",
  "True",
  "False",
  "None",
  "self",
  "super",
  "const",
  "let",
  "var",
  "function",
  "new",
  "this",
  "typeof",
  "instanceof",
  "export",
  "default",
  "type",
  "interface",
  "enum",
  "extends",
  "implements",
  "public",
  "private",
  "static",
  "abstract",
  "readonly",
  "void",
  "null",
  "undefined",
  "boolean",
  "number",
  "string",
])

type TK = "keyword" | "string" | "number" | "comment" | "fn" | "plain"

function tokenizeLine(line: string): { text: string; kind: TK }[] {
  const out: { text: string; kind: TK }[] = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (ch === "  #" || (ch === "/" && line[i + 1] === "/")) {
      out.push({ text: line.slice(i), kind: "comment" })
      break
    }
    if (ch === "#") {
      out.push({ text: line.slice(i), kind: "comment" })
      break
    }
    if (ch === '"' || ch === "'") {
      const q = ch
      let j = i + 1
      if (line[j] === q && line[j + 1] === q) {
        j = i + 3
        while (j < line.length - 2 && !(line[j] === q && line[j + 1] === q && line[j + 2] === q))
          j++
        j += 3
      } else {
        while (j < line.length && line[j] !== q) {
          if (line[j] === "\\") j++
          j++
        }
        j++
      }
      out.push({ text: line.slice(i, j), kind: "string" })
      i = j
      continue
    }
    if (ch === "`") {
      let j = i + 1
      while (j < line.length && line[j] !== "`") j++
      out.push({ text: line.slice(i, j + 1), kind: "string" })
      i = j + 1
      continue
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(line[i + 1] ?? ""))) {
      let j = i
      while (j < line.length && /[\d._xXoObBa-fA-F]/.test(line[j]!)) j++
      out.push({ text: line.slice(i, j), kind: "number" })
      i = j
      continue
    }
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i
      while (j < line.length && /[\w$]/.test(line[j]!)) j++
      const w = line.slice(i, j)
      out.push({ text: w, kind: KW.has(w) ? "keyword" : line[j] === "(" ? "fn" : "plain" })
      i = j
      continue
    }
    out.push({ text: ch, kind: "plain" })
    i++
  }
  return out
}

const TK_COLOR: Record<TK, string> = {
  keyword: "var(--kw)",
  string: "var(--str)",
  number: "var(--num)",
  comment: "var(--cmt)",
  fn: "var(--fn)",
  plain: "var(--code-text)",
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await window.yomi.copyText(text)
    return
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

// ── Answer Block (MCQ / definite answer) ──────────────────────────────────────

function AnswerBlock({ answer }: { answer: string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    copyToClipboard(answer).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div
      style={{
        background: "var(--code-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        margin: "6px 0",
        fontSize: 12,
        fontFamily: UI_FONT,
      }}
      className="no-drag"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px 4px 12px",
          borderBottom: "1px solid var(--menu-sep)",
          background: "var(--accent-d)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            color: "var(--section-label)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          answer
        </span>
        <button
          onClick={copy}
          style={{
            background: copied ? "var(--accent-d)" : "none",
            border: `1px solid ${copied ? "var(--border-hi)" : "var(--border)"}`,
            borderRadius: 3,
            padding: "1px 7px",
            fontSize: 9,
            color: copied ? "var(--accent)" : "var(--dim)",
            cursor: "pointer",
            fontFamily: UI_FONT,
            transition: "all .2s",
          }}
          onMouseEnter={(e) => {
            if (!copied) {
              e.currentTarget.style.color = "var(--accent)"
              e.currentTarget.style.borderColor = "var(--border-hi)"
            }
          }}
          onMouseLeave={(e) => {
            if (!copied) {
              e.currentTarget.style.color = "var(--dim)"
              e.currentTarget.style.borderColor = "var(--border)"
            }
          }}
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <div
        style={{
          padding: "12px 16px 14px",
          fontSize: 13.5,
          fontFamily: UI_FONT,
          fontWeight: 450,
          lineHeight: 1.58,
          color: "var(--text)",
          textAlign: "left",
          letterSpacing: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {answer}
      </div>
    </div>
  )
}

// ── CodeBlock ──────────────────────────────────────────────────────────────────

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  if (lang === "answer") return <AnswerBlock answer={code.trim()} />
  const lines = code.split("\n")
  if (lines.at(-1) === "") lines.pop()
  const numW = String(lines.length).length * 8 + 12
  const [copied, setCopied] = React.useState(false)

  const copyCode = () => {
    copyToClipboard(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      style={{
        background: "var(--code-bg)",
        borderRadius: 8,
        overflow: "hidden",
        margin: "6px 0",
        border: "1px solid var(--border)",
        fontSize: 12,
        fontFamily: CODE_FONT,
      }}
      className="no-drag"
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px 4px 12px",
          borderBottom: "1px solid var(--menu-sep)",
          background: "var(--accent-d)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            color: "var(--section-label)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          {lang || "code"}
        </span>
        <button
          onClick={copyCode}
          style={{
            background: copied ? "var(--accent-d)" : "none",
            border: `1px solid ${copied ? "var(--border-hi)" : "var(--border)"}`,
            borderRadius: 3,
            padding: "1px 7px",
            fontSize: 9,
            color: copied ? "var(--accent)" : "var(--dim)",
            cursor: "pointer",
            fontFamily: UI_FONT,
            transition: "all .2s",
          }}
          onMouseEnter={(e) => {
            if (!copied) {
              e.currentTarget.style.color = "var(--accent)"
              e.currentTarget.style.borderColor = "var(--border-hi)"
            }
          }}
          onMouseLeave={(e) => {
            if (!copied) {
              e.currentTarget.style.color = "var(--dim)"
              e.currentTarget.style.borderColor = "var(--border)"
            }
          }}
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <div style={{ overflowX: "auto", padding: "8px 0" }}>
        {lines.map((line, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              alignItems: "flex-start",
              padding: "1.5px 14px 1.5px 10px",
              minHeight: 18,
            }}
          >
            <span
              style={{
                color: "var(--border-hi)",
                userSelect: "none",
                minWidth: numW,
                textAlign: "right",
                marginRight: 14,
                flexShrink: 0,
                lineHeight: "18px",
              }}
            >
              {idx + 1}
            </span>
            <span style={{ color: "var(--code-text)", whiteSpace: "pre", lineHeight: "18px" }}>
              {tokenizeLine(line).map((t, ti) => (
                <span key={ti} style={{ color: TK_COLOR[t.kind] }}>
                  {t.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Inline Markdown ────────────────────────────────────────────────────────────

function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  let last = 0,
    m: RegExpExecArray | null,
    k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2])
      parts.push(
        <strong key={k++} style={{ fontWeight: 600, color: "var(--text)" }}>
          {m[2]}
        </strong>,
      )
    else if (m[3])
      parts.push(
        <code
          key={k++}
          style={{
            fontFamily: CODE_FONT,
            fontSize: "0.87em",
            background: "var(--accent-d)",
            borderRadius: 3,
            padding: "1px 5px",
            color: "var(--str)",
          }}
        >
          {m[3]}
        </code>,
      )
    else if (m[4])
      parts.push(
        <em key={k++} style={{ fontStyle: "italic", color: "var(--dim)" }}>
          {m[4]}
        </em>,
      )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ── Content Renderer ───────────────────────────────────────────────────────────

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; lang: string; code: string }

function parseBlocks(raw: string): Block[] {
  const lines = raw.split("\n")
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const hm = line.match(/^(#{1,3}) (.+)$/)
    if (hm) {
      out.push({ kind: "h", level: hm[1]!.length as 1 | 2 | 3, text: hm[2]! })
      i++
      continue
    }
    const cm = line.match(/^```(\w*)/)
    if (cm) {
      const lang = cm[1] ?? ""
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        body.push(lines[i]!)
        i++
      }
      i++
      out.push({ kind: "code", lang, code: body.join("\n") })
      continue
    }
    if (/^[-*•] /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*•] /.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-*•] /, ""))
        i++
      }
      out.push({ kind: "ul", items })
      continue
    }
    if (/^\d+[.)]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+[.)]\s+/, ""))
        i++
      }
      out.push({ kind: "ol", items })
      continue
    }
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^#{1,3} /.test(lines[i]!) &&
      !/^```/.test(lines[i]!) &&
      !/^[-*•] /.test(lines[i]!) &&
      !/^\d+[.)]\s/.test(lines[i]!)
    ) {
      para.push(lines[i]!)
      i++
    }
    if (para.length) out.push({ kind: "p", text: para.join(" ") })
  }
  return out
}

// Renders pre-parsed blocks. Shared by Blocks and CodeAnswerLayout.
function RenderBlocks({ blocks, isStreaming }: { blocks: Block[]; isStreaming: boolean }) {
  return (
    <div>
      {blocks.map((b, idx) => {
        if (b.kind === "h") {
          const sz = [14, 12.5, 12][b.level - 1]!
          return (
            <div
              key={idx}
              style={{
                fontSize: sz,
                fontWeight: 600,
                fontFamily: UI_FONT,
                color: "var(--text)",
                letterSpacing: "0",
                margin: idx === 0 ? "0 0 8px" : "12px 0 5px",
                paddingBottom: b.level === 1 ? 5 : 0,
                borderBottom: b.level === 1 ? "1px solid var(--menu-sep)" : "none",
              }}
            >
              {b.text}
            </div>
          )
        }
        if (b.kind === "p")
          return (
            <p
              key={idx}
              style={{
                fontSize: 12.5,
                lineHeight: 1.7,
                fontFamily: UI_FONT,
                color: "var(--text)",
                margin: "0 0 7px",
              }}
            >
              <Inline text={b.text} />
            </p>
          )
        if (b.kind === "ul")
          return (
            <ul key={idx} style={{ listStyle: "none", padding: 0, margin: "0 0 7px" }}>
              {b.items.map((item, i) => (
                <li
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 7,
                    fontSize: 12.5,
                    lineHeight: 1.65,
                    fontFamily: UI_FONT,
                    color: "var(--text)",
                    marginBottom: 3,
                  }}
                >
                  <span
                    style={{
                      color: "var(--accent)",
                      flexShrink: 0,
                      marginTop: 3,
                      fontSize: 7,
                      opacity: 0.7,
                    }}
                  >
                    ◆
                  </span>
                  <span>
                    <Inline text={item} />
                  </span>
                </li>
              ))}
            </ul>
          )
        if (b.kind === "ol")
          return (
            <ol key={idx} style={{ listStyle: "none", padding: 0, margin: "0 0 7px" }}>
              {b.items.map((item, i) => (
                <li
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 7,
                    fontSize: 12.5,
                    lineHeight: 1.65,
                    fontFamily: UI_FONT,
                    color: "var(--text)",
                    marginBottom: 3,
                  }}
                >
                  <span
                    style={{
                      color: "var(--accent)",
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 600,
                      minWidth: 14,
                      opacity: 0.75,
                    }}
                  >
                    {i + 1}.
                  </span>
                  <span>
                    <Inline text={item} />
                  </span>
                </li>
              ))}
            </ol>
          )
        if (b.kind === "code") return <CodeBlock key={idx} code={b.code} lang={b.lang} />
        return null
      })}
      {isStreaming && (
        <span
          style={{
            display: "inline-block",
            width: 2,
            height: "0.85em",
            background: "var(--accent)",
            marginLeft: 2,
            verticalAlign: "text-bottom",
            animation: "blink 1s step-end infinite",
            borderRadius: 1,
            opacity: 0.7,
          }}
        />
      )}
    </div>
  )
}

// When code includes complexity notes, keep them readable instead of code-like.
function ComplexityDisplay({ blocks, isStreaming }: { blocks: Block[]; isStreaming: boolean }) {
  const raw = blocks
    .filter((b) => b.kind === "p")
    .map((b) => (b as Extract<Block, { kind: "p" }>).text)
    .join(" ")
  if (!raw) return <RenderBlocks blocks={blocks} isStreaming={isStreaming} />

  const parseOne = (label: string, stopLabel: string) => {
    const idx = raw.search(new RegExp(label + "[:\\s]", "i"))
    if (idx < 0) return null
    const seg = raw.slice(idx)
    const m = seg.match(/O\([^)]+\)/)
    if (!m) return null
    const after = seg.slice(seg.indexOf(m[0]) + m[0].length)
    const stopRe = stopLabel ? new RegExp(stopLabel + "[:\\s]", "i") : null
    const stopIdx = stopRe ? after.search(stopRe) : -1
    const note = (stopIdx >= 0 ? after.slice(0, stopIdx) : after)
      .replace(/^\s*[—–\-|,]+\s*/, "")
      .trim()
    return { notation: m[0], note }
  }

  const time = parseOne("time", "space")
  const space = parseOne("space", "")
  if (!time && !space) return <RenderBlocks blocks={blocks} isStreaming={isStreaming} />

  const Row = ({ label, notation, note }: { label: string; notation: string; note: string }) => (
    <p
      style={{
        margin: "0 0 4px",
        fontSize: 12.5,
        lineHeight: 1.55,
        fontFamily: UI_FONT,
        color: "rgba(255,255,255,0.92)",
      }}
    >
      <strong style={{ color: "rgba(255,255,255,0.98)", fontWeight: 650 }}>{label}:</strong>{" "}
      <span>{notation}</span>
      {note ? <span style={{ color: "var(--dim)" }}> - {note}</span> : null}
    </p>
  )

  return (
    <div>
      {time && <Row label="Time" notation={time.notation} note={time.note} />}
      {space && <Row label="Space" notation={space.notation} note={space.note} />}
      {isStreaming && (
        <span
          style={{
            display: "inline-block",
            width: 2,
            height: "0.85em",
            background: "var(--accent)",
            animation: "blink 1s step-end infinite",
            borderRadius: 1,
            opacity: 0.7,
          }}
        />
      )}
    </div>
  )
}

function CodeAnswerLayout({ blocks, isStreaming }: { blocks: Block[]; isStreaming: boolean }) {
  const codeIdxs = blocks.map((b, i) => (b.kind === "code" ? i : -1)).filter((i) => i >= 0)
  if (codeIdxs.length === 0) return <RenderBlocks blocks={blocks} isStreaming={isStreaming} />

  const firstCode = codeIdxs[0]!
  const lastCode = codeIdxs[codeIdxs.length - 1]!

  const reasoningBlocks = blocks.slice(0, firstCode)
  const codeBlocks = blocks.slice(firstCode, lastCode + 1)
  const complexityBlocks = blocks.slice(lastCode + 1)

  const sectionLabel = (text: string) => (
    <div
      style={{
        fontSize: 8.5,
        fontFamily: UI_FONT,
        fontWeight: 700,
        letterSpacing: "0.14em",
        color: "var(--section-label)",
        marginBottom: 6,
        userSelect: "none",
      }}
    >
      {text}
    </div>
  )

  return (
    <div
      style={{
        border: "1px solid var(--border-hi)",
        borderRadius: 9,
        overflow: "hidden",
        background: "rgba(255,255,255,0.015)",
      }}
    >
      {/* Reasoning */}
      {reasoningBlocks.length > 0 && (
        <div style={{ padding: "8px 12px 6px", borderBottom: "1px solid var(--menu-sep)" }}>
          {sectionLabel("REASONING")}
          <RenderBlocks
            blocks={reasoningBlocks}
            isStreaming={isStreaming && codeBlocks.length === 0}
          />
        </div>
      )}

      {/* Code block(s) */}
      <div>
        {codeBlocks.map((b, i) =>
          b.kind === "code" ? <CodeBlock key={i} code={b.code} lang={b.lang} /> : null,
        )}
        {isStreaming && codeBlocks.length === 0 && reasoningBlocks.length === 0 && (
          <div style={{ padding: "8px 12px" }}>
            <span
              style={{
                display: "inline-block",
                width: 2,
                height: "0.85em",
                background: "var(--accent)",
                verticalAlign: "text-bottom",
                animation: "blink 1s step-end infinite",
                borderRadius: 1,
                opacity: 0.7,
              }}
            />
          </div>
        )}
      </div>

      {/* Complexity */}
      {complexityBlocks.length > 0 && (
        <div
          style={{
            padding: "6px 12px 8px",
            borderTop: "1px solid var(--menu-sep)",
            background: "rgba(255,255,255,0.018)",
          }}
        >
          {sectionLabel("COMPLEXITY")}
          <ComplexityDisplay blocks={complexityBlocks} isStreaming={isStreaming} />
        </div>
      )}
    </div>
  )
}

function Blocks({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  const hasCode = blocks.some((b) => b.kind === "code")
  if (hasCode) return <CodeAnswerLayout blocks={blocks} isStreaming={isStreaming} />
  return <RenderBlocks blocks={blocks} isStreaming={isStreaming} />
}

// ── Copy Button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => {
    copyToClipboard(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: copied ? "var(--accent-d)" : "rgba(255,255,255,0.035)",
        border: `1px solid ${copied ? "var(--border-hi)" : "var(--border)"}`,
        borderRadius: 5,
        padding: "3px 9px",
        fontSize: 10,
        fontFamily: UI_FONT,
        letterSpacing: "0.02em",
        color: copied ? "var(--accent)" : "var(--dim)",
        cursor: "pointer",
        transition: "all .2s",
      }}
      onMouseEnter={(e) => {
        if (!copied) {
          e.currentTarget.style.background = "var(--accent-d)"
          e.currentTarget.style.color = "var(--accent)"
        }
      }}
      onMouseLeave={(e) => {
        if (!copied) {
          e.currentTarget.style.background = "rgba(255,255,255,0.035)"
          e.currentTarget.style.color = "var(--dim)"
        }
      }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  )
}

// ── Text Input ─────────────────────────────────────────────────────────────────

function TextInputPanel({ surfaceBg }: { surfaceBg: string }) {
  const [value, setValue] = React.useState("")
  const [connectedProviders, setConnectedProviders] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef("")

  useEffect(() => {
    valueRef.current = value
  }, [value])

  // Use rAF so the OS-level window focus transfer completes before the DOM focus call.
  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  useEffect(() => {
    window.yomi.getIntegrations?.().then(integrations => {
      if (integrations) {
        setConnectedProviders(integrations.filter(i => i.connected).map(i => i.provider))
      }
    }).catch(() => {})
  }, [])

  const submit = React.useCallback(() => {
    const text = valueRef.current.trim()
    if (!text) return
    setValue("")
    valueRef.current = ""
    window.yomi.submitTextQuery(text)
  }, [])

  return (
    <div
      style={{
        background: surfaceBg,
        border: "1px solid var(--border-hi)",
        borderRadius: 9,
        overflow: "hidden",
        boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.04)",
        animation: "slideUp 0.2s cubic-bezier(0.16,1,0.3,1)",
      }}
      className="drag yomi-hit-area"
    >
      <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10.5,
            color: "var(--section-label)",
            letterSpacing: "0.12em",
            fontFamily: UI_FONT,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          ASK
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit() }
          }}
          placeholder="Type your question…"
          className="no-drag"
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            fontSize: 12.5,
            fontFamily: UI_FONT,
            color: "var(--text)",
            caretColor: "var(--accent)",
          }}
        />
        <button
          onClick={submit}
          className="no-drag"
          style={{
            background: "var(--accent-d)",
            border: "1px solid var(--border-hi)",
            borderRadius: 4,
            padding: "3px 10px",
            fontSize: 11.5,
            color: "var(--accent)",
            fontFamily: UI_FONT,
            cursor: "pointer",
            flexShrink: 0,
            transition: "all .15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--accent-g)"
            e.currentTarget.style.color = "var(--text)"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--accent-d)"
            e.currentTarget.style.color = "var(--accent)"
          }}
        >
          Send ↵
        </button>
      </div>
      <div style={{ height: 1, background: "var(--menu-sep)" }} />
      {/* Connector shelf */}
      <div
        style={{
          padding: "5px 10px 6px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: UI_FONT,
        }}
      >
        <span style={{ fontSize: 10.5, color: "var(--dim)", flexShrink: 0, whiteSpace: "nowrap" as const }}>
          Connect your apps
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, overflow: "hidden" }}>
          {connectedProviders.slice(0, 8).map(p => (
            <button
              key={p}
              title={p}
              onClick={() => window.yomi.openIntegrationsPage()}
              className="no-drag"
              style={{
                display: "flex",
                alignItems: "center",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                flexShrink: 0,
                lineHeight: 0,
                opacity: 1,
                transition: "opacity .15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.7" }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1" }}
            >
              <ConnectorIcon id={p} size={20} />
            </button>
          ))}
        </div>
        <button
          onClick={() => window.yomi.openIntegrationsPage()}
          className="no-drag"
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            fontSize: 10.5,
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
            fontFamily: UI_FONT,
            whiteSpace: "nowrap" as const,
          }}
        >
          Integrations →
        </button>
      </div>
    </div>
  )
}

// ── Response Panel ─────────────────────────────────────────────────────────────

function ResponsePanel({
  entry,
  onDismiss,
  isActive,
  surfaceBg,
}: {
  entry: ChatEntry
  onDismiss: () => void
  isActive: boolean
  surfaceBg: string
}) {
  return (
    <div
      style={{
        background: surfaceBg,
        border: "1px solid var(--border)",
        borderRadius: 9,
        overflow: "hidden",
        animation: "slideUp 0.22s cubic-bezier(0.16,1,0.3,1)",
        boxShadow: "0 6px 30px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.03)",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        maxHeight: isActive ? undefined : 300,
      }}
      className="drag yomi-hit-area"
    >
      {/* Warm amber left accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: entry.error
            ? "var(--error)"
            : entry.limitWarning
              ? "#f59e0b"
              : entry.notice
                ? "var(--accent)"
                : entry.isStreaming
                  ? "linear-gradient(to bottom, var(--accent), var(--accent-d))"
                  : "var(--border-hi)",
          transition: "background .3s",
        }}
      />

      {/* Transcript strip */}
      {(entry.transcript || entry.error || entry.notice || entry.limitWarning) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px 6px 14px",
            borderBottom: "1px solid var(--menu-sep)",
            background: "rgba(255,255,255,0.018)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              fontFamily: UI_FONT,
              fontWeight: 700,
              flexShrink: 0,
              color: entry.error
                ? "var(--error)"
                : entry.limitWarning
                  ? "#f59e0b"
                  : entry.notice
                    ? "var(--accent)"
                    : "var(--section-label)",
            }}
          >
            {entry.error ? "ERR" : entry.limitWarning ? "LIMIT" : entry.notice ? "YOMI" : "YOU"}
          </span>
          <span
            style={{
              fontSize: 13,
              fontFamily: UI_FONT,
              color: entry.error
                ? "var(--error)"
                : entry.limitWarning
                  ? "#f59e0b"
                  : entry.notice
                    ? "var(--accent)"
                    : "var(--dim)",
              fontStyle: entry.error || entry.limitWarning || entry.notice ? "normal" : "italic",
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {entry.error
              ? `⚠ ${entry.error}`
              : entry.limitWarning
                ? `⚠ ${entry.limitWarning.message}`
                : entry.notice
                  ? entry.notice
                  : entry.transcript}
          </span>
          {entry.limitWarning && (
            <button
              className="no-drag"
              onClick={() => window.yomi.openDashboard()}
              style={{
                background: "#f59e0b22",
                border: "1px solid #f59e0b66",
                color: "#f59e0b",
                fontSize: 10,
                fontFamily: UI_FONT,
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "2px 6px",
                borderRadius: 4,
                flexShrink: 0,
                cursor: "pointer",
              }}
            >
              UPGRADE
            </button>
          )}
          <button
            onClick={onDismiss}
            className="no-drag"
            style={{
              background: "none",
              border: "none",
              color: "var(--dim)",
              fontSize: 15,
              lineHeight: 1,
              padding: "1px 3px",
              flexShrink: 0,
              borderRadius: 3,
              transition: "color .15s, background .15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent)"
              e.currentTarget.style.background = "var(--accent-d)"
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--dim)"
              e.currentTarget.style.background = "none"
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Body — active entry expands to full content height (outer list scrolls);
               older entries scroll individually within their 300px cap */}
      {!entry.error && !entry.limitWarning && entry.text !== "" && (
        <div
          className="no-drag"
          style={
            isActive
              ? {
                  overflowX: "auto",
                  overscrollBehavior: "contain",
                  scrollBehavior: "smooth",
                  padding: "10px 12px 4px 14px",
                }
              : {
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  overflowX: "auto",
                  overscrollBehavior: "contain",
                  scrollBehavior: "smooth",
                  padding: "10px 12px 4px 14px",
                }
          }
        >
          <Blocks text={entry.text} isStreaming={entry.isStreaming} />
        </div>
      )}

      {!entry.error && !entry.limitWarning && entry.ttsError && (
        <div
          className="no-drag"
          style={{
            margin: "0 12px 8px 14px",
            padding: "5px 7px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--accent-d)",
            color: "var(--accent)",
            fontSize: 11.5,
            fontFamily: UI_FONT,
            lineHeight: 1.25,
            flexShrink: 0,
          }}
        >
          {entry.ttsError}
        </div>
      )}

      {/* Copy */}
      {!entry.error && !entry.limitWarning && !entry.isStreaming && entry.text && (
        <div
          style={{
            padding: "0 12px 8px",
            display: "flex",
            justifyContent: "flex-end",
            flexShrink: 0,
          }}
          className="no-drag"
        >
          <CopyButton text={entry.text} />
        </div>
      )}
    </div>
  )
}

// ── Yomi Logo Mark ─────────────────────────────────────────────────────────────

function YomiLogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-3 -3 30 30"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <rect x="-3" y="-3" width="30" height="30" rx="7" fill="url(#ym-lg-bg)" />
      <rect x="-3" y="-3" width="30" height="11" rx="7" fill="url(#ym-lg-shine)" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="white"
        d="M12 2c-.791 0-1.55.314-2.11.874l-.893.893a.985.985 0 0 1-.696.288H7.04A2.984 2.984 0 0 0 4.055 7.04v1.262a.986.986 0 0 1-.288.696l-.893.893a2.984 2.984 0 0 0 0 4.22l.893.893a.985.985 0 0 1 .288.696v1.262a2.984 2.984 0 0 0 2.984 2.984h1.262c.261 0 .512.104.696.288l.893.893a2.984 2.984 0 0 0 4.22 0l.893-.893a.985.985 0 0 1 .696-.288h1.262a2.984 2.984 0 0 0 2.984-2.984V15.7c0-.261.104-.512.288-.696l.893-.893a2.984 2.984 0 0 0 0-4.22l-.893-.893a.985.985 0 0 1-.288-.696V7.04a2.984 2.984 0 0 0-2.984-2.984h-1.262a.985.985 0 0 1-.696-.288l-.893-.893A2.984 2.984 0 0 0 12 2Zm3.683 7.73a1 1 0 1 0-1.414-1.413l-4.253 4.253-1.277-1.277a1 1 0 0 0-1.415 1.414l1.985 1.984a1 1 0 0 0 1.414 0l4.96-4.96Z"
      />
      <defs>
        <linearGradient
          id="ym-lg-bg"
          x1="-3"
          y1="-3"
          x2="27"
          y2="27"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#3B5BDB" />
        </linearGradient>
        <linearGradient
          id="ym-lg-shine"
          x1="0"
          y1="-3"
          x2="0"
          y2="8"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="white" stopOpacity="0.22" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

// ── Toolbar ────────────────────────────────────────────────────────────────────

function Key({ label }: { label: string }) {
  const { theme: t } = React.useContext(ThemeCtx)
  return (
    <kbd
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: t.kbdBg,
        border: `1px solid ${t.kbdBorder}`,
        borderBottom: `2px solid ${t.kbdBorderB}`,
        borderRadius: 4,
        padding: "0 6px",
        fontSize: 10,
        color: t.kbdText,
        minWidth: 18,
        height: 17,
        fontWeight: 500,
      }}
    >
      {label}
    </kbd>
  )
}

const SpeakerOnSVG = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
  </svg>
)

const SpeakerOffSVG = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
  </svg>
)

const HamburgerIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor" aria-hidden>
    <rect y="1.5" width="13" height="1.5" rx="0.75" />
    <rect y="5.75" width="13" height="1.5" rx="0.75" />
    <rect y="10" width="13" height="1.5" rx="0.75" />
  </svg>
)

const IntegrationsSVG = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M17 7H7a5 5 0 0 0 0 10h10a5 5 0 0 0 0-10zm0 8H7a3 3 0 0 1 0-6h10a3 3 0 0 1 0 6zm0-4a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
  </svg>
)


const MicSVG = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08C16.39 17.43 19 14.53 19 11h-2z" />
  </svg>
)

const TypeSVG = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z" />
  </svg>
)

const ScreenshotSVG = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M9 3L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-3.17L15 3H9zm3 5a5 5 0 110 10 5 5 0 010-10zm0 2a3 3 0 100 6 3 3 0 000-6z" />
  </svg>
)

function initialsFor(name?: string, email?: string): string {
  const source = name?.trim() || email?.split("@")[0] || "Y"
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

// ── Menu Card ──────────────────────────────────────────────────────────────────

function MenuCard({
  subscription,
  plan,
  onProfileNameSave,
  onSignOut,
  onClose,
  onHoverEnter,
  onHoverLeave,
  cardRef,
}: {
  subscription: SubscriptionInfo | null
  plan?: string
  onProfileNameSave: (name: string) => Promise<void>
  onSignOut: () => void
  onClose: () => void
  onHoverEnter: () => void
  onHoverLeave: () => void
  cardRef?: React.RefObject<HTMLDivElement>
}) {
  const { theme: t, setTheme } = React.useContext(ThemeCtx)
  const [nameDraft, setNameDraft] = React.useState(subscription?.name ?? "")
  const [profileEditing, setProfileEditing] = React.useState(false)
  const [profileSaving, setProfileSaving] = React.useState(false)
  const [profileError, setProfileError] = React.useState("")

  React.useEffect(() => {
    setNameDraft(subscription?.name ?? "")
    setProfileEditing(false)
    setProfileError("")
  }, [subscription?.name])

  const saveProfileName = async () => {
    const nextName = nameDraft.trim()
    if (!nextName) {
      setNameDraft(subscription?.name ?? "")
      return
    }
    setProfileSaving(true)
    setProfileError("")
    try {
      await onProfileNameSave(nextName)
      setProfileEditing(false)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Could not save")
    } finally {
      setProfileSaving(false)
    }
  }

  const shortcuts = [
    { label: "Voice", keys: ["Ctrl", "Space"] },
    { label: "AI Chats", keys: ["Ctrl", "Enter"] },
    { label: "Screen", keys: ["Ctrl", "S"] },
    { label: "Stop / cancel", keys: ["Esc"] },
    { label: "Move", keys: ["Ctrl", "Arrows"] },
    { label: "Hide", keys: ["Ctrl", "H"] },
    { label: "Quit", keys: ["Ctrl", "Q"] },
  ]

  const upgradeLabel = plan === "max" ? null : "Upgrade"

  const MenuBtn = ({
    label,
    danger,
    onClick,
  }: {
    label: string
    danger?: boolean
    onClick: () => void
  }) => (
    <button
      onClick={onClick}
      className="no-drag"
      style={{
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        padding: "7px 12px",
        borderRadius: 6,
        fontSize: 12,
        fontFamily: UI_FONT,
        cursor: "pointer",
        color: danger ? t.dangerText : t.btnText,
        transition: "background .12s, color .12s",
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? t.dangerHoverBg : t.btnHoverBg
        e.currentTarget.style.color = danger ? t.dangerText : t.btnHoverText
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "none"
        e.currentTarget.style.color = danger ? t.dangerText : t.btnText
      }}
    >
      {label}
    </button>
  )

  return (
    <>
      <div
        className="no-drag yomi-hit-area yomi-menu-zone"
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        style={{
          position: "absolute",
          top: 28,
          right: "max(8px, calc(50% - 382px))",
          zIndex: 1000,
          width: 250,
          height: 24,
        }}
      />
      <motion.div
        ref={cardRef}
        className="no-drag yomi-hit-area yomi-menu-zone"
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        initial={{ opacity: 0, scale: 0.95, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -6 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        style={{
          position: "absolute",
          top: 52,
          right: "max(8px, calc(50% - 382px))",
          zIndex: 1000,
          width: 250,
          background: t.surface,
          border: `1px solid ${t.borderHi}`,
          borderRadius: 16,
          boxShadow: t.menuShadow,
          overflowX: "hidden",
          overflowY: "auto",
          transformOrigin: "top right",
        }}
      >
        {/* Profile */}
        <div style={{ padding: "12px 14px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: t.accentD,
                border: `1px solid ${t.borderHi}`,
                color: t.accent,
                fontSize: 12,
                fontFamily: UI_FONT,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {initialsFor(subscription?.name, subscription?.email)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {profileEditing ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveProfileName()
                      if (e.key === "Escape") {
                        e.preventDefault()
                        e.stopPropagation()
                        setNameDraft(subscription?.name ?? "")
                        setProfileError("")
                        setProfileEditing(false)
                        e.currentTarget.blur()
                      }
                    }}
                    disabled={profileSaving}
                    autoFocus
                    className="no-drag"
                    maxLength={80}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      boxSizing: "border-box",
                      background: t.kbdBg,
                      border: `1px solid ${t.kbdBorder}`,
                      borderRadius: 6,
                      outline: "none",
                      padding: "5px 8px",
                      margin: 0,
                      color: t.text,
                      fontSize: 13,
                      fontFamily: UI_FONT,
                      fontWeight: 700,
                    }}
                  />
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={saveProfileName}
                    disabled={profileSaving}
                    className="no-drag"
                    style={{
                      background: t.upgradeBg,
                      border: `1px solid ${t.upgradeBorder}`,
                      color: t.upgradeText,
                      borderRadius: 6,
                      padding: "5px 8px",
                      fontSize: 10.5,
                      fontFamily: UI_FONT,
                      fontWeight: 700,
                      cursor: profileSaving ? "default" : "pointer",
                      opacity: profileSaving ? 0.65 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {profileSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <div
                    style={{
                      color: t.text,
                      fontSize: 13,
                      fontFamily: UI_FONT,
                      fontWeight: 700,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {subscription?.name || "Yomi user"}
                  </div>
                  <button
                    onClick={() => {
                      setNameDraft(subscription?.name ?? "")
                      setProfileError("")
                      setProfileEditing(true)
                    }}
                    className="no-drag"
                    style={{
                      background: t.kbdBg,
                      border: `1px solid ${t.kbdBorder}`,
                      color: t.btnText,
                      borderRadius: 6,
                      padding: "3px 7px",
                      fontSize: 10.5,
                      fontFamily: UI_FONT,
                      fontWeight: 700,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = t.btnHoverBg
                      e.currentTarget.style.color = t.btnHoverText
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = t.kbdBg
                      e.currentTarget.style.color = t.btnText
                    }}
                  >
                    Edit
                  </button>
                </div>
              )}
              <div
                style={{
                  fontSize: 11,
                  fontFamily: UI_FONT,
                  color: t.dim,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  marginTop: 2,
                }}
              >
                {subscription?.email || "Signed in"}
              </div>
            </div>
          </div>
          {(profileSaving || profileError) && (
            <div
              style={{
                marginTop: 7,
                fontSize: 10.5,
                fontFamily: UI_FONT,
                color: profileError ? t.error : t.sectionLabel,
              }}
            >
              {profileError || "Saving..."}
            </div>
          )}
        </div>

        <div style={{ height: 1, background: t.menuSep }} />

        {/* Shortcuts */}
        <div style={{ padding: "10px 14px" }}>
          <div
            style={{
              fontSize: 10,
              fontFamily: UI_FONT,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: t.sectionLabel,
              marginBottom: 10,
            }}
          >
            SHORTCUTS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {shortcuts.map(({ label, keys }) => (
              <div
                key={label}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span
                  style={{ fontSize: 13, fontFamily: UI_FONT, color: t.btnText, fontWeight: 500 }}
                >
                  {label}
                </span>
                <div style={{ display: "flex", gap: 3 }}>
                  {keys.map((k, i) => (
                    <Key key={i} label={k} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: t.menuSep }} />

        {/* Theme switcher */}
        <div style={{ padding: "10px 14px" }}>
          <div
            style={{
              fontSize: 10,
              fontFamily: UI_FONT,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: t.sectionLabel,
              marginBottom: 9,
            }}
          >
            THEME
          </div>
          <div style={{ position: "relative" }}>
            <select
              value={t.id}
              onChange={(e) => setTheme(e.target.value as ThemeId)}
              className="no-drag"
              style={{
                width: "100%",
                padding: "7px 28px 7px 10px",
                background: t.kbdBg,
                border: `1px solid ${t.kbdBorder}`,
                borderRadius: 7,
                cursor: "pointer",
                fontSize: 12,
                fontFamily: UI_FONT,
                color: t.btnText,
                outline: "none",
                WebkitAppearance: "none",
                appearance: "none",
              }}
            >
              {(Object.keys(THEMES) as ThemeId[]).map((id) => (
                <option key={id} value={id} style={{ background: "#0a0a0a", color: "#e2e8f0" }}>
                  {THEMES[id].label}
                </option>
              ))}
            </select>
            <span
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                pointerEvents: "none",
                width: 0,
                height: 0,
                borderLeft: "4px solid transparent",
                borderRight: "4px solid transparent",
                borderTop: `5px solid ${t.dim}`,
              }}
            />
          </div>
        </div>

        <div style={{ height: 1, background: t.menuSep }} />
        {/* Actions */}
        <div style={{ padding: "5px" }}>
          {upgradeLabel && (
            <button
              onClick={() => {
                window.yomi.openUpgrade()
                onClose()
              }}
              className="no-drag"
              style={{
                width: "100%",
                textAlign: "left",
                background: t.upgradeBg,
                border: `1px solid ${t.upgradeBorder}`,
                padding: "8px 12px",
                borderRadius: 6,
                marginBottom: 4,
                fontSize: 13,
                fontFamily: UI_FONT,
                cursor: "pointer",
                color: t.upgradeText,
                fontWeight: 600,
                transition: "background .12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = t.upgradeBgHover
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = t.upgradeBg
              }}
            >
              ✦ {upgradeLabel}
            </button>
          )}
          <MenuBtn
            label="Sign out"
            onClick={() => {
              onSignOut()
              onClose()
            }}
          />
          <MenuBtn
            label="Quit"
            danger
            onClick={() => {
              window.yomi.quit()
              onClose()
            }}
          />
        </div>
      </motion.div>
    </>
  )
}

// ── Notch state loader ───────────────────────────────────────────────────────
// Per-state micro-loader shown in the notch: waveform (listening), spinner
// (processing), blinking caret (typing), equalizer (speaking).
type LoaderKind = "listening" | "processing" | "typing" | "speaking"

function StateLoader({ kind, accent, faint }: { kind: LoaderKind; accent: string; faint: string }) {
  if (kind === "processing") {
    return (
      <div
        style={{
          width: 13,
          height: 13,
          borderRadius: "50%",
          flexShrink: 0,
          border: `1.6px solid ${faint}`,
          borderTopColor: accent,
          animation: "spin .7s linear infinite",
        }}
      />
    )
  }
  if (kind === "typing") {
    return (
      <div
        style={{
          width: 2,
          height: 13,
          borderRadius: 1,
          flexShrink: 0,
          background: accent,
          animation: "blink 1s step-end infinite",
        }}
      />
    )
  }
  // listening = mic waveform (4 bars), speaking = denser/faster equalizer (5 bars)
  const bars = kind === "speaking" ? 5 : 4
  const dur = kind === "speaking" ? 0.7 : 0.95
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 14, flexShrink: 0 }}>
      {Array.from({ length: bars }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 2.5,
            height: 14,
            borderRadius: 2,
            background: accent,
            transformOrigin: "center",
            animation: `wave ${dur}s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

function Toolbar({
  state,
  plan,
  menuOpen,
  onMenuOpen,
  onMenuScheduleClose,
}: {
  state: HotkeyState
  plan?: string
  menuOpen: boolean
  onMenuOpen: () => void
  onMenuScheduleClose: () => void
}) {
  const { ttsEnabled, toggleTts, pendingAct, clearPendingAct } = useYomiStore()
  // automation disabled — keep store subscriptions so the type stays narrow
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _automationRuns = useYomiStore((s) => s.automationRuns)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _missionsOpen = useYomiStore((s) => s.missionsOpen)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _toggleMissions = useYomiStore((s) => s.toggleMissions)
  const { theme: t } = React.useContext(ThemeCtx)

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          height: 40,
          background: "transparent",
          borderRadius: 10,
          gap: 10,
          position: "relative",
          zIndex: 999,
        }}
        className="drag yomi-hit-area"
      >
        {/* Left: brand + state indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "rgba(0,0,0,0.22)",
            borderRadius: 8,
            padding: "3px 8px 3px 6px",
          }}
        >
          {/* Drag grip */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2.5,
              opacity: 0.2,
              flexShrink: 0,
            }}
          >
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: "flex", gap: 2.5 }}>
                <div style={{ width: 2, height: 2, borderRadius: "50%", background: t.dragDot }} />
                <div style={{ width: 2, height: 2, borderRadius: "50%", background: t.dragDot }} />
              </div>
            ))}
          </div>

          {/* Brand — always shown; live state lives on the notch below */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <YomiLogoMark size={20} />
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                fontFamily: DISPLAY_FONT,
                letterSpacing: "-0.01em",
                lineHeight: 1,
                color: "rgba(255,255,255,0.88)",
              }}
            >
              Yomi
            </span>
          </div>

          {plan && (
            <span
              style={{
                fontSize: 10.5,
                fontFamily: UI_FONT,
                letterSpacing: "0.05em",
                color: t.planText,
                border: `1px solid ${t.planBorder}`,
                borderRadius: 4,
                padding: "0 7px",
                lineHeight: "18px",
                textTransform: "capitalize",
                fontWeight: 500,
              }}
            >
              {plan}
            </span>
          )}
          <button
            onClick={() => window.yomi.openDashboard()}
            className="no-drag"
            style={{
              fontSize: 10.5,
              fontFamily: UI_FONT,
              letterSpacing: "0.02em",
              color: t.sectionLabel,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            Dashboard
          </button>
        </div>

        {/* Right: controls */}
        <div
          style={{
            display: "flex",
            gap: 5,
            alignItems: "center",
            background: "rgba(0,0,0,0.22)",
            borderRadius: 8,
            padding: "3px 6px",
          }}
          className="no-drag"
        >
          {/* Missions button disabled — desktop automation hidden */}

          {/* Voice mode button */}
          <button
            onClick={() => {
              if (state === "idle") window.yomi.triggerVoice()
            }}
            onMouseEnter={(e) => {
              if (state !== "idle") return
              e.currentTarget.style.color = t.hambColorActive
              e.currentTarget.style.background = t.hambBgActive
              e.currentTarget.style.borderColor = t.hambBorderActive
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color =
                state === "idle" ? t.hambColor : "rgba(255,255,255,0.22)"
              e.currentTarget.style.background = t.hambBg
              e.currentTarget.style.borderColor = t.hambBorder
            }}
            style={{
              background: t.hambBg,
              border: `1px solid ${t.hambBorder}`,
              borderRadius: 5,
              cursor: state === "idle" ? "pointer" : "default",
              color: state === "idle" ? t.hambColor : "rgba(255,255,255,0.22)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              height: 22,
              flexShrink: 0,
              transition: "all .15s",
            }}
            title="Voice (Ctrl+Space)"
          >
            <MicSVG />
            <span
              style={{
                fontSize: 11,
                fontFamily: UI_FONT,
                letterSpacing: "0.03em",
                fontWeight: 500,
              }}
            >
              Voice
            </span>
          </button>

          {/* Type mode button */}
          <button
            onClick={() => {
              if (state === "idle") window.yomi.triggerText()
            }}
            onMouseEnter={(e) => {
              if (state !== "idle") return
              e.currentTarget.style.color = t.hambColorActive
              e.currentTarget.style.background = t.hambBgActive
              e.currentTarget.style.borderColor = t.hambBorderActive
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color =
                state === "idle" ? t.hambColor : "rgba(255,255,255,0.22)"
              e.currentTarget.style.background = t.hambBg
              e.currentTarget.style.borderColor = t.hambBorder
            }}
            style={{
              background: t.hambBg,
              border: `1px solid ${t.hambBorder}`,
              borderRadius: 5,
              cursor: state === "idle" ? "pointer" : "default",
              color: state === "idle" ? t.hambColor : "rgba(255,255,255,0.22)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              height: 22,
              flexShrink: 0,
              transition: "all .15s",
            }}
            title="AI Chats (Ctrl+Enter)"
          >
            <TypeSVG />
            <span
              style={{
                fontSize: 11,
                fontFamily: UI_FONT,
                letterSpacing: "0.03em",
                fontWeight: 500,
              }}
            >
              AI Chats
            </span>
          </button>

          {/* Analyze button — one click captures the screen and analyses it straight into chat */}
          <button
            onClick={() => {
              if (state === "idle") window.yomi.triggerAnalyze()
            }}
            onMouseEnter={(e) => {
              if (state !== "idle") return
              e.currentTarget.style.color = t.hambColorActive
              e.currentTarget.style.background = t.hambBgActive
              e.currentTarget.style.borderColor = t.hambBorderActive
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color =
                state === "idle" ? t.hambColor : "rgba(255,255,255,0.22)"
              e.currentTarget.style.background = t.hambBg
              e.currentTarget.style.borderColor = t.hambBorder
            }}
            style={{
              background: t.hambBg,
              border: `1px solid ${t.hambBorder}`,
              borderRadius: 5,
              cursor: state === "idle" ? "pointer" : "default",
              color: state === "idle" ? t.hambColor : "rgba(255,255,255,0.22)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              height: 22,
              flexShrink: 0,
              transition: "all .15s",
            }}
            title="Analyze my screen (Ctrl+S)"
          >
            <ScreenshotSVG />
            <span
              style={{
                fontSize: 11,
                fontFamily: UI_FONT,
                letterSpacing: "0.03em",
                fontWeight: 500,
              }}
            >
              Analyze
            </span>
          </button>

          {/* Sound toggle button */}
          <button
            onClick={toggleTts}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = t.hambColorActive
              e.currentTarget.style.background = t.hambBgActive
              e.currentTarget.style.borderColor = t.hambBorderActive
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = ttsEnabled ? t.hambColor : "rgba(255,255,255,0.35)"
              e.currentTarget.style.background = t.hambBg
              e.currentTarget.style.borderColor = t.hambBorder
            }}
            style={{
              background: t.hambBg,
              border: `1px solid ${t.hambBorder}`,
              borderRadius: 5,
              cursor: "pointer",
              color: ttsEnabled ? t.hambColor : "rgba(255,255,255,0.35)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              height: 22,
              flexShrink: 0,
              transition: "all .15s",
            }}
            title={ttsEnabled ? "Sound on" : "Muted"}
          >
            {ttsEnabled ? <SpeakerOnSVG /> : <SpeakerOffSVG />}
            <span
              style={{
                fontSize: 11,
                fontFamily: UI_FONT,
                letterSpacing: "0.03em",
                fontWeight: 500,
              }}
            >
              {ttsEnabled ? "Sound" : "Muted"}
            </span>
          </button>

          {/* Integrations button — opens dashboard in browser */}
          <button
            onClick={() => window.yomi.openIntegrationsPage()}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = t.hambColorActive
              e.currentTarget.style.background = t.hambBgActive
              e.currentTarget.style.borderColor = t.hambBorderActive
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = t.hambColor
              e.currentTarget.style.background = t.hambBg
              e.currentTarget.style.borderColor = t.hambBorder
            }}
            style={{
              background: t.hambBg,
              border: `1px solid ${t.hambBorder}`,
              borderRadius: 5,
              cursor: "pointer",
              color: t.hambColor,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 7px",
              height: 22,
              flexShrink: 0,
              transition: "all .15s",
            }}
            title="Integrations"
            className="no-drag"
          >
            <IntegrationsSVG />
            <span style={{ fontSize: 11, fontFamily: UI_FONT, letterSpacing: "0.03em", fontWeight: 500 }}>
              Integrations
            </span>
          </button>

          {/* Confirm prompt for a risky action awaiting the user's go-ahead */}
          {pendingAct && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginLeft: 4,
                padding: "2px 8px",
                height: 22,
                borderRadius: 5,
                background: "rgba(220,38,38,0.16)",
                border: "1px solid rgba(248,113,113,0.5)",
                color: "rgba(254,226,226,0.95)",
                fontSize: 11,
                fontFamily: UI_FONT,
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  maxWidth: 150,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {pendingAct.label}?
              </span>
              <button
                onClick={() => {
                  window.yomi.confirmAct(pendingAct.id, true)
                  clearPendingAct()
                }}
                style={{
                  cursor: "pointer",
                  border: "none",
                  borderRadius: 4,
                  padding: "1px 7px",
                  fontWeight: 700,
                  background: "rgba(34,197,94,0.85)",
                  color: "#04210f",
                  fontFamily: UI_FONT,
                  fontSize: 11,
                }}
              >
                Yes
              </button>
              <button
                onClick={() => {
                  window.yomi.confirmAct(pendingAct.id, false)
                  clearPendingAct()
                }}
                style={{
                  cursor: "pointer",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 4,
                  padding: "1px 7px",
                  background: "transparent",
                  color: "rgba(255,255,255,0.85)",
                  fontFamily: UI_FONT,
                  fontSize: 11,
                }}
              >
                No
              </button>
            </div>
          )}

          {state === "listening" && (
            <>
              <Chip
                label="Send"
                keys={["Enter"]}
                hot={true}
                onClick={() => window.yomi.stopListening()}
              />
              <Chip
                label="Stop"
                keys={["Esc"]}
                hot={false}
                onClick={() => window.yomi.requestEscape()}
              />
            </>
          )}
          {state === "text-input" && <Chip label="Cancel" keys={["Esc"]} hot={false} />}

          <button
            className="no-drag yomi-menu-zone"
            onClick={() => {
              if (!menuOpen) onMenuOpen()
            }}
            onMouseEnter={(e) => {
              onMenuOpen()
              e.currentTarget.style.color = t.hambColorActive
              e.currentTarget.style.background = t.hambBgActive
              e.currentTarget.style.borderColor = t.hambBorderActive
            }}
            onMouseLeave={(e) => {
              onMenuScheduleClose()
              if (!menuOpen) {
                e.currentTarget.style.color = t.hambColor
                e.currentTarget.style.background = t.hambBg
                e.currentTarget.style.borderColor = t.hambBorder
              }
            }}
            style={{
              background: menuOpen ? t.hambBgActive : t.hambBg,
              border: `1px solid ${menuOpen ? t.hambBorderActive : t.hambBorder}`,
              borderRadius: 5,
              cursor: "pointer",
              color: menuOpen ? t.hambColorActive : t.hambColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 22,
              flexShrink: 0,
              transition: "all .15s",
            }}
            title="Menu"
          >
            <HamburgerIcon />
          </button>
        </div>
      </div>
    </>
  )
}

// ── Notch — state display that hangs from the bottom of the toolbar ──────────────
// Drops down when Yomi is active (listening / processing / typing / speaking) and
// retracts when idle. Shows the per-state micro-loader + label + a dim context line.
function Notch({ state }: { state: HotkeyState }) {
  const { theme: t } = React.useContext(ThemeCtx)
  const entries = useYomiStore((s) => s.entries)
  const active = state !== "idle"

  let statusLabel = ""
  let loaderKind: LoaderKind = "processing"
  if (state === "listening") {
    statusLabel = "Listening"
    loaderKind = "listening"
  } else if (state === "text-input") {
    statusLabel = "Typing"
    loaderKind = "typing"
  } else if (state === "processing") {
    statusLabel = "Processing"
    loaderKind = "processing"
  }

  const latest = entries[entries.length - 1]
  let contextText: string | null = null
  // eslint-disable-next-line no-constant-condition
  if (false) {
    // automation context — disabled
  } else if (state === "listening") contextText = "Esc to stop"
  else if (state === "text-input") contextText = "text only, no voice"
  else if (state === "processing") contextText = latest?.transcript?.trim() || "Working on it"

  const notchBg = t.toolbarBg
  const EAR = 12 // concave-ear radius

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="notch"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          // -1px overlap so the notch reads as fused to the toolbar's bottom edge.
          style={{ position: "relative", marginTop: -1, flexShrink: 0, zIndex: 5 }}
          className="yomi-hit-area no-drag"
        >
          {/* concave ears flare the tab up into the toolbar's bottom edge */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: -EAR,
              width: EAR,
              height: EAR,
              background: `radial-gradient(circle at 0% 100%, transparent ${EAR}px, ${notchBg} ${EAR + 0.5}px)`,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              right: -EAR,
              width: EAR,
              height: EAR,
              background: `radial-gradient(circle at 100% 100%, transparent ${EAR}px, ${notchBg} ${EAR + 0.5}px)`,
            }}
          />
          {/* tab body — square top (meets the toolbar), rounded bottom */}
          <div
            style={{
              minWidth: 200,
              maxWidth: 320,
              background: notchBg,
              borderBottomLeftRadius: 18,
              borderBottomRightRadius: 18,
              boxShadow: state === "listening" ? t.appShadowListen : t.appShadow,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              padding: "8px 18px 9px",
            }}
          >
            {contextText && (
              <span
                style={{
                  fontSize: 10.5,
                  fontFamily: UI_FONT,
                  letterSpacing: "0.01em",
                  color: "rgba(255,255,255,0.45)",
                  maxWidth: 280,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {contextText}
              </span>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <StateLoader kind={loaderKind} accent={t.dotPulse} faint={t.dotSpinFaint} />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: UI_FONT,
                  letterSpacing: "-0.01em",
                  lineHeight: 1,
                  color: "rgba(255,255,255,0.95)",
                }}
              >
                {statusLabel}
              </span>
            </div>
            {/* automation run details removed — desktop automation hidden */}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Chip({
  label,
  keys,
  hot,
  onClick,
}: {
  label: string
  keys: string[]
  hot: boolean
  onClick?: () => void
}) {
  const { theme: t } = React.useContext(ThemeCtx)
  const Tag = onClick ? "button" : "div"
  return (
    <Tag
      {...(onClick ? { onClick } : {})}
      onMouseEnter={
        onClick
          ? (e: React.MouseEvent<HTMLElement>) => {
              e.currentTarget.style.opacity = "0.75"
            }
          : undefined
      }
      onMouseLeave={
        onClick
          ? (e: React.MouseEvent<HTMLElement>) => {
              e.currentTarget.style.opacity = "1"
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        background: hot ? t.chipBgHot : t.chipBgCold,
        border: `1px solid ${hot ? t.chipBorderHot : t.chipBorderCold}`,
        borderRadius: 5,
        padding: "2px 7px 2px 6px",
        transition: "all .2s",
        cursor: onClick ? "pointer" : "default",
        ...(onClick ? { fontFamily: "inherit" } : {}),
      }}
    >
      <span
        style={{
          fontSize: 11.5,
          fontFamily: UI_FONT,
          color: hot ? t.chipTextHot : t.chipTextCold,
          letterSpacing: "0.01em",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 2 }}>
        {keys.map((k, i) => (
          <Key key={i} label={k} />
        ))}
      </div>
    </Tag>
  )
}

// ── Sign-In Panel ──────────────────────────────────────────────────────────────

const GitHubIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
)

const GoogleIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
)

function OAuthButton({
  icon,
  label,
  loading,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  loading: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="no-drag"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        width: "100%",
        padding: "13px 18px",
        borderRadius: 10,
        background: "rgba(255,224,194,0.05)",
        border: "1px solid rgba(255,224,194,0.12)",
        fontSize: 13.5,
        fontWeight: 500,
        color: "var(--text)",
        fontFamily: UI_FONT,
        cursor: disabled ? "default" : "pointer",
        transition: "all .15s",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "rgba(255,224,194,0.1)"
          e.currentTarget.style.borderColor = "rgba(255,200,130,0.35)"
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "rgba(255,224,194,0.05)"
          e.currentTarget.style.borderColor = "rgba(255,224,194,0.12)"
        }
      }}
    >
      {loading ? (
        <div
          style={{
            width: 17,
            height: 17,
            borderRadius: "50%",
            border: "2px solid rgba(255,224,194,0.12)",
            borderTopColor: "rgba(255,200,130,0.8)",
            animation: "spin .75s linear infinite",
            flexShrink: 0,
          }}
        />
      ) : (
        icon
      )}
      {label}
    </button>
  )
}

function SignInPanel({
  isWaiting,
  loadingProvider,
  error,
  lastProvider,
  onSignIn,
}: {
  isWaiting: boolean
  loadingProvider: "github" | "google" | null
  error: string
  lastProvider: "github" | "google" | null
  onSignIn: (provider: "github" | "google") => void
}) {
  const busy = loadingProvider !== null

  return (
    <div
      className="no-drag"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 24px",
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <YomiLogoMark size={40} />
      </div>
      <div
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 30,
          fontWeight: 700,
          color: "var(--text)",
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
          marginBottom: 7,
        }}
      >
        Get started
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "rgba(175,163,145,0.7)",
          lineHeight: 1.6,
          marginBottom: 26,
        }}
      >
        Sign in to your Yomi account.
      </div>

      {isWaiting ? (
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              border: "2.5px solid rgba(255,255,255,0.1)",
              borderTopColor: "var(--accent)",
              animation: "spin .75s linear infinite",
            }}
          />
          <div style={{ fontSize: 13.5, color: "var(--dim)", lineHeight: 1.6 }}>
            Opening your browser to sign in…
          </div>
          <button
            onClick={() => onSignIn(lastProvider ?? "github")}
            className="no-drag"
            style={{
              background: "var(--accent-d)",
              border: "1px solid var(--border-hi)",
              borderRadius: 8,
              padding: "8px 22px",
              fontSize: 12,
              color: "var(--accent)",
              fontFamily: UI_FONT,
              cursor: "pointer",
              transition: "background .15s",
            }}
          >
            Open browser again
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 340 }}>
            <OAuthButton
              icon={<GitHubIcon />}
              label="Continue with GitHub"
              loading={loadingProvider === "github"}
              disabled={busy}
              onClick={() => onSignIn("github")}
            />
            <OAuthButton
              icon={<GoogleIcon />}
              label="Continue with Google"
              loading={loadingProvider === "google"}
              disabled={busy}
              onClick={() => onSignIn("google")}
            />
          </div>

          {error && (
            <div
              style={{
                fontSize: 12,
                color: "var(--error)",
                marginTop: 18,
                lineHeight: 1.5,
                maxWidth: 340,
              }}
            >
              {error}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── App ────────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const {
    authState,
    authError,
    setAuthState,
    hotkeyState,
    entries,
    ttsEnabled,
    subscription,
    handleSseEvent,
    setHotkeyState,
    stopActivePlayback,
    dismissEntry,
    setSubscription,
    setSubscriptionLoading,
  } = useYomiStore()

  const [loadingProvider, setLoadingProvider] = React.useState<"github" | "google" | null>(null)
  const [lastProvider, setLastProvider] = React.useState<"github" | "google" | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [updateNotice, setUpdateNotice] = React.useState<UpdateNotice>(null)
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const menuOpenedAtRef = useRef<number>(0)
  const menuCardRef = useRef<HTMLDivElement | null>(null)

  const openMenu = useCallback(() => {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current)
      menuCloseTimerRef.current = null
    }
    menuOpenedAtRef.current = Date.now()
    setMenuOpen((open) => (open ? open : true))
  }, [])

  // Called when cursor leaves the button, bridge, or card.
  const scheduleMenuClose = useCallback(() => {
    // Ignore spurious close calls within 400ms of open (e.g. OS mouseleave from window resize)
    if (Date.now() - menuOpenedAtRef.current < 400) return
    if (menuCloseTimerRef.current) clearTimeout(menuCloseTimerRef.current)
    menuCloseTimerRef.current = setTimeout(() => {
      menuCloseTimerRef.current = null
      if (document.querySelector(".yomi-menu-zone:hover")) return
      setMenuOpen(false)
    }, 220)
  }, [])

  const cancelMenuClose = useCallback(() => {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current)
      menuCloseTimerRef.current = null
    }
  }, [])

  // Immediate close — framer-motion AnimatePresence handles the exit animation
  const closeMenuNow = useCallback(() => {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current)
      menuCloseTimerRef.current = null
    }
    setMenuOpen(false)
  }, [])

  const rootRef = useRef<HTMLDivElement>(null)
  const entriesRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sysStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<AudioWorkletNode | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const workletReadyRef = useRef<Promise<void> | null>(null)
  const audioPlayingRef = useRef(false)
  const localAudioQueue = useRef<string[]>([])
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const audioTokenRef = useRef(0)
  const draggingRef = useRef(false)

  const resetAudioPlayback = useCallback(() => {
    audioTokenRef.current += 1
    localAudioQueue.current = []
    const src = audioSourceRef.current
    audioSourceRef.current = null
    if (src) {
      try {
        src.onended = null
        src.stop()
      } catch {
        /* already stopped */
      }
      try {
        src.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    audioPlayingRef.current = false
  }, [])

  const playQueuedAudio = useCallback(() => {
    if (audioPlayingRef.current) return
    const ctx = ctxRef.current
    if (!ctx) return

    audioPlayingRef.current = true
    const token = audioTokenRef.current

    const playNext = async () => {
      while (token === audioTokenRef.current && localAudioQueue.current.length > 0) {
        const b64 = localAudioQueue.current.shift()!
        const bin = atob(b64)
        const buf = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)

        try {
          const ab = await ctx.decodeAudioData(buf.buffer)
          if (token !== audioTokenRef.current) break

          const src = ctx.createBufferSource()
          const gain = ctx.createGain()
          audioSourceRef.current = src
          src.buffer = ab
          gain.gain.value = TTS_PLAYBACK_GAIN
          src.connect(gain)
          gain.connect(ctx.destination)

          if (ctx.state === "suspended") await ctx.resume()
          if (token !== audioTokenRef.current) {
            src.disconnect()
            gain.disconnect()
            break
          }

          src.start()
          await new Promise<void>((resolve) => {
            src.onended = () => {
              if (audioSourceRef.current === src) audioSourceRef.current = null
              gain.disconnect()
              resolve()
            }
          })
        } catch (e) {
          if (token === audioTokenRef.current) console.warn("[yomi/audio] playback failed:", e)
        }
      }

      if (token === audioTokenRef.current) audioPlayingRef.current = false
    }

    void playNext()
  }, [])

  const enqueueAudioChunk = useCallback(
    (base64: string) => {
      localAudioQueue.current.push(base64)
      playQueuedAudio()
    },
    [playQueuedAudio],
  )

  // Listen to auth status events from main process
  useEffect(() => {
    return window.yomi.onAuthStatus((status, detail) => {
      if (status === "ok") {
        setLoadingProvider(null)
        setAuthState("authenticated")
      } else if (status === "needed") {
        setLoadingProvider(null)
        setAuthState("unauthenticated")
      } else if (status === "waiting") setAuthState("waiting")
      else if (status === "error") {
        setLoadingProvider(null)
        setAuthState("unauthenticated", detail ?? "Sign-in failed — try again")
      }
    })
  }, [setAuthState])

  const handleSignIn = useCallback(
    (provider: "github" | "google") => {
      setLoadingProvider(provider)
      setLastProvider(provider)
      setAuthState("waiting")
      window.yomi.startAuth(provider)
    },
    [setAuthState],
  )

  // Fetch subscription info when authenticated
  useEffect(() => {
    if (authState !== "authenticated") return
    setSubscriptionLoading(true)
    window.yomi
      .getSubscriptionInfo()
      .then((info) => {
        setSubscription(info)
        setSubscriptionLoading(false)
      })
      .catch(() => {
        setSubscriptionLoading(false)
      })
  }, [authState, setSubscription, setSubscriptionLoading])

  // Listen for subscription updates from main
  useEffect(() => {
    return window.yomi.onSubscriptionUpdate((info) => {
      setSubscription(info)
    })
  }, [setSubscription])

  useEffect(() => {
    const offAvailable = window.yomi.onUpdateAvailable((info) => {
      setUpdateNotice({ status: "available", ...info })
    })
    const offDownloaded = window.yomi.onUpdateDownloaded((info) => {
      setUpdateNotice({ status: "downloaded", ...info })
    })
    const offError = window.yomi.onUpdateError((info) => {
      console.warn("[yomi] updater error:", info.message)
    })
    return () => {
      offAvailable()
      offDownloaded()
      offError()
    }
  }, [])

  const handleUpdateClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (!updateNotice) return
      if (updateNotice.status === "downloaded") {
        window.yomi.installUpdate()
        return
      }
      if (updateNotice.status === "available") {
        setUpdateNotice({ status: "downloading", version: updateNotice.version })
        window.yomi.downloadUpdate()
      }
    },
    [updateNotice],
  )

  // Size the Electron shell to the root overlay only; transient hit areas animate.
  React.useLayoutEffect(() => {
    let frame = 0
    let lastHeight = 0
    const compactHeight = 96

    const measureAndResize = () => {
      if (authState === "checking") {
        window.yomi.resize(880, compactHeight)
        lastHeight = compactHeight
        return
      }

      const minHeight = authState === "unauthenticated" || authState === "waiting" ? 460 : compactHeight
      const root = rootRef.current
      // position:absolute children don't affect scrollHeight. Use offsetTop+offsetHeight
      // (layout dimensions, unaffected by framer-motion transforms) to get the true bottom.
      const menuBottom = menuCardRef.current
        ? menuCardRef.current.offsetTop + menuCardRef.current.offsetHeight
        : 0
      const nextHeight = Math.ceil(Math.max(
        minHeight,
        (root?.scrollHeight ?? 0),
        menuBottom,
      ))
      if (Math.abs(nextHeight - lastHeight) < 2) return
      lastHeight = nextHeight
      window.yomi.resize(880, nextHeight)
    }

    const scheduleResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measureAndResize)
    }

    const resizeObserver = new ResizeObserver(scheduleResize)
    if (rootRef.current) resizeObserver.observe(rootRef.current)
    if (menuCardRef.current) resizeObserver.observe(menuCardRef.current)

    scheduleResize()
    const settleFrame = requestAnimationFrame(scheduleResize)

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(settleFrame)
      resizeObserver.disconnect()
    }
  }, [authState, entries.length, hotkeyState, updateNotice, menuOpen])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest(".drag") || t.closest(".no-drag")) return
      draggingRef.current = true
      window.yomi.startDrag(e.screenX, e.screenY)
    }
    const onMove = (e: MouseEvent) => {
      if (draggingRef.current) window.yomi.moveDrag(e.screenX, e.screenY)
    }
    const onUp = () => {
      draggingRef.current = false
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [])

  useEffect(() => {
    const c1 = window.yomi.onEvent((event) => {
      if (event.type === "transcript") resetAudioPlayback()
      if (event.type === "audio_chunk" && useYomiStore.getState().ttsEnabled) {
        enqueueAudioChunk(event.base64)
      }
      handleSseEvent(event)
    })
    const c2 = window.yomi.onStateChange(setHotkeyState)
    return () => {
      c1()
      c2()
    }
  }, [enqueueAudioChunk, handleSseEvent, resetAudioPlayback, setHotkeyState])

  useEffect(() => {
    const ctx = new AudioContext({ sampleRate: 16000 })
    ctxRef.current = ctx
    const code = `
      class PCMProcessor extends AudioWorkletProcessor {
        process(inputs) {
          const inp=inputs[0]?.[0]
          if (inp?.length) { const c=new Float32Array(inp); this.port.postMessage(c.buffer,[c.buffer]) }
          return true
        }
      }
      registerProcessor('pcm-processor',PCMProcessor)
    `
    const blob = new Blob([code], { type: "application/javascript" })
    const url = URL.createObjectURL(blob)
    workletReadyRef.current = ctx.audioWorklet
      .addModule(url)
      .catch((err) => console.error("[yomi/worklet] addModule failed:", err))
      .finally(() => URL.revokeObjectURL(url))
    return () => {
      ctx.close().catch(() => {})
      ctxRef.current = null
      workletReadyRef.current = null
    }
  }, [])

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        streamRef.current = s
      })
      .catch((err) => console.error("[yomi/mic] getUserMedia(audio) failed:", err))
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Grab Windows system audio loopback once on mount; mic-only is the fallback.
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const id = await window.yomi.getDesktopSourceId()
        if (!id || !active) return
        const s = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: id },
          } as MediaTrackConstraints,
          video: {
            mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: id },
          } as MediaTrackConstraints,
        })
        // Drop video tracks — we only want the audio loopback
        s.getVideoTracks().forEach((t) => t.stop())
        if (active) sysStreamRef.current = s
        else s.getAudioTracks().forEach((t) => t.stop())
      } catch {
        /* no permission: silently fall back to mic-only */
      }
    })()
    return () => {
      active = false
      sysStreamRef.current?.getTracks().forEach((t) => t.stop())
      sysStreamRef.current = null
    }
  }, [])

  useEffect(() => {
    if (hotkeyState !== "listening") {
      processorRef.current?.disconnect()
      processorRef.current = null
      return
    }
    // Starting a new voice query: stop any in-progress TTS playback.
    resetAudioPlayback()
    let cancelled = false
    let micSrc: MediaStreamAudioSourceNode | null = null
    let sysSrc: MediaStreamAudioSourceNode | null = null
    let proc: AudioWorkletNode | null = null
    // Mic-only VAD: a second worklet tap on the mic alone (not the system-audio
    // loopback) so app/TTS sound can't fool end-of-speech detection.
    let vadProc: AudioWorkletNode | null = null
    let stopped = false // guard so we only auto-stop once per listening session
    const vad = new EnergyVad({ sampleRate: 16000, silenceHangoverMs: VAD_SILENCE_HANGOVER_MS })
    let maxTimer: ReturnType<typeof setTimeout> | null = null
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null
    const clearTimers = () => {
      if (maxTimer) clearTimeout(maxTimer)
      if (inactivityTimer) clearTimeout(inactivityTimer)
      maxTimer = inactivityTimer = null
    }
    const armInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer)
      // No speech at all for a while → leave the hands-free loop entirely.
      inactivityTimer = setTimeout(() => {
        if (!stopped) {
          stopped = true
          clearTimers()
          window.yomi.requestEscape()
        }
      }, VAD_INACTIVITY_MS)
    }
    ;(async () => {
      await workletReadyRef.current
      if (cancelled) return
      const stream = streamRef.current,
        ctx = ctxRef.current
      if (!ctx) return
      // No mic stream means getUserMedia failed (permission/device). Surface it instead
      // of recording silence that later resets with no feedback.
      if (!stream) {
        console.error("[yomi/mic] no microphone stream available when listening started")
        useYomiStore.getState().handleSseEvent({
          type: "error",
          message: "Microphone unavailable — check mic permissions.",
        })
        return
      }
      if (ctx.state === "suspended") await ctx.resume()
      if (cancelled) return
      try {
        proc = new AudioWorkletNode(ctx, "pcm-processor")
      } catch (err) {
        console.error("[yomi/worklet] failed to create AudioWorkletNode:", err)
        useYomiStore
          .getState()
          .handleSseEvent({ type: "error", message: "Audio engine failed to start." })
        return
      }
      proc.port.onmessage = (e) => window.yomi.sendAudioChunk(e.data as ArrayBuffer, 16000)
      // Mic input (always present)
      micSrc = ctx.createMediaStreamSource(stream)
      micSrc.connect(proc)
      // Mix in system/loopback audio so Yomi can hear background sound (videos, meetings).
      // VAD stays mic-only (line below) so TTS or background music won't auto-stop the turn.
      const sysStream = sysStreamRef.current
      if (sysStream && sysStream.getAudioTracks().some((t) => t.readyState === "live")) {
        sysSrc = ctx.createMediaStreamSource(sysStream)
        sysSrc.connect(proc)
      }
      proc.connect(ctx.destination)
      processorRef.current = proc

      // Mic-only VAD tap → auto-stop on silence so the user never presses Enter.
      try {
        vadProc = new AudioWorkletNode(ctx, "pcm-processor")
        vadProc.port.onmessage = (e) => {
          if (stopped) return
          const frame = new Float32Array(e.data as ArrayBuffer)
          const { hasSpeech, speechEnd } = vad.processFrame(frame)
          if (hasSpeech) armInactivity() // reset the "said nothing" timer while talking
          if (speechEnd) {
            stopped = true
            clearTimers()
            window.yomi.stopListening() // end this utterance and process it
          }
        }
        micSrc.connect(vadProc) // mic only — sysSrc is deliberately NOT connected here
        vadProc.connect(ctx.destination) // keeps the node pulled; emits silence
        maxTimer = setTimeout(() => {
          if (!stopped) {
            stopped = true
            clearTimers()
            window.yomi.stopListening()
          }
        }, VAD_MAX_UTTERANCE_MS)
        armInactivity()
      } catch (err) {
        // VAD is best-effort; manual Enter/Stop still works if the tap fails.
        console.warn("[yomi/vad] mic VAD tap failed:", err)
      }
    })()
    return () => {
      cancelled = true
      clearTimers()
      micSrc?.disconnect()
      sysSrc?.disconnect()
      proc?.disconnect()
      vadProc?.disconnect()
      processorRef.current = null
    }
  }, [hotkeyState])

  // Stop in-flight audio immediately when TTS is toggled off.
  useEffect(() => {
    if (!ttsEnabled) {
      resetAudioPlayback()
    }
  }, [ttsEnabled, resetAudioPlayback])

  // Global shortcuts consume Escape before the renderer sees it, so we get a
  // dedicated IPC instead.  Stop audio and dismiss the active streaming entry.
  useEffect(() => {
    return window.yomi.onStopAudio(() => {
      resetAudioPlayback()
      stopActivePlayback()
    })
  }, [resetAudioPlayback, stopActivePlayback])

  // Fallback: if globalShortcut("Escape") failed to register (common on some Windows setups),
  // the keypress reaches the window when focused — forward it to main via IPC.
  // When the global shortcut IS registered it consumes the key and this never fires.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.yomi.requestEscape()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const hasContent = entries.length > 0 || hotkeyState === "text-input"
  const isListening = hotkeyState === "listening"
  const { theme: t } = React.useContext(ThemeCtx)
  const toolbarBg = t.bg
  const chatSurfaceBg = t.surface
  const activeEntry = entries[entries.length - 1]

  useEffect(() => {
    const el = entriesRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    })
  }, [activeEntry?.id, activeEntry?.text, activeEntry?.isStreaming])

  const handleProfileNameSave = useCallback(
    async (name: string) => {
      const updated = await window.yomi.updateProfileName(name)
      setSubscription(updated)
    },
    [setSubscription],
  )

  useEffect(() => {
    const sendHitRegions = () => {
      const regions = Array.from(document.querySelectorAll<HTMLElement>(".yomi-hit-area"))
        .map((el) => {
          const r = el.getBoundingClientRect()
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
          }
        })
        .filter((r) => r.width > 0 && r.height > 0)
      window.yomi.setHitRegions(regions)
    }

    const resizeObserver = new ResizeObserver(sendHitRegions)
    const mutationObserver = new MutationObserver(sendHitRegions)
    resizeObserver.observe(document.body)
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    })
    window.addEventListener("resize", sendHitRegions)
    requestAnimationFrame(sendHitRegions)
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", sendHitRegions)
      window.yomi.setHitRegions([])
    }
  }, [authState, entries.length, hotkeyState, menuOpen, updateNotice])

  // ── Sign-in states ──────────────────────────────────────────────────────────

  if (authState === "checking") {
    // Transparent while we verify the stored token — barely visible
    return <div style={{ height: "100vh", background: "transparent" }} />
  }

  if (authState === "unauthenticated" || authState === "waiting") {
    return (
      <div
        className="yomi-hit-area drag"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: opaqueColor(t.toolbarBg),
          borderRadius: 18,
          overflow: "hidden",
          border: `1px solid ${t.borderHi}`,
          position: "relative",
        }}
      >
        <SignInPanel
          isWaiting={authState === "waiting"}
          loadingProvider={loadingProvider}
          error={authError}
          lastProvider={lastProvider}
          onSignIn={handleSignIn}
        />
      </div>
    )
  }

  // ── Authenticated UI ────────────────────────────────────────────────────────

  return (
    <div
      ref={rootRef}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative",
        minWidth: 0,
        boxSizing: "border-box",
      }}
    >
      {/* Toolbar pill — always visible, its own floating card */}
      <div
        className="yomi-hit-area"
        style={{
          flexShrink: 0,
          width: 880,
          maxWidth: "calc(100vw - 40px)",
          background: toolbarBg,
          border: isListening ? t.appBorderListen : t.appBorder,
          borderRadius: 12,
          boxShadow: isListening ? t.appShadowListen : t.appShadow,
          overflow: "hidden",
          transition: "border-color .3s, box-shadow .3s",
        }}
      >
        <Toolbar
          state={hotkeyState}
          plan={subscription?.plan}
          menuOpen={menuOpen}
          onMenuOpen={openMenu}
          onMenuScheduleClose={scheduleMenuClose}
        />
      </div>

      <AnimatePresence>
        {updateNotice && (
          <motion.div
            key="update-notice"
            className="yomi-hit-area no-drag"
            initial={{ y: -8, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -6, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            style={{
              marginTop: 6,
              width: 880,
              maxWidth: "calc(100vw - 40px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "9px 12px",
              borderRadius: 10,
              background: toolbarBg,
              border: `1px solid ${t.borderHi}`,
              boxShadow: "0 12px 30px rgba(0,0,0,0.38)",
              color: t.text,
              fontSize: 12,
              boxSizing: "border-box",
            }}
          >
            <span>
              {updateNotice.status === "available"
                ? `Yomi ${updateNotice.version} is available.`
                : updateNotice.status === "downloading"
                  ? `Downloading Yomi ${updateNotice.version}...`
                  : `Yomi ${updateNotice.version} is ready to install.`}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="no-drag"
                onClick={handleUpdateClick}
                disabled={updateNotice.status === "downloading"}
                style={{
                  border: `1px solid ${t.borderHi}`,
                  borderRadius: 8,
                  background: t.accentD,
                  color: t.text,
                  padding: "5px 9px",
                  fontSize: 11,
                  cursor: updateNotice.status === "downloading" ? "default" : "pointer",
                  opacity: updateNotice.status === "downloading" ? 0.7 : 1,
                }}
              >
                {updateNotice.status === "available"
                  ? "Download"
                  : updateNotice.status === "downloading"
                    ? "Downloading"
                    : "Restart"}
              </button>
              <button
                className="no-drag"
                onClick={() => setUpdateNotice(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: t.dim,
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                }}
                aria-label="Dismiss update notice"
              >
                ×
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notch — state display that hangs from the bottom of the toolbar */}
      <Notch state={hotkeyState} />

      {/* MissionControl disabled — desktop automation hidden */}

      {/* Chat content — no wrapper card; ResponsePanel and TextInputPanel are self-styled */}
      <AnimatePresence>
        {hasContent && (
          <motion.div
            key="chat-card"
            initial={{ y: 14, opacity: 0, scale: 0.99 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -8, opacity: 0, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            style={{
              marginTop: 8,
              width: 880,
              maxWidth: "calc(100vw - 40px)",
              maxHeight: 600,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            {hotkeyState === "text-input" && <TextInputPanel surfaceBg={chatSurfaceBg} />}

            {entries.length > 0 && (
              <div
                ref={entriesRef}
                className="no-drag"
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: "auto",
                  overflowX: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                  // Round the scroll viewport so the chat card keeps its rounded
                  // corners while content scrolls (overflow clips to the radius).
                  borderRadius: 9,
                  overscrollBehavior: "contain",
                  scrollBehavior: "smooth",
                  scrollbarGutter: "stable",
                }}
              >
                {(() => {
                  const e = entries[entries.length - 1]!
                  return (
                    <ResponsePanel
                      key={e.id}
                      entry={e}
                      isActive={true}
                      surfaceBg={chatSurfaceBg}
                      onDismiss={() => dismissEntry(e.id)}
                    />
                  )
                })()}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Menu backdrop + card — rendered at App level so backdrop-filter on the
          toolbar wrapper doesn't create a fixed-position containing block that clips them */}
      {menuOpen && (
        <div onClick={closeMenuNow} style={{ position: "fixed", inset: 0, zIndex: 998 }} />
      )}
      <AnimatePresence>
        {menuOpen && (
          <MenuCard
            key="menu"
            subscription={subscription}
            plan={subscription?.plan}
            onProfileNameSave={handleProfileNameSave}
            onSignOut={() => window.yomi.signOut()}
            onClose={closeMenuNow}
            onHoverEnter={cancelMenuClose}
            onHoverLeave={scheduleMenuClose}
            cardRef={menuCardRef}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Theme Provider ─────────────────────────────────────────────────────────────

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = React.useState<ThemeId>(() => {
    const saved = localStorage.getItem("yomi:theme") as ThemeId | null
    const id: ThemeId = saved && saved in THEMES ? saved : "black"
    applyTheme(THEMES[id])
    return id
  })

  const handleSetTheme = React.useCallback((id: ThemeId) => {
    setThemeId(id)
    applyTheme(THEMES[id])
    localStorage.setItem("yomi:theme", id)
  }, [])

  return (
    <ThemeCtx.Provider value={{ theme: THEMES[themeId], setTheme: handleSetTheme }}>
      {children}
    </ThemeCtx.Provider>
  )
}

// ── Mount ──────────────────────────────────────────────────────────────────────

const root = document.getElementById("root")
if (root)
  createRoot(root).render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  )
