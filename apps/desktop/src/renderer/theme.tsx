import React from "react"

export type ThemeId = "amber" | "blue" | "green" | "violet" | "hotpink" | "purple" | "black"

export interface Theme {
  id: ThemeId
  label: string
  bg: string
  surface: string
  border: string
  borderHi: string
  text: string
  dim: string
  accent: string
  accentD: string
  accentG: string
  error: string
  errorD: string
  codeBg: string
  kw: string
  str: string
  num: string
  cmt: string
  fn: string
  codeText: string
  toolbarBg: string
  menuBg: string
  menuBorder: string
  menuShadow: string
  menuSep: string
  sectionLabel: string
  btnText: string
  btnHoverBg: string
  btnHoverText: string
  dangerText: string
  dangerHoverBg: string
  upgradeText: string
  upgradeBg: string
  upgradeBgHover: string
  upgradeBorder: string
  dotIdle: string
  dotPulse: string
  dotPulseGlow: string
  dotSpinFaint: string
  dotSpinBright: string
  lblIdle: string
  lblActive: string
  lblProcessing: string
  planText: string
  planBorder: string
  ttsOn: string
  ttsOff: string
  ttsHoverBg: string
  hambBg: string
  hambBgActive: string
  hambBorder: string
  hambBorderActive: string
  hambColor: string
  hambColorActive: string
  chipBgHot: string
  chipBgCold: string
  chipBorderHot: string
  chipBorderCold: string
  chipTextHot: string
  chipTextCold: string
  kbdBg: string
  kbdBorder: string
  kbdBorderB: string
  kbdText: string
  dragDot: string
  appBorder: string
  appBorderListen: string
  appShadow: string
  appShadowListen: string
  scrollThumb: string
  scrollThumbHover: string
  sliderTrack: string
  sliderThumb: string
  sliderThumbBorder: string
  sliderShadow: string
  sliderHoverShadow: string
  selectionBg: string
  placeholder: string
}

export const ThemeCtx = React.createContext<{ theme: Theme; setTheme: (id: ThemeId) => void }>({
  theme: {} as Theme,
  setTheme: () => {},
})

export function glassPanel(base: string, _glow: string): string {
  return base
}

export function glassBar(base: string): string {
  return base
}

export function opaqueColor(color: string): string {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  return m ? `rgb(${m[1]},${m[2]},${m[3]})` : color
}

export const UI_FONT = "'Inter', 'Segoe UI Variable', 'Segoe UI', sans-serif"
export const DISPLAY_FONT = "'Caveat', cursive"
export const CODE_FONT = "'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace"
