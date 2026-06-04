import { BrowserWindow, screen } from "electron"

let guideWin: BrowserWindow | null = null
let overlayOrigin = { x: 0, y: 0 }

const HTML = `<!DOCTYPE html>
<html><head><style>
* { margin:0; padding:0; box-sizing:border-box }
html, body { width:100%; height:100%; background:transparent; overflow:hidden; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif }
#buddy {
  position:absolute; left:50%; top:50%; display:none;
  width:30px; height:30px; transform:translate(-50%,-50%);
  color:#93c5fd; filter:drop-shadow(0 8px 22px rgba(0,0,0,.55));
  pointer-events:none; transition:opacity .18s ease;
}
#buddy svg { width:30px; height:30px; display:block }
#target, #pulse1, #pulse2 {
  position:absolute; display:none; left:50%; top:50%;
  border-radius:999px; transform:translate(-50%,-50%);
  pointer-events:none;
}
#target {
  width:18px; height:18px; background:rgba(96,165,250,.95);
  border:2px solid rgba(255,255,255,.95); box-shadow:0 0 28px rgba(59,130,246,.75);
}
#pulse1, #pulse2 {
  width:42px; height:42px; border:2px solid rgba(96,165,250,.56);
  animation:ripple 1.45s ease-out infinite;
}
#pulse2 { animation-delay:.55s }
#label {
  position:absolute; display:none; max-width:210px; padding:6px 9px;
  border-radius:8px; color:rgba(248,250,252,.96); font-size:12px; font-weight:650;
  background:rgba(8,13,25,.86); border:1px solid rgba(147,197,253,.24);
  box-shadow:0 12px 36px rgba(0,0,0,.45); backdrop-filter:blur(16px) saturate(150%);
  line-height:1.25; pointer-events:none;
}
#label .meta {
  display:block; color:rgba(147,197,253,.86); font-size:10px; font-weight:750;
  letter-spacing:.08em; text-transform:uppercase; margin-bottom:2px;
}
#label .text {
  display:block; white-space:normal; overflow-wrap:anywhere;
}
@keyframes ripple {
  0% { width:36px; height:36px; opacity:.76 }
  100% { width:112px; height:112px; opacity:0 }
}
</style></head>
<body>
<div id="pulse1"></div>
<div id="pulse2"></div>
<div id="target"></div>
<div id="buddy"><svg viewBox="0 0 32 32" fill="none" aria-hidden><path d="M5 3.5L24.5 15.2L16.2 18.4L12.1 27.8L5 3.5Z" fill="currentColor" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg></div>
<div id="label"></div>
<script>
let pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
let raf = 0
function place(id, x, y) {
  const el = document.getElementById(id)
  el.style.left = x + 'px'
  el.style.top = y + 'px'
}
function placeBuddy(x, y) {
  const el = document.getElementById('buddy')
  el.style.left = Math.max(12, x - 28) + 'px'
  el.style.top = Math.max(12, y - 34) + 'px'
  el.style.transform = 'translate(-50%,-50%) rotate(0deg)'
}
function labelPosition(x, y) {
  const pad = 10
  const gap = 18
  const labelW = 220
  const labelH = 58
  const choices = [
    { x: x + gap, y: y + gap },
    { x: x + gap, y: y - labelH - gap },
    { x: x - labelW - gap, y: y + gap },
    { x: x - labelW - gap, y: y - labelH - gap },
  ]
  const fits = choices.find((c) =>
    c.x >= pad &&
    c.y >= pad &&
    c.x + labelW <= window.innerWidth - pad &&
    c.y + labelH <= window.innerHeight - pad
  )
  const c = fits || choices[0]
  return {
    x: Math.max(pad, Math.min(window.innerWidth - labelW - pad, c.x)),
    y: Math.max(pad, Math.min(window.innerHeight - labelH - pad, c.y)),
  }
}
function showTarget(x, y, label, step, total) {
  cancelAnimationFrame(raf)
  const start = { ...pos }
  const end = { x, y }
  const c1 = { x: start.x + (end.x - start.x) * .35, y: start.y - 120 }
  const c2 = { x: start.x + (end.x - start.x) * .72, y: end.y + 80 }
  const started = performance.now()
  ;['buddy','target','pulse1','pulse2','label'].forEach(id => {
    const el = document.getElementById(id)
    el.style.display = 'block'
  })
  const lbl = document.getElementById('label')
  const meta = total > 1 ? 'STEP ' + step + ' / ' + total : 'CLICK THIS'
  lbl.innerHTML = '<span class="meta"></span><span class="text"></span>'
  lbl.querySelector('.meta').textContent = meta
  lbl.querySelector('.text').textContent = label || 'target'
  function bezier(t, a, b, c, d) {
    const mt = 1 - t
    return mt*mt*mt*a + 3*mt*mt*t*b + 3*mt*t*t*c + t*t*t*d
  }
  function tick(now) {
    const t = Math.min(1, (now - started) / 620)
    const ease = 1 - Math.pow(1 - t, 3)
    const bx = bezier(ease, start.x, c1.x, c2.x, end.x)
    const by = bezier(ease, start.y, c1.y, c2.y, end.y)
    pos = { x: bx, y: by }
    placeBuddy(bx, by)
    place('target', x, y); place('pulse1', x, y); place('pulse2', x, y)
    const labelPos = labelPosition(x, y)
    place('label', labelPos.x, labelPos.y)
    if (t < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}
function showInstruction(label, step, total) {
  cancelAnimationFrame(raf)
  ;['buddy','target','pulse1','pulse2'].forEach(id => { document.getElementById(id).style.display = 'none' })
  const lbl = document.getElementById('label')
  lbl.style.display = 'block'
  const meta = total > 1 ? 'STEP ' + step + ' / ' + total : 'GUIDE'
  lbl.innerHTML = '<span class="meta"></span><span class="text"></span>'
  lbl.querySelector('.meta').textContent = meta
  lbl.querySelector('.text').textContent = label || 'Follow this step'
  place('label', Math.round((window.innerWidth - 240) / 2), window.innerHeight - 96)
}
function hideTarget() {
  cancelAnimationFrame(raf)
  ;['buddy','target','pulse1','pulse2','label'].forEach(id => { document.getElementById(id).style.display = 'none' })
}
</script>
</body></html>`

export function createGuideOverlay(): void {
  const displays = screen.getAllDisplays()
  const minX = Math.min(...displays.map((d) => d.bounds.x))
  const minY = Math.min(...displays.map((d) => d.bounds.y))
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width))
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height))
  overlayOrigin = { x: minX, y: minY }
  guideWin = new BrowserWindow({
    width: maxX - minX,
    height: maxY - minY,
    x: minX,
    y: minY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    backgroundColor: "#00000000",
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  guideWin.setIgnoreMouseEvents(true)
  guideWin.setAlwaysOnTop(true, "screen-saver")
  guideWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  guideWin.webContents.on("will-navigate", (event) => event.preventDefault())
  const b64 = Buffer.from(HTML).toString("base64")
  guideWin.loadURL(`data:text/html;base64,${b64}`)
}

export function showGuidePoint(x: number, y: number): void {
  showGuideTarget(x, y, "target")
}

export function showGuideTarget(x: number, y: number, label = "target", step = 1, total = 1): void {
  if (!guideWin || guideWin.isDestroyed()) return
  if (!guideWin.isVisible()) guideWin.show()
  const localX = Math.round(x - overlayOrigin.x)
  const localY = Math.round(y - overlayOrigin.y)
  guideWin.webContents
    .executeJavaScript(`showTarget(${localX},${localY},${JSON.stringify(label)},${step},${total})`)
    .catch(() => {})
}

export function showGuideInstruction(label: string, step = 1, total = 1): void {
  if (!guideWin || guideWin.isDestroyed()) return
  if (!guideWin.isVisible()) guideWin.show()
  guideWin.webContents
    .executeJavaScript(`showInstruction(${JSON.stringify(label)},${step},${total})`)
    .catch(() => {})
}

export function hideGuidePoint(): void {
  if (!guideWin || guideWin.isDestroyed()) return
  guideWin.webContents
    .executeJavaScript(`hideTarget()`)
    .then(() => guideWin?.hide())
    .catch(() => guideWin?.hide())
}
