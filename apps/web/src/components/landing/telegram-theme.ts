// Telegram's light theme: the green doodle wallpaper, white incoming bubbles and
// pale-green outgoing ones with green read ticks.
export const TG = {
  bg: "#c6dba4",
  bar: "rgba(255,255,255,0.94)",
  incoming: "#ffffff",
  outgoing: "#e4fbcf",
  text: "#0f1419",
  muted: "#8d99a6",
  outMuted: "#4fae4e",
  accent: "#3390ec",
  // translucent chips over the wallpaper: date pills, service notes, inline buttons
  glass: "rgba(62, 96, 52, 0.32)",
  glassHover: "rgba(62, 96, 52, 0.45)",
}

// Doodles tiled over a soft green-to-yellow gradient, like Telegram's default wallpaper.
const DOODLES = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' fill='none' stroke='#3f6b2a' stroke-opacity='0.16' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M14 20l4-8 4 8-8-5h8z'/><circle cx='70' cy='18' r='7'/><path d='M100 40c6 0 6 8 0 8s-6 8 0 8'/><rect x='12' y='64' width='16' height='12' rx='3'/><path d='M16 64v-3h8v3'/><path d='M58 70l8 8m0-8l-8 8'/><path d='M92 88a8 8 0 1 0 12 0l-6-10z'/><path d='M30 100h14M37 93v14'/><path d='M66 104c4-6 10-6 14 0'/></svg>`,
)}")`

export const WALLPAPER = `${DOODLES}, linear-gradient(160deg, #dfe9b4 0%, #b8d6a2 45%, #cfe0a6 100%)`
