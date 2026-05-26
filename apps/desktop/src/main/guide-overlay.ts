import { BrowserWindow, screen } from "electron"

let guideWin: BrowserWindow | null = null

const HTML = `<!DOCTYPE html>
<html><head><style>
* { margin:0; padding:0; box-sizing:border-box }
body { background:transparent; overflow:hidden }
#dot {
  position:absolute; display:none;
  width:44px; height:44px;
  border-radius:50%;
  background:rgba(59,130,246,0.82);
  border:2.5px solid rgba(255,255,255,0.9);
  transform:translate(-50%,-50%);
  pointer-events:none;
}
#ring1, #ring2 {
  position:absolute;
  border-radius:50%;
  border:2px solid rgba(59,130,246,0.55);
  width:44px; height:44px;
  display:none;
  pointer-events:none;
}
@keyframes ripple {
  0%   { width:44px; height:44px; opacity:0.7; margin-left:-22px; margin-top:-22px }
  100% { width:120px; height:120px; opacity:0; margin-left:-60px; margin-top:-60px }
}
#ring1 { animation:ripple 1.6s ease-out infinite }
#ring2 { animation:ripple 1.6s ease-out infinite .65s }
</style></head>
<body>
<div id="dot"></div>
<div id="ring1"></div>
<div id="ring2"></div>
<script>
function showDot(x, y) {
  const ids = ['dot', 'ring1', 'ring2']
  ids.forEach(id => {
    const el = document.getElementById(id)
    el.style.left = x + 'px'
    el.style.top = y + 'px'
    el.style.display = 'block'
  })
}
function hideDot() {
  ;['dot','ring1','ring2'].forEach(id => { document.getElementById(id).style.display = 'none' })
}
</script>
</body></html>`

export function createGuideOverlay(): void {
  const { width, height } = screen.getPrimaryDisplay().bounds
  guideWin = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, focusable: false,
    show: false,
    backgroundColor: "#00000000", hasShadow: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  guideWin.setIgnoreMouseEvents(true)
  if (process.platform !== "darwin") guideWin.setAlwaysOnTop(true, "screen-saver")
  const b64 = Buffer.from(HTML).toString("base64")
  guideWin.loadURL(`data:text/html;base64,${b64}`)
}

export function showGuidePoint(x: number, y: number): void {
  if (!guideWin || guideWin.isDestroyed()) return
  if (!guideWin.isVisible()) guideWin.show()
  guideWin.webContents.executeJavaScript(`showDot(${x},${y})`).catch(() => {})
}

export function hideGuidePoint(): void {
  if (!guideWin || guideWin.isDestroyed()) return
  guideWin.webContents.executeJavaScript(`hideDot()`)
    .then(() => guideWin?.hide())
    .catch(() => guideWin?.hide())
}
