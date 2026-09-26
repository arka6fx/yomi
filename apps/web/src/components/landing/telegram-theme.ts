// Telegram's dark theme, with the purple outgoing bubbles from a real yomi chat.
export const TG = {
  bg: "#0e1621",
  bar: "#17212b",
  incoming: "#182533",
  outgoing: "linear-gradient(135deg, #8a4fe8 0%, #7440d8 100%)",
  accent: "#5eb5f7",
  muted: "#7f91a4",
}

// Faint doodles tiled behind the chat, like Telegram's default wallpaper.
export const WALLPAPER = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' fill='none' stroke='#fff' stroke-opacity='0.05' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M14 20l4-8 4 8-8-5h8z'/><circle cx='70' cy='18' r='7'/><path d='M100 40c6 0 6 8 0 8s-6 8 0 8'/><rect x='12' y='64' width='16' height='12' rx='3'/><path d='M16 64v-3h8v3'/><path d='M58 70l8 8m0-8l-8 8'/><path d='M92 88a8 8 0 1 0 12 0l-6-10z'/><path d='M30 100h14M37 93v14'/><path d='M66 104c4-6 10-6 14 0'/></svg>`,
)}")`
